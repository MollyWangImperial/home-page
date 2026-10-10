import type { Side } from "./config";
import { drawArrow, kneeComps, kneeGeo, kneeRestCheck, sideX, type KneeDial } from "./knee-target";
import { inView, poseFrameValues, poseJoints, type Frame, type Geo, type LapRest, type PoseInput } from "./metrics";
import { TARGET_COMPLETION_MS, TARGET_HOLD_MS } from "./target-timing";
import { drawTargetCompletion, drawTestingTarget } from "./target-visual";

// Seated Toe Lift on the shared target flow: a front camera with the patient seated, head to feet in view, the
// exercising foot turned out to the side with the heel on the floor. A front camera cannot see toes lift that point
// at it (replayed camera landmarks of a patient doing so barely moved), but sees a foot side-on lift clearly: the
// measure is the foot's angle in the picture, heel to toes (the pose's heel and foot index), in degrees above level.
// The toes turning up about the heel raise it; the whole leg moving, or the foot sliding, moves the heel and toes
// together and hardly does. An "Ankle angle" dial beside the shoulder (placed like the knee's, knee-target.ts) shows
// it: a side view of a foot whose toes turn up about the heel into the target circle, with the same circle
// activation as the other exercises; an arrow at the real toes shows them lifting. The patient never moves out of
// view: everything is done seated with the foot where it is. Positions are raw (unmirrored) image coordinates: x in
// frame widths, y in frame heights; lengths in frame heights.

const DEG = 180 / Math.PI;
type P2 = { x: number; y: number };
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** The cycle's steps, by index (config.ts ex_ankle_dorsiflexion). */
export const TOE_STEP = { lift: 0, lower: 1 } as const;

// ---------- the measure ----------

/** The pose's heel landmark on a side. */
export const heelIndex = (side: Side) => (side === "left" ? 29 : 30);

/**
 * The foot's angle in the picture: from the heel to the toes, in degrees above level, whichever way the toes point
 * (about level for a foot turned out side-on; well below for one pointing at the camera).
 */
export function toeLiftRaw(pose: PoseInput, side: Side, aspect: number): number | undefined {
  const lm = pose.landmarks, j = poseJoints(side);
  const heel = lm[heelIndex(side)], toe = lm[j.foot];
  if (!inView(heel) || !inView(toe)) return undefined;
  const across = Math.abs(toe.x - heel.x) * aspect, up = heel.y - toe.y;
  // Too short in the picture to have a direction (the foot end-on to the camera).
  return Math.hypot(across, up) < TOE_MIN_FOOT ? undefined : Math.atan2(up, across) * DEG;
}
/** The foot must be at least this long in the picture (frame heights) to measure its angle. */
const TOE_MIN_FOOT = 0.02;

