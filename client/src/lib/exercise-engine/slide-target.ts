import type { Side } from "./config";
import { drawRingLabel } from "./hand-target";
import { inView, poseFrameValues, poseJoints, type Frame, type Geo, type LapRest, type PoseInput, type Pt } from "./metrics";
import { TARGET_COMPLETION_MS, TARGET_HOLD_MS } from "./target-timing";
import { drawTargetCompletion, drawTestingTarget } from "./target-visual";

// Supported Arm Elevation as a table slide on the shared target flow. The patient sits at the corner of a table
// that is beside the affected side, forearm resting on a towel, other hand on the thigh, with a front camera at
// chest height (above the table) seeing the head to the thighs. The hand slides forward along the table, mostly
// toward the camera, so it hardly moves in the picture: the shoulder's elevation comes from the pose model's 3D
// landmarks, and a slide dial drawn beside the shoulder shows it. The dial is a side view of the arm on a table
// whose hand slides into the target circle as the shoulder elevates, with the same circle activation as the other
// exercises. Positions are raw (unmirrored) image coordinates: x in frame widths, y in frame heights; lengths in
// frame heights.

const DEG = 180 / Math.PI;
type P2 = { x: number; y: number };
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** The cycle's steps, by index (config.ts ex_wallslide). */
export const SLIDE_STEP = { slide: 0, back: 1 } as const;

/** The slide's own part of the set-up snapshot (Geo): the resting hands in the picture and the shoulder span. */
export type SlideGeo = Geo & { slideWristX?: number; slideWristY?: number; slideOtherX?: number; slideOtherY?: number; slideSpan?: number };

// ---------- the set-up snapshot and the slide's own checks ----------

/** The shoulder span in the picture (frame heights), the scale for the hand checks. */
function shoulderSpan(pose: PoseInput, side: Side, aspect: number): number | undefined {
  const lm = pose.landmarks, j = poseJoints(side);
  const s = lm[j.shoulder], o = lm[j.shoulderOther];
  return inView(s) && inView(o) ? Math.hypot((s.x - o.x) * aspect, s.y - o.y) : undefined;
}

/** The snapshot's slide fields: both wrists in the picture and the shoulder span. */
export function slideGeo(pose: PoseInput, side: Side, aspect: number): Partial<SlideGeo> {
  const lm = pose.landmarks, j = poseJoints(side);
  const out: Partial<SlideGeo> = {};
  const wrist = lm[j.wrist], other = lm[j.wristOther];
  if (inView(wrist)) { out.slideWristX = wrist.x; out.slideWristY = wrist.y; }
  if (inView(other)) { out.slideOtherX = other.x; out.slideOtherY = other.y; }
  const span = shoulderSpan(pose, side, aspect);
  if (span !== undefined) out.slideSpan = span;
  return out;
}

/** The other hand counts as helping this close to the affected forearm, in shoulder spans... */
const OTHER_NEAR_SPAN = 0.4;
/** ...or once it has travelled this far from where it rested at set-up. */
const OTHER_TRAVEL_SPAN = 0.5;

/** Distance from a point to the segment a-b, in frame heights. */
function segmentDistance(p: Pt, a: Pt, b: Pt, aspect: number) {
  const ax = a.x * aspect, ay = a.y, bx = b.x * aspect, by = b.y, px = p.x * aspect, py = p.y;
  const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
  const k = length ? clamp(((px - ax) * dx + (py - ay) * dy) / length, 0, 1) : 0;
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}

/**
 * The slide's own compensation measures against the set-up reference:
 * - hand_lift_pct: the affected hand higher in the picture than where it rested on the table, in % of the shoulder
 *   span. Sliding along the table never raises the hand in the picture from a camera above the table (it stays level
 *   or sinks as it nears the camera), so a rise is the hand or forearm lifting off the support. The elbow rising is
 *   normal in a slide and is not counted.
 * - other_hand_pct: the other hand helping, in % of its limit (100 at the limit): it travelled half a shoulder span
 *   from where it rested, or came within 0.4 of a span of the affected forearm.
 */
