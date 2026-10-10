import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { fixRunnerPage, measurablePosture, RUNNER_STEADY, STEADY_CONFIG, steadyRunnerDrawing, withoutPinchCoin } from "../../../server/movement-check-fixes";
import { prepareRunnerHtml } from "../../../server/movement-check-runner";

/** The runner's drawOverlay and posture code as the Rehyn app serves them (only the lines the fixes rely on). */
const DRAWING = `function drawOverlay(landmarks){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // draw skeleton
  if(landmarks){
    if(armOnly){ }else{
      drawingUtils.drawLandmarks(landmarks, {color:"#D9E5DC", radius:3});
      drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {color:"#4A7856", lineWidth:4});
    }
  }
  if(latestHandLandmarks){
    drawingUtils.drawConnectors(latestHandLandmarks, HAND_CONNECTIONS, {color:"rgba(127,229,163,0.88)", lineWidth:2});
    drawingUtils.drawLandmarks(latestHandLandmarks, {color:"rgba(217,229,220,0.72)", radius:1.4});
  }
  if(!armOnly && !calibratingAssessment && !stepCompleted && voiceFinishedAt > 0) assessmentQuality.draw(ctx, landmarks, canvas.width, canvas.height);
}
const ICON_EMOJI = { cup: "☕", table: "🪵", towel: "🧺", ball: "🏐", coin: "🪙" };`;

const POSTURE = `raw(p,w,aspectRatio=1){
      if(usable([11,12,23,24])) {
      }
      if(this.testingMouthHeadDrop || this.ladderTrunkScale) {
        if(visible([11,12])) {
        }
      }
}
calibrate(p,w){ if(!r.torso || !finite(r.width)) return; }
postureBaseline(samples){ const directions=samples.map(x=>x.torso);
      return Math.max(...directions.map(v=>angleV(v,b.torso)))<6 ? b : null; }
jointTrunkReadout(r){ const pelvisScale=b?.hipScreenSpan>0?r.hipScreenSpan/b.hipScreenSpan:NaN; }
postureReadout(r){ if(b && r.torso && finite(r.screenWidth) && x) { y=(r.arm_elevation||0)*.12; } }`;

const PAGE = `<!doctype html><html><body><script type="module">
const API_BASE = window.location.origin + "/api";
async function startStep(){ }
function postRN(data){ const message=JSON.stringify(data); window.parent.postMessage(message,"https://rehyn-recovery-companion.onrender.com"); }
${DRAWING}
${POSTURE}
</script></body></html>`;

describe("the runner fixes", () => {
  it("draws the steadied body and hand, keeping the runner's own drawing as the fallback", () => {
    const html = steadyRunnerDrawing(DRAWING);
    expect(html.indexOf("const __steady = ")).toBeLessThan(html.indexOf("// draw skeleton"));
    expect(html).toContain('if(__steady) window.__rehynSteady.drawPose(ctx, __steady, canvas.width, canvas.height); else drawingUtils.drawLandmarks(landmarks, {color:"#D9E5DC", radius:3});');
    expect(html).toContain("if(!__steady) drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS");
    expect(html).toContain("if(!__steady) drawingUtils.drawConnectors(latestHandLandmarks, HAND_CONNECTIONS");
    expect(html).toContain("if(!__steady) drawingUtils.drawLandmarks(latestHandLandmarks");
    expect(html).toContain("window.__rehynSteady.drawHand(ctx, __steady, canvas.width, canvas.height);");
    expect(html).toContain("assessmentQuality.draw(ctx, (__steady && __steady.pose) || landmarks,");
    // Not the page it expects: unchanged.
    const other = DRAWING.replace("// draw skeleton", "");
    expect(steadyRunnerDrawing(other)).toBe(other);
  });

  it("takes the coin off the pinch target and nothing else", () => {
    const html = withoutPinchCoin(DRAWING);
    expect(html).toContain('const ICON_EMOJI = { cup: "☕", table: "🪵", towel: "🧺", ball: "🏐" };');
    expect(withoutPinchCoin("const x = 1;")).toBe("const x = 1;");
  });

  it("lets ladder-mode posture be measured without the hips, all or nothing", () => {
    const html = measurablePosture(POSTURE);
    expect(html).toContain("if(this.ladderTrunkScale && !usable([11,12,23,24]) && usable([11,12])) {");
    expect(html).toContain("r.armFromVertical=angleV([0,1,0],sub(w[a.e],w[a.s]));");
    expect(html).toContain("r.shoulderAxisX=Math.sign(across[0]);r.shoulderAxisY=0;");
    expect(html).toContain("if((!r.torso && !this.ladderTrunkScale) || !finite(r.width)) return;");
    expect(html).toContain("samples.map(x=>x.torso).filter(Boolean)");
    expect(html).toContain("return (this.ladderTrunkScale && directions.length<15) || Math.max(");
    expect(html).toContain("if(b && (r.torso || this.ladderTrunkScale) && finite(r.screenWidth)");
    expect(html).toContain("finite(r.armFromVertical)?r.armFromVertical:0)*.12");
    expect(html).toContain("r.hipScreenSpan/b.hipScreenSpan:1;");
    const other = POSTURE.replace("(r.arm_elevation||0)*.12", "r.arm_elevation*.12");
    expect(measurablePosture(other)).toBe(other);
  });

  it("serves the steadier script with the page only when the drawing was steadied", () => {
    const html = prepareRunnerHtml(PAGE)!;
    expect(html.split("root.__rehynSteady = {").length).toBe(2);
    expect(html.indexOf("root.__rehynSteady = {")).toBeLessThan(html.indexOf("</body>"));
    expect(fixRunnerPage(PAGE).steady).toBe(true);
    const plain = prepareRunnerHtml(PAGE.replace("// draw skeleton", ""))!;
    expect(plain).not.toContain("root.__rehynSteady");
    // The fixes never stop the page being served.
    expect(plain).toContain("__rehynHostDemos");
  });
});

