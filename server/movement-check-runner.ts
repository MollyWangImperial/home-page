import express from "express";
import { fixRunnerPage, RUNNER_STEADY } from "./movement-check-fixes";

// The movement check's original camera runner (the Rehyn app's anonymous review runner) served from the companion's
// own origin, so the companion can show each task's full-screen demonstration before the task starts. The runner page
// is fetched from the Rehyn app unchanged except for four things:
// - its API calls go back to the Rehyn app (it builds them from its own origin, which here is the companion's);
// - its messages to the host go to this origin (it names the companion's Render origin, so local testing works too);
// - its startStep (inside its module, out of reach from other scripts) first asks window.__rehynHostDemos, which ...
// - ... a small script defines when the page is opened with host_demos=1: a task's first step announces "task_intro"
//   and waits once for the host's "host_continue" (the camera keeps running and set-up is done once).
// It also gets the fixes in movement-check-fixes.ts: steadier keypoints, no coin on the pinch target, and posture
// checks a seated patient's camera can measure.
// Its movement models load from the companion's own /vendor/mediapipe, byte-identical to the Rehyn app's.
// If the page no longer has what this relies on, the iframe is sent to the original runner unchanged.

export const RUNNER_UPSTREAM = "https://rehyn.onrender.com";
const API_ANCHOR = 'window.location.origin + "/api"';
const HOST_ORIGIN = '"https://rehyn-recovery-companion.onrender.com"';
const POST_ANCHOR = `postMessage(message,${HOST_ORIGIN})`;
const STEP_ANCHOR = "async function startStep(){";
/**
 * The first thing the runner's startStep does: ask the host hook (if any) to wait for this task's demonstration. Not
 * for pinch when the runner is about to skip it (hand opening never held alone: its own gate in startFunctionLadderTask).
 */
const STEP_WAIT = `${STEP_ANCHOR}
  try {
    const hostTask = tasks[currentTaskIdx];
    const hostOpening = hostTask && hostTask.id === "H3" && typeof taskResults !== "undefined" ? ((taskResults.find(row => row && row.task_id === "H4") || {}).metrics || {}).ladder : null;
    if (typeof window.__rehynHostDemos === "function" && !(hostOpening && !hostOpening.best_alone)) await window.__rehynHostDemos(hostTask, currentTaskIdx, tasks.length, currentStepIdx);
  } catch (error) { /* never in the way of the task */ }`;
/** How long a task waits for the host's demonstration before starting anyway (it then tells the host, which closes it). */
export const HOST_WAIT_MS = 600000;

/**
 * The hook, a classic script at the end of the body: it runs while the page is parsed, before the runner's module, so
 * __rehynHostDemos is there before any task starts. A task's first step announces the task and waits once for the host.
 */
export const RUNNER_HOOK = `<script>
(function(){
  if (new URLSearchParams(location.search).get("host_demos") !== "1" || window.parent === window) return;
  var post = function(data){ window.parent.postMessage(JSON.stringify(data), window.location.origin); };
  var introduced = {};
  window.__rehynHostDemos = function(task, index, total, stepIndex){
    if (!task || stepIndex !== 0 || introduced[index]) return Promise.resolve();
    introduced[index] = true;
    return new Promise(function(resolve){
      var done = false;
      var finish = function(){ if (done) return; done = true; window.removeEventListener("message", onMessage); clearTimeout(timer); resolve(); };
      var onMessage = function(event){
        if (event.source !== window.parent || event.origin !== window.location.origin) return;
        var data = event.data;
        if (typeof data === "string") { try { data = JSON.parse(data); } catch (error) { return; } }
        if (data && data.type === "host_continue" && data.task_id === task.id) finish();
      };
      window.addEventListener("message", onMessage);
      var timer = setTimeout(function(){ post({ type: "task_intro_timeout", task_id: task.id }); finish(); }, ${HOST_WAIT_MS});
      post({ type: "task_intro", task_id: task.id, task_index: index, task_count: total });
    });
  };
  post({ type: "host_demos_ready" });
})();
</script>`;

/** The runner page ready to serve from the companion, or null when it no longer has what this relies on. */
export function prepareRunnerHtml(html: string, upstream = RUNNER_UPSTREAM): string | null {
  const once = (anchor: string) => html.split(anchor).length === 2;
  if (!once(API_ANCHOR) || !once(STEP_ANCHOR) || !html.includes(POST_ANCHOR) || !html.includes("</body>")) return null;
  // The display, pinch and posture fixes (movement-check-fixes.ts), each skipped if the page is not as it expects.
  const fixed = fixRunnerPage(html);
  const scripts = fixed.steady ? `${RUNNER_STEADY}\n${RUNNER_HOOK}` : RUNNER_HOOK;
  // Function replacers, so nothing in the page or the hook is read as a "$" replacement pattern.
  return fixed.html
    .replace(API_ANCHOR, () => JSON.stringify(`${upstream}/api`))
    .replace(STEP_ANCHOR, () => STEP_WAIT)
    .split(POST_ANCHOR).join("postMessage(message,window.location.origin)")
    .replace(/<\/body>(?![\s\S]*<\/body>)/, () => `${scripts}\n</body>`);
}

type Fetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** The runner page itself (as opposed to a holding page shown while the Rehyn app wakes). */
const isRunnerPage = (html: string) => html.includes(STEP_ANCHOR) || html.includes("RehynAssessmentLadder");
const WAKING = "waking";

/**
 * GET /?<runner query>: the prepared runner page. The Rehyn app sleeps when idle (Render's free plan wakes in up to a
 * minute or so, and may answer with a holding page meanwhile), so a failed try or a page that is not the runner is
 * tried again after a short wait, all within `timeoutMs`. If the page still cannot be prepared (or is the runner but
 * changed, which another try will not fix), the iframe goes to the original runner unchanged (no demonstrations or
 * fixes; the host accepts its messages and lets it use the camera).
 */
export function createMovementCheckRunnerRouter({ upstream = RUNNER_UPSTREAM, fetchImpl = fetch as unknown as Fetch, timeoutMs = 100000, tries = 40, retryDelayMs = 3000 }: { upstream?: string; fetchImpl?: Fetch; timeoutMs?: number; tries?: number; retryDelayMs?: number } = {}) {
  // An Express app also initialises req/res helpers when mounted in Vite's Connect middleware.
  const router = express();
  /** The prepared page, "" for a runner page that cannot be prepared (final), "waking" for a holding page, or null for a failed try. */
  const attempt = async (url: string, waitMs: number): Promise<string | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: "text/html" } });
      if (!response.ok) throw new Error(`Runner unavailable (${response.status})`);
      const page = await response.text();
      return prepareRunnerHtml(page, upstream) ?? (isRunnerPage(page) ? "" : WAKING);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  router.get("/", async (req, res) => {
    const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    const original = `${upstream}/api/pose/review-runner${query}`;
    const deadline = Date.now() + timeoutMs;
    // A holding page is waited through until the deadline; failed tries (errors, timeouts, bad statuses: a waking
    // Render app may answer 502/503 at once for a while) count against `tries`, by default enough to fill the deadline.
    let html: string | null = null, failures = 0;
    for (;;) {
      const result = await attempt(original, Math.max(1, deadline - Date.now()));
      if (result !== null && result !== WAKING) { html = result; break; }
      if (result === null && ++failures >= Math.max(1, tries)) break;
      if (Date.now() + retryDelayMs >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
    if (!html) { res.redirect(302, original); return; }
    res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).send(html);
  });
  return router;
}