export function slideComps(pose: PoseInput, ref: SlideGeo | null, side: Side, aspect: number): Frame["comps"] {
  const out: Frame["comps"] = {};
  const span = ref?.slideSpan;
  if (!ref || !span || span < 0.03) return out;
  const lm = pose.landmarks, j = poseJoints(side);
  const wrist = lm[j.wrist], elbow = lm[j.elbow], other = lm[j.wristOther];
  if (inView(wrist) && ref.slideWristY !== undefined) out.hand_lift_pct = Math.max(0, (ref.slideWristY - wrist.y) / span * 100);
  if (inView(other) && ref.slideOtherX !== undefined && ref.slideOtherY !== undefined) {
    const travel = Math.hypot((other.x - ref.slideOtherX) * aspect, other.y - ref.slideOtherY) / span / OTHER_TRAVEL_SPAN;
    const near = inView(wrist) && inView(elbow) ? OTHER_NEAR_SPAN / Math.max(0.05, segmentDistance(other, elbow, wrist, aspect) / span) : 0;
    out.other_hand_pct = Math.min(300, Math.max(travel, near) * 100);
  }
  return out;
}

/**
 * What set-up waits for, in the patient's words: head to thighs in view with room round the body, the affected
 * forearm resting on the table beside the body (above the lap, elbow bent), the other hand on its thigh, and the
 * camera above the table (seen from above, the resting hand sits no higher in the picture than the elbow).
 */
export function slideRestCheck(pose: PoseInput | null, side: Side, aspect: number): { lapRest?: LapRest; lapMissing?: string } {
  if (!pose) return { lapMissing: "Sit in front of the camera so I can see you." };
  const lm = pose.landmarks, j = poseJoints(side);
  const seen = (...indices: number[]) => indices.every(index => inView(lm[index]));
  const name = side === "left" ? "left" : "right";
  if (!seen(j.nose)) return { lapMissing: "Move the camera back so I can see you from your head to your thighs." };
  if (!seen(j.shoulder, j.shoulderOther)) return { lapMissing: "Move the camera back so I can see both shoulders." };
  if (!seen(j.hip, j.hipOther)) return { lapMissing: "Sit at the corner of the table, with the table beside you, so I can see both hips." };
  if (!seen(j.elbow, j.wrist)) return { lapMissing: `Rest your ${name} forearm on the table where the camera can see your elbow and hand.` };
  if (!seen(j.wristOther)) return { lapMissing: "Rest your other hand on your thigh where the camera can see it." };
  if (lm[j.nose].y < 0.05) return { lapMissing: "Tilt the camera up a little so there is space above your head." };
  if ([j.shoulder, j.shoulderOther, j.elbow, j.wrist, j.wristOther].some(index => lm[index].x < 0.04 || lm[index].x > 0.96)) {
    return { lapMissing: "Move the camera so you are in the middle of the picture." };
  }
  const span = shoulderSpan(pose, side, aspect)!;
  const shoulder = lm[j.shoulder], other = lm[j.shoulderOther], hip = lm[j.hip], hipOther = lm[j.hipOther];
  const torso = (hip.y + hipOther.y) / 2 - (shoulder.y + other.y) / 2;
  if (span < 0.08 || torso < 0.1) return { lapMissing: "Move the camera a little closer." };
  const wrist = lm[j.wrist], elbow = lm[j.elbow], otherWrist = lm[j.wristOther];
  const out = Math.sign(shoulder.x - other.x) || 1;
  // The forearm on the table: the hand above the lap, on the affected side of the body.
  if (wrist.y > hip.y - 0.2 * torso || (wrist.x - (shoulder.x + other.x) / 2) * out <= 0) {
    return { lapMissing: `Rest your ${name} forearm on a towel on the table beside you, with your elbow bent.` };
  }
  // From a camera above the table the forearm, pointing toward it, has the hand no higher than the elbow.
  if (wrist.y < elbow.y - 0.05 * span) return { lapMissing: "Raise the camera to chest height, above the table." };
  // The other hand resting on its thigh.
  if (otherWrist.y < hipOther.y - 0.3 * torso || otherWrist.y > hipOther.y + 0.6 * torso) return { lapMissing: "Rest your other hand on your thigh." };
  return { lapRest: { x: wrist.x, y: wrist.y, bodyScale: span } };
}