/** The toe lift steadied over the last few frames (a median of up to 5 within 250 ms): the foot's points are small and jitter. */
export class ToeLiftFilter {
  private samples: { t: number; value: number }[] = [];
  reset() { this.samples = []; }
  push(t: number, value: number | undefined): number | undefined {
    this.samples = this.samples.filter(sample => t - sample.t <= 250 && sample.t <= t);
    if (value === undefined || !Number.isFinite(value)) return undefined;
    this.samples = [...this.samples.slice(-4), { t, value }];
    const sorted = this.samples.map(sample => sample.value).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
}

/**
 * The toe lift's part of the set-up snapshot: the knee's, plus the affected toes, heel and hip, and the other toes, in
 * the picture.
 */
export function toeGeo(pose: PoseInput, side: Side, aspect: number): Partial<Geo> {
  const lm = pose.landmarks, j = poseJoints(side);
  const out: Partial<Geo> = kneeGeo(pose, side, aspect);
  const toe = lm[j.foot], heel = lm[heelIndex(side)], hip = lm[j.hip], otherToe = lm[j.footOther];
  if (inView(toe)) { out.toeImgX = toe.x; out.toeImgY = toe.y; }
  if (inView(heel)) { out.heelImgX = heel.x; out.heelImgY = heel.y; }
  if (inView(toe) && inView(heel)) out.footAcross = Math.abs(toe.x - heel.x) * aspect;
  if (inView(hip)) { out.hipImgX = hip.x; out.hipImgY = hip.y; }
  if (inView(otherToe)) out.otherToeImgY = otherToe.y;
  return out;
}

/**
 * Where the legs rest, which the toe lift's checks are judged from: taken at set-up, and again before each lift
 * (session.ts), so a foot set down a little differently between repetitions is not counted as a check.
 */
const TOE_REBASE: (keyof Geo)[] = ["kneeImgX", "kneeImgY", "ankleImgX", "ankleImgY", "hipImgX", "hipImgY", "heelImgX", "heelImgY", "toeImgX", "toeImgY", "otherAnkleImgX", "otherAnkleImgY", "otherToeImgY"];
/** The reference with the resting legs' positions taken from `base` where it has them. */
export function toeRebase(ref: Geo, base: Geo): Geo {
  const out = { ...ref };
  for (const key of TOE_REBASE) if (base[key] !== undefined) out[key] = base[key];
  return out;
}

/**
 * Whether a lift's resting foot angle can stand in for the set-up one (`shift`, degrees from it): a foot set down
 * turned a little differently rests up to the rest calibration's 8 degrees higher, or further toward the camera,
 * lower; much higher, the toes are not resting but already up, and the set-up rest is kept.
 */
export const toeRestShiftOk = (shift: number) => shift <= 8 && shift >= -20;

/** Heel to foot index as a share of the lower leg (knee to ankle) for an adult, both side-on to the camera. */
const FOOT_SHIN_SHARE = 0.47;
/**
 * The foot's real turn up (degrees) from its turn in the picture: a foot turned only partly side-on shows less of its
 * length across the picture than up it, so the picture overstates the lift (about a third more at 45 degrees). How
 * side-on it rested comes from how far it reached across the picture against the lower leg.
 */
export function toeTrueLift(imageLift: number, ref: Geo): number {
  if (!ref.footAcross || !ref.kneeShin || !(imageLift > 0)) return Math.max(0, imageLift);
  return Math.atan(Math.tan(Math.min(imageLift, 85) / DEG) * sideOn(ref.footAcross, ref.kneeShin)) * DEG;
}
/** How side-on a resting foot is (1 fully; less as it turns toward the camera), from its reach across the picture. */
const sideOn = (across: number, shin: number) => clamp(across / (FOOT_SHIN_SHARE * shin), 0.4, 1);

/**
 * A lift's reading as the set-up foot would show it: measured from where this lift's foot rested (`liftRest`), and
 * turned up as far as the set-up foot would show the same real lift (a foot set down turned differently shows it
 * larger or smaller: toeTrueLift), from the set-up rest. Below rest it is left as it is. `liftAcross`/`setupAcross`:
 * the resting feet's reach across the picture; `shin`: the set-up lower leg's length (frame heights).
 */
export function toeInSetupView(raw: number, liftRest: number, setupRest: number, liftAcross?: number, setupAcross?: number, shin?: number): number {
  const lift = raw - liftRest;
  if (!(lift > 0) || !liftAcross || !setupAcross || !shin) return setupRest + lift;
  return setupRest + Math.atan(Math.tan(Math.min(lift, 85) / DEG) * sideOn(liftAcross, shin) / sideOn(setupAcross, shin)) * DEG;
}

/**
 * The toe lift's own checks against where the legs rested (toeRebase), in % of the resting lower leg's image length:
 * - heel_lift_pct: the heel moved from its place in the picture, beyond the knee's own travel (which knee lifting
 *   covers): the heel lifting, the foot pulled back or kicked forward. Lifting the toes turns the foot about the heel,
 *   which stays put;
 * - knee_sideways_pct: the knee moved sideways against the hip on its side (the knee falling out or in);
 * - other_leg_pct: the knee's (the other ankle's travel), or the other foot's toes lifting along with these (a mirror
 *   movement), counted double since toes rise less than a foot moves;
 * and the knee's: thigh_lift_pct (the knee rising), trunk_retreat_pct.
 */
export function toeComps(pose: PoseInput, geo: Geo, ref: Geo | null, side: Side, aspect: number): Frame["comps"] {
  const out: Frame["comps"] = { ...kneeComps(pose, geo, ref, side, aspect) };
  const shin = ref?.kneeShin;
  if (!ref || !shin || shin <= 0.02) return out;
  const lm = pose.landmarks, j = poseJoints(side);
  const knee = lm[j.knee], heel = lm[heelIndex(side)], hip = lm[j.hip];
  const otherAnkle = lm[j.ankleOther], otherToe = lm[j.footOther];
  const travel = (p: { x: number; y: number }, x: number, y: number) => Math.hypot((p.x - x) * aspect, p.y - y) / shin * 100;
  if (inView(otherAnkle) && inView(otherToe) && ref.otherAnkleImgY !== undefined && ref.otherToeImgY !== undefined) {
    // The other toes' rise against their ankle, so the whole foot moving is not counted twice.
    const otherToes = Math.max(0, ((ref.otherToeImgY - otherToe.y) - (ref.otherAnkleImgY - otherAnkle.y)) / shin * 100);
    out.other_leg_pct = Math.max(out.other_leg_pct ?? 0, OTHER_TOES_WEIGHT * otherToes);
  }
  if (inView(heel) && inView(knee) && ref.heelImgX !== undefined && ref.heelImgY !== undefined && ref.kneeImgX !== undefined && ref.kneeImgY !== undefined) {
    out.heel_lift_pct = Math.max(0, travel(heel, ref.heelImgX, ref.heelImgY) - travel(knee, ref.kneeImgX, ref.kneeImgY));
  }
  if (inView(knee) && inView(hip) && ref.kneeImgX !== undefined && ref.hipImgX !== undefined) {
    out.knee_sideways_pct = (Math.abs((knee.x - hip.x) - (ref.kneeImgX - ref.hipImgX)) * aspect / shin) * 100;
  }
  return out;
}
/** The other foot's toes lifting counts this many times over in other_leg_pct (7.5% of the lower leg trips it). */
const OTHER_TOES_WEIGHT = 2;

/**
 * What set-up waits for: the knee's (head to feet, seated, both feet on the floor, room round the body), and the
 * affected heel and toes in view with the foot turned out to the side, toes down.
 */
export function toeRestCheck(pose: PoseInput | null, side: Side, aspect: number): { lapRest?: LapRest; lapMissing?: string } {
  const knee = kneeRestCheck(pose, side, aspect);
  if (!pose || !knee.lapRest) return knee;
  const lm = pose.landmarks, j = poseJoints(side);
  const toe = lm[j.foot], heel = lm[heelIndex(side)], hip = lm[j.hip], hipOther = lm[j.hipOther];
  if (!inView(toe) || !inView(heel)) return { lapMissing: `Tilt the camera down a little so I can see your ${side} heel and toes.` };
  if (Math.max(toe.y, heel.y) > 0.94) return { lapMissing: "Tilt the camera down a little so there is space below your feet." };
  const shin = knee.lapRest.bodyScale;
  if (shin < TOE_MIN_SHIN) return { lapMissing: "Move the camera a little closer, keeping your feet in view." };
  // Turned out: the toes away from the other foot, and the foot side-on enough that its toes do not point down the picture.
  const out = Math.sign(hip.x - hipOther.x) || 1;
  const across = (toe.x - heel.x) * aspect * out, angle = Math.atan2(heel.y - toe.y, Math.abs(toe.x - heel.x) * aspect) * DEG;
  if (across < TOE_TURNED_ACROSS * shin || angle < -TOE_TURNED_MAX_DROP_DEG) return { lapMissing: `Turn your ${side} foot out to the side, toes pointing away from your other foot, heel on the floor.` };
  if (angle > TOE_REST_MAX_DEG) return { lapMissing: "Rest your toes on the floor, heel down." };
  return knee;
}
/** The lower leg must be at least this long in the picture (frame heights) for the foot's turn to show. */
const TOE_MIN_SHIN = 0.11;
/**
 * A foot turned out reaches at least this far across the picture, heel to toes (a share of the lower leg), and its
 * toes sit at most this far below level (a foot pointing at the camera reads 50-60 degrees below; turned out, 20-35).
 */
const TOE_TURNED_ACROSS = 0.2, TOE_TURNED_MAX_DROP_DEG = 40;
/** Resting toes are at most this far above level: further up, they are already lifted. */
const TOE_REST_MAX_DEG = 15;

/**
 * One camera frame: the toe lift (steadied by `filter` when given), the six checks and the set-up's resting foot.
 * During the movement only the affected leg and foot have to stay in view; a check whose body part is out of view
 * stays unmeasured.
 */
export function toeFrame(det: { pose: PoseInput | null }, side: Side, t: number, aspect: number, ref: Geo | null, filter?: ToeLiftFilter): Frame {
  const pose = det.pose;
  if (!pose) { filter?.push(t, undefined); return { t, values: {}, comps: {}, visible: false, missing: "Sit in front of the camera so I can see you.", ...toeRestCheck(null, side, aspect) }; }
  const lm = pose.landmarks, j = poseJoints(side);
  const seen = (...indices: number[]) => indices.every(index => inView(lm[index]));
  const body = poseFrameValues(pose, side, ref);
  const geo = { ...body.geo!, ...toeGeo(pose, side, aspect) } as Geo;
  const raw = toeLiftRaw(pose, side, aspect);
  const lift = filter ? filter.push(t, raw) : raw;
  const legSeen = seen(j.hip, j.knee, j.ankle, j.foot, heelIndex(side));
  const comps: Frame["comps"] = { trunk_approach_pct: body.comps.trunk_approach_pct, ...toeComps(pose, geo, ref, side, aspect) };
  return {
    t, values: { toe_lift: legSeen ? lift : undefined }, comps, geo,
    visible: legSeen, missing: legSeen ? undefined : "Keep your knees and feet in view of the camera.",
    ...toeRestCheck(pose, side, aspect),
  };
}

// ---------- each step's target ----------

/** The practice goal: a modest lift from the resting toes (degrees), before the personal goal is learned. */
export const TOE_PRACTICE_LIFT = 12;
export const toePracticeGoal = (rest: number) => rest + TOE_PRACTICE_LIFT;
/** A practice lift not on target for this long comes closer: lift as far as is comfortable. */
export const TOE_EASE_MS = 12000, TOE_EASED_LIFT = 8;
/** Once on target, the toes may sag this much (degrees) before they count as off. */
export const TOE_HYSTERESIS = 3;
/** The toes are down again within this share of the way from rest to the goal (at least TOE_LOWER_MIN degrees above rest). */
export const TOE_LOWER_SHARE = 0.3, TOE_LOWER_MIN = 5;
/**
 * After this long lowering, toes within half the way back, or within the rest calibration's own tolerance (8
 * degrees), count: the measure may not settle exactly where it began (the foot set down a little differently), and
 * the lowering has no other way to finish.
 */
const TOE_LOWER_LENIENT_MS = 10000, TOE_LOWER_LENIENT_SHARE = 0.5, TOE_LOWER_LENIENT_MIN = 8;

export type ToeTargetInput = { value: number | undefined; rest: number; goal: number; lowering: boolean; armed: boolean; practice: boolean; t: number };

/**
 * Whether the toes are on this step's target, and how far along they are. Lift: the toes at their goal (on target
 * until they sag a little below). Lower: the toes most of the way back down. A practice lift not on target for a while
 * eases to a small lift.
 */
export class ToeTarget {
  private key = "";
  private on = false;
  private armedSince: number | null = null;
  private lastOn: number | null = null;
  private eased = false;
  /** The highest reading in this step: a lowering after a while also counts once the toes have come half the way down from it. */
  private peak = -Infinity;

