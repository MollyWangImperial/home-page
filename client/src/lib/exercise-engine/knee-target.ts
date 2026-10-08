import type { Side } from "./config";
import { drawGhost } from "./ghost";
import { drawRingLabel } from "./hand-target";
import { angleAt, inView, poseFrameValues, poseJoints, type Frame, type Geo, type LapRest, type PoseInput, type Pt } from "./metrics";
import { TARGET_COMPLETION_MS, TARGET_HOLD_MS } from "./target-timing";
import { drawTargetCompletion, drawTestingTarget } from "./target-visual";

// Seated Knee Extension on the shared target flow: a front camera with the patient seated, head to feet in view,
// feet flat on the floor. From the front the lower leg swings toward the camera, so straightening the knee hardly
// moves the foot in the picture: the knee angle comes from the pose model's 3D landmarks, and a knee dial drawn
// beside the leg shows it. The dial is a side view of the knee whose foot travels into the target circle as the
// knee straightens, with the same circle activation as the other exercises. The patient never has to move out of
// view: everything is done seated. Positions are raw (unmirrored) image coordinates: x in frame widths, y in frame
// heights; lengths in frame heights.

const DEG = 180 / Math.PI;
type P2 = { x: number; y: number };
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** The cycle's steps, by index (config.ts ex_lower_selective). */
export const KNEE_STEP = { lift: 0, lower: 1 } as const;

// ---------- the knee's measure and the set-up snapshot ----------

/** The lower leg's length in the picture (frame heights), knee to ankle. */
function shinLength(knee: Pt, ankle: Pt, aspect: number) {
  return Math.hypot((ankle.x - knee.x) * aspect, ankle.y - knee.y);
}

/**
 * The knee's part of the posture snapshot (Geo), kept in the set-up reference: the affected knee and ankle in the
 * picture with the lower leg's image length, the other ankle in the picture, and the other knee's 3D angle.
 */
export function kneeGeo(pose: PoseInput, side: Side, aspect: number): Partial<Geo> {
  const lm = pose.landmarks, w = pose.world, j = poseJoints(side);
  const out: Partial<Geo> = {};
  const knee = lm[j.knee], ankle = lm[j.ankle], otherAnkle = lm[j.ankleOther];
  if (inView(knee) && inView(ankle)) {
    out.kneeImgX = knee.x; out.kneeImgY = knee.y; out.kneeShin = shinLength(knee, ankle, aspect);
    out.ankleImgX = ankle.x; out.ankleImgY = ankle.y;
  }
  if (inView(otherAnkle)) { out.otherAnkleImgX = otherAnkle.x; out.otherAnkleImgY = otherAnkle.y; }
  if ([j.hipOther, j.kneeOther, j.ankleOther].every(index => inView(lm[index])) && w[j.hipOther] && w[j.kneeOther] && w[j.ankleOther]) {
    out.otherKnee = angleAt(w[j.hipOther], w[j.kneeOther], w[j.ankleOther]);
  }
  return out;
}

/**
 * The knee's own compensation measures against the set-up reference:
 * - trunk_retreat_pct: leaning back, the shoulders AND the face both smaller in the picture (the mirror of
 *   leaning forward, trunk_approach_pct), in %;
 * - thigh_lift_pct: the affected knee higher in the picture than at set-up (the thigh lifting off the chair), in %
 *   of the resting lower leg's image length;
 * - other_leg_pct: the other ankle's travel in the picture since set-up, in % of that length;
 * - other_knee_delta: the other knee's 3D angle change since set-up, degrees.
 */
