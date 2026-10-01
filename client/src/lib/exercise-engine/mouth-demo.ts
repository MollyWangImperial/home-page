import { drawGhost, mouthGhostPose } from "./ghost";
import { TARGET_COMPLETION_MS, TARGET_HOLD_MS } from "./target-timing";
import { drawTargetCompletion, drawTestingTarget } from "./target-visual";

const MOVE_MS = 1100;
const RADIUS = 16;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const poseAt = (fraction: number, returning: boolean) => {
  const smooth = fraction * fraction * (3 - 2 * fraction);
  return returning ? 1 - smooth : smooth;
};
function contactStart(returning: boolean) {
  const target = mouthGhostPose(returning ? 0 : 1).wrist;
  let low = 0, high = 1;
  for (let index = 0; index < 24; index++) {
    const middle = (low + high) / 2;
    const hand = mouthGhostPose(poseAt(middle, returning)).wrist;
    if (Math.hypot(hand[0] - target[0], hand[1] - target[1]) <= RADIUS) high = middle; else low = middle;
  }
  return high * MOVE_MS;
}
const CONTACT_MS = [contactStart(false), contactStart(true)];
export const mouthDemoDuration = (returning: boolean) => CONTACT_MS[returning ? 1 : 0] + TARGET_HOLD_MS + TARGET_COMPLETION_MS;

export function mouthDemoState(elapsedMs: number, returning: boolean, armed = true) {
  const elapsed = armed ? Math.max(0, elapsedMs) : 0;
  const contactAt = CONTACT_MS[returning ? 1 : 0];
  const contact = armed && elapsed >= contactAt;
  const progress = contact ? clamp((elapsed - contactAt) / TARGET_HOLD_MS) : 0;
  const completionElapsedMs = elapsed - contactAt - TARGET_HOLD_MS;
  const phase = !armed ? "waiting" : !contact ? "move" : progress < 1 ? "hold" : "complete";
  const instruction = !armed ? "Listen first. The circle becomes active when the voice finishes."
    : phase === "complete" ? returning ? "Lap target complete" : "Mouth target complete — now lower the cup"
    : contact ? `Hold at ${returning ? "your lap" : "your lips"} · ${Math.round(progress * 100)}%`
    : returning ? "Lower the cup to the lap circle" : "Bring the cup to the mouth circle, keeping your head up";
  return { pose: poseAt(clamp(elapsed / MOVE_MS), returning), armed, contact, progress, phase, instruction, completionElapsedMs };
}

export function mouthGhostTarget(width: number, height: number, returning: boolean) {
  const target = mouthGhostPose(returning ? 0 : 1).wrist;
  const scale = Math.min(width / 300, height / 270);
  return { x: (width - 300 * scale) / 2 + target[0] * scale, y: (height - 270 * scale) / 2 + target[1] * scale, radius: RADIUS * scale };
}

export function drawMouthDemo(ctx: CanvasRenderingContext2D, elapsedMs: number, returning: boolean, width: number, height: number, now: number, reducedMotion = false, armed = true) {
  const state = mouthDemoState(elapsedMs, returning, armed);
  drawGhost(ctx, "mouth", state.pose, width, height);
  const target = mouthGhostTarget(width, height, returning);
  if (state.phase === "complete") drawTargetCompletion(ctx, { ...target, elapsed: Math.min(state.completionElapsedMs, TARGET_COMPLETION_MS - 1), now, reducedMotion: true });
  else drawTestingTarget(ctx, { ...target, armed, contact: state.contact, progress: state.progress, now, reducedMotion });
}
