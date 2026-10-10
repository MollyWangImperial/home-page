import type { Side } from "./config";
import { drawCup } from "./grasp-target";
import { drawRingLabel } from "./hand-target";
import { inView, poseFrameValues, poseJoints, type Frame, type Geo, type LapRest, type PoseInput, type Pt } from "./metrics";
import { TARGET_COMPLETION_MS, TARGET_HOLD_MS } from "./target-timing";
import { drawTargetCompletion, drawTestingTarget } from "./target-visual";

// Supported Arm Elevation on the shared target flow. The forearm rests on a table beside the affected side (a
// supported slide along it) or on the chair's armrest (lifted from it), the other hand on its thigh or the other
// armrest, a front camera at chest height seeing the head to the thighs. The hand moves out to the side and a little
// forward (the scapular plane, the usual safe plane for shoulder elevation after stroke) toward a cup drawn in a
// target circle, with an arrow showing the way. Most of that movement is across the picture, so the hand's place on
// screen measures it and decides the circle, as for Graded Forward Reach; a hand moving toward the camera would only
// change its depth.
// Positions are raw (unmirrored) image coordinates: x in frame widths, y in frame heights; lengths in frame heights.

type P2 = { x: number; y: number };
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** The cycle's steps, by index (config.ts ex_wallslide). */
export const SLIDE_STEP = { slide: 0, back: 1 } as const;
/** What the forearm rests on (the patient's choice at the start). */
export type SlideSupport = "table" | "armrest";

/** The slide's own part of the set-up snapshot (Geo): the resting hands in the picture and the shoulder span. */
export type SlideGeo = Geo & { slideWristX?: number; slideWristY?: number; slideOtherX?: number; slideOtherY?: number; slideSpan?: number; slideOut?: number };

// ---------- where the cup is ----------

/** The practice cup's distance out from the resting hand, in shoulder spans; eased to this if not reached for a while. */
export const SLIDE_PRACTICE_SPANS = 0.6, SLIDE_EASED_SPANS = 0.35, SLIDE_EASE_MS = 12000;
/** The circles' radius, in shoulder spans (within limits in frame heights)... */
const CIRCLE_SPAN = 0.22, CIRCLE_MIN = 0.045, CIRCLE_MAX = 0.1;
/** ...and never more than this share of the distance between the cup and the resting place, so they never touch. */
const CIRCLE_APART = 0.4;
/** Once in a circle, the hand stays in it until it is this much further out (a hold is not lost to a flicker). */
const CIRCLE_STAY = 1.2;
/**
 * Set-up needs room beside the arm for the practice cup and its circle, plus this margin (shoulder spans) for a hand
 * that goes a little past it. The cup never sits further out than the practice distance, so asking for more room
 * would only make people sit further back than they need to.
 */
const ROOM_MARGIN_SPANS = 0.1;

/**
 * How far the cup sits above the resting hand for each shoulder span out: level along a table (the hand slides on
 * it); from the armrest the arm lifts as it moves out, so the cup is out and a little up (about 27 degrees).
 */
export const SLIDE_RISE = { table: 0, armrest: 0.5 } as const;

/**
 * Both circles' radius (frame heights): a share of the shoulder span within limits, and small enough that the cup's
 * circle and the resting circle stay apart (with the stay margin) however close the cup is or however small the span.
 */
export function slideRadius(span: number, spans: number, rise = 0): number {
  return Math.min(clamp(CIRCLE_SPAN * span, CIRCLE_MIN, CIRCLE_MAX), CIRCLE_APART * spans * span * Math.hypot(1, rise));
}

/** The circle the hand moves out to: from the resting hand, `spans` shoulder spans away from the body (and `rise` up per span). */
export function slideCircle(rest: LapRest, out: number, spans: number, aspect: number, rise = 0): P2 & { radius: number } {
  return { x: rest.x + out * spans * rest.bodyScale / aspect, y: rest.y - rise * spans * rest.bodyScale, radius: slideRadius(rest.bodyScale, spans, rise) };
}

/** The resting circle the hand comes back to, the same size as that cup's circle. */
export function restCircle(rest: LapRest, spans: number, rise = 0): P2 & { radius: number } {
  return { x: rest.x, y: rest.y, radius: slideRadius(rest.bodyScale, spans, rise) };
}

