import type { Rung, Side } from "./config";
import { LEVEL_BY_RUNG } from "./config";
import { fingerExtension, inView, poseFrameValues, poseJoints, reachLapRest, type Frame, type Geo, type HandInput, type PoseInput, type Pt } from "./metrics";
import { handOpenness, openRing, palmAxes, palmRing, relaxRing, REST_OPEN_MAX } from "./hand-target";
import { TARGET_COMPLETION_MS, TARGET_HOLD_MS } from "./target-timing";
import { drawTargetCompletion, drawTestingTarget } from "./target-visual";
import { chooseHand } from "./tracker";

// Cylindrical Grasp and Transport with a cup drawn on screen, seated without a table, hands resting on the
// thighs. Five steps on the shared target flow: reach to the cup while opening the hand, close the hand around
// it, carry it across the body's midline, open the hand to let go, return to the lap. Positions are normalized
// raw (unmirrored) image coordinates: x in frame widths, y in frame heights; lengths in frame heights.

const DEG = 180 / Math.PI;
type P2 = { x: number; y: number };
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** The cycle's steps, by index (config.ts ex_grasp). */
export const GRASP_STEP = { reach: 0, grasp: 1, carry: 2, release: 3, back: 4 } as const;

// ---------- where the cup is picked up and put down ----------

/** How far past the body's midline the cup is put down, in shoulder widths, by level. */
const PUT_ACROSS = { easy: 0.3, medium: 0.45, difficult: 0.6 } as const;
/** The pick-up circle sits a little out from the affected shoulder (shoulder widths), at lower-chest height (torso lengths). */
const PICK_OUT = 0.15, CUP_DOWN = 0.5;

export type GraspLayout = {
  /** Pick-up and put-down circle centres. */
  pick: P2; put: P2;
  /** Circle radius, frame heights. */
  radius: number;
  /** Shoulder width at set-up, frame heights. */
  width: number;
  /** +1 when the affected shoulder is to the right of the other in the raw image, else -1. */
  out: number;
};

/** The layout from the set-up posture: shoulders and hips in view. */
export function graspLayout(pose: PoseInput | null, side: Side, aspect: number, rung: Rung = 1): GraspLayout | null {
  const lm = pose?.landmarks, j = poseJoints(side);
  const s = lm?.[j.shoulder], o = lm?.[j.shoulderOther], h = lm?.[j.hip], ho = lm?.[j.hipOther];
  if (!s || !o || !h || !ho || ![s, o, h, ho].every(p => inView(p))) return null;
  const width = Math.abs(s.x - o.x) * aspect;
  const torso = (h.y + ho.y) / 2 - (s.y + o.y) / 2;
  if (width < 0.05 || torso < 0.08) return null;
  const out = Math.sign(s.x - o.x) || 1;
  const midX = (s.x + o.x) / 2;
  const y = Math.min(0.85, s.y + CUP_DOWN * torso);
  const radius = Math.min(0.15, Math.max(0.08, 0.38 * width));
  const clampX = (x: number) => Math.min(1 - radius / aspect - 0.02, Math.max(radius / aspect + 0.02, x));
  return {
    pick: { x: clampX(s.x + out * PICK_OUT * width / aspect), y },
    put: { x: clampX(midX - out * PUT_ACROSS[LEVEL_BY_RUNG[rung]] * width / aspect), y },
    radius, width, out,
  };
}

/** The lap circle's radius (frame heights): Graded Forward Reach's rule, from the shoulder span; size is Alira's target size scale. */
export function graspLapRadius(layout: GraspLayout, aspect: number, size = 1): number {
  return Math.min(Math.max(0.11 * size, (layout.width / aspect) * 0.55 * size), 0.18 * size) * Math.min(aspect, 1);
}

/** Set-up estimates move the layout this share of the way each frame, so it settles steadily. */
export function followLayout(last: GraspLayout | null, next: GraspLayout | null, share = 0.2): GraspLayout | null {
  if (!next) return last;
  if (!last) return next;
  const mix = (a: number, b: number) => a + (b - a) * share;
  return { pick: { x: mix(last.pick.x, next.pick.x), y: mix(last.pick.y, next.pick.y) }, put: { x: mix(last.put.x, next.put.x), y: mix(last.put.y, next.put.y) }, radius: mix(last.radius, next.radius), width: mix(last.width, next.width), out: next.out };
}