export function kneeComps(pose: PoseInput, geo: Geo, ref: Geo | null, side: Side, aspect: number): Frame["comps"] {
  const out: Frame["comps"] = {};
  if (!ref) return out;
  const lm = pose.landmarks, j = poseJoints(side);
  if (geo.shoulderWidth && ref.shoulderWidth && geo.eyeSpan && ref.eyeSpan) {
    out.trunk_retreat_pct = Math.max(0, (1 - Math.max(geo.shoulderWidth / ref.shoulderWidth, geo.eyeSpan / ref.eyeSpan)) * 100);
  }
  const shin = ref.kneeShin;
  if (shin && shin > 0.02) {
    const knee = lm[j.knee];
    if (inView(knee) && ref.kneeImgY !== undefined) out.thigh_lift_pct = Math.max(0, (ref.kneeImgY - knee.y) / shin * 100);
    const otherAnkle = lm[j.ankleOther];
    if (inView(otherAnkle) && ref.otherAnkleImgX !== undefined && ref.otherAnkleImgY !== undefined) {
      out.other_leg_pct = Math.hypot((otherAnkle.x - ref.otherAnkleImgX) * aspect, otherAnkle.y - ref.otherAnkleImgY) / shin * 100;
    }
  }
  if (geo.otherKnee !== undefined && ref.otherKnee !== undefined) out.other_knee_delta = Math.abs(geo.otherKnee - ref.otherKnee);
  return out;
}

/** A resting knee reads at most this (3D, degrees): beyond it the foot is out in front, not below the knee. */
const REST_KNEE_MAX_DEG = 130;

/** What set-up waits for, in the patient's words: head to feet in view with some space round them, both feet flat. */
export function kneeRestCheck(pose: PoseInput | null, side: Side, aspect: number): { lapRest?: LapRest; lapMissing?: string } {
  if (!pose) return { lapMissing: "Sit in front of the camera so I can see you." };
  const lm = pose.landmarks, j = poseJoints(side);
  const seen = (...indices: number[]) => indices.every(index => inView(lm[index]));
  if (!seen(j.nose)) return { lapMissing: "Move the camera back so I can see you from your head to your feet." };
  if (!seen(j.shoulder, j.shoulderOther)) return { lapMissing: "Move the camera back so I can see both shoulders." };
  if (!seen(j.hip, j.hipOther)) return { lapMissing: "Sit facing the camera so I can see both hips." };
  if (!seen(j.knee, j.kneeOther)) return { lapMissing: "Move the camera back so I can see both knees." };
  if (!seen(j.ankle, j.ankleOther, j.foot)) return { lapMissing: "Move the camera back, or tilt it down, so I can see both feet." };
  const knee = lm[j.knee], ankle = lm[j.ankle], otherAnkle = lm[j.ankleOther], foot = lm[j.foot];
  // Room round the body: the raised foot first comes lower in the picture as it nears the camera.
  if (lm[j.nose].y < 0.05) return { lapMissing: "Tilt the camera up a little so there is space above your head." };
  if (Math.max(ankle.y, otherAnkle.y, foot.y) > 0.92) return { lapMissing: "Tilt the camera down a little so there is space below your feet." };
  if ([j.shoulder, j.shoulderOther, j.knee, j.kneeOther, j.ankle, j.ankleOther].some(index => lm[index].x < 0.04 || lm[index].x > 0.96)) {
    return { lapMissing: "Move the camera so you are in the middle of the picture." };
  }
  const shin = shinLength(knee, ankle, aspect);
  if (shin < 0.06) return { lapMissing: "Move the camera a little closer." };
  // Feet flat on the floor: each lower leg hangs down from its knee, and both ankles are level. From the front a foot
  // placed forward still looks below its knee, so the knee's 3D angle (generously, for its jitter) says it is bent.
  const w = pose.world;
  const bentAngle = w[j.hip] && w[j.knee] && w[j.ankle] ? angleAt(w[j.hip], w[j.knee], w[j.ankle]) : undefined;
  if (ankle.y - knee.y < 0.6 * shin || (bentAngle !== undefined && bentAngle > REST_KNEE_MAX_DEG)) return { lapMissing: "Put your foot flat on the floor, below your knee." };
  if (Math.abs(ankle.y - otherAnkle.y) > 0.25 * shin) return { lapMissing: "Put both feet flat on the floor, about hip-width apart." };
  return { lapRest: { x: ankle.x, y: ankle.y, bodyScale: shin } };
}

/**
 * One camera frame: the affected knee's angle (3D), the six checks and the set-up's resting foot. During the
 * movement only the affected leg has to stay in view; a check whose body part is out of view stays unmeasured.
 */