/** +1 when the affected side is toward +x in the raw image (away from the body's middle), else -1. */
export function slideOutward(pose: PoseInput | null, side: Side): number | null {
  const lm = pose?.landmarks, j = poseJoints(side);
  const s = lm?.[j.shoulder], o = lm?.[j.shoulderOther];
  return s && o && inView(s) && inView(o) ? Math.sign(s.x - o.x) || 1 : null;
}

// ---------- the set-up snapshot and the slide's own checks ----------

/** The shoulder span in the picture (frame heights), the scale for the hand checks. */
function shoulderSpan(pose: PoseInput, side: Side, aspect: number): number | undefined {
  const lm = pose.landmarks, j = poseJoints(side);
  const s = lm[j.shoulder], o = lm[j.shoulderOther];
  return inView(s) && inView(o) ? Math.hypot((s.x - o.x) * aspect, s.y - o.y) : undefined;
}

/** The snapshot's slide fields: both wrists in the picture, the shoulder span and the outward direction. */
export function slideGeo(pose: PoseInput, side: Side, aspect: number): Partial<SlideGeo> {
  const lm = pose.landmarks, j = poseJoints(side);
  const out: Partial<SlideGeo> = {};
  const wrist = lm[j.wrist], other = lm[j.wristOther];
  if (inView(wrist)) { out.slideWristX = wrist.x; out.slideWristY = wrist.y; }
  if (inView(other)) { out.slideOtherX = other.x; out.slideOtherY = other.y; }
  const span = shoulderSpan(pose, side, aspect);
  if (span !== undefined) out.slideSpan = span;
  const outward = slideOutward(pose, side);
  if (outward !== null) out.slideOut = outward;
  return out;
}

/** The other hand counts as helping this close to the affected forearm, in shoulder spans... */
const OTHER_NEAR_SPAN = 0.4;
/** ...or once it has travelled this far from where it rested as the slide started. */
const OTHER_TRAVEL_SPAN = 0.5;

/** Distance from a point to the segment a-b, in frame heights. */
function segmentDistance(p: Pt, a: Pt, b: Pt, aspect: number) {
  const ax = a.x * aspect, ay = a.y, bx = b.x * aspect, by = b.y, px = p.x * aspect, py = p.y;
  const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
  const k = length ? clamp(((px - ax) * dx + (py - ay) * dy) / length, 0, 1) : 0;
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}

/**
 * How far the hand has slid out from where it rested, in shoulder spans: its sideways travel in the picture away
 * from the body (the forward part of the movement only changes its depth). 0 at set-up, before the reference exists.
 */
export function slideOut(pose: PoseInput, ref: SlideGeo | null, side: Side, aspect: number): number | undefined {
  const wrist = pose.landmarks[poseJoints(side).wrist];
  if (!inView(wrist)) return undefined;
  if (!ref) return 0;
  if (ref.slideWristX === undefined || !ref.slideSpan || ref.slideSpan < 0.03) return undefined;
  const out = ref.slideOut ?? slideOutward(pose, side) ?? 1;
  return (wrist.x - ref.slideWristX) * out * aspect / ref.slideSpan;
}

/**
 * The slide's own compensation measures against the set-up reference:
 * - hand_lift_pct (table only): the affected hand higher in the picture than where it rested, in % of the shoulder
 *   span. A clean reach out to the cup lifts the hand a little (the arm straightens and the hand leaves the edge of
 *   the support), so the check's threshold (config.ts) only counts a clear lift. The elbow rising is normal in a
 *   slide and is not counted.
 * - other_hand_pct: the other hand helping, in % of its limit (100 at the limit): it travelled half a shoulder span
 *   from where it rested (its thigh or the other armrest), or came within 0.4 of a span of the affected forearm.
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

/** Where the forearm rests, for the patient's choice of support (both when it is not known). */
export const slideRestOn = (support?: SlideSupport) =>
  support === "table" ? "on the table beside you" : support === "armrest" ? "on the armrest of your chair" : "on a table beside you or on the armrest of your chair";

/** The set-up instruction for the resting forearm. */
export const slideRestPrompt = (side: Side, support?: SlideSupport) => `Rest your ${side === "left" ? "left" : "right"} forearm ${slideRestOn(support)}, with your elbow bent.`;