// ---------- the affected hand and how far it carried the cup ----------

/** The affected hand: nearest the affected pose wrist (it may cross the body's midline while carrying). */
export function graspHand(det: { pose: PoseInput | null; hands: HandInput[] }, side: Side): HandInput | null {
  const lm = det.pose?.landmarks, j = poseJoints(side);
  const wrist = lm?.[j.wrist], other = lm?.[j.wristOther];
  const hand = chooseHand(det.hands, wrist);
  if (!hand || !wrist) return hand;
  // Never the other hand: it must be nearer the affected wrist than the other wrist.
  const d = (p: Pt) => Math.hypot(hand.landmarks[0].x - p.x, hand.landmarks[0].y - p.y);
  return other && inView(other) && d(other) < d(wrist) ? null : hand;
}

/** Where the affected hand is: the palm's centre when the hand model sees it, else the pose wrist. */
export function graspPoint(hand: HandInput | null, pose: PoseInput | null, side: Side, aspect: number): P2 | null {
  const palm = palmRing(hand, aspect);
  if (palm) return { x: palm.x, y: palm.y };
  const wrist = pose?.landmarks[poseJoints(side).wrist];
  return wrist && inView(wrist) ? { x: wrist.x, y: wrist.y } : null;
}

/**
 * How far across the body the hand is: its sideways position against the live shoulders, in shoulder widths:
 * 0 at the affected shoulder, 0.5 at the midline, about 1 at the put-down circle. Measured against the live
 * body, so leaning sideways does not count as carrying (that is its own check).
 */
export function carryAcross(point: P2 | null, pose: PoseInput | null, side: Side, aspect: number): number | undefined {
  const lm = pose?.landmarks, j = poseJoints(side);
  const s = lm?.[j.shoulder], o = lm?.[j.shoulderOther];
  if (!point || !s || !o || !inView(s) || !inView(o)) return undefined;
  const width = Math.abs(s.x - o.x) * aspect;
  if (width < 0.05) return undefined;
  return (s.x - point.x) * Math.sign(s.x - o.x) * aspect / width;
}

// ---------- the arm and hand checks ----------

/**
 * Elbow swinging out: the upper arm's angle out from the trunk's downward line in the image (front view), positive
 * when the elbow goes out to the side. Carrying the cup across should bring the elbow in, not out. No value when
 * the upper arm points at the camera (its image length under half its set-up length) or a point is hidden.
 */
export function elbowOutDeg(pose: PoseInput | null, side: Side, aspect: number, upperArmRef?: number): number | undefined {
  const lm = pose?.landmarks, j = poseJoints(side);
  const s = lm?.[j.shoulder], o = lm?.[j.shoulderOther], e = lm?.[j.elbow], h = lm?.[j.hip], ho = lm?.[j.hipOther];
  if (!s || !o || !e || !h || !ho || ![s, o, e, h, ho].every(p => inView(p))) return undefined;
  const down = unit2({ x: ((h.x + ho.x) / 2 - (s.x + o.x) / 2) * aspect, y: (h.y + ho.y) / 2 - (s.y + o.y) / 2 });
  const across = { x: (s.x - o.x) * aspect, y: s.y - o.y };
  const lateral = unit2({ x: across.x - down.x * dot2(across, down), y: across.y - down.y * dot2(across, down) });
  const arm = { x: (e.x - s.x) * aspect, y: e.y - s.y };
  const length = Math.hypot(arm.x, arm.y);
  const width = Math.hypot(across.x, across.y);
  if (length < 0.45 * width || (upperArmRef !== undefined && length < 0.5 * upperArmRef)) return undefined;
  return Math.atan2(dot2(arm, lateral), dot2(arm, down)) * DEG;
}

/** The upper arm's image length (frame heights), kept from set-up so a foreshortened arm gives no elbow value. */
export function upperArmLength(pose: PoseInput | null, side: Side, aspect: number): number | undefined {
  const lm = pose?.landmarks, j = poseJoints(side);
  const s = lm?.[j.shoulder], e = lm?.[j.elbow];
  return s && e && inView(s) && inView(e) ? Math.hypot((e.x - s.x) * aspect, e.y - s.y) : undefined;
}