// ---------- the steadier itself, run as the page runs it ----------

type Pt = { x: number; y: number; z?: number; visibility?: number };
function steadier() {
  const context = vm.createContext({ Math, isFinite, String }) as Record<string, any>;
  context.window = context;
  vm.runInContext(RUNNER_STEADY.replace(/^<script>|<\/script>$/g, ""), context);
  return { steady: new context.RehynSteady.Steady(), api: context.RehynSteady };
}
const P = (x: number, y: number, visibility = 0.95): Pt => ({ x, y, z: 0, visibility });
/** A seated patient, right arm affected; the right hand's pose points at (hx, hy). */
function pose(hx: number, hy: number): Pt[] {
  const p = Array.from({ length: 33 }, () => P(0.5, 0.5, 0.1));
  p[0] = P(0.5, 0.3); p[11] = P(0.6, 0.45); p[12] = P(0.4, 0.45); p[23] = P(0.57, 0.85); p[24] = P(0.43, 0.85);
  p[14] = P(0.37, 0.62); p[16] = P(hx, hy + 0.03); p[18] = P(hx - 0.01, hy); p[20] = P(hx, hy - 0.005); p[22] = P(hx + 0.01, hy);
  return p;
}
/** The hand model's 21 points around a palm at (hx, hy). */
function hand(hx: number, hy: number): Pt[] {
  return Array.from({ length: 21 }, (_, i) => P(hx + ((i % 5) - 2) * 0.008, hy + (i === 0 ? 0.03 : -Math.floor(i / 5) * 0.01)));
}
const palm = (h: Pt[]) => ({ x: (h[17].x + h[5].x + h[2].x) / 3, y: (h[17].y + h[5].y + h[2].y) / 3 });
const frame = (steady: any, now: number, p: Pt[] | null, h: Pt[] | null = null, extra: Record<string, unknown> = {}) =>
  steady.update({ pose: p, hand: h, side: "right", aspect: 16 / 9, now, task: "T3", lowering: false, ...extra });