/**
 * One camera frame: the shoulder's elevation and the elbow (3D), the five checks, and the set-up's resting hand on
 * the table. During the slide only the affected arm has to stay in view; a check whose body part is out of view
 * stays unmeasured.
 */
export function slideFrame(det: { pose: PoseInput | null }, side: Side, t: number, aspect: number, ref: Geo | null): Frame {
  const pose = det.pose;
  if (!pose) return { t, values: {}, comps: {}, visible: false, missing: "Sit in front of the camera so I can see you.", ...slideRestCheck(null, side, aspect) };
  const lm = pose.landmarks, j = poseJoints(side);
  const seen = (...indices: number[]) => indices.every(index => inView(lm[index]));
  const body = poseFrameValues(pose, side, ref);
  const geo = { ...body.geo!, ...slideGeo(pose, side, aspect) } as SlideGeo;
  const armSeen = seen(j.shoulder, j.elbow, j.wrist, j.hip);
  const trunkSeen = seen(j.shoulder, j.shoulderOther, j.hip, j.hipOther);
  const comps: Frame["comps"] = {
    trunk_approach_pct: body.comps.trunk_approach_pct,
    trunk_side_lean_delta: trunkSeen ? body.comps.trunk_side_lean_delta : undefined,
    shoulder_hike_rel_delta: trunkSeen ? body.comps.shoulder_hike_rel_delta : undefined,
    shoulder_elevation_pct: body.comps.shoulder_elevation_pct,
    ...slideComps(pose, ref as SlideGeo | null, side, aspect),
  };
  return {
    t, comps, geo,
    values: armSeen ? { shoulder_flexion: body.values.shoulder_flexion, elbow_extension: body.values.elbow_extension } : {},
    visible: armSeen, missing: armSeen ? undefined : seen(j.shoulder, j.elbow, j.wrist) ? "Sit at the corner of the table, with the table beside you, so I can see your hips." : "Keep your shoulder, elbow and hand in view of the camera.",
    ...slideRestCheck(pose, side, aspect),
  };
}

// ---------- the slide dial beside the shoulder ----------

export type SlideDial = {
  /** The dial's shoulder, beside the affected shoulder on the outside of the body. */
  pivot: P2;
  /** The dial's upper arm length, frame heights (the dial's unit). */
  radius: number;
  /** +1 when the dial's hand slides toward +x in the raw image (away from the body), else -1. */
  out: number;
};

/** The dial's arm, in upper-arm lengths: the forearm, and the table at the resting elbow's height. */
const DIAL_FOREARM = 0.9;
/** The dial's shoulder angle (from straight down) where the target circle sits: the goal is always drawn here. */
export const DIAL_GOAL_DEG = 42;
/** The dial's arm is straight here: the hand can slide no further along its table. */
const DIAL_MAX_DEG = Math.acos(1 / (1 + DIAL_FOREARM)) * DEG;
/** The circle's radius, the dial's gap from the shoulder and its reach out to the far edge of the circle, in upper-arm lengths. */
const DIAL_CIRCLE = 0.24, DIAL_GAP = 0.6, DIAL_REACH = 1.62 + DIAL_CIRCLE + 0.1, DIAL_DEPTH = 1 + DIAL_CIRCLE + 0.1;

/** The dial's hand on its table at a shoulder angle (degrees), in upper-arm lengths from the dial's shoulder. */
export function dialHand(degrees: number): { elbow: [number, number]; hand: [number, number] } {
  const a = clamp(degrees, 0, DIAL_MAX_DEG) / DEG;
  const elbow: [number, number] = [Math.sin(a), Math.cos(a)];
  const drop = 1 - elbow[1];
  return { elbow, hand: [elbow[0] + Math.sqrt(Math.max(0, DIAL_FOREARM * DIAL_FOREARM - drop * drop)), 1] };
}