/**
 * Wrist bending: the angle between the forearm (pose elbow to wrist) and the palm (hand wrist to middle knuckle)
 * in the image, as the Rehyn backend measures it (server.py projectedWristBendDegrees): unaffected by carrying
 * the arm across or curling the fingers, and no value when the view cannot support it (a short or
 * foreshortened forearm or palm, a hand that is not the affected one, or either pointing into the camera).
 */
export function wristBendDeg(pose: PoseInput | null, hand: HandInput | null, side: Side, aspect: number): number | undefined {
  const lm = pose?.landmarks, hl = hand?.landmarks, j = poseJoints(side);
  if (!lm || !hl) return undefined;
  const elbow = lm[j.elbow], wrist = lm[j.wrist], handWrist = hl[0], middleBase = hl[9];
  if (![elbow, wrist, handWrist, middleBase, hl[5], hl[17]].every(p => inView(p))) return undefined;
  const distance = (a: Pt, b: Pt) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const forearm = { x: (wrist.x - elbow.x) * aspect, y: wrist.y - elbow.y };
  const palm = { x: (middleBase.x - handWrist.x) * aspect, y: middleBase.y - handWrist.y };
  const forearmLength = Math.hypot(forearm.x, forearm.y), palmLength = Math.hypot(palm.x, palm.y);
  const s = lm[j.shoulder], o = lm[j.shoulderOther];
  const shoulderWidth = inView(s) && inView(o) ? distance(s, o) : NaN;
  if (!Number.isFinite(shoulderWidth) || forearmLength < shoulderWidth * 0.4 || palmLength < shoulderWidth * 0.1 || palmLength > forearmLength * 0.85) return undefined;
  if (distance(wrist, handWrist) > palmLength * 0.6) return undefined;
  const other = lm[j.wristOther];
  if (inView(other) && distance(other, handWrist) < distance(wrist, handWrist)) return undefined;
  const forearmDepth = (wrist.z - elbow.z) * aspect, palmDepth = (middleBase.z - handWrist.z) * aspect;
  if (!Number.isFinite(forearmDepth) || !Number.isFinite(palmDepth)
    || forearmLength < 0.65 * Math.hypot(forearmLength, forearmDepth) || palmLength < 0.65 * Math.hypot(palmLength, palmDepth)) return undefined;
  return Math.acos(Math.max(-1, Math.min(1, dot2(forearm, palm) / (forearmLength * palmLength)))) * DEG;
}

/**
 * The cup's axis from the 3D hand landmarks: with the thumb up, the cup lies along the knuckle line (little to
 * index knuckle). Carrying it across the body keeps this line; the forearm rolling or the wrist tipping turns it.
 */
export function cupAxis(hand: HandInput | null): [number, number, number] | undefined {
  return palmAxes(hand)?.b;
}

/**
 * How far the cup has tipped since the grip: the change in the knuckle line's angle from vertical (up is -y). The
 * hand turning about the vertical as it carries the cup across the body leaves this unchanged.
 */
export function cupTipping(hand: HandInput | null, grip: [number, number, number] | undefined): number | undefined {
  const axis = cupAxis(hand);
  if (!axis || !grip) return undefined;
  const fromUp = (v: [number, number, number]) => Math.acos(Math.max(-1, Math.min(1, -v[1] / (Math.hypot(...v) || 1)))) * DEG;
  return Math.abs(fromUp(axis) - fromUp(grip));
}

// ---------- one camera frame ----------

export type GraspFrameOptions = {
  /** The knuckle line when the hand closed around the cup, this repetition (cup tipping is measured from it). */
  gripAxis?: [number, number, number];
};

/**
 * One camera frame: the movement (elbow, shoulder, hand opening, carry across), the six checks, and the resting
 * position for set-up (the affected hand on the thigh, as for Graded Forward Reach).
 */