describe("the runner's keypoint steadier", () => {
  it("keeps the wrist where the hand is while the pose model flips the forearm down", () => {
    const { steady } = steadier();
    let shown: any;
    for (let t = 0; t <= 1000; t += 33) shown = frame(steady, t, pose(0.5, 0.33));
    // The forearm flips to the lap for 600 ms (no hand model reading): the drawn wrist stays at the mouth.
    for (let t = 1033; t <= 1633; t += 33) {
      shown = frame(steady, t, pose(0.45, 0.75));
      expect(shown.pose[16].y).toBeLessThan(0.4);
    }
    // The live points beyond the arm are still drawn from this frame.
    expect(shown.pose[11].x).toBeCloseTo(0.6, 2);
  });

  it("follows a real movement at once and stays close behind it", () => {
    const { steady } = steadier();
    for (let t = 0; t <= 500; t += 33) frame(steady, t, pose(0.45, 0.75));
    let shown: any, y = 0.75;
    // Up to the mouth in 0.8 s, a brisk but real speed.
    for (let t = 533; t <= 1333; t += 33) { y = 0.75 - (0.42 * (t - 500)) / 833; shown = frame(steady, t, pose(0.45, y)); }
    const live = (pose(0.45, y)[18].y + pose(0.45, y)[20].y + pose(0.45, y)[22].y) / 3;
    const drawn = (shown.pose[18].y + shown.pose[20].y + shown.pose[22].y) / 3;
    expect(Math.abs(drawn - live)).toBeLessThan(0.05);
  });

  it("follows a hand read less often than the drawing runs (the same reading repeated between scans)", () => {
    const { steady } = steadier();
    let h = hand(0.5, 0.33), shown: any;
    for (let t = 0; t <= 500; t += 16) shown = frame(steady, t, pose(0.5, 0.33), h);
    // A new hand reading every 180 ms, moving down at 1.5 torso lengths a second (not a return to the lap).
    let y = 0.33;
    for (let t = 516; t <= 1500; t += 16) {
      if ((t - 516) % 176 === 0) { y = 0.33 + (0.6 * (t - 500)) / 1000; h = hand(0.5, y); }
      shown = frame(steady, t, pose(0.5, 0.33), h);
    }
    expect(Math.abs(palm(shown.hand).y - palm(h).y)).toBeLessThan(0.06);
  });

  it("steadies the jitter of a still hand", () => {
    const { steady } = steadier();
    const drawn: number[] = [];
    for (let i = 0, t = 0; i < 90; i++, t += 33) {
      const jitter = (i % 2 ? 1 : -1) * 0.006;
      const shown = frame(steady, t, pose(0.5 + jitter, 0.4), hand(0.5 + jitter, 0.4));
      if (i > 30) drawn.push(palm(shown.hand).x);
    }
    const spread = Math.max(...drawn) - Math.min(...drawn);
    expect(spread).toBeLessThan(0.006);
  });

  it("keeps a hand the hand model misses for a moment, then lets it go", () => {
    const { steady } = steadier();
    for (let t = 0; t <= 500; t += 33) frame(steady, t, pose(0.5, 0.33), hand(0.5, 0.33));
    expect(frame(steady, 533, pose(0.5, 0.33), null).hand).not.toBeNull();
    expect(frame(steady, 500 + STEADY_CONFIG.graceMs - 10, pose(0.5, 0.33), null).hand).not.toBeNull();
    expect(frame(steady, 500 + STEADY_CONFIG.graceMs + 40, pose(0.5, 0.33), null).hand).toBeNull();
  });

  it("draws the arm to the hand model's wrist while it sees the hand", () => {
    const { steady } = steadier();
    let shown: any;
    // The pose puts the wrist at the chest; the hand model sees the hand at the mouth from the start.
    for (let t = 0; t <= 600; t += 33) shown = frame(steady, t, pose(0.45, 0.6), hand(0.5, 0.33));
    expect(shown.pose[16].y).toBeLessThan(0.4);
    expect(shown.pose[16].visibility).toBe(1);
  });

  it("starts afresh for each task and draws nothing without a pose", () => {
    const { steady } = steadier();
    for (let t = 0; t <= 300; t += 33) frame(steady, t, pose(0.5, 0.33));
    const next = frame(steady, 333, pose(0.45, 0.75), null, { task: "H4" });
    expect(next.pose[18].y).toBeCloseTo(0.75, 2);
    expect(frame(steady, 366, null, null, { task: "H4" }).pose).toBeNull();
  });

  it("draws in the exercises' style: the body's lines and joints, only the shoulders for hand tasks", () => {
    const { steady, api } = steadier();
    const calls: string[] = [];
    const ctx = new Proxy({}, { get: (_t, key) => (typeof key === "string" && ["save", "restore", "beginPath", "moveTo", "lineTo", "stroke", "arc", "fill"].includes(key) ? () => calls.push(key) : undefined), set: () => true });
    const shown = frame(steady, 0, pose(0.5, 0.33), hand(0.5, 0.33));
    api.drawPose(ctx, shown, 1280, 720);
    const bodyStrokes = calls.filter(call => call === "stroke").length;
    calls.length = 0;
    api.drawPose(ctx, { ...shown, task: "H4" }, 1280, 720);
    expect(calls.filter(call => call === "stroke").length).toBe(1);
    expect(bodyStrokes).toBeGreaterThan(1);
    calls.length = 0;
    api.drawHand(ctx, shown, 1280, 720);
    expect(calls.filter(call => call === "stroke").length).toBe(21);
  });
});