/** The dial from the set-up posture: beside the affected shoulder, sized by the upper arm, kept inside the picture. */
export function slideDial(pose: PoseInput | null, side: Side, aspect: number): SlideDial | null {
  const lm = pose?.landmarks, j = poseJoints(side);
  const shoulder = lm?.[j.shoulder], other = lm?.[j.shoulderOther], elbow = lm?.[j.elbow];
  if (!shoulder || !other || !elbow || ![shoulder, other, elbow].every(p => inView(p))) return null;
  const upper = Math.hypot((elbow.x - shoulder.x) * aspect, elbow.y - shoulder.y);
  const out = Math.sign(shoulder.x - other.x) || 1;
  const room = (out > 0 ? 0.98 - shoulder.x : shoulder.x - 0.02) * aspect;
  const radius = Math.min(clamp(0.8 * upper, 0.09, 0.16), room / (DIAL_GAP + DIAL_REACH), (0.98 - shoulder.y) / DIAL_DEPTH);
  if (radius < 0.06) return null;
  return { pivot: { x: shoulder.x + out * DIAL_GAP * radius / aspect, y: shoulder.y }, radius, out };
}

/** Set-up estimates move the dial this share of the way each frame, so it settles steadily. */
export function followSlideDial(last: SlideDial | null, next: SlideDial | null, share = 0.2): SlideDial | null {
  if (!next) return last;
  if (!last) return next;
  const mix = (a: number, b: number) => a + (b - a) * share;
  return { pivot: { x: mix(last.pivot.x, next.pivot.x), y: mix(last.pivot.y, next.pivot.y) }, radius: mix(last.radius, next.radius), out: next.out };
}

/** A point of the dial (upper-arm lengths: along the table away from the body, and down) in raw image coordinates. */
export function dialPoint(dial: SlideDial, along: number, down: number, aspect: number): P2 {
  return { x: dial.pivot.x + dial.out * along * dial.radius / aspect, y: dial.pivot.y + down * dial.radius };
}

/** The dial's shoulder angle for a movement progress (0 resting, 1 at the goal). */
export const dialDegrees = (progress: number) => clamp(Number.isFinite(progress) ? progress : 0, -0.1, 1.3) * DIAL_GOAL_DEG;

// ---------- each step's target ----------

/** The practice goal: a modest slide from the resting shoulder, before the personal goal is learned (a table allows about 55-63 degrees). */
export function slidePracticeGoal(rest: number): number {
  return rest + clamp(0.35 * (60 - rest), 15, 30);
}
/** A practice slide not reached in this long comes closer: slide as far as is comfortable. */
export const SLIDE_EASE_MS = 12000, SLIDE_EASED_DEG = 10;
/** Once on target, the shoulder may sag this much before it counts as off (a hold is not lost to a flicker). */
export const SLIDE_HYSTERESIS_DEG = 4;
/**
 * The arm is back with the shoulder within this share of the way from rest to the goal (at least this many degrees
 * from rest, so a small goal still leaves room for the 3D angle's jitter), the hand down on the table.
 */
export const SLIDE_BACK_SHARE = 0.3, SLIDE_BACK_MIN_DEG = 8;
/**
 * The hand back where it rested also counts with the shoulder a little further up (the 3D angle may not settle exactly
 * where it was at set-up), and, after this long sliding back, at any angle.
 */
const SLIDE_NEARLY_SHARE = 0.4, SLIDE_BACK_LENIENT_MS = 10000;
/**
 * The resting hand's circle on the table and how far above its resting point the hand still counts as down, in
 * shoulder spans. The circle is small: a hand slid forward to the goal is only about 0.15-0.2 spans away in the picture.
 */
const HAND_BACK_SPAN = 0.1, HAND_DOWN_SPAN = 0.13;

export type SlideTargetInput = {
  value: number | undefined;
  /** The resting shoulder elevation learned at set-up. */
  rest: number;
  /** The goal: the practice goal, or the goal learned in practice. */
  goal: number;
  returning: boolean;
  /** The affected hand now, and where it rested at set-up (the shoulder span as the scale). */
  hand?: P2 | null;
  restHand?: LapRest | null;
  aspect: number;
  armed: boolean;
  practice: boolean;
  t: number;
};

/**
 * Whether the arm is on this step's target, and how far along it is. Slide: the shoulder at its goal (it stays on
 * target until it sags a few degrees below). Back: the shoulder most of the way back with the hand down on the table.
 * The hand slides mostly toward the camera, so its place in the picture hardly changes: the hand alone never decides
 * that the arm is back. A practice slide not on target for a while eases to a small slide.
 */