export function graspFrame(det: { pose: PoseInput | null; hands: HandInput[] }, side: Side, t: number, aspect: number, ref: Geo | null, options: GraspFrameOptions = {}): Frame {
  const pose = det.pose;
  const hand = graspHand(det, side);
  const point = graspPoint(hand, pose, side, aspect);
  const body = pose ? poseFrameValues(pose, side, ref) : null;
  const values: Frame["values"] = { ...(body?.values ?? {}) };
  if (hand) {
    values.finger_extension = fingerExtension(hand);
    values.hand_openness = handOpenness(hand);
  }
  values.carry_across = carryAcross(point, pose, side, aspect);
  const comps: Frame["comps"] = {
    trunk_approach_pct: body?.comps.trunk_approach_pct,
    trunk_side_lean_delta: body?.comps.trunk_side_lean_delta,
    shoulder_hike_rel_delta: body?.comps.shoulder_hike_rel_delta,
    shoulder_elevation_pct: body?.comps.shoulder_elevation_pct,
    elbow_out_deg: elbowOutDeg(pose, side, aspect, ref?.graspUpperArm),
    wrist_bend_deg: wristBendDeg(pose, hand, side, aspect),
    cup_tilt_deg: cupTipping(hand, options.gripAxis),
  };
  const wrist = pose?.landmarks[poseJoints(side).wrist];
  const visible = Boolean(point) || inView(wrist);
  const upperArm = upperArmLength(pose, side, aspect);
  return {
    t, values, comps, visible, missing: visible ? undefined : "Bring your affected hand back into view.",
    geo: body?.geo ? { ...body.geo, ...(upperArm !== undefined ? { graspUpperArm: upperArm } : {}) } : undefined,
    ...reachLapRest(pose, side),
  };
}

// ---------- each step's target ----------

export type GraspRings = { rest: number; open: number; close: number; release: number };

/**
 * The hand-opening thresholds (palm lengths) from the relaxed hand learned at set-up and the opening learned in
 * practice: open at the cup (the Active Hand Opening ring), closed around it (that ring's close circle), and open
 * enough to let go (most of the way back to the open ring).
 */
export function graspRings(rest: number | undefined, learned?: number): GraspRings {
  // A hand resting flat on the thigh reads nearly open: anchor on a relaxed hand at most, as hand opening does.
  const r = Math.min(REST_OPEN_MAX, rest !== undefined && Number.isFinite(rest) ? rest : 0.5);
  const open = openRing(r, learned);
  return { rest: r, open, close: relaxRing(r, open), release: r + 0.6 * (open - r) };
}

/**
 * Whether the hand is on this step's target, and how far along it is (0-1). Reach: the hand in the pick-up circle,
 * opened to the ring. Grasp: still at the cup (a slightly larger circle), closed around it. Carry: in the put-down
 * circle, still closed (or the hand model cannot see it). Let go: at the put-down circle, opened again.
 */
export function graspTarget(step: number, point: P2 | null, openness: number | undefined, layout: GraspLayout, rings: GraspRings, aspect: number, start?: P2): { contact: boolean; progress: number } {
  if (!point) return { contact: false, progress: 0 };
  const distance = (c: P2) => Math.hypot((point.x - c.x) * aspect, point.y - c.y);
  const near = (c: P2, scale = 1) => distance(c) <= layout.radius * scale;
  const approach = (c: P2) => {
    if (!start) return near(c) ? 1 : 0;
    const from = Math.hypot((start.x - c.x) * aspect, start.y - c.y);
    return Math.max(0, Math.min(1, 1 - (distance(c) - layout.radius) / Math.max(0.05, from - layout.radius)));
  };
  const opened = openness !== undefined && openness >= rings.open;
  switch (step) {
    case GRASP_STEP.reach: {
      const contact = near(layout.pick) && opened;
      return { contact, progress: contact ? 1 : Math.min(0.98, approach(layout.pick)) };
    }
    case GRASP_STEP.grasp: {
      const contact = near(layout.pick, 1.4) && openness !== undefined && openness <= rings.close;
      return { contact, progress: contact ? 1 : 0 };
    }
    case GRASP_STEP.carry: {
      // Still closed: a little looser than the grasp, never as open as letting go.
      const contact = near(layout.put) && (openness === undefined || openness <= Math.min(rings.close + 0.1, rings.release));
      return { contact, progress: contact ? 1 : Math.min(0.98, approach(layout.put)) };
    }
    case GRASP_STEP.release: {
      const contact = near(layout.put, 1.4) && openness !== undefined && openness >= rings.release;
      return { contact, progress: contact ? 1 : 0 };
    }
    default:
      return { contact: false, progress: 0 };
  }
}