/** How far above its hip (in torso lengths) the other hand may rest: on its thigh or on the chair's other armrest. */
const OTHER_REST_ABOVE_HIP = 0.55;
export const OTHER_REST_HINT = "Rest your other hand on your thigh or on the chair's other armrest.";
export const OTHER_IN_VIEW_HINT = "Rest your other hand on your thigh or the other armrest, where the camera can see it.";

/**
 * What set-up waits for, in the patient's words: head to thighs in view with room round the body and beside the arm
 * for the cup, the affected forearm resting beside the body (on a table or the armrest, above the lap), the other
 * hand resting on its thigh or the other armrest, and the camera above the support (seen from above, the resting
 * hand sits no higher in the picture than the elbow). `support` words the hints for the patient's choice (both when
 * it is not known).
 */
export function slideRestCheck(pose: PoseInput | null, side: Side, aspect: number, support?: SlideSupport): { lapRest?: LapRest; lapMissing?: string } {
  if (!pose) return { lapMissing: "Sit in front of the camera so I can see you." };
  const lm = pose.landmarks, j = poseJoints(side);
  const seen = (...indices: number[]) => indices.every(index => inView(lm[index]));
  const name = side === "left" ? "left" : "right";
  const on = slideRestOn(support);
  if (!seen(j.nose)) return { lapMissing: "Move the camera back so I can see you from your head to your thighs." };
  if (!seen(j.shoulder, j.shoulderOther)) return { lapMissing: "Move the camera back so I can see both shoulders." };
  if (!seen(j.hip, j.hipOther)) return { lapMissing: "Move the camera back so I can see both hips." };
  if (!seen(j.elbow, j.wrist)) return { lapMissing: `Rest your ${name} forearm ${on}, where the camera can see your elbow and hand.` };
  if (!seen(j.wristOther)) return { lapMissing: OTHER_IN_VIEW_HINT };
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
  // The forearm resting beside the body, on the affected side: the hand well above the lap, or (resting at the front
  // end of a low armrest) a little above the hip but clearly out beside the thigh, where a hand on the lap never is.
  // A recorded armrest hand drooping at the armrest's end sat 0.13 of the torso above the hip, 0.9 of a span out.
  const above = (hip.y - wrist.y) / torso, beside = (wrist.x - hip.x) * out * aspect / span;
  if (!(above >= 0.2 || (above >= 0.05 && beside >= 0.6)) || (wrist.x - (shoulder.x + other.x) / 2) * out <= 0) {
    return { lapMissing: slideRestPrompt(side, support) };
  }
  // From a camera above the support the forearm, pointing toward it, has the hand no higher than the elbow.
  if (wrist.y < elbow.y - 0.05 * span) return { lapMissing: "Raise the camera to chest height, above your forearm." };
  // The other hand resting on its thigh or on the chair's other armrest (a recorded armrest hand sat a third of the
  // torso above the hip), not up at the chest.
  if (otherWrist.y < hipOther.y - OTHER_REST_ABOVE_HIP * torso || otherWrist.y > hipOther.y + 0.6 * torso) return { lapMissing: OTHER_REST_HINT };
  // Room beside the arm for the cup and its circle.
  const far = wrist.x + out * ((SLIDE_PRACTICE_SPANS + ROOM_MARGIN_SPANS) * span + slideRadius(span, SLIDE_PRACTICE_SPANS)) / aspect;
  if (far < 0.02 || far > 0.98) return { lapMissing: "Move the camera back a little, or sit a little toward your other side, so there is room beside your arm for the cup." };
  return { lapRest: { x: wrist.x, y: wrist.y, bodyScale: span } };
}

/**
 * One camera frame: how far the hand has slid out (in the picture) and the shoulder's elevation (3D), the checks, and
 * the set-up's resting hand. During the movement only the affected arm has to stay in view; a check whose body part
 * is out of view stays unmeasured.
 */
export function slideFrame(det: { pose: PoseInput | null }, side: Side, t: number, aspect: number, ref: Geo | null, support?: SlideSupport): Frame {
  const pose = det.pose;
  if (!pose) return { t, values: {}, comps: {}, visible: false, missing: "Sit in front of the camera so I can see you.", ...slideRestCheck(null, side, aspect, support) };
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
    values: armSeen ? { slide_out: slideOut(pose, ref as SlideGeo | null, side, aspect), shoulder_flexion: body.values.shoulder_flexion } : {},
    visible: armSeen, missing: armSeen ? undefined : seen(j.shoulder, j.elbow, j.wrist) ? "Move the camera back so I can see your hips." : "Keep your shoulder, elbow and hand in view of the camera.",
    ...slideRestCheck(pose, side, aspect, support),
  };
}

