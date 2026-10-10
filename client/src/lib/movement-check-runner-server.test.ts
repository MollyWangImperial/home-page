import { afterEach, describe, expect, it, vi } from "vitest";
import vm from "node:vm";
import type { Server } from "node:http";
import { createMovementCheckRunnerRouter, HOST_WAIT_MS, prepareRunnerHtml, RUNNER_HOOK, RUNNER_UPSTREAM } from "../../../server/movement-check-runner";

/** The parts of the live runner page the companion relies on, as the Rehyn app serves them (its main script is a module). */
const PAGE = `<!doctype html><html><body><script type="module">
const API_BASE = window.location.origin + "/api";
var tasks = [{ id: "T1" }, { id: "T3" }, { id: "H4" }, { id: "H3" }]; var currentTaskIdx = 0; var currentStepIdx = 0; var taskResults = [];
function postRN(data){
  const message=JSON.stringify(data);
  if(window.parent && window.parent!==window){
    window.parent.postMessage(message,"https://rehyn-recovery-companion.onrender.com");
  }
}
async function startStep(){ started.push(currentTaskIdx); return "started"; }
</script></body></html>`;

describe("the runner page served from the companion", () => {
  it("points the API at the Rehyn app, messages this origin, asks the hook first in startStep and adds the hook once", () => {
    const html = prepareRunnerHtml(PAGE)!;
    expect(html).toContain(`const API_BASE = "${RUNNER_UPSTREAM}/api";`);
    expect(html).not.toContain('window.location.origin + "/api"');
    expect(html).toContain("window.parent.postMessage(message,window.location.origin)");
    expect(html).not.toContain('"https://rehyn-recovery-companion.onrender.com"');
    const step = html.slice(html.indexOf("async function startStep(){"));
    expect(step.indexOf("await window.__rehynHostDemos(hostTask, currentTaskIdx, tasks.length, currentStepIdx)")).toBeGreaterThan(0);
    expect(step.indexOf("await window.__rehynHostDemos(")).toBeLessThan(step.indexOf("started.push"));
    expect(html.split(RUNNER_HOOK).length).toBe(2);
    expect(html.indexOf(RUNNER_HOOK)).toBeLessThan(html.indexOf("</body>"));
  });
  it("gives up (null) when the page no longer has what it relies on", () => {
    expect(prepareRunnerHtml(PAGE.replace('window.location.origin + "/api"', '"/api"'))).toBeNull();
    expect(prepareRunnerHtml(PAGE.replace("async function startStep(){", "async function beginStep(){"))).toBeNull();
    expect(prepareRunnerHtml(PAGE.replace('"https://rehyn-recovery-companion.onrender.com"', "parentOrigin"))).toBeNull();
    expect(prepareRunnerHtml(PAGE.replace("</body>", ""))).toBeNull();
  });
});

/** The prepared page in a sandbox, as a browser runs it: the hook while parsing, then the runner's module. */
function runnerPage(search = "?host_demos=1", framed = true) {
  const posted: { type: string; task_id?: string; task_index?: number; task_count?: number }[] = [];
  const listeners = new Set<(event: { source: unknown; origin: string; data: unknown }) => void>();
  const parent = { postMessage: (message: string, origin: string) => { expect(origin).toBe("https://companion.test"); posted.push(JSON.parse(message)); } };
  const started: number[] = [];
  const context = vm.createContext({ URLSearchParams, JSON, setTimeout, clearTimeout, Promise, started, location: { search, origin: "https://companion.test" } }) as Record<string, any>;
  context.window = context;
  context.window.parent = framed ? parent : context;
  context.window.addEventListener = (type: string, listener: any) => { if (type === "message") listeners.add(listener); };
  context.window.removeEventListener = (type: string, listener: any) => { if (type === "message") listeners.delete(listener); };
  const html = prepareRunnerHtml(PAGE)!;
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  const hook = scripts.find(script => script.includes("__rehynHostDemos = function"))!;
  const runner = scripts.find(script => script.includes("async function startStep"))!.replace("const API_BASE", "var API_BASE");
  vm.runInContext(hook, context);
  vm.runInContext(runner, context);
  const send = (data: unknown, from: unknown = parent, origin = "https://companion.test") => listeners.forEach(listener => listener({ source: from, origin, data }));
  return { context, posted, started, send, listeners };
}