// ---------- the cup on screen, through a repetition ----------

/**
 * The drawn cup in the hand (display only: contact, holds and scores come from the measured hand). A One Euro filter:
 * still while the hand is still (the hand points' jitter averaged away), following at once as the hand moves, and
 * never faster than a hand carrying a cup, so a one-frame landmark glitch glides instead of jumping.
 */
export const CUP_STEADY = {
  /** Cutoff with the hand still (Hz), its rise per cup-circle radius a second of speed, and the speed estimate's cutoff (Hz). */
  minCutoff: 1, beta: 0.6, speedCutoff: 1,
  /** The drawn cup's top speed, frame heights a second. */
  glide: 3,
};

class CupSteadier {
  private at: P2 | null = null;
  private raw: P2 | null = null;
  private speed = { x: 0, y: 0 };
  private t = 0;

  /** Start the drawing at `from` (where the cup was), so the cup slides into the hand rather than jumping. */
  start(from: P2, t: number) { this.at = { ...from }; this.raw = { ...from }; this.speed = { x: 0, y: 0 }; this.t = t; }

  get current(): P2 | null { return this.at ? { ...this.at } : null; }

  /** No reading this frame: the cup stays, and the clock moves on (so the next reading cannot jump it far). */
  touch(t: number) { if (this.at) this.t = t; }

  /** The drawn point after a reading `p` at `t` ms. scale: the cup circle's radius (frame heights). */
  next(t: number, p: P2, aspect: number, scale: number): P2 {
    if (!this.at || !this.raw) { this.start(p, t); return { ...p }; }
    const dt = clamp((t - this.t) / 1000, 0.001, 0.1);
    this.t = t;
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    // The speed estimate filters the velocity, not its size, so a still hand's noise averages out.
    const k = alpha(CUP_STEADY.speedCutoff), unit = Math.max(0.01, scale);
    this.speed = {
      x: this.speed.x + k * ((p.x - this.raw.x) * aspect / unit / dt - this.speed.x),
      y: this.speed.y + k * ((p.y - this.raw.y) / unit / dt - this.speed.y),
    };
    this.raw = { ...p };
    let a = alpha(CUP_STEADY.minCutoff + CUP_STEADY.beta * Math.hypot(this.speed.x, this.speed.y));
    const gap = Math.hypot((p.x - this.at.x) * aspect, p.y - this.at.y);
    if (gap > 0 && a * gap > CUP_STEADY.glide * dt) a = CUP_STEADY.glide * dt / gap;
    this.at = { x: this.at.x + a * (p.x - this.at.x), y: this.at.y + a * (p.y - this.at.y) };
    return { ...this.at };
  }
}

/**
 * Where to draw the cup and how it is tilted, and the grip tilt the cup-tipping check measures from. The cup sits
 * at the pick-up circle until the hand first closes around it; from then it stays in the hand, steadied
 * (CUP_STEADY), until let go, even if the grip reading flickers or the hand model loses the hand for a while (the cup
 * then moves as the pose wrist does); and it stays at the put-down circle once let go.
 */
export class CupCarry {
  private key = "";
  private gripAxis: [number, number, number] | undefined;
  private tilt = 0;
  private placed = false;
  /** Grasped this repetition: the cup is in the hand from the first grasp until let go. */
  private grasped = false;
  private steady = new CupSteadier();
  /** While the hand model does not see the hand: the pose wrist and the cup when it lost the hand. */
  private anchor: { wrist: P2; cup: P2 } | null = null;