// ---------- each step's target ----------

export type SlideTargetInput = {
  /** The affected hand now. */
  hand: P2 | null;
  /** Where the hand rested at set-up (its shoulder span as the scale), and the outward direction. */
  rest: LapRest;
  out: number;
  aspect: number;
  /** The cup's distance out from the resting hand, shoulder spans (the practice distance, eased if it had to come closer). */
  spans: number;
  /** How far up the cup sits per span out (SLIDE_RISE: level along a table, a little up from the armrest). */
  rise?: number;
  returning: boolean;
  armed: boolean;
  practice: boolean;
  t: number;
};

/**
 * Whether the hand is on this step's target, where that target is, and how far along the hand is. Slide: the hand in
 * the cup's circle. Back: the hand in its resting circle. A practice cup not reached for a while comes closer.
 */
export class SlideTarget {
  private key = "";
  private on = false;
  private armedSince: number | null = null;
  private lastOn: number | null = null;
  private eased = false;

  reset() { this.key = ""; this.on = false; this.armedSince = null; this.lastOn = null; this.eased = false; }

  update(key: string, input: SlideTargetInput): { contact: boolean; progress: number; circle: P2 & { radius: number }; spans: number; eased: boolean } {
    if (key !== this.key) { this.reset(); this.key = key; }
    if (input.armed) this.armedSince ??= input.t;
    let spans = input.spans;
    if (input.practice && !input.returning) {
      // Eased after a while without contact (since arming, or since the hand last left the circle).
      if (this.armedSince !== null && input.t - Math.max(this.armedSince, this.lastOn ?? -Infinity) >= SLIDE_EASE_MS) this.eased = true;
      if (this.eased) spans = Math.min(spans, SLIDE_EASED_SPANS);
    }
    const circle = input.returning ? restCircle(input.rest, spans, input.rise ?? 0) : slideCircle(input.rest, input.out, spans, input.aspect, input.rise ?? 0);
    const hand = input.hand;
    const distance = hand ? Math.hypot((hand.x - circle.x) * input.aspect, hand.y - circle.y) : Infinity;
    this.on = Boolean(hand) && distance <= circle.radius * (this.on ? CIRCLE_STAY : 1);
    if (this.on) this.lastOn = input.t;
    const travel = hand ? (hand.x - input.rest.x) * input.out * input.aspect / input.rest.bodyScale : 0;
    const progress = spans > 0 ? travel / spans : 0;
    return { contact: this.on, progress: input.returning ? 1 - progress : progress, circle, spans, eased: this.eased };
  }
}

// ---------- drawing on the camera view ----------

/**
 * The direction arrow from the hand toward the active circle, on the mirrored camera view: a soft track with
 * chevrons that drift along it (still, with reduced motion). Canvas pixels.
 */
export function drawSlideArrow(ctx: CanvasRenderingContext2D, from: P2, to: P2 & { radius: number }, now: number, reducedMotion: boolean, scale: number) {
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  const gap = to.radius + scale * 0.25;
  if (length <= gap + scale * 0.3) return;
  const ux = dx / length, uy = dy / length;
  const start = scale * 0.25, end = length - gap;
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255,254,250,.6)"; ctx.lineWidth = Math.max(5, scale * 0.16);
  ctx.beginPath(); ctx.moveTo(from.x + ux * start, from.y + uy * start); ctx.lineTo(from.x + ux * end, from.y + uy * end); ctx.stroke();
  const size = Math.max(9, scale * 0.38), spacing = size * 1.5;
  const offset = reducedMotion ? 0 : ((now / 600) % 1) * spacing;
  ctx.strokeStyle = "#e18e6d"; ctx.lineWidth = Math.max(5, scale * 0.14);
  for (let along = start + offset; along <= end; along += spacing) {
    const x = from.x + ux * along, y = from.y + uy * along;
    ctx.beginPath();
    ctx.moveTo(x - ux * size - uy * size * 0.7, y - uy * size + ux * size * 0.7);
    ctx.lineTo(x, y);
    ctx.lineTo(x - ux * size + uy * size * 0.7, y - uy * size - ux * size * 0.7);
    ctx.stroke();
  }
  ctx.restore();
}