export function kneeFrame(det: { pose: PoseInput | null }, side: Side, t: number, aspect: number, ref: Geo | null): Frame {
  const pose = det.pose;
  if (!pose) return { t, values: {}, comps: {}, visible: false, missing: "Sit in front of the camera so I can see you.", ...kneeRestCheck(null, side, aspect) };
  const lm = pose.landmarks, j = poseJoints(side);
  const seen = (...indices: number[]) => indices.every(index => inView(lm[index]));
  const body = poseFrameValues(pose, side, ref);
  const geo = { ...body.geo!, ...kneeGeo(pose, side, aspect) } as Geo;
  const legSeen = seen(j.hip, j.knee, j.ankle);
  const trunkSeen = seen(j.shoulder, j.shoulderOther, j.hip, j.hipOther);
  const comps: Frame["comps"] = {
    trunk_approach_pct: body.comps.trunk_approach_pct,
    trunk_side_lean_delta: trunkSeen ? body.comps.trunk_side_lean_delta : undefined,
    hip_hike_delta: seen(j.hip, j.hipOther) ? body.comps.hip_hike_delta : undefined,
    ...kneeComps(pose, geo, ref, side, aspect),
  };
  return {
    t, values: { knee_extension: legSeen ? body.values.knee_extension : undefined }, comps, geo,
    visible: legSeen, missing: legSeen ? undefined : "Keep your knees and feet in view of the camera.",
    ...kneeRestCheck(pose, side, aspect),
  };
}

// ---------- the knee dial beside the leg ----------

export type KneeDial = {
  /** The dial's knee, beside the affected knee on the outside of the leg. */
  pivot: P2;
  /** The dial's lower leg length, frame heights. */
  radius: number;
  /** +1 when the dial's foot swings toward +x in the raw image (away from the other leg), else -1. */
  out: number;
};

/** The dial's angle (from straight down) where the target circle sits: the goal is always drawn here. */
export const DIAL_GOAL_DEG = 70;
/** The target circle's radius on the dial, a share of its lower leg. */
const DIAL_CIRCLE_SHARE = 0.3;

/** The dial from the set-up posture: beside the affected knee, sized by the lower leg, kept inside the picture. */
export function kneeDial(pose: PoseInput | null, side: Side, aspect: number): KneeDial | null {
  const lm = pose?.landmarks, j = poseJoints(side);
  const knee = lm?.[j.knee], ankle = lm?.[j.ankle], other = lm?.[j.kneeOther];
  if (!knee || !ankle || !other || ![knee, ankle, other].every(p => inView(p))) return null;
  const shin = shinLength(knee, ankle, aspect);
  if (shin < 0.06) return null;
  const out = Math.sign(knee.x - other.x) || 1;
  // The dial's gap from the knee plus its swing out to the goal and the circle, in frame heights.
  const reach = 0.45 + Math.sin(DIAL_GOAL_DEG / DEG) + DIAL_CIRCLE_SHARE + 0.15;
  const room = (out > 0 ? 0.98 - knee.x : knee.x - 0.02) * aspect;
  const radius = Math.min(clamp(0.85 * shin, 0.12, 0.22), room / reach, (0.98 - knee.y) / (1 + DIAL_CIRCLE_SHARE));
  if (radius < 0.07) return null;
  return { pivot: { x: knee.x + out * 0.45 * radius / aspect, y: knee.y }, radius, out };
}

/** Set-up estimates move the dial this share of the way each frame, so it settles steadily. */
export function followDial(last: KneeDial | null, next: KneeDial | null, share = 0.2): KneeDial | null {
  if (!next) return last;
  if (!last) return next;
  const mix = (a: number, b: number) => a + (b - a) * share;
  return { pivot: { x: mix(last.pivot.x, next.pivot.x), y: mix(last.pivot.y, next.pivot.y) }, radius: mix(last.radius, next.radius), out: next.out };
}

/** The dial's foot at `degrees` from straight down (raw image coordinates). */
export function dialPoint(dial: KneeDial, degrees: number, aspect: number): P2 {
  const a = degrees / DEG;
  return { x: dial.pivot.x + dial.out * Math.sin(a) * dial.radius / aspect, y: dial.pivot.y + Math.cos(a) * dial.radius };
}