export class SlideTarget {
  private key = "";
  private on = false;
  private armedSince: number | null = null;
  private lastOn: number | null = null;
  private eased = false;

  reset() { this.key = ""; this.on = false; this.armedSince = null; this.lastOn = null; this.eased = false; }

  update(key: string, input: SlideTargetInput): { contact: boolean; progress: number; goal: number; eased: boolean } {
    if (key !== this.key) { this.reset(); this.key = key; }
    if (input.armed) this.armedSince ??= input.t;
    let goal = input.goal;
    if (input.practice && !input.returning) {
      // Eased after a while without contact (since arming, or since the shoulder last sagged off the target).
      if (this.armedSince !== null && input.t - Math.max(this.armedSince, this.lastOn ?? -Infinity) >= SLIDE_EASE_MS) this.eased = true;
      if (this.eased) goal = Math.min(goal, input.rest + SLIDE_EASED_DEG);
    }
    const value = input.value;
    const measured = value !== undefined && Number.isFinite(value);
    const range = Math.max(1, goal - input.rest);
    const progress = measured ? (value - input.rest) / range : 0;
    if (input.returning) {
      const rest = input.restHand, hand = input.hand, span = rest?.bodyScale ?? 0;
      const placed = Boolean(rest && hand && span > 0);
      const back = placed && Math.hypot((hand!.x - rest!.x) * input.aspect, hand!.y - rest!.y) <= HAND_BACK_SPAN * span;
      const down = placed && hand!.y >= rest!.y - HAND_DOWN_SPAN * span;
      const slack = this.on ? SLIDE_HYSTERESIS_DEG : 0;
      const bent = measured && value - input.rest <= Math.max(SLIDE_BACK_SHARE * range, SLIDE_BACK_MIN_DEG) + slack;
      const nearly = measured && value - input.rest <= Math.max(SLIDE_NEARLY_SHARE * range, SLIDE_BACK_MIN_DEG) + slack;
      const lenient = this.armedSince !== null && input.t - this.armedSince >= SLIDE_BACK_LENIENT_MS;
      this.on = (down && bent) || (back && (nearly || lenient));
    } else {
      this.on = measured && (this.on ? value >= goal - SLIDE_HYSTERESIS_DEG : value >= goal);
    }
    if (this.on) this.lastOn = input.t;
    return { contact: this.on, progress, goal, eased: this.eased };
  }
}

// ---------- drawing the dial on the camera view ----------

export type SlideDrawing = {
  /** The movement's progress (0 resting, 1 at the goal) for the dial's hand. */
  progress: number;
  returning: boolean;
  armed: boolean;
  contact: boolean;
  /** The hold's progress, 0-1. */
  hold: number;
  label: string;
  now: number;
  reducedMotion: boolean;
};