export type SlideDrawing = {
  /** The cup's circle and the resting circle, raw image coordinates (radius in frame heights). */
  cup: P2 & { radius: number };
  rest: P2 & { radius: number };
  /** The affected hand now (raw image coordinates), for the arrow. */
  hand: P2 | null;
  returning: boolean;
  armed: boolean;
  contact: boolean;
  /** The hold's progress, 0-1. */
  hold: number;
  label: string;
  now: number;
  reducedMotion: boolean;
};

/** The active circle with the cup in it, the arrow showing the way, on the mirrored camera view. */
export function drawSlideTargets(ctx: CanvasRenderingContext2D, width: number, height: number, state: SlideDrawing) {
  const px = (p: P2) => ({ x: (1 - p.x) * width, y: p.y * height });
  const cup = px(state.cup), rest = px(state.rest);
  const active = state.returning ? { ...rest, radius: state.rest.radius * height } : { ...cup, radius: state.cup.radius * height };
  // The cup waits in its circle (and stays there, faded, while the hand comes back).
  if (state.returning) { ctx.save(); ctx.globalAlpha = 0.45; drawCup(ctx, cup.x, cup.y, state.cup.radius * height * 0.95); ctx.restore(); }
  drawTestingTarget(ctx, { ...active, armed: state.armed, contact: state.contact, progress: state.hold, now: state.now, reducedMotion: state.reducedMotion });
  if (!state.returning) drawCup(ctx, cup.x, cup.y, state.cup.radius * height * 0.95);
  if (state.armed && !state.contact && state.hand) drawSlideArrow(ctx, px(state.hand), active, state.now, state.reducedMotion, state.cup.radius * height);
  drawRingLabel(ctx, active.x, active.y, active.radius, state.label, height, state.armed);
}

/** A step's circle in canvas pixels (for the completion animation of the circle just finished). */
export function slideCanvasCircle(circle: P2 & { radius: number }, width: number, height: number) {
  return { x: (1 - circle.x) * width, y: circle.y * height, radius: circle.radius * height };
}

// ---------- the demonstration and the no-camera simulator (front view, 300 x 270 drawing space) ----------

/**
 * Which demonstration to show: the patient's own affected side as the mirrored camera shows it (the arm to the
 * screen's left for a left-affected patient), and the cup level along a table or a little up from the armrest.
 */
export type SlideVariant = { side?: Side; armrest?: boolean };

const MOVE_MS = 1400;
const FIG = { head: [120, 48], shoulderA: [166, 96], shoulderO: [74, 96], hipA: [152, 196], hipO: [88, 196] } as const;
/** The affected hand resting beside the thigh (on the table or armrest), and the cup out to the side: level along a table, a little up from the armrest. */
const SPOT = { rest: [182, 190] as [number, number], cup: [258, 190] as [number, number], raised: [258, 170] as [number, number] };
const GHOST_RADIUS = 18;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (k: number) => k * k * (3 - 2 * k);
const unit = (k: number) => clamp(k, 0, 1);
const poseAt = (fraction: number, returning: boolean) => (returning ? 1 - smooth(fraction) : smooth(fraction));
/** A drawing-space x on the patient's own side (mirrored for a left-affected patient). */
const sideX = (x: number, side: Side = "right") => (side === "left" ? 300 - x : x);
const cupSpot = (armrest = false) => (armrest ? SPOT.raised : SPOT.cup);

/**
 * The resting elbow: down by the side, on the support behind the hand. Seen from the front, the forearm resting on
 * the table or armrest points toward the camera, so it looks short; the elbow sits low, close to the body and a little
 * inside the shoulder-to-hand line (bent inward), never out to the side.
 */
const REST_ELBOW: [number, number] = [170, 158];
/** How far the elbow sits below the straight line from the shoulder to the cup (a soft bend, not a locked arm). */
const REACH_BEND = 10;

/** The elbow with the hand at the cup: halfway out, just below the shoulder-to-cup line (bending down and in). */
function reachElbow(cup: readonly [number, number]): [number, number] {
  const [sx, sy] = FIG.shoulderA, dx = cup[0] - sx, dy = cup[1] - sy, d = Math.hypot(dx, dy) || 1;
  return [sx + dx / 2 - (REACH_BEND * dy) / d, sy + dy / 2 + (REACH_BEND * dx) / d];
}