/** Where the dial's foot is drawn for a movement progress (0 resting, 1 at the goal). */
export const dialDegrees = (progress: number) => clamp(Number.isFinite(progress) ? progress : 0, -0.15, 1.3) * DIAL_GOAL_DEG;
export const dialCircleRadius = (dial: KneeDial) => DIAL_CIRCLE_SHARE * dial.radius;

// ---------- each step's target ----------

/** The practice goal: a modest straightening from the resting knee, before the personal goal is learned. */
export function kneePracticeGoal(rest: number): number {
  return rest + clamp(0.35 * (170 - rest), 15, 30);
}
/** A practice lift not on target for this long comes closer: straighten as far as is comfortable. */
export const KNEE_EASE_MS = 12000, KNEE_EASED_DEG = 10;
/** Once on target, the knee may sag this much before it counts as off (a hold is not lost to a flicker). */
export const KNEE_HYSTERESIS_DEG = 4;
/**
 * The knee is down again within this share of the way from rest to the goal (at least KNEE_LOWER_MIN_DEG above
 * rest, so a small goal still leaves room for the 3D angle's jitter), with the foot down.
 */
export const KNEE_LOWER_SHARE = 0.3, KNEE_LOWER_MIN_DEG = 8;
/**
 * The foot back where it rested also counts with the knee a little further up (the 3D angle may not settle exactly
 * where it was at set-up), and, after this long lowering, at any angle: a foot on the floor where it rested is down.
 */
const KNEE_BACK_SHARE = 0.4, KNEE_LOWER_LENIENT_MS = 10000;
/** The resting foot's circle in the picture, and how far above its resting point the foot still counts as down. */
const FOOT_BACK_SHARE = 0.25, FOOT_DOWN_SHARE = 0.2;

export type KneeTargetInput = {
  value: number | undefined;
  /** The resting knee angle learned at set-up. */
  rest: number;
  /** The goal angle: the practice goal, or the goal learned in practice. */
  goal: number;
  lowering: boolean;
  /** The affected ankle now, and where it rested at set-up (its lower leg's image length as the scale). */
  ankle?: P2 | null;
  restFoot?: LapRest | null;
  aspect: number;
  armed: boolean;
  practice: boolean;
  t: number;
};

/**
 * Whether the knee is on this step's target, and how far along it is. Straighten: the knee at its goal (it stays
 * on target until it sags a few degrees below). Lower: the knee most of the way back with the foot down. From the
 * front a raised lower leg points at the camera, so the foot's place in the picture hardly changes as the knee
 * straightens: the foot alone never decides that it is down. A practice lift not on target for a while eases to a
 * small straightening.
 */
export class KneeTarget {
  private key = "";
  private on = false;
  private armedSince: number | null = null;
  private lastOn: number | null = null;
  private eased = false;

  reset() { this.key = ""; this.on = false; this.armedSince = null; this.lastOn = null; this.eased = false; }

  update(key: string, input: KneeTargetInput): { contact: boolean; progress: number; goal: number; eased: boolean } {
    if (key !== this.key) { this.reset(); this.key = key; }
    if (input.armed) this.armedSince ??= input.t;
    let goal = input.goal;
    if (input.practice && !input.lowering) {
      // Eased after a while without contact (since arming, or since the knee last sagged off the target).
      if (this.armedSince !== null && input.t - Math.max(this.armedSince, this.lastOn ?? -Infinity) >= KNEE_EASE_MS) this.eased = true;
      if (this.eased) goal = Math.min(goal, input.rest + KNEE_EASED_DEG);
    }
    const value = input.value;
    const measured = value !== undefined && Number.isFinite(value);
    const range = Math.max(1, goal - input.rest);
    const progress = measured ? (value - input.rest) / range : 0;
    if (input.lowering) {
      const foot = input.restFoot, ankle = input.ankle;
      const scale = foot?.bodyScale ?? 0;
      const back = Boolean(foot && ankle && scale > 0 && Math.hypot((ankle.x - foot.x) * input.aspect, ankle.y - foot.y) <= FOOT_BACK_SHARE * scale);
      const down = Boolean(foot && ankle && scale > 0 && ankle.y >= foot.y - FOOT_DOWN_SHARE * scale);
      const slack = this.on ? KNEE_HYSTERESIS_DEG : 0;
      const bent = measured && value - input.rest <= Math.max(KNEE_LOWER_SHARE * range, KNEE_LOWER_MIN_DEG) + slack;
      const nearlyBent = measured && value - input.rest <= Math.max(KNEE_BACK_SHARE * range, KNEE_LOWER_MIN_DEG) + slack;
      const lenient = this.armedSince !== null && input.t - this.armedSince >= KNEE_LOWER_LENIENT_MS;
      this.on = (down && bent) || (back && (nearlyBent || lenient));
    } else {
      this.on = measured && (this.on ? value >= goal - KNEE_HYSTERESIS_DEG : value >= goal);
    }
    if (this.on) this.lastOn = input.t;
    return { contact: this.on, progress, goal, eased: this.eased };
  }
}

