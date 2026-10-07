import { drawGhost, mouthGhostPose } from "./ghost";
import { TARGET_COMPLETION_MS, TARGET_HOLD_MS } from "./target-timing";
import { drawTargetCompletion, drawTestingTarget } from "./target-visual";

const MOVE_MS = 1100;
/** The mouth circle is small; the lap circle is the same size as the forward reach's lap circle. */
const MOUTH_RADIUS = 16;
const LAP_RADIUS = 30;
const radiusFor = (returning: boolean) => (returning ? LAP_RADIUS : MOUTH_RADIUS);
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const poseAt = (fraction: number, returning: boolean) => {
  const smooth = fraction * fraction * (3 - 2 * fraction);
  return returning ? 1 - smooth : smooth;
};
// The instant the hand actually enters the fixed circle, as in the reach demonstration.
function contactStart(returning: boolean) {
  const target = mouthGhostPose(returning ? 0 : 1).wrist;
  let low = 0, high = 1;
  for (let index = 0; index < 24; index++) {
    const middle = (low + high) / 2;
    const hand = mouthGhostPose(poseAt(middle, returning)).wrist;
    if (Math.hypot(hand[0] - target[0], hand[1] - target[1]) <= radiusFor(returning)) high = middle; else low = middle;
  }
  return high * MOVE_MS;
}
const CONTACT_MS = [contactStart(false), contactStart(true)];
export const mouthDemoDuration = (returning: boolean) => CONTACT_MS[returning ? 1 : 0] + TARGET_HOLD_MS + TARGET_COMPLETION_MS;

/** Same states, fields and wording pattern as reachDemoState; only the target (the mouth) differs. */
export function mouthDemoState(elapsedMs: number, returning: boolean, armed = true) {
  const elapsed = armed ? Math.max(0, elapsedMs) : 0;
  const contactAt = CONTACT_MS[returning ? 1 : 0];
  const contact = armed && elapsed >= contactAt;
  const progress = contact ? clamp((elapsed - contactAt) / TARGET_HOLD_MS) : 0;
  const completionElapsedMs = elapsed - contactAt - TARGET_HOLD_MS;
  const phase = !armed ? "waiting" : !contact ? "move" : progress < 1 ? "hold" : "complete";
  const pose = poseAt(clamp(elapsed / MOVE_MS), returning);
  const target = mouthGhostPose(returning ? 0 : 1).wrist;
  const label = returning ? "Lap target" : "Mouth target";
  const instruction = !armed ? "Listen to the instruction. The circle will become active when the voice finishes."
    : phase === "complete" ? returning ? "Lap target complete" : "Target complete — now lower the cup to your lap"
    : phase === "hold" ? `${returning ? "Hold on lap" : "Hold at your lips"} · ${Math.round(progress * 100)}%`
    : returning ? "Lower the cup to the lap circle" : "Bring the cup to the mouth circle, keeping your head up";
  return { pose, target, radius: radiusFor(returning), armed, contact, progress, completionElapsedMs, phase, label, instruction };
}

export function mouthGhostTarget(width: number, height: number, returning: boolean) {
  const target = mouthGhostPose(returning ? 0 : 1).wrist;
  const scale = Math.min(width / 300, height / 270);
  return { x: (width - 300 * scale) / 2 + target[0] * scale, y: (height - 270 * scale) / 2 + target[1] * scale, radius: radiusFor(returning) * scale };
}

export function drawMouthDemo(ctx: CanvasRenderingContext2D, elapsedMs: number, returning: boolean, width: number, height: number, now: number, reducedMotion = false, armed = true) {
  const state = mouthDemoState(elapsedMs, returning, armed);
  drawGhost(ctx, "mouth", state.pose, width, height);
  const { x, y, radius } = mouthGhostTarget(width, height, returning);
  if (state.phase === "complete") {
    // Keep the completed check visible if speech takes longer than the animation.
    drawTargetCompletion(ctx, { x, y, radius, elapsed: Math.min(state.completionElapsedMs, TARGET_COMPLETION_MS - 1), now, reducedMotion: reducedMotion || state.completionElapsedMs >= TARGET_COMPLETION_MS });
  } else {
    drawTestingTarget(ctx, { x, y, radius, armed, contact: state.contact, progress: state.progress, now, reducedMotion });
  }
  ctx.save();
  ctx.font = "600 12px Manrope, sans-serif";
  ctx.fillStyle = state.contact ? "#285b49" : "#a14d32";
  // The mouth label sits beside the cup so it does not cover the face; the lap label sits above, as for the reach.
  ctx.textAlign = returning ? "center" : "left";
  ctx.fillText(state.phase === "complete" ? "Complete" : state.label, returning ? x : x + radius + 16 * Math.min(width / 300, height / 270), returning ? y - radius - 10 : y + 4);
  ctx.restore();
}