  reset() { this.key = ""; this.on = false; this.armedSince = null; this.lastOn = null; this.eased = false; this.peak = -Infinity; }

  update(key: string, input: ToeTargetInput): { contact: boolean; progress: number; goal: number; eased: boolean } {
    if (key !== this.key) { this.reset(); this.key = key; }
    if (input.armed) this.armedSince ??= input.t;
    let goal = input.goal;
    if (input.practice && !input.lowering) {
      if (this.armedSince !== null && input.t - Math.max(this.armedSince, this.lastOn ?? -Infinity) >= TOE_EASE_MS) this.eased = true;
      if (this.eased) goal = Math.min(goal, input.rest + TOE_EASED_LIFT);
    }
    const value = input.value;
    const measured = value !== undefined && Number.isFinite(value);
    const range = Math.max(0.5, goal - input.rest);
    const progress = measured ? (value - input.rest) / range : 0;
    if (input.lowering) {
      if (measured) this.peak = Math.max(this.peak, value);
      const lenient = this.armedSince !== null && input.t - this.armedSince >= TOE_LOWER_LENIENT_MS;
      const band = (lenient ? Math.max(TOE_LOWER_LENIENT_SHARE * range, TOE_LOWER_LENIENT_MIN) : Math.max(TOE_LOWER_SHARE * range, TOE_LOWER_MIN)) + (this.on ? TOE_HYSTERESIS : 0);
      // After a while, toes come half the way down from the step's highest reading also count (the foot may have been
      // set down turned a little differently, so it rests higher than its rest).
      const cameDown = lenient && Number.isFinite(this.peak) && this.peak - input.rest >= range && measured && value <= this.peak - TOE_LOWER_LENIENT_SHARE * range;
      this.on = measured && (value - input.rest <= band || cameDown);
    } else {
      this.on = measured && (this.on ? value >= goal - TOE_HYSTERESIS : value >= goal);
    }
    if (this.on) this.lastOn = input.t;
    return { contact: this.on, progress, goal, eased: this.eased };
  }
}

// ---------- the ankle dial (placed like the knee's dial, beside the affected shoulder) ----------

/** The dial's toe angle where the target circle sits (its goal, exaggerated so the turn reads clearly). */
export const TOE_DIAL_GOAL_DEG = 40;
const TOE_CIRCLE_SHARE = 0.28;
/** The dial's heel sits this far below the dial's top, as a share of its foot length. */
const TOE_HEEL_DROP = 0.8;

/** A dial in canvas pixels: its heel, its foot's length, and which way (+1 right, -1 left) its toes point. */
type ToeDialPx = { x: number; y: number; r: number; dir: number };
const toePoint = (d: ToeDialPx, degrees: number) => ({ x: d.x + d.dir * Math.cos(degrees / DEG) * d.r, y: d.y - Math.sin(degrees / DEG) * d.r });
/** Where the dial's toes are drawn for a movement progress (0 resting, 1 at the goal). */
export const toeDialDegrees = (progress: number) => clamp(Number.isFinite(progress) ? progress : 0, -0.15, 1.3) * TOE_DIAL_GOAL_DEG;

function liveToeDial(dial: KneeDial, width: number, height: number): ToeDialPx {
  return { x: (1 - dial.pivot.x) * width, y: (dial.pivot.y + TOE_HEEL_DROP * dial.radius) * height, r: dial.radius * height, dir: -dial.out };
}

/** The gauge without its circle: the toes' path, a side-view lower leg standing on its heel with the foot turning up, and a caption. */
function drawToeDialBase(ctx: CanvasRenderingContext2D, d: ToeDialPx, progress: number, caption: string, light = false) {
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  for (let degrees = -6; degrees <= TOE_DIAL_GOAL_DEG + 12; degrees += 2) { const p = toePoint(d, degrees); if (degrees === -6) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
  ctx.strokeStyle = light ? "rgba(40,91,73,.35)" : "rgba(255,254,250,.6)"; ctx.lineWidth = Math.max(2, d.r * 0.05); ctx.setLineDash([6, 8]); ctx.stroke(); ctx.setLineDash([]);
  // The lower leg standing up from the ankle, just in front of the heel; the foot from the heel out to the toes.
  const ankle = { x: d.x + d.dir * 0.18 * d.r, y: d.y - 0.2 * d.r };
  ctx.strokeStyle = "rgba(40,91,73,.9)"; ctx.lineWidth = Math.max(5, d.r * 0.16);
  ctx.beginPath(); ctx.moveTo(ankle.x, ankle.y); ctx.lineTo(ankle.x - d.dir * 0.06 * d.r, d.y - TOE_HEEL_DROP * d.r - 0.1 * d.r); ctx.stroke();
  const toes = toePoint(d, toeDialDegrees(progress));
  ctx.strokeStyle = "#e18e6d"; ctx.lineWidth = Math.max(5, d.r * 0.15);
  ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(ankle.x, ankle.y); ctx.lineTo(toes.x, toes.y); ctx.closePath(); ctx.stroke();
  ctx.fillStyle = "#fffefa";
  ctx.beginPath(); ctx.arc(d.x, d.y, Math.max(3, d.r * 0.07), 0, Math.PI * 2); ctx.fill();
  ctx.font = `800 ${Math.max(11, Math.round(d.r * 0.22))}px Manrope, sans-serif`;
  ctx.textAlign = "center";
  if (light) ctx.fillStyle = "#285b49";
  else { ctx.fillStyle = "#fffefa"; ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 5; }
  ctx.fillText(caption, ankle.x - d.dir * 0.1 * d.r, d.y - TOE_HEEL_DROP * d.r - 0.28 * d.r);
  ctx.restore();
}

function drawToeDialTip(ctx: CanvasRenderingContext2D, d: ToeDialPx, progress: number) {
  const toes = toePoint(d, toeDialDegrees(progress));
  ctx.save();
  ctx.fillStyle = "#fffefa"; ctx.strokeStyle = "#e18e6d"; ctx.lineWidth = Math.max(2, d.r * 0.04);
  ctx.beginPath(); ctx.arc(toes.x, toes.y, Math.max(4, d.r * 0.09), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}

/**
 * A label beside a circle, on the toes' side (out from the body). When the canvas has no room beside it, the label
 * goes under the dial instead (below `under`, the bottom of the dial's resting circle). Returns whether it did.
 */
function drawSideLabel(ctx: CanvasRenderingContext2D, text: string, at: P2, radius: number, dir: number, fontPx: number, bounds: { width: number; height: number } | null, style: { light: boolean; active: boolean }, under = -Infinity) {
  ctx.save();
  ctx.font = `800 ${fontPx}px Manrope, sans-serif`;
  const width = ctx.measureText(text).width;
  let x = at.x + dir * (radius + 6) + (dir > 0 ? width / 2 : -width / 2), y = at.y + fontPx / 3;
  const beneath = !!bounds && (x - width / 2 < 8 || x + width / 2 > bounds.width - 8);
  if (beneath) {
    x = clamp(at.x, width / 2 + 8, Math.max(width / 2 + 8, bounds!.width - width / 2 - 8));
    y = Math.max(at.y + radius, under) + fontPx + 2;
  }
  ctx.textAlign = "center";
  if (style.light) ctx.fillStyle = style.active ? "#285b49" : "#a14d32";
  else { ctx.fillStyle = style.active ? "#fffefa" : "rgba(255,254,250,.7)"; ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 6; }
  ctx.fillText(text, x, y);
  ctx.restore();
  return beneath;
}

/** Where to centre an arrow's label so it reads outward from the arrow's line, clear of the leg beside it. */
function outwardLabelX(ctx: CanvasRenderingContext2D, text: string, fontPx: number, x: number, dir: number, inset: number) {
  ctx.save();
  ctx.font = `800 ${fontPx}px Manrope, sans-serif`;
  const half = ctx.measureText(text).width / 2;
  ctx.restore();
  return x + dir * (half - inset);
}

export type ToeDialDrawing = {
  progress: number; lowering: boolean; armed: boolean; contact: boolean; hold: number; label: string; now: number; reducedMotion: boolean;
  /** A line under the dial (practice: that its toes move with the patient's toes). */
  hint?: string;
};

/** The ankle dial on the mirrored camera view: the gauge, and the active circle at the goal (lift) or with the toes down (lower). */
export function drawToeDial(ctx: CanvasRenderingContext2D, dial: KneeDial, width: number, height: number, state: ToeDialDrawing) {
  const d = liveToeDial(dial, width, height);
  drawToeDialBase(ctx, d, state.progress, "Ankle angle");
  const target = toePoint(d, state.lowering ? 0 : TOE_DIAL_GOAL_DEG);
  const radius = TOE_CIRCLE_SHARE * d.r;
  drawTestingTarget(ctx, { x: target.x, y: target.y, radius, armed: state.armed, contact: state.contact, progress: state.hold, now: state.now, reducedMotion: state.reducedMotion });
  drawToeDialTip(ctx, d, state.progress);
  const labelPx = Math.max(14, Math.round(height / 28));
  const beneath = drawSideLabel(ctx, state.label, target, radius, d.dir, labelPx, { width, height }, { light: false, active: state.armed }, d.y + radius);
  if (state.hint) {
    ctx.save();
    const fontPx = Math.max(13, Math.round(height / 34));
    ctx.font = `800 ${fontPx}px Manrope, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#fffefa"; ctx.shadowColor = "rgba(0,0,0,.7)"; ctx.shadowBlur = 6;
    const half = ctx.measureText(state.hint).width / 2;
    // Under the label when the label went under the dial.
    ctx.fillText(state.hint, clamp(d.x + d.dir * 0.4 * d.r, half + 8, Math.max(half + 8, width - half - 8)), Math.min(height - 8, d.y + radius + fontPx * 1.3 + (beneath ? labelPx + 4 : 0)));
    ctx.restore();
  }
}

/** The circle the last step completed, in canvas pixels (for its completion animation). */
export function toeDialCircle(dial: KneeDial, lowering: boolean, width: number, height: number) {
  const d = liveToeDial(dial, width, height);
  return { ...toePoint(d, lowering ? 0 : TOE_DIAL_GOAL_DEG), radius: TOE_CIRCLE_SHARE * d.r };
}

// ---------- the arrow at the toes ----------

/**
 * The toes' arrow from where the foot rests: an arc about the heel, just beyond the toes (so it does not hide them),
 * from level with them up the way they turn as they lift. out: +1 when the toes point toward +x in the raw image.
 */
export type ToeGuide = { start: P2; control: P2; end: P2; shin: number; out: number };

/** The arc's span about the heel, degrees above the resting foot, and its radius as a share of the foot's length. */
const GUIDE_FROM_DEG = 4, GUIDE_TO_DEG = 40, GUIDE_REACH = 1.15;

export function toeGuide(ref: Geo | null, dial: KneeDial | null, aspect: number): ToeGuide | null {
  if (!ref || !dial || ref.toeImgX === undefined || ref.toeImgY === undefined || ref.heelImgX === undefined || ref.heelImgY === undefined || !ref.kneeShin) return null;
  const hx = ref.heelImgX * aspect, hy = ref.heelImgY;
  const across = ref.toeImgX * aspect - hx, down = ref.toeImgY - hy;
  const length = Math.hypot(across, down);
  if (length < TOE_MIN_FOOT) return null;
  const out = Math.sign(across) || dial.out;
  const rest = Math.atan2(-down, Math.abs(across));
  // A point on the arc, `degrees` above the resting foot, at `reach` foot lengths from the heel; kept in the picture.
  const at = (degrees: number, reach: number) => {
    const a = rest + degrees / DEG;
    return { x: clamp((hx + out * Math.cos(a) * length * reach) / aspect, 0.03, 0.97), y: clamp(hy - Math.sin(a) * length * reach, 0.03, 0.97) };
  };
  // A quadratic curve through the arc's middle bulges out by 1/cos(half the span).
  const half = (GUIDE_TO_DEG - GUIDE_FROM_DEG) / 2;
  return {
    start: at(GUIDE_FROM_DEG, GUIDE_REACH), control: at(GUIDE_FROM_DEG + half, GUIDE_REACH / Math.cos(half / DEG)), end: at(GUIDE_TO_DEG, GUIDE_REACH),
    shin: ref.kneeShin, out,
  };
}

/** The arrow on the mirrored camera view: up while lifting ("Lift your toes"), down while lowering ("Toes down"); it moves until the toes are there. */
export function drawToeGuide(ctx: CanvasRenderingContext2D, guide: ToeGuide, width: number, height: number, state: { lowering: boolean; emphasis: boolean; now: number; reducedMotion: boolean }) {
  const px = (p: P2) => ({ x: (1 - p.x) * width, y: p.y * height });
  const start = px(guide.start), control = px(guide.control), end = px(guide.end);
  const lineWidth = Math.max(4, guide.shin * height * 0.05), fontPx = Math.max(14, Math.round(height / 30));
  const bounds = { width, height };
  const [from, to] = state.lowering ? [end, start] : [start, end];
  const label = state.lowering ? "Toes down" : "Lift your toes";
  // Out from the body on the mirrored view is -out in the raw image.
  drawArrow(ctx, from, control, to, {
    width: lineWidth, label, emphasis: state.emphasis, now: state.now, reducedMotion: state.reducedMotion,
    labelAt: { x: outwardLabelX(ctx, label, fontPx, end.x, -guide.out, lineWidth), y: end.y - lineWidth * 3 }, fontPx, bounds,
  });
}

// ---------- the demonstration and the no-camera simulator (300 x 270 drawing space) ----------

const MOVE_MS = 1100;
const smooth = (k: number) => k * k * (3 - 2 * k);
const unit = (k: number) => clamp(k, 0, 1);
const poseAt = (fraction: number, returning: boolean) => (returning ? 1 - smooth(fraction) : smooth(fraction));
/** The demonstration's ankle dial, up beside the foot as it sits beside the shoulder on the camera view: its heel and foot length. */
const DEMO_TOE_DIAL = { x: 196, y: 92, r: 44 };
/**
 * The close-up's lower leg and foot, as drawn for a right foot turned out (toes to the right, as the mirror shows it):
 * the knee at the top, the ankle, the heel on the floor and the toes; the floor; and how far the foot turns up about
 * the heel at the goal (degrees).
 */
const DEMO_KNEE = { x: 80, y: 44 }, DEMO_ANKLE = { x: 88, y: 204 }, DEMO_HEEL = { x: 70, y: 236 }, DEMO_TOES = { x: 206, y: 236 };
const DEMO_FLOOR_Y = 242, DEMO_LIFT_DEG = 25;

function demoToeDial(side: Side): ToeDialPx {
  return { x: sideX(DEMO_TOE_DIAL.x, side), y: DEMO_TOE_DIAL.y, r: DEMO_TOE_DIAL.r, dir: side === "left" ? -1 : 1 };
}

/**
 * The scene for the demonstration, the simulator and the screen previews: a close-up of the affected lower leg with
 * the foot turned out to the side (the toe is small seen from across the room), its toes turning up about the heel
 * on the floor, the arrow at the toes, and the ankle dial turning toward its circle as on the camera view. The circle
 * is drawn by the caller (the shared target visuals).
 */
export function drawToeScene(ctx: CanvasRenderingContext2D, width: number, height: number, state: { progress: number; lowering: boolean; side: Side; arrow: boolean; armed: boolean; now: number; reducedMotion: boolean }) {
  const s = Math.min(width / 300, height / 270);
  const side = state.side, dir = side === "left" ? -1 : 1;
  const X = (p: P2): P2 => ({ x: sideX(p.x, side), y: p.y });
  // A point of the foot turned up about the heel by `degrees` (toes toward the side's outward direction).
  const turned = (p: P2, degrees: number): P2 => {
    const a = degrees / DEG, dx = p.x - DEMO_HEEL.x, dy = p.y - DEMO_HEEL.y;
    return X({ x: DEMO_HEEL.x + dx * Math.cos(a) + dy * Math.sin(a), y: DEMO_HEEL.y - dx * Math.sin(a) + dy * Math.cos(a) });
  };
  const lift = clamp(state.progress, -0.1, 1.2) * DEMO_LIFT_DEG;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.translate((width - 300 * s) / 2, (height - 270 * s) / 2);
  ctx.scale(s, s);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.font = "800 11px Manrope, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#285b49";
  ctx.fillText("Your foot, turned out to the side", 150, 20);
  // The floor, the lower leg down from the knee, and the foot turning up about the heel.
  ctx.strokeStyle = "#b9d3c2"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(16, DEMO_FLOOR_Y); ctx.lineTo(284, DEMO_FLOOR_Y); ctx.stroke();
  const knee = X(DEMO_KNEE), ankle = turned(DEMO_ANKLE, lift), heel = X(DEMO_HEEL), toes = turned(DEMO_TOES, lift);
  ctx.strokeStyle = "#e18e6d"; ctx.lineWidth = 26;
  ctx.beginPath(); ctx.moveTo(knee.x, knee.y); ctx.lineTo(ankle.x, ankle.y); ctx.stroke();
  ctx.fillStyle = "#e18e6d"; ctx.lineWidth = 18;
  ctx.beginPath(); ctx.moveTo(heel.x, heel.y); ctx.lineTo(ankle.x, ankle.y); ctx.lineTo(toes.x, toes.y); ctx.closePath(); ctx.fill(); ctx.stroke();
  // The heel stays down: a dot on the floor and a word under it.
  ctx.fillStyle = "#fffefa";
  ctx.beginPath(); ctx.arc(heel.x, heel.y, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#285b49";
  ctx.fillText("Heel stays down", heel.x + dir * 28, DEMO_FLOOR_Y + 16);
  // The arrow at the toes, along their turn about the heel: up while lifting, down while lowering.
  if (state.arrow) {
    const reach = (degrees: number, far: number) => turned({ x: DEMO_HEEL.x + (DEMO_TOES.x - DEMO_HEEL.x) * far, y: DEMO_TOES.y - 6 }, degrees);
    const low = reach(3, 1.1), high = reach(DEMO_LIFT_DEG + 10, 1.1), control = reach((DEMO_LIFT_DEG + 13) / 2, 1.1 / Math.cos((DEMO_LIFT_DEG + 7) / 2 / DEG));
    const [from, to] = state.lowering ? [high, low] : [low, high];
    const label = state.lowering ? "Toes down" : "Lift your toes";
    // Its label in the open space above the foot, clear of the arrowhead and of the dial's own labels under its circle.
    drawArrow(ctx, from, control, to, {
      width: 4, label, emphasis: state.armed, now: state.now, reducedMotion: state.reducedMotion,
      labelAt: { x: sideX(138, side), y: 128 }, fontPx: 12, light: true,
    });
  }
  drawToeDialBase(ctx, demoToeDial(side), state.progress, "Ankle angle", true);
  drawToeDialTip(ctx, demoToeDial(side), state.progress);
  ctx.restore();
}

/** The demonstration's circle on its ankle dial, in canvas pixels: the goal while lifting, the toes down while lowering. */
export function toeGhostTarget(width: number, height: number, returning: boolean, side: Side = "right") {
  const s = Math.min(width / 300, height / 270);
  const p = toePoint(demoToeDial(side), returning ? 0 : TOE_DIAL_GOAL_DEG);
  return { x: (width - 300 * s) / 2 + p.x * s, y: (height - 270 * s) / 2 + p.y * s, radius: TOE_CIRCLE_SHARE * DEMO_TOE_DIAL.r * s };
}

/** The instant the dial's toes enter their circle as the demonstration moves. */
function contactStartMs(returning: boolean) {
  const d = demoToeDial("right"), target = toePoint(d, returning ? 0 : TOE_DIAL_GOAL_DEG), radius = TOE_CIRCLE_SHARE * d.r;
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    const toes = toePoint(d, toeDialDegrees(poseAt(middle, returning)));
    if (Math.hypot(toes.x - target.x, toes.y - target.y) <= radius) high = middle;
    else low = middle;
  }
  return high * MOVE_MS;
}
const CONTACT_MS = [contactStartMs(false), contactStartMs(true)];

export const toeDemoDuration = (returning: boolean) => CONTACT_MS[returning ? 1 : 0] + TARGET_HOLD_MS + TARGET_COMPLETION_MS;

/** The simulated patient is on target at the end of each movement (level 1 is the goal, 0 resting). */
export function toeGhostContact(level: number, returning: boolean): boolean {
  return returning ? level <= 0.05 : level >= 0.95;
}

export function toeDemoState(elapsedMs: number, returning: boolean, armed = true) {
  const elapsed = armed ? Math.max(0, elapsedMs) : 0;
  const reached = CONTACT_MS[returning ? 1 : 0];
  const contact = armed && elapsed >= reached;
  const progress = contact ? unit((elapsed - reached) / TARGET_HOLD_MS) : 0;
  const completionElapsedMs = elapsed - reached - TARGET_HOLD_MS;
  const phase = !armed ? "waiting" : !contact ? "move" : progress < 1 ? "hold" : "complete";
  const pose = poseAt(unit(elapsed / MOVE_MS), returning);
  const t = toePoint(demoToeDial("right"), returning ? 0 : TOE_DIAL_GOAL_DEG);
  const target: [number, number] = [t.x, t.y];
  const label = returning ? "Toes down" : "Lift";
  const instruction = !armed ? "Listen to the instruction. The circle will become active when the voice finishes."
    : phase === "complete" ? returning ? "Toes down complete" : "Toes high enough — now lower them slowly"
    : phase === "hold" ? `${returning ? "Rest your foot flat" : "Hold your toes up"} · ${Math.round(progress * 100)}%`
    : returning ? "Lower the front of your foot slowly to the floor"
    : "With your foot turned out and your heel down, lift your toes. The ankle dial moves with your foot, toward its circle";
  return { pose, target, radius: TOE_CIRCLE_SHARE * DEMO_TOE_DIAL.r, armed, contact, progress, completionElapsedMs, phase, label, instruction };
}

export function drawToeDemo(ctx: CanvasRenderingContext2D, elapsedMs: number, returning: boolean, width: number, height: number, now: number, reducedMotion = false, armed = true, side: Side = "right") {
  const state = toeDemoState(elapsedMs, returning, armed);
  drawToeScene(ctx, width, height, { progress: state.pose, lowering: returning, side, arrow: true, armed, now, reducedMotion });
  const { x, y, radius } = toeGhostTarget(width, height, returning, side);
  if (state.phase === "complete") {
    drawTargetCompletion(ctx, { x, y, radius, elapsed: Math.min(state.completionElapsedMs, TARGET_COMPLETION_MS - 1), now, reducedMotion: reducedMotion || state.completionElapsedMs >= TARGET_COMPLETION_MS });
  } else {
    drawTestingTarget(ctx, { x, y, radius, armed, contact: state.contact, progress: state.progress, now, reducedMotion });
  }
  const s = Math.min(width / 300, height / 270);
  const rest = toeGhostTarget(width, height, true, side);
  drawSideLabel(ctx, state.phase === "complete" ? "Complete" : state.label, { x, y }, radius, side === "left" ? -1 : 1, Math.max(11, Math.round(12 * s)), { width, height }, { light: true, active: state.contact }, rest.y + rest.radius);
}