/** The slide dial on the mirrored camera view: a table, a side-view arm whose hand slides along it, and the active circle. */
export function drawSlideDial(ctx: CanvasRenderingContext2D, dial: SlideDial, width: number, height: number, state: SlideDrawing) {
  const aspect = width / height;
  const at = (along: number, down: number) => { const p = dialPoint(dial, along, down, aspect); return { x: (1 - p.x) * width, y: p.y * height }; };
  const r = dial.radius * height;
  const rest = dialHand(0).hand[0], top = dialHand(DIAL_MAX_DEG).hand[0];
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  // The table, and the path the hand slides along it.
  const tableA = at(-0.1, 1.12), tableB = at(top + 0.3, 1.12);
  ctx.strokeStyle = "rgba(255,254,250,.7)"; ctx.lineWidth = Math.max(4, r * 0.06);
  ctx.beginPath(); ctx.moveTo(tableA.x, tableA.y); ctx.lineTo(tableB.x, tableB.y); ctx.stroke();
  const pathA = at(rest, 1), pathB = at(top, 1);
  ctx.strokeStyle = "rgba(255,254,250,.55)"; ctx.lineWidth = Math.max(3, r * 0.05); ctx.setLineDash([6, 8]);
  ctx.beginPath(); ctx.moveTo(pathA.x, pathA.y); ctx.lineTo(pathB.x, pathB.y); ctx.stroke(); ctx.setLineDash([]);
  // The body's side, then the arm: shoulder to elbow to the hand on the table.
  const trunkA = at(-0.25, -0.1), trunkB = at(-0.25, 1.05);
  ctx.strokeStyle = "rgba(40,91,73,.85)"; ctx.lineWidth = Math.max(8, r * 0.16);
  ctx.beginPath(); ctx.moveTo(trunkA.x, trunkA.y); ctx.lineTo(trunkB.x, trunkB.y); ctx.stroke();
  const arm = dialHand(dialDegrees(state.progress));
  const shoulder = at(0, 0), elbow = at(arm.elbow[0], arm.elbow[1]), hand = at(arm.hand[0], arm.hand[1]);
  ctx.strokeStyle = "#e18e6d"; ctx.lineWidth = Math.max(7, r * 0.13);
  ctx.beginPath(); ctx.moveTo(shoulder.x, shoulder.y); ctx.lineTo(elbow.x, elbow.y); ctx.lineTo(hand.x, hand.y); ctx.stroke();
  ctx.fillStyle = "#fffefa";
  ctx.beginPath(); ctx.arc(shoulder.x, shoulder.y, Math.max(5, r * 0.08), 0, Math.PI * 2); ctx.fill();
  // The active circle: at the goal while sliding forward, at the resting hand while sliding back.
  const { x, y, radius } = slideDialCircle(dial, state.returning, width, height);
  drawTestingTarget(ctx, { x, y, radius, armed: state.armed, contact: state.contact, progress: state.hold, now: state.now, reducedMotion: state.reducedMotion });
  // The hand over the circle, so it can be seen sliding into it.
  ctx.fillStyle = "#fffefa"; ctx.strokeStyle = "#e18e6d"; ctx.lineWidth = Math.max(3, r * 0.04);
  ctx.beginPath(); ctx.arc(hand.x, hand.y, Math.max(7, r * 0.1), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  drawRingLabel(ctx, x, y, radius, state.label, height, state.armed);
  ctx.restore();
}

/** A step's circle on the dial in canvas pixels: the goal while sliding forward, the resting hand while sliding back. */
export function slideDialCircle(dial: SlideDial, returning: boolean, width: number, height: number) {
  const [along, down] = dialHand(returning ? 0 : DIAL_GOAL_DEG).hand;
  const p = dialPoint(dial, along, down, width / height);
  return { x: (1 - p.x) * width, y: p.y * height, radius: DIAL_CIRCLE * dial.radius * height };
}

// ---------- the demonstration and the no-camera simulator (side view, 300 x 270 drawing space) ----------

const MOVE_MS = 1400;
const GHOST = { shoulder: [112, 92] as [number, number], upper: 64, fore: 58, table: 156, goalDeg: 45 };
const GHOST_RADIUS = 18;
const smooth = (k: number) => k * k * (3 - 2 * k);
const unit = (k: number) => clamp(k, 0, 1);
const poseAt = (fraction: number, returning: boolean) => (returning ? 1 - smooth(fraction) : smooth(fraction));

/** The ghost's arm at progress p (0 resting, 1 slid forward): its elbow and the hand on the table. */
export function slideGhostPose(p: number): { elbow: [number, number]; hand: [number, number] } {
  const a = (GHOST.goalDeg * clamp(p, 0, 1.2)) / DEG;
  const [sx, sy] = GHOST.shoulder;
  const elbow: [number, number] = [sx + GHOST.upper * Math.sin(a), sy + GHOST.upper * Math.cos(a)];
  const drop = GHOST.table - elbow[1];
  return { elbow, hand: [elbow[0] + Math.sqrt(Math.max(0, GHOST.fore * GHOST.fore - drop * drop)), GHOST.table] };
}

/** The instant the ghost's hand enters its circle, as the reach's demonstration finds it. */
function contactStartMs(returning: boolean) {
  const target = slideGhostPose(returning ? 0 : 1).hand;
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    const hand = slideGhostPose(poseAt(middle, returning)).hand;
    if (Math.hypot(hand[0] - target[0], hand[1] - target[1]) <= GHOST_RADIUS) high = middle;
    else low = middle;
  }
  return high * MOVE_MS;
}
const CONTACT_MS = [contactStartMs(false), contactStartMs(true)];

