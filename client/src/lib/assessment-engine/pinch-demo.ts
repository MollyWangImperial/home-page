// The movement check's pinch demonstration (DemoReel): the thumb meets the first finger tip to tip, holds, then lets
// go. The check's pinch task asks for that alone, with no object, so unlike the Pinch and Peg exercise this drawing
// shows no peg and no tray. The hand, its timing and its target come from the exercise's pinch drawing.

import { pinchDemoDuration, pinchDemoState, pinchGhostPoints, pinchGhostTarget, PINCH_FINGERS, type PinchStep } from "@/lib/exercise-engine/pinch-target";
import { TARGET_COMPLETION_MS } from "@/lib/exercise-engine/target-timing";
import { drawTargetCompletion, drawTestingTarget } from "@/lib/exercise-engine/target-visual";

/** The first finger only: the pinch, then the let-go. */
const STEPS: [PinchStep, PinchStep] = [{ finger: 0, letGo: false, index: 0 }, { finger: 0, letGo: true, index: 1 }];
const stepFor = (letGo: boolean) => STEPS[letGo ? 1 : 0];

export const checkPinchDemoDuration = (letGo: boolean) => pinchDemoDuration(letGo);

export function checkPinchDemoState(elapsedMs: number, letGo: boolean, armed = true) {
  const state = pinchDemoState(elapsedMs, stepFor(letGo), armed);
  const instruction = !armed ? state.instruction
    : state.phase === "complete" ? `${state.label} complete`
    : state.phase === "hold" ? `${letGo ? "Hold your fingers open" : "Hold the pinch"} · ${Math.round(state.progress * 100)}%`
    : letGo ? "Open your thumb and finger" : "Bring your thumb to your first finger, tip to tip";
  return { ...state, instruction };
}

/** The front-on hand closing its thumb on the first finger: p 0 apart, 1 tip to tip. */
function drawHand(ctx: CanvasRenderingContext2D, p: number, width: number, height: number, colors = { line: "#3c8255", accent: "#e18e6d", soft: "#b9d3c2" }) {
  const s = Math.min(width / 300, height / 270);
  ctx.save();
  ctx.translate((width - 300 * s) / 2, (height - 270 * s) / 2);
  ctx.scale(s, s);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const points = pinchGhostPoints(0, p);
  // Forearm resting on the table.
  ctx.strokeStyle = colors.soft; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(40, 262); ctx.lineTo(260, 262); ctx.stroke();
  ctx.strokeStyle = colors.line; ctx.lineWidth = 26;
  ctx.beginPath(); ctx.moveTo(points[0][0], 258); ctx.lineTo(points[0][0], points[0][1]); ctx.stroke();
  ctx.fillStyle = colors.line;
  ctx.beginPath();
  [0, 1, 5, 9, 13, 17].forEach((index, i) => (i ? ctx.lineTo(points[index][0], points[index][1]) : ctx.moveTo(points[index][0], points[index][1])));
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = colors.line; ctx.lineWidth = 12; ctx.stroke();
  ctx.strokeStyle = colors.accent; ctx.lineWidth = 11;
  [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]].forEach(chain => {
    ctx.beginPath();
    chain.forEach((index, i) => (i ? ctx.lineTo(points[index][0], points[index][1]) : ctx.moveTo(points[index][0], points[index][1])));
    ctx.stroke();
  });
  // The two tips that meet.
  ctx.fillStyle = colors.accent;
  [4, PINCH_FINGERS[0].tip].forEach(index => { ctx.beginPath(); ctx.arc(points[index][0], points[index][1], 7, 0, Math.PI * 2); ctx.fill(); });
  ctx.restore();
}

export function drawCheckPinchDemo(ctx: CanvasRenderingContext2D, elapsedMs: number, letGo: boolean, width: number, height: number, now: number, reducedMotion = false, armed = true) {
  const state = checkPinchDemoState(elapsedMs, letGo, armed);
  ctx.clearRect(0, 0, width, height);
  drawHand(ctx, state.pose, width, height);
  const { x, y, radius } = pinchGhostTarget(width, height, stepFor(letGo));
  if (state.phase === "complete") drawTargetCompletion(ctx, { x, y, radius, elapsed: Math.min(state.completionElapsedMs, TARGET_COMPLETION_MS - 1), now, reducedMotion: reducedMotion || state.completionElapsedMs >= TARGET_COMPLETION_MS });
  else drawTestingTarget(ctx, { x, y, radius, armed, contact: state.contact, progress: state.progress, now, reducedMotion });
  ctx.save();
  ctx.font = "600 12px Manrope, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = state.contact ? "#285b49" : "#a14d32";
  ctx.fillText(state.phase === "complete" ? "Complete" : state.label, x, y - radius - 10);
  ctx.restore();
}