describe("the hook that waits for each task's demonstration", () => {
  afterEach(() => vi.useRealTimers());

  it("announces each task's first step and starts it only after the host's go-ahead for that task", async () => {
    const page = runnerPage();
    expect(page.posted).toEqual([{ type: "host_demos_ready" }]);
    const step = page.context.startStep();
    await Promise.resolve();
    expect(page.posted.at(-1)).toEqual({ type: "task_intro", task_id: "T1", task_index: 0, task_count: 4 });
    expect(page.started).toEqual([]);
    // Another task's go-ahead, another origin or another window do not start it.
    page.send(JSON.stringify({ type: "host_continue", task_id: "T3" }));
    page.send(JSON.stringify({ type: "host_continue", task_id: "T1" }), page.context.window.parent, "https://elsewhere.test");
    page.send(JSON.stringify({ type: "host_continue", task_id: "T1" }), {});
    await Promise.resolve();
    expect(page.started).toEqual([]);
    page.send(JSON.stringify({ type: "host_continue", task_id: "T1" }));
    await expect(step).resolves.toBe("started");
    expect(page.started).toEqual([0]);
    expect(page.listeners.size).toBe(0);
  });

  it("waits only once per task: later steps and a repeated first step start at once", async () => {
    const page = runnerPage();
    const first = page.context.startStep();
    page.send({ type: "host_continue", task_id: "T1" });
    await first;
    await expect(page.context.startStep()).resolves.toBe("started");
    page.context.currentStepIdx = 1;
    await expect(page.context.startStep()).resolves.toBe("started");
    expect(page.posted.filter(message => message.type === "task_intro")).toHaveLength(1);
    // The next task waits again.
    page.context.currentTaskIdx = 1; page.context.currentStepIdx = 0;
    const next = page.context.startStep();
    await Promise.resolve();
    expect(page.posted.at(-1)).toMatchObject({ type: "task_intro", task_id: "T3", task_index: 1 });
    page.send({ type: "host_continue", task_id: "T3" });
    await next;
    expect(page.started).toEqual([0, 0, 0, 1]);
  });

  it("starts the task anyway if the host never answers, and tells the host so it closes the demonstration", async () => {
    vi.useFakeTimers();
    const page = runnerPage();
    const step = page.context.startStep();
    await vi.advanceTimersByTimeAsync(HOST_WAIT_MS - 1);
    expect(page.started).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await expect(step).resolves.toBe("started");
    expect(page.posted.at(-1)).toEqual({ type: "task_intro_timeout", task_id: "T1" });
  });

  it("does not show pinch's demonstration when the runner is about to skip pinch (hand opening never held alone)", async () => {
    const page = runnerPage();
    page.context.currentTaskIdx = 3;
    page.context.taskResults.push({ task_id: "H4", metrics: { ladder: { best_alone: null, measured: true } } });
    await expect(page.context.startStep()).resolves.toBe("started");
    expect(page.posted.some(message => message.type === "task_intro")).toBe(false);
    // Hand opening held alone: pinch runs, so its demonstration comes first.
    const held = runnerPage();
    held.context.currentTaskIdx = 3;
    held.context.taskResults.push({ task_id: "H4", metrics: { ladder: { best_alone: "partial", measured: true } } });
    const step = held.context.startStep();
    await Promise.resolve();
    expect(held.posted.at(-1)).toMatchObject({ type: "task_intro", task_id: "H3" });
    held.send({ type: "host_continue", task_id: "H3" });
    await expect(step).resolves.toBe("started");
  });

  it("does nothing without host_demos=1, or outside a frame", async () => {
    for (const page of [runnerPage("?ladder=1"), runnerPage("?host_demos=1", false)]) {
      expect(page.posted).toEqual([]);
      await expect(page.context.startStep()).resolves.toBe("started");
      expect(page.started).toEqual([0]);
    }
  });
});