  /**
   * t: the frame's time (ms); aspect: the picture's width over its height. The cup follows `point` (the palm's
   * centre, or the pose wrist when the hand model does not see the hand: `hand` null).
   */
  update(key: string, step: number, contact: boolean, hand: HandInput | null, point: P2 | null, layout: GraspLayout, t: number, aspect: number): { at: P2; tilt: number; inHand: boolean } {
    if (key !== this.key) { this.key = key; this.gripAxis = undefined; this.tilt = 0; this.placed = false; this.grasped = false; this.steady = new CupSteadier(); this.anchor = null; }
    // The grip's own knuckle line: kept up to date (steadied) while the hand is closed around the cup.
    const axis = cupAxis(hand);
    if (step === GRASP_STEP.grasp && contact && axis) {
      const g = this.gripAxis;
      const mixed: [number, number, number] = g ? [g[0] + (axis[0] - g[0]) * 0.3, g[1] + (axis[1] - g[1]) * 0.3, g[2] + (axis[2] - g[2]) * 0.3] : axis;
      const n = Math.hypot(...mixed) || 1;
      this.gripAxis = [mixed[0] / n, mixed[1] / n, mixed[2] / n];
    }
    if (step === GRASP_STEP.release && contact) this.placed = true;
    if (step === GRASP_STEP.back) this.placed = true;
    // Grasped at the first close around the cup (or once past the grasp): the cup does not go back to its circle.
    if (!this.grasped && ((step === GRASP_STEP.grasp && contact) || step === GRASP_STEP.carry || step === GRASP_STEP.release) && point) {
      this.grasped = true;
      this.steady.start(layout.pick, t);
    }
    const inHand = this.grasped && !this.placed;
    if (inHand && point && hand) {
      this.anchor = null;
      this.steady.next(t, point, aspect, layout.radius);
    } else if (inHand && point) {
      // The hand model lost the hand: the cup moves as the pose wrist has since (the wrist sits apart from the palm, so
      // the cup is not moved onto it), and the drawing keeps time, so the hand coming back does not jump the cup.
      const cup = this.steady.current;
      if (!this.anchor && cup) this.anchor = { wrist: point, cup };
      const a = this.anchor;
      this.steady.next(t, a ? { x: a.cup.x + point.x - a.wrist.x, y: a.cup.y + point.y - a.wrist.y } : point, aspect, layout.radius);
    } else if (inHand) this.steady.touch(t);
    const tipping = cupTipping(hand, this.gripAxis);
    if (inHand && tipping !== undefined) this.tilt += (tipping - this.tilt) * 0.3;
    if (!inHand) this.tilt *= 0.7;
    const at = inHand ? this.steady.current ?? layout.pick : this.placed ? layout.put : layout.pick;
    return { at, tilt: this.tilt, inHand };
  }

  /** The knuckle line when the hand closed around the cup (undefined before the grasp). */
  get grip(): [number, number, number] | undefined { return this.gripAxis; }

  /** Start again with the cup at the pick-up circle (the practice restarts after going back). */
  reset() { this.key = ""; this.gripAxis = undefined; this.tilt = 0; this.placed = false; this.grasped = false; this.steady = new CupSteadier(); this.anchor = null; }
}

/** A drawn cup (side view) at a canvas point, tilted by degrees. */
export function drawCup(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, tilt = 0, colors = { body: "rgba(255,254,250,.92)", line: "#285b49", accent: "#e18e6d" }) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt / DEG);
  const w = size * 0.62, h = size;
  ctx.lineWidth = Math.max(2, size * 0.07);
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, -h / 2); ctx.lineTo(w * 0.4, h / 2); ctx.lineTo(-w * 0.4, h / 2); ctx.closePath();
  ctx.fillStyle = colors.body; ctx.fill();
  ctx.strokeStyle = colors.line; ctx.stroke();
  ctx.beginPath(); ctx.arc(w * 0.5, 0, h * 0.2, -Math.PI / 2, Math.PI / 2); ctx.stroke();
  ctx.fillStyle = colors.accent;
  ctx.fillRect(-w * 0.42, -h * 0.28, w * 0.84, h * 0.12);
  ctx.restore();
}

// ---------- the demonstration and the no-camera simulator, front view, 300 x 270 drawing space ----------

const MOVE_MS = 1100, SHAPE_MS = 700;
const FIG = { head: [150, 48], shoulderA: [196, 96], shoulderO: [104, 96], hipA: [182, 196], hipO: [118, 196] } as const;
/** Hand positions: resting on the affected thigh, at the cup, and at the put-down circle across the midline. */
const SPOT = { lap: [190, 222] as [number, number], pick: [214, 160] as [number, number], put: [120, 160] as [number, number] };
const GHOST_RADIUS = 26;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (k: number) => k * k * (3 - 2 * k);
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));