/** The ghost's hand at progress p (0 resting, 1 at the cup), drawn for the right side. */
export function slideGhostPose(p: number, armrest = false): { hand: [number, number] } {
  const k = clamp(p, 0, 1.1), cup = cupSpot(armrest);
  return { hand: [lerp(SPOT.rest[0], cup[0], k), lerp(SPOT.rest[1], cup[1], k)] };
}

/**
 * The ghost's affected arm at progress p, drawn for the right side: from the forearm resting on its support (elbow
 * down by the side) the arm reaches out, the elbow rising and moving out until the arm is nearly straight at the cup.
 */
export function slideGhostArm(p: number, armrest = false): { shoulder: [number, number]; elbow: [number, number]; hand: [number, number] } {
  const k = clamp(p, 0, 1.1), out = reachElbow(cupSpot(armrest));
  return { shoulder: [FIG.shoulderA[0], FIG.shoulderA[1]], elbow: [lerp(REST_ELBOW[0], out[0], k), lerp(REST_ELBOW[1], out[1], k)], hand: slideGhostPose(p, armrest).hand };
}

function ghostPoint(returning: boolean, armrest = false): [number, number] { return returning ? SPOT.rest : cupSpot(armrest); }

/** The instant the ghost's hand enters its circle, as the reach's demonstration finds it. */
function contactStartMs(returning: boolean, armrest: boolean) {
  const target = ghostPoint(returning, armrest);
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    const hand = slideGhostPose(poseAt(middle, returning), armrest).hand;
    if (Math.hypot(hand[0] - target[0], hand[1] - target[1]) <= GHOST_RADIUS) high = middle;
    else low = middle;
  }
  return high * MOVE_MS;
}
const CONTACT_MS = { table: [contactStartMs(false, false), contactStartMs(true, false)], armrest: [contactStartMs(false, true), contactStartMs(true, true)] };
const contactMs = (returning: boolean, armrest = false) => CONTACT_MS[armrest ? "armrest" : "table"][returning ? 1 : 0];

export const slideDemoDuration = (returning: boolean, armrest = false) => contactMs(returning, armrest) + TARGET_HOLD_MS + TARGET_COMPLETION_MS;

/** The step's circle in canvas pixels: the cup for the movement out, the resting place for the way back. */
export function slideGhostTarget(width: number, height: number, returning: boolean, variant: SlideVariant = {}) {
  const [x, y] = ghostPoint(returning, variant.armrest);
  const s = Math.min(width / 300, height / 270);
  return { x: (width - 300 * s) / 2 + sideX(x, variant.side) * s, y: (height - 270 * s) / 2 + y * s, radius: GHOST_RADIUS * s };
}

/** The simulated patient is on target at the end of each movement (level 1 is the cup, 0 resting). */
export function slideGhostContact(level: number, returning: boolean): boolean {
  return returning ? level <= 0.05 : level >= 0.95;
}

/** The front-view figure seated with the affected forearm resting beside the thigh, moving the hand out to the cup. */
export function drawSlideGhost(ctx: CanvasRenderingContext2D, p: number, width: number, height: number, variant: SlideVariant = {}, colors = { line: "#3c8255", accent: "#e18e6d", soft: "#b9d3c2" }) {
  const s = Math.min(width / 300, height / 270);
  const side = variant.side;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate((width - 300 * s) / 2, (height - 270 * s) / 2);
  ctx.scale(s, s);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const line = (pts: readonly (readonly [number, number])[]) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(sideX(x, side), y) : ctx.moveTo(sideX(x, side), y))); ctx.stroke(); };
  // The seat, and the support beside the affected thigh: a table out to the side, or the chair's short armrest.
  ctx.strokeStyle = colors.soft; ctx.lineWidth = 6;
  line([[66, 236], [174, 236]]);
  if (variant.armrest) { line([[164, 200], [204, 200]]); line([[198, 200], [198, 236]]); }
  else line([[170, 200], [288, 200]]);
  // Body: head, trunk, thighs, the other hand resting on its thigh.
  ctx.strokeStyle = colors.line; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(sideX(FIG.head[0], side), FIG.head[1], 20, 0, Math.PI * 2); ctx.stroke();
  line([FIG.shoulderO, FIG.shoulderA]);
  line([FIG.shoulderO, FIG.hipO, FIG.hipA, FIG.shoulderA]);
  line([FIG.hipO, [82, 226]]); line([FIG.hipA, [158, 226]]);
  line([FIG.shoulderO, [62, 160], [80, 222]]);
  // The affected arm: resting with the elbow down by the side, then reaching out to the cup.
  const { elbow, hand: [hx, hy] } = slideGhostArm(p, variant.armrest);
  ctx.strokeStyle = colors.accent; ctx.lineWidth = 9;
  line([FIG.shoulderA, elbow, [hx, hy]]);
  ctx.beginPath(); ctx.arc(sideX(hx, side), hy, 6, 0, Math.PI * 2); ctx.fillStyle = colors.accent; ctx.fill();
  ctx.restore();
}

