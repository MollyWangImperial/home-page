import { readFileSync } from "node:fs";
import vm from "node:vm";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const backend = readFileSync("assessment-service/backend/fast_screening.py", "utf8").replace(/\r\n/g, "\n");
const native = readFileSync("client/src/lib/fast-check-runtime.js", "utf8");
const script = backend.split('<script type="module">')[1].split("</script>")[0];
function functionText(source: string, name: string) {
  const start = source.indexOf(`function ${name}(`);
  const tail = source.slice(start);
  const end = tail.slice(1).search(/\n(?:async )?function |\n(?:window\.startDemo911Call=|const click=)/);
  if (start < 0 || end < 0) throw new Error(`Missing FAST function ${name}`);
  return tail.slice(0, end + 1).trim();
}

describe("FAST port preserves clinical and rendering contracts", () => {
  it.each(["analyseFace", "analyseArms", "finalizeFace", "finalizeArms", "normalizeSpeech", "editDistance", "similarity", "isCompleteSpeechCandidate", "outcome"])("keeps %s byte-identical to the original runner", name => {
    expect(functionText(native, name)).toBe(functionText(script, name));
  });

  it("keeps observation thresholds, source prompts and voice/hold gates", () => {
    expect(native.match(/const FACE_WINDOW_MS=[^;]+;/)?.[0]).toBe(script.match(/const FACE_WINDOW_MS=[^;]+;/)?.[0]);
    for (const name of ["renderFace", "renderArms", "renderSpeech"]) {
      expect(functionText(native, name)).toBe(functionText(script, name));
    }
    expect(native).not.toMatch(/window\.(?:postRN|startDemo911Call)=|onclick="|autostart/);
  });

  it("scopes every style selector to FAST, including small screens", () => {
    const css = postcss.parse(readFileSync("client/src/pages/fast-check-runtime.css", "utf8"));
    css.walkRules(rule => {
      if (rule.parent.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
      for (const selector of rule.selectors) expect(selector.startsWith(".fast-check-runtime")).toBe(true);
    });
  });
});

function replay() {
  let now = 1000;
  const scheduled: { callback: () => void; delay: number }[] = [];
  const result = { className: "", innerHTML: "" }, text = { textContent: "" };
  const elements: Record<string, unknown> = { video: {}, canvas: { getContext: () => ({}) }, panel: {}, cameraLabel: {}, scanFill: { style: {} }, autoResult: result, assist: { className: "", querySelector: () => text } };
  const context = vm.createContext({
    document: { getElementById: (id: string) => elements[id] || null, querySelector: () => null },
    window: {}, navigator: {}, host: { disposed: false }, performance: { now: () => now },
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    setTimeout: (callback: () => void, delay: number) => { scheduled.push({ callback, delay }); return scheduled.length; }, clearTimeout: () => {},
  });
  const body = native.slice(native.indexOf("let PoseLandmarker,"), native.indexOf("const click=event=>"));
  vm.runInContext(body, context);
  const run = (code: string) => vm.runInContext(code, context);
  return { context, run, advance: (ms: number) => { now += ms; }, scheduled, result, text };
}

describe("hosted FAST observations", () => {
  it("detects an established smile dropping and schedules the arm step", () => {
    const r = replay(); r.run('current="face";stepStartedAt=1000;');
    const landmarks = Array.from({ length: 292 }, () => ({ x: .5, y: .5 }));
    landmarks[33] = { x: .3, y: .4 }; landmarks[263] = { x: .7, y: .4 };
    landmarks[61] = { x: .4, y: .6 }; landmarks[291] = { x: .6, y: .6 };
    const observe = (smile: number) => {
      r.context.faceResult = { faceLandmarks: [landmarks], faceBlendshapes: [{ categories: [{ categoryName: "mouthSmileLeft", score: smile }, { categoryName: "mouthSmileRight", score: smile }] }] };
      r.run("analyseFace(faceResult,null)");
    };
    for (let i = 0; i < 8; i++) { r.advance(34); observe(.2); }
    r.advance(34); observe(.01); expect(r.run("automated.face.decision")).toBe("pending");
    r.advance(500); observe(.01); expect(r.run("automated.face.decision")).toBe("yes");
    expect(r.result.innerHTML).toContain("Possible FAST sign detected");
    expect(r.scheduled.at(-1)?.delay).toBe(650);
  });

  it.each([true, false])("identifies sustained one-sided arm lowering (%s)", oneSided => {
    const r = replay(); r.run('current="arms";stepStartedAt=1000;');
    const lm = Array.from({ length: 17 }, () => ({ x: .5, y: .5, visibility: 1 }));
    lm[11].x = .3; lm[12].x = .7; lm[15].y = .5; lm[16].y = oneSided ? .9 : .5;
    r.context.lm = lm;
    for (let i = 0; i < 50; i++) { r.advance(70); r.run("analyseArms(lm)"); }
    if (oneSided) r.run("finalizeArms()");
    expect(r.run("automated.arms.decision")).toBe(oneSided ? "yes" : "no");
  });

  it("keeps incomplete speech and uncertain observations from becoming a clear result", () => {
    const r = replay();
    expect(r.run('isCompleteSpeechCandidate({transcript:"the sky is blue"})')).toBe(false);
    expect(r.run('isCompleteSpeechCandidate({transcript:"the sky is blue today"})')).toBe(true);
    r.run('answers.face="no";answers.arms="no";answers.speech="unsure";');
    expect(r.run("outcome().call_999")).toBe(true);
  });
});