// ---------- drawing the dial on the camera view ----------

export type DialDrawing = {
  /** The movement's progress (0 resting, 1 at the goal) for the dial's foot. */
  progress: number;
  lowering: boolean;
  armed: boolean;
  contact: boolean;
  /** The hold's progress, 0-1. */
  hold: number;
  label: string;
  now: number;
  reducedMotion: boolean;
};

/** The knee dial, drawn on the mirrored camera view: the path, a side-view leg whose foot follows the knee, and the active circle. */
export function drawKneeDial(ctx: CanvasRenderingContext2D, dial: KneeDial, width: number, height: number, state: DialDrawing) {
  const aspect = width / height;
  const X = (x: number) => (1 - x) * width, Y = (y: number) => y * height;
  const pivot = { x: X(dial.pivot.x), y: Y(dial.pivot.y) };
  const at = (degrees: number) => { const p = dialPoint(dial, degrees, aspect); return { x: X(p.x), y: Y(p.y) }; };
  const r = dial.radius * height;
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  // The path the foot travels, from resting to just past the goal.
  ctx.beginPath();
  for (let degrees = -8; degrees <= DIAL_GOAL_DEG + 18; degrees += 2) { const p = at(degrees); if (degrees === -8) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
  ctx.strokeStyle = "rgba(255,254,250,.55)"; ctx.lineWidth = Math.max(3, r * 0.05); ctx.setLineDash([6, 8]); ctx.stroke(); ctx.setLineDash([]);
  // The thigh, resting level on the chair, then the lower leg out to the foot.
  const thigh = { x: X(dial.pivot.x - dial.out * 0.4 * dial.radius / aspect), y: pivot.y };
  const foot = at(dialDegrees(state.progress));
  ctx.strokeStyle = "rgba(40,91,73,.85)"; ctx.lineWidth = Math.max(8, r * 0.16);
  ctx.beginPath(); ctx.moveTo(thigh.x, thigh.y); ctx.lineTo(pivot.x, pivot.y); ctx.stroke();
  ctx.strokeStyle = "#e18e6d"; ctx.lineWidth = Math.max(7, r * 0.13);
  ctx.beginPath(); ctx.moveTo(pivot.x, pivot.y); ctx.lineTo(foot.x, foot.y); ctx.stroke();
  ctx.fillStyle = "#fffefa";
  ctx.beginPath(); ctx.arc(pivot.x, pivot.y, Math.max(5, r * 0.07), 0, Math.PI * 2); ctx.fill();
  // The active circle: at the goal while straightening, at the resting foot while lowering.
  const target = at(state.lowering ? 0 : DIAL_GOAL_DEG);
  const radius = dialCircleRadius(dial) * height;
  drawTestingTarget(ctx, { x: target.x, y: target.y, radius, armed: state.armed, contact: state.contact, progress: state.hold, now: state.now, reducedMotion: state.reducedMotion });
  // The foot over the circle, so it can be seen entering it.
  ctx.fillStyle = "#fffefa"; ctx.strokeStyle = "#e18e6d"; ctx.lineWidth = Math.max(3, r * 0.04);
  ctx.beginPath(); ctx.arc(foot.x, foot.y, Math.max(7, r * 0.09), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  drawRingLabel(ctx, target.x, target.y, radius, state.label, height, state.armed);
  ctx.restore();
}

/** The circle the last step completed, in canvas pixels (for its completion animation). */
export function dialCircle(dial: KneeDial, lowering: boolean, width: number, height: number) {
  const p = dialPoint(dial, lowering ? 0 : DIAL_GOAL_DEG, width / height);
  return { x: (1 - p.x) * width, y: p.y * height, radius: dialCircleRadius(dial) * height };
}

// ---------- the demonstration and the no-camera simulator (the side-view ghost, 300 x 270 drawing space) ----------

const MOVE_MS = 1300;
const GHOST_RADIUS = 20;
const smooth = (k: number) => k * k * (3 - 2 * k);
const unit = (k: number) => clamp(k, 0, 1);
const poseAt = (fraction: number, returning: boolean) => (returning ? 1 - smooth(fraction) : smooth(fraction));

/** The ghost's ankle at progress p: the same leg as ghost.ts draws (knee 92 to 160 degrees). */
function ghostAnkle(p: number): [number, number] {
  const knee = (92 + (160 - 92) * p) / DEG;
  return [186 - 64 * Math.cos(knee), 176 + 64 * Math.sin(knee)];
}

/** The instant the ghost's ankle enters its circle, as the reach's demonstration finds it. */
function contactStartMs(returning: boolean) {
  const target = ghostAnkle(returning ? 0 : 1);
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    const ankle = ghostAnkle(poseAt(middle, returning));
    if (Math.hypot(ankle[0] - target[0], ankle[1] - target[1]) <= GHOST_RADIUS) high = middle;
    else low = middle;
  }
  return high * MOVE_MS;
}
const CONTACT_MS = [contactStartMs(false), contactStartMs(true)];

export const kneeDemoDuration = (returning: boolean) => CONTACT_MS[returning ? 1 : 0] + TARGET_HOLD_MS + TARGET_COMPLETION_MS;

/** The step's circle around the ghost's foot, in canvas pixels: straightened for the lift, resting for the lower. */
export function kneeGhostTarget(width: number, height: number, returning: boolean) {
  const [x, y] = ghostAnkle(returning ? 0 : 1);
  const s = Math.min(width / 300, height / 270);
  return { x: (width - 300 * s) / 2 + x * s, y: (height - 270 * s) / 2 + y * s, radius: GHOST_RADIUS * s };
}

/** The simulated patient is on target at the end of each movement (level 1 is the goal, 0 resting). */
export function kneeGhostContact(level: number, returning: boolean): boolean {
  return returning ? level <= 0.05 : level >= 0.95;
}

export function kneeDemoState(elapsedMs: number, returning: boolean, armed = true) {
  const elapsed = armed ? Math.max(0, elapsedMs) : 0;
  const reached = CONTACT_MS[returning ? 1 : 0];
  const contact = armed && elapsed >= reached;
  const progress = contact ? unit((elapsed - reached) / TARGET_HOLD_MS) : 0;
  const completionElapsedMs = elapsed - reached - TARGET_HOLD_MS;
  const phase = !armed ? "waiting" : !contact ? "move" : progress < 1 ? "hold" : "complete";
  const pose = poseAt(unit(elapsed / MOVE_MS), returning);
  const target = ghostAnkle(returning ? 0 : 1);
  const label = returning ? "Foot down" : "Straighten";
  const instruction = !armed ? "Listen to the instruction. The circle will become active when the voice finishes."
    : phase === "complete" ? returning ? "Foot down complete" : "Target complete — now lower your foot slowly"
    : phase === "hold" ? `${returning ? "Rest your foot" : "Hold your knee straight"} · ${Math.round(progress * 100)}%`
    : returning ? "Bend your knee and lower your foot slowly to the floor" : "Straighten your knee slowly until your foot reaches the circle";
  return { pose, target, radius: GHOST_RADIUS, armed, contact, progress, completionElapsedMs, phase, label, instruction };
}

export function drawKneeDemo(ctx: CanvasRenderingContext2D, elapsedMs: number, returning: boolean, width: number, height: number, now: number, reducedMotion = false, armed = true) {
  const state = kneeDemoState(elapsedMs, returning, armed);
  drawGhost(ctx, "knee", state.pose, width, height);
  const { x, y, radius } = kneeGhostTarget(width, height, returning);
  if (state.phase === "complete") {
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