describe("the runner route", () => {
  let server: Server | null = null;
  afterEach(() => new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve())));
  const serve = async (fetchImpl: Parameters<typeof createMovementCheckRunnerRouter>[0]["fetchImpl"], timeoutMs = 100000) => {
    const app = createMovementCheckRunnerRouter({ upstream: "https://rehyn.test", fetchImpl, retryDelayMs: 5, timeoutMs, tries: 4 });
    server = await new Promise<Server>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const address = server.address() as { port: number };
    return (path: string) => fetch(`http://127.0.0.1:${address.port}${path}`, { redirect: "manual" });
  };

  it("serves the prepared page for the same query", async () => {
    const asked: string[] = [];
    const get = await serve(async url => { asked.push(url); return { ok: true, status: 200, text: async () => PAGE }; });
    const response = await get("/?package=initial&task_ids=T1%2CT3&host_demos=1");
    expect(asked).toEqual(["https://rehyn.test/api/pose/review-runner?package=initial&task_ids=T1%2CT3&host_demos=1"]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain('const API_BASE = "https://rehyn.test/api";');
  });

  it("tries again when the Rehyn app is slow to wake or fails once", async () => {
    let calls = 0;
    const get = await serve(async () => { calls += 1; if (calls === 1) throw new Error("waking up"); return { ok: true, status: 200, text: async () => PAGE }; });
    const response = await get("/?task_ids=T1");
    expect(response.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("keeps trying through quick error answers until the deadline by default", async () => {
    let calls = 0;
    const app = createMovementCheckRunnerRouter({ upstream: "https://rehyn.test", retryDelayMs: 5, fetchImpl: async () => {
      calls += 1;
      return calls < 10 ? { ok: false, status: 503, text: async () => "" } : { ok: true, status: 200, text: async () => PAGE };
    } });
    server = await new Promise<Server>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/?task_ids=T1`, { redirect: "manual" });
    expect(response.status).toBe(200);
    expect(calls).toBe(10);
  });

  it("waits through the holding page Render shows while the Rehyn app wakes", async () => {
    let calls = 0;
    const get = await serve(async () => { calls += 1; return { ok: true, status: 200, text: async () => (calls < 3 ? "<html><body>Service waking up</body></html>" : PAGE) }; });
    const response = await get("/?task_ids=T1");
    expect(response.status).toBe(200);
    expect(calls).toBe(3);
  });

  it("sends the iframe to the original runner when the page is unusable or the Rehyn app is unreachable", async () => {
    let calls = 0;
    // The runner, but changed: another try will not fix it.
    let get = await serve(async () => { calls += 1; return { ok: true, status: 200, text: async () => PAGE.replace('window.location.origin + "/api"', '"/api"') }; });
    let response = await get("/?task_ids=T1");
    expect(response.status).toBe(302);
    expect(calls).toBe(1);
    expect(response.headers.get("location")).toBe("https://rehyn.test/api/pose/review-runner?task_ids=T1");
    await new Promise<void>(resolve => server!.close(() => resolve()));
    // Never the runner: waited through until the deadline (more tries than failed fetches get), then given up.
    calls = 0;
    get = await serve(async () => { calls += 1; return { ok: true, status: 200, text: async () => "<html><body>Service waking up</body></html>" }; }, 150);
    response = await get("/?task_ids=T1");
    expect(response.status).toBe(302);
    expect(calls).toBeGreaterThan(4);
    await new Promise<void>(resolve => server!.close(() => resolve()));
    // Failing fetches: given up after the tries.
    calls = 0;
    get = await serve(async () => { calls += 1; throw new Error("offline"); });
    response = await get("/?task_ids=T1");
    expect(response.status).toBe(302);
    expect(calls).toBe(4);
    await new Promise<void>(resolve => server!.close(() => resolve()));
    get = await serve(async () => { throw new Error("offline"); });
    response = await get("/?task_ids=T3");
    expect(response.headers.get("location")).toBe("https://rehyn.test/api/pose/review-runner?task_ids=T3");
    await new Promise<void>(resolve => server!.close(() => resolve()));
    get = await serve(async () => ({ ok: false, status: 503, text: async () => "" }));
    response = await get("/?task_ids=H4");
    expect(response.status).toBe(302);
    server = null;
  });
});
