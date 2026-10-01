import { drawGhost, reachGhostPose } from "./ghost";
import { TARGET_COMPLETION_MS, TARGET_HOLD_MS } from "./target-timing";
import { drawTargetCompletion, drawTestingTarget } from "./target-visual";

const MOVE_MS = 1100;
const RADIUS = 30;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => n * n * (3 - 2 * n);
const poseAt = (fraction: number, returning: boolean) => returning ? 1 - smooth(fraction) : smooth(fraction);

// Find the instant the hand actually enters the fixed ring, rather than starting a timer
// at the beginning of the movement or waiting until it has reached the centre dot.
function contactStartMs(returning: boolean) {
  const target = reachGhostPose(returning ? 0 : 1).wrist;
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    const hand = reachGhostPose(poseAt(middle, returning)).wrist;
    if (Math.hypot(hand[0] - target[0], hand[1] - target[1]) <= RADIUS) high = middle;
    else low = middle;
  }
  return high * MOVE_MS;
}
const CONTACT_MS = [contactStartMs(false), contactStartMs(true)];

export function reachDemoDuration(returning: boolean) {
  return CONTACT_MS[returning ? 1 : 0] + TARGET_HOLD_MS + TARGET_COMPLETION_MS;
}

export function reachDemoState(elapsedMs: number, returning: boolean, armed = true) {
  const elapsed = armed ? Math.max(0, elapsedMs) : 0;
  const contactAt = CONTACT_MS[returning ? 1 : 0];
  const contact = armed && elapsed >= contactAt;
  const progress = contact ? clamp((elapsed - contactAt) / TARGET_HOLD_MS) : 0;
  const completionElapsedMs = elapsed - contactAt - TARGET_HOLD_MS;
  const phase = !armed ? "waiting" : !contact ? "move" : progress < 1 ? "hold" : "complete";
  const pose = poseAt(clamp(elapsed / MOVE_MS), returning);
  const target = reachGhostPose(returning ? 0 : 1).wrist;
  const label = returning ? "Lap target" : "Reach target";
  const instruction = !armed ? "Listen to the instruction. The circle will become active when the voice finishes."
    : phase === "complete" ? returning ? "Lap target complete" : "Target complete — now return to your lap"
    : phase === "hold" ? `Hold on ${returning ? "lap" : "target"} · ${Math.round(progress * 100)}%`
    : returning ? "Return your hand to the lap circle" : "Reach forward and touch the circle";
  return { pose, target, radius: RADIUS, armed, contact, progress, completionElapsedMs, phase, label, instruction };
}

export function reachGhostTarget(width: number, height: number, returning: boolean) {
  const target = reachGhostPose(returning ? 0 : 1).wrist;
  const scale = Math.min(width / 300, height / 270);
  return { x: (width - 300 * scale) / 2 + target[0] * scale, y: (height - 270 * scale) / 2 + target[1] * scale, radius: RADIUS * scale };
}

export function drawReachDemo(ctx: CanvasRenderingContext2D, elapsedMs: number, returning: boolean, width: number, height: number, now: number, reducedMotion = false, armed = true) {
  const state = reachDemoState(elapsedMs, returning, armed);
  drawGhost(ctx, "reach", state.pose, width, height);
  const { x, y, radius } = reachGhostTarget(width, height, returning);
  if (state.phase === "complete") {
    // Keep the completed check visible if speech takes longer than the animation.
    drawTargetCompletion(ctx, { x, y, radius, elapsed: Math.min(state.completionElapsedMs, TARGET_COMPLETION_MS - 1), now, reducedMotion: reducedMotion || state.completionElapsedMs >= TARGET_COMPLETION_MS });
  } else {
    drawTestingTarget(ctx, { x, y, radius, armed, contact: state.contact, progress: state.progress, now, reducedMotion });
  }
  ctx.save();
  ctx.font = "600 12px Manrope, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = state.contact ? "#285b49" : "#a14d32";
  ctx.fillText(state.phase === "complete" ? "Complete" : state.label, x, y - radius - 10);
  ctx.restore();
}