export const slideDemoDuration = (returning: boolean) => CONTACT_MS[returning ? 1 : 0] + TARGET_HOLD_MS + TARGET_COMPLETION_MS;

/** The step's circle round the ghost's hand, in canvas pixels: slid forward, or resting for the slide back. */
export function slideGhostTarget(width: number, height: number, returning: boolean) {
  const [x, y] = slideGhostPose(returning ? 0 : 1).hand;
  const s = Math.min(width / 300, height / 270);
  return { x: (width - 300 * s) / 2 + x * s, y: (height - 270 * s) / 2 + y * s, radius: GHOST_RADIUS * s };
}

/** The simulated patient is on target at the end of each movement (level 1 is the goal, 0 resting). */
export function slideGhostContact(level: number, returning: boolean): boolean {
  return returning ? level <= 0.05 : level >= 0.95;
}

/** The side-view figure seated beside a table, the affected forearm on it, sliding the hand forward. */
export function drawSlideGhost(ctx: CanvasRenderingContext2D, p: number, width: number, height: number, colors = { line: "#3c8255", accent: "#e18e6d", soft: "#b9d3c2" }) {
  const s = Math.min(width / 300, height / 270);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate((width - 300 * s) / 2, (height - 270 * s) / 2);
  ctx.scale(s, s);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const line = (pts: [number, number][]) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); };
  // Chair and table (the towel on its top).
  ctx.strokeStyle = colors.soft; ctx.lineWidth = 6;
  line([[84, 120], [84, 182], [180, 182], [180, 252]]);
  line([[120, GHOST.table + 8], [282, GHOST.table + 8]]); line([[270, GHOST.table + 8], [270, 252]]);
  ctx.lineWidth = 4; line([[130, GHOST.table + 3], [240, GHOST.table + 3]]);
  // Body: head, trunk, thigh and lower leg.
  ctx.strokeStyle = colors.line; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(112, 52, 18, 0, Math.PI * 2); ctx.stroke();
  line([GHOST.shoulder, [106, 176]]); line([[106, 176], [176, 178], [180, 248]]);
  // The affected arm, the hand sliding along the table.
  const arm = slideGhostPose(p);
  ctx.strokeStyle = colors.accent; ctx.lineWidth = 9;
  line([GHOST.shoulder, arm.elbow, arm.hand]);
  ctx.beginPath(); ctx.arc(arm.hand[0], arm.hand[1], 5, 0, Math.PI * 2); ctx.fillStyle = colors.accent; ctx.fill();
  ctx.restore();
}

export function slideDemoState(elapsedMs: number, returning: boolean, armed = true) {
  const elapsed = armed ? Math.max(0, elapsedMs) : 0;
  const reached = CONTACT_MS[returning ? 1 : 0];
  const contact = armed && elapsed >= reached;
  const progress = contact ? unit((elapsed - reached) / TARGET_HOLD_MS) : 0;
  const completionElapsedMs = elapsed - reached - TARGET_HOLD_MS;
  const phase = !armed ? "waiting" : !contact ? "move" : progress < 1 ? "hold" : "complete";
  const pose = poseAt(unit(elapsed / MOVE_MS), returning);
  const target = slideGhostPose(returning ? 0 : 1).hand;
  const label = returning ? "Slide back" : "Slide";
  const instruction = !armed ? "Listen to the instruction. The circle will become active when the voice finishes."
    : phase === "complete" ? returning ? "Slide back complete" : "Target complete — now slide your hand back"
    : phase === "hold" ? `${returning ? "Rest your hand" : "Hold your hand there"} · ${Math.round(progress * 100)}%`
    : returning ? "Slide your hand back to where it started" : "Slide your hand forward along the table to the circle";
  return { pose, target, radius: GHOST_RADIUS, armed, contact, progress, completionElapsedMs, phase, label, instruction };
}

export function drawSlideDemo(ctx: CanvasRenderingContext2D, elapsedMs: number, returning: boolean, width: number, height: number, now: number, reducedMotion = false, armed = true) {
  const state = slideDemoState(elapsedMs, returning, armed);
  drawSlideGhost(ctx, state.pose, width, height);
  const { x, y, radius } = slideGhostTarget(width, height, returning);
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