/** The demonstration's state (the same fields as the reach's): `target` is in the right side's drawing space. */
export function slideDemoState(elapsedMs: number, returning: boolean, armed = true, armrest = false) {
  const elapsed = armed ? Math.max(0, elapsedMs) : 0;
  const reached = contactMs(returning, armrest);
  const contact = armed && elapsed >= reached;
  const progress = contact ? unit((elapsed - reached) / TARGET_HOLD_MS) : 0;
  const completionElapsedMs = elapsed - reached - TARGET_HOLD_MS;
  const phase = !armed ? "waiting" : !contact ? "move" : progress < 1 ? "hold" : "complete";
  const pose = poseAt(unit(elapsed / MOVE_MS), returning);
  const target = ghostPoint(returning, armrest);
  const label = returning ? "Rest" : "Cup";
  const instruction = !armed ? "Listen to the instruction. The circle will become active when the voice finishes."
    : phase === "complete" ? returning ? "Back at rest" : "Target complete — now bring your hand back to rest"
    : phase === "hold" ? `${returning ? "Rest your hand" : "Hold your hand at the cup"} · ${Math.round(progress * 100)}%`
    : returning ? "Bring your hand back to where it rested" : armrest ? "Follow the arrow: lift your hand out to the cup" : "Follow the arrow: slide your hand out to the cup";
  return { pose, target, radius: GHOST_RADIUS, armed, contact, progress, completionElapsedMs, phase, label, instruction };
}

export function drawSlideDemo(ctx: CanvasRenderingContext2D, elapsedMs: number, returning: boolean, width: number, height: number, now: number, reducedMotion = false, armed = true, variant: SlideVariant = {}) {
  const state = slideDemoState(elapsedMs, returning, armed, variant.armrest);
  drawSlideGhost(ctx, state.pose, width, height, variant);
  const s = Math.min(width / 300, height / 270), ox = (width - 300 * s) / 2, oy = (height - 270 * s) / 2;
  const { x, y, radius } = slideGhostTarget(width, height, returning, variant);
  const cup = slideGhostTarget(width, height, false, variant);
  if (returning) { ctx.save(); ctx.globalAlpha = 0.45; drawCup(ctx, cup.x, cup.y, cup.radius * 0.95); ctx.restore(); }
  if (state.phase === "complete") {
    drawTargetCompletion(ctx, { x, y, radius, elapsed: Math.min(state.completionElapsedMs, TARGET_COMPLETION_MS - 1), now, reducedMotion: reducedMotion || state.completionElapsedMs >= TARGET_COMPLETION_MS });
  } else {
    drawTestingTarget(ctx, { x, y, radius, armed, contact: state.contact, progress: state.progress, now, reducedMotion });
  }
  if (!returning) drawCup(ctx, cup.x, cup.y, cup.radius * 0.95);
  const [hx, hy] = slideGhostPose(state.pose, variant.armrest).hand;
  if (armed && !state.contact) drawSlideArrow(ctx, { x: ox + sideX(hx, variant.side) * s, y: oy + hy * s }, { x, y, radius }, now, reducedMotion, radius);
  ctx.save();
  ctx.font = "600 12px Manrope, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = state.contact ? "#285b49" : "#a14d32";
  // The resting circle's label goes below it, clear of the arm coming down to it.
  ctx.fillText(state.phase === "complete" ? "Complete" : state.label, x, returning ? y + radius + 16 : y - radius - 10);
  ctx.restore();
}