/** The ghost's hand position and openness (0 closed .. 1 open) at progress p (0-1) through a step. */
export function graspGhostPose(step: number, p: number): { hand: [number, number]; open: number; cup: "pick" | "hand" | "put" } {
  const k = smooth(clamp01(p));
  const mixPoint = (a: [number, number], b: [number, number]): [number, number] => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
  switch (step) {
    case GRASP_STEP.reach: return { hand: mixPoint(SPOT.lap, SPOT.pick), open: k, cup: "pick" };
    case GRASP_STEP.grasp: return { hand: SPOT.pick, open: 1 - k, cup: k > 0.6 ? "hand" : "pick" };
    case GRASP_STEP.carry: return { hand: mixPoint(SPOT.pick, SPOT.put), open: 0, cup: "hand" };
    case GRASP_STEP.release: return { hand: SPOT.put, open: k, cup: k > 0.5 ? "put" : "hand" };
    default: return { hand: mixPoint(SPOT.put, SPOT.lap), open: 0.3 * (1 - k), cup: "put" };
  }
}

/** The step's target in the ghost's space: the circle the hand goes to (the lap for the return). */
function ghostTargetPoint(step: number): [number, number] {
  return step === GRASP_STEP.reach || step === GRASP_STEP.grasp ? SPOT.pick : step === GRASP_STEP.back ? SPOT.lap : SPOT.put;
}

/** The step's target circle in canvas pixels. */
export function graspGhostTarget(width: number, height: number, step: number) {
  const s = Math.min(width / 300, height / 270);
  const [x, y] = ghostTargetPoint(step);
  return { x: (width - 300 * s) / 2 + x * s, y: (height - 270 * s) / 2 + y * s, radius: GHOST_RADIUS * s * (step === GRASP_STEP.grasp || step === GRASP_STEP.release ? 1.15 : 1) };
}

/** The simulated patient is on target near the end of each movement (level 1 is the target, 0 the start). */
export function graspGhostContact(level: number, step: number): boolean {
  return step === GRASP_STEP.back ? level >= 0.95 : level >= 0.95;
}

function contactAt(step: number) {
  return (step === GRASP_STEP.grasp || step === GRASP_STEP.release ? SHAPE_MS : MOVE_MS) * 0.92;
}

export const graspDemoDuration = (step: number) => contactAt(step) + TARGET_HOLD_MS + TARGET_COMPLETION_MS;

const LABELS = ["Cup", "Grasp", "Across", "Let go", "Lap"];
const INSTRUCTIONS = ["Reach to the cup, opening your hand", "Close your hand around the cup", "Carry the cup across your body", "Open your hand to let go", "Bring your hand back to your lap"];
const HOLDS = ["Hold your open hand at the cup", "Hold the cup", "Hold the cup there", "Hold your hand open", "Rest on your lap"];

export function graspDemoState(elapsedMs: number, step: number, armed = true) {
  const elapsed = armed ? Math.max(0, elapsedMs) : 0;
  const reached = contactAt(step);
  const contact = armed && elapsed >= reached;
  const progress = contact ? clamp01((elapsed - reached) / TARGET_HOLD_MS) : 0;
  const completionElapsedMs = elapsed - reached - TARGET_HOLD_MS;
  const phase = !armed ? "waiting" : !contact ? "move" : progress < 1 ? "hold" : "complete";
  const pose = clamp01(elapsed / (step === GRASP_STEP.grasp || step === GRASP_STEP.release ? SHAPE_MS : MOVE_MS));
  const target = ghostTargetPoint(step);
  const label = LABELS[step] ?? "Target";
  const instruction = !armed ? "Listen to the instruction. The circle will become active when the voice finishes."
    : phase === "complete" ? `${label} complete`
    : phase === "hold" ? `${HOLDS[step] ?? "Hold"} · ${Math.round(progress * 100)}%`
    : INSTRUCTIONS[step] ?? "";
  return { pose, target, radius: GHOST_RADIUS, armed, contact, progress, completionElapsedMs, phase, label, instruction };
}

/** The front-view figure with the affected arm reaching, grasping, carrying and letting go of the cup. */
export function drawGraspGhost(ctx: CanvasRenderingContext2D, step: number, p: number, width: number, height: number, colors = { line: "#3c8255", accent: "#e18e6d", soft: "#b9d3c2" }) {
  const s = Math.min(width / 300, height / 270);
  ctx.save();
  ctx.translate((width - 300 * s) / 2, (height - 270 * s) / 2);
  ctx.scale(s, s);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const line = (pts: readonly (readonly [number, number])[]) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); };
  // Chair seat and thighs.
  ctx.strokeStyle = colors.soft; ctx.lineWidth = 6;
  line([[96, 236], [204, 236]]);
  // Body: head, trunk, the other arm resting on its thigh.
  ctx.strokeStyle = colors.line; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(FIG.head[0], FIG.head[1], 20, 0, Math.PI * 2); ctx.stroke();
  line([FIG.shoulderO, FIG.shoulderA]);
  line([FIG.shoulderO, FIG.hipO, FIG.hipA, FIG.shoulderA]);
  line([FIG.hipO, [112, 226]]); line([FIG.hipA, [188, 226]]);
  line([FIG.shoulderO, [92, 160], [110, 222]]);
  // The affected arm, elbow bending outward and down.
  const pose = graspGhostPose(step, p);
  const [hx, hy] = pose.hand, [sx, sy] = FIG.shoulderA;
  const dx = hx - sx, dy = hy - sy, d = Math.max(1, Math.hypot(dx, dy));
  const upper = 64, fore = 58, along = Math.min(d, upper + fore - 1);
  const a = (upper * upper - fore * fore + along * along) / (2 * along);
  const hgt = Math.sqrt(Math.max(0, upper * upper - a * a));
  const elbow: [number, number] = [sx + (a * dx) / d + (hgt * dy) / d, sy + (a * dy) / d - (hgt * dx) / d];
  ctx.strokeStyle = colors.accent; ctx.lineWidth = 9;
  line([FIG.shoulderA, elbow, pose.hand]);
  // The hand: a circle of fingers, open or closed.
  const fingers = 4 + 10 * pose.open;
  ctx.lineWidth = 5;
  for (let i = 0; i < 4; i++) {
    const angle = (-100 + i * 22) / DEG;
    line([pose.hand, [hx + Math.cos(angle) * fingers, hy + Math.sin(angle) * fingers]]);
  }
  // The cup.
  const cupAt: [number, number] = pose.cup === "hand" ? [hx - 4, hy - 4] : pose.cup === "pick" ? SPOT.pick : SPOT.put;
  drawCup(ctx, cupAt[0], cupAt[1], 24, 0, { body: "rgba(255,254,250,.95)", line: colors.line, accent: colors.accent });
  ctx.restore();
}

export function drawGraspDemo(ctx: CanvasRenderingContext2D, elapsedMs: number, step: number, width: number, height: number, now: number, reducedMotion = false, armed = true) {
  const state = graspDemoState(elapsedMs, step, armed);
  ctx.clearRect(0, 0, width, height);
  drawGraspGhost(ctx, step, state.pose, width, height);
  const { x, y, radius } = graspGhostTarget(width, height, step);
  if (state.phase === "complete") drawTargetCompletion(ctx, { x, y, radius, elapsed: Math.min(state.completionElapsedMs, TARGET_COMPLETION_MS - 1), now, reducedMotion: reducedMotion || state.completionElapsedMs >= TARGET_COMPLETION_MS });
  else drawTestingTarget(ctx, { x, y, radius, armed, contact: state.contact, progress: state.progress, now, reducedMotion });
  ctx.save();
  ctx.font = "600 12px Manrope, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = state.contact ? "#285b49" : "#a14d32";
  ctx.fillText(state.phase === "complete" ? "Complete" : state.label, x, y - radius - 10);
  ctx.restore();
}

// ---------- small helpers ----------

function dot2(a: P2, b: P2) { return a.x * b.x + a.y * b.y; }
function unit2(a: P2): P2 { const n = Math.hypot(a.x, a.y) || 1; return { x: a.x / n, y: a.y / n }; }
