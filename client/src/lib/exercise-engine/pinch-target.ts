import type { Side } from "./config";
import { affectedHand, handCovers, handGhostPoints, handReady, handTurnComps, inHandZone, palmAxes, palmFacing, palmGeo, palmRing, type HandZone } from "./hand-target";
import { handVisible, inView, poseFrameValues, poseJoints, type Frame, type Geo, type HandInput, type PoseInput, type Pt } from "./metrics";
import { TARGET_COMPLETION_MS, TARGET_HOLD_MS } from "./target-timing";
import { drawTargetCompletion, drawTestingTarget } from "./target-visual";

// Pinch and Peg on the shared target flow, set up as Active Hand Opening is: the elbow on an armrest or table and the
// hand up in the shaded area beside the body at chest height, palm to the camera, so the face and both shoulders stay
// in view. Each pinch picks up a drawn peg: the thumb meets a fingertip tip to tip and holds, then lets go and the peg
// drops into a drawn tray. Level 1 pinches the first finger, then the middle finger (each step's `finger`, config.ts
// pinchCycle). MediaPipe hand landmarks: wrist 0; thumb 1-4; index 5-8; middle 9-12; ring 13-16; little 17-20. Image
// positions are raw (unmirrored) normalized coordinates.

type V = [number, number, number];
type P2 = { x: number; y: number };
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const size = (a: V) => Math.hypot(a[0], a[1], a[2]);
const vec = (p: Pt): V => [p.x, p.y, p.z];
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const finite = (...values: (number | undefined)[]) => values.every(value => typeof value === "number" && Number.isFinite(value));

/**
 * The fingers the thumb meets (a step's `finger`): the first and the middle finger, the two a front camera sees
 * reliably. Each has its tip, its chain from knuckle to tip, and the measure of the thumb closing on it.
 */
export const PINCH_FINGERS = [
  { name: "first finger", tip: 8, chain: [5, 6, 7, 8], metric: "pinch_index" },
  { name: "middle finger", tip: 12, chain: [9, 10, 11, 12], metric: "pinch_middle" },
] as const;
/** A cycle step's finger, kept to the two the camera tracks. */
export const pinchFinger = (finger: number | undefined) => (finger === 1 ? 1 : 0);

// ---------- the affected hand and how far the thumb has closed ----------

/**
 * The affected hand: as Active Hand Opening chooses it (on the affected side of the body, nearest the affected
 * wrist), and never the other hand coming over to help: that hand would be nearer the other wrist.
 */
export function pinchHand(det: { pose: PoseInput | null; hands: HandInput[] }, side: Side): HandInput | null {
  const hand = affectedHand(det, side);
  const lm = det.pose?.landmarks, j = poseJoints(side);
  const wrist = lm?.[j.wrist], other = lm?.[j.wristOther];
  if (!hand || !wrist || !other || !inView(wrist) || !inView(other)) return hand;
  const d = (p: Pt) => Math.hypot(hand.landmarks[0].x - p.x, hand.landmarks[0].y - p.y);
  return d(other) < d(wrist) ? null : hand;
}

/** Palm length from the 3D landmarks (wrist to middle knuckle), metres. */
function palmLength(w: Pt[]): number {
  return size(sub(vec(w[9]), vec(w[0])));
}

/** The 3D gap from the thumb tip to a fingertip, in palm lengths: unaffected by the palm's tilt or the camera distance. */
export function pinchGap(hand: HandInput | null, finger: number): number | undefined {
  const w = hand?.world, tip = PINCH_FINGERS[finger]?.tip;
  if (!w || tip === undefined || ![0, 4, 9, tip].every(index => w[index] && finite(w[index].x, w[index].y, w[index].z))) return undefined;
  const palm = palmLength(w);
  return palm > 0.01 ? size(sub(vec(w[4]), vec(w[tip]))) / palm : undefined;
}

/** How far the thumb has closed on a finger, 0-100: 100 at the fingertip, 75 within a quarter palm length (touching). */
export const closureOf = (gap: number) => clamp(100 * (1 - gap), 0, 100);
export const gapOf = (closure: number) => 1 - closure / 100;

/**
 * Where along the finger the thumb tip is, 0 at the knuckle to 1 at the fingertip: the nearest point of the finger's
 * chain (3D). Tip to tip (or pad to pad) is at the far end; a thumb pressed against the side of the finger (a key
 * pinch) or into the palm is nearer the knuckle.
 */
export function tipAlong(hand: HandInput | null, finger: number): number | undefined {
  const w = hand?.world, chain = PINCH_FINGERS[finger]?.chain;
  if (!w || !chain || ![4, ...chain].every(index => w[index] && finite(w[index].x, w[index].y, w[index].z))) return undefined;
  const thumb = vec(w[4]);
  let total = 0, best = Infinity, at = 0;
  const lengths = chain.slice(1).map((index, i) => size(sub(vec(w[index]), vec(w[chain[i]]))));
  const sum = lengths.reduce((a, b) => a + b, 0);
  if (sum < 0.005) return undefined;
  chain.slice(1).forEach((index, i) => {
    const a = vec(w[chain[i]]), segment = sub(vec(w[index]), a), length = lengths[i];
    const k = length > 0 ? clamp(dot(sub(thumb, a), segment) / (length * length), 0, 1) : 0;
    const distance = size(sub(thumb, [a[0] + segment[0] * k, a[1] + segment[1] * k, a[2] + segment[2] * k]));
    if (distance < best) { best = distance; at = (total + k * length) / sum; }
    total += length;
  });
  return at;
}

/** The thumb-to-fingertip gap in the picture, in palm lengths as the picture shows the palm (a cross-check on depth). */
export function imageGap(hand: HandInput | null, finger: number, aspect: number): number | undefined {
  const p = hand?.landmarks, tip = PINCH_FINGERS[finger]?.tip, ring = palmRing(hand, aspect);
  if (!p || tip === undefined || !p[4] || !p[tip] || !ring) return undefined;
  return Math.hypot((p[4].x - p[tip].x) * aspect, p[4].y - p[tip].y) / ring.scale;
}

/** A fingertip's distance from the palm's centre within the palm's own plane, in palm lengths (hand-target.ts handOpenness, per finger). */
export function fingerReach(hand: HandInput | null, tip: number): number | undefined {
  const w = hand?.world, axes = palmAxes(hand);
  if (!w || !axes || !w[tip] || ![0, 5, 9, 13, 17].every(index => w[index])) return undefined;
  const centre = [0, 5, 9, 13, 17].reduce<V>((sum, index) => [sum[0] + w[index].x / 5, sum[1] + w[index].y / 5, sum[2] + w[index].z / 5], [0, 0, 0]);
  const palm = palmLength(w);
  if (palm < 0.01) return undefined;
  const d = sub(vec(w[tip]), centre);
  return Math.hypot(dot(d, axes.a), dot(d, axes.b)) / palm;
}

// ---------- the checks ----------

/** The middle, ring and little fingertips: they should stay out while the thumb meets the first finger. */
const OTHER_TIPS = [12, 16, 20] as const;
/** The posture snapshot, with the resting reach of the three other fingers (kept in the set-up reference). */
export type PinchGeo = Geo & { pinchReach12?: number; pinchReach16?: number; pinchReach20?: number };

export function pinchGeo(hand: HandInput | null): Partial<PinchGeo> {
  const out: Partial<PinchGeo> = { ...palmGeo(hand) };
  for (const tip of OTHER_TIPS) { const reach = fingerReach(hand, tip); if (reach !== undefined) out[`pinchReach${tip}`] = reach; }
  return out;
}

/** Fingers resting curled below this reach (palm lengths) cannot be judged for curling further: the check stays unmeasured. */
const CURL_REST_MIN = 0.5;
/** The other fingers count as curled in once their mean reach is at most this (a relaxed hand is about 0.45-0.7). */
const CURL_REACH_MAX = 0.45;

/** Whether the set-up hand's other fingers rested out far enough for curling in to be judged. */
export function curlJudged(ref: Geo | null): boolean {
  const rest = OTHER_TIPS.map(tip => (ref as PinchGeo | null)?.[`pinchReach${tip}`]);
  return finite(...rest) && rest.reduce((a, b) => a! + b!, 0)! / rest.length >= CURL_REST_MIN;
}

/**
 * Other fingers curling in with the pinch (loss of finger independence): how far the middle, ring and little
 * fingertips' mean reach has dropped below the set-up hand, in hundredths of a palm length, once they are curled in
 * (otherwise 0). Unmeasured for a hand that rested with those fingers already curled.
 */
export function massFlexion(hand: HandInput | null, ref: PinchGeo | null): number | undefined {
  if (!ref) return undefined;
  const rest = OTHER_TIPS.map(tip => ref[`pinchReach${tip}`]);
  const now = OTHER_TIPS.map(tip => fingerReach(hand, tip));
  if (!finite(...rest) || !finite(...now)) return undefined;
  const restMean = rest.reduce((a, b) => a! + b!, 0)! / rest.length, nowMean = now.reduce((a, b) => a! + b!, 0)! / now.length;
  if (restMean < CURL_REST_MIN) return undefined;
  return nowMean <= CURL_REACH_MAX ? Math.max(0, restMean - nowMean) * 100 : 0;
}

/**
 * The other hand coming over to help: how near it is to the affected palm's centre, as 1 / its distance in palm
 * lengths (1 is a palm length away; 0 when it is nowhere in view). From the other side's pose wrist and any second
 * hand the hand model sees.
 */
export function otherHandNear(det: { pose: PoseInput | null; hands: HandInput[] }, hand: HandInput | null, side: Side, aspect: number): number | undefined {
  const ring = palmRing(hand, aspect);
  if (!hand || !ring) return undefined;
  const points: Pt[] = [];
  const wrist = det.pose?.landmarks[poseJoints(side).wristOther];
  if (wrist && inView(wrist)) points.push(wrist);
  for (const other of det.hands) if (other !== hand) points.push(...other.landmarks);
  if (!points.length) return 0;
  const distance = Math.min(...points.map(p => Math.hypot((p.x - ring.x) * aspect, p.y - ring.y))) / ring.scale;
  return Math.min(10, 1 / Math.max(0.1, distance));
}

// ---------- set-up and readiness ----------

/** At set-up the thumb rests at least this far from the first fingertip (palm lengths), so a pinch has room to close. */
const REST_GAP_MIN = 0.3;
/** Each pinch starts with the thumb apart: at least this far from the fingertip, or nearly as far as at set-up. */
export const startGap = (restClosure: number) => Math.min(0.5, gapOf(restClosure) - 0.05);

/**
 * The resting hand at set-up, as Active Hand Opening learns it (every fingertip in view, the face and both shoulders
 * too, in the shaded area, palm to the camera) but with the fingers simply relaxed, however open, and the thumb
 * resting a little away from the first finger.
 */
export function pinchRest(hand: HandInput | null, aspect: number, side: Side, faceAndShoulders: boolean, zone: HandZone | null): { lapRest?: { x: number; y: number; bodyScale: number }; lapMissing?: string } {
  if (!hand) return { lapMissing: `Hold your ${side} hand up in the shaded area with your palm facing the camera.` };
  const view = handVisible(hand);
  if (!view.ok) return { lapMissing: view.missing };
  if (!faceAndShoulders) return { lapMissing: "Keep your face and both shoulders in view." };
  const ring = palmRing(hand, aspect);
  if (zone && !inHandZone(ring, zone, aspect)) return { lapMissing: "Bring your hand into the shaded area." };
  if (palmFacing(hand, side) < 0.5) return { lapMissing: "Turn your palm to face the camera." };
  const gap = pinchGap(hand, 0);
  if (!ring || gap === undefined) return { lapMissing: "Hold your hand toward the camera so I can see every finger." };
  if (gap < REST_GAP_MIN) return { lapMissing: "Let your thumb rest a little away from your first finger." };
  return { lapRest: { x: hand.landmarks[0].x, y: hand.landmarks[0].y, bodyScale: ring.scale } };
}

/**
 * Whether the hand is ready to start a pinch: Active Hand Opening's readiness (in the shaded area, palm to the
 * camera, wrist and palm as at set-up, clear of the face and shoulders), with the thumb apart from the finger. A
 * thumb that will not open further is waived after a while, as fingers that will not relax are.
 */
export function pinchReady(hand: HandInput | null, zone: HandZone | null, aspect: number, side: Side, options: { covering?: "face" | "shoulder" | null; ref?: Geo | null; startGap?: number }) {
  const ready = handReady(hand, zone, aspect, side, { covering: options.covering, ref: options.ref });
  if (!ready.ready || options.startGap === undefined) return ready;
  const gap = pinchGap(hand, 0);
  if (gap !== undefined && gap < options.startGap) return { ready: false, placed: ready.placed, almost: true, hint: "Open your thumb away from your finger." };
  return ready;
}

/**
 * One camera frame: how far the thumb has closed on each finger (pinch_index, pinch_middle), the six checks, the
 * resting hand for set-up and whether a pinch may start. The body model checks only the trunk, the shoulders and the
 * other hand, so the arm and hips (often behind the table) need not be in view.
 */
export function pinchFrame(det: { pose: PoseInput | null; hands: HandInput[] }, side: Side, t: number, aspect: number, ref: Geo | null, options: { zone?: HandZone | null; startGap?: number } = {}): Frame {
  const joints = poseJoints(side);
  const landmarks = det.pose?.landmarks;
  const hand = pinchHand(det, side);
  const body = det.pose ? poseFrameValues(det.pose, side, ref) : null;
  const covering = handCovers(hand, det.pose, side, aspect);
  const values: Frame["values"] = {};
  PINCH_FINGERS.forEach((finger, index) => { const gap = pinchGap(hand, index); if (gap !== undefined) values[finger.metric] = closureOf(gap); });
  // A hand hiding the face or a shoulder leaves the trunk and shoulder checks unmeasured rather than misread.
  const comps: Frame["comps"] = {
    ...handTurnComps(hand, ref),
    trunk_approach_pct: covering ? undefined : body?.comps.trunk_approach_pct,
    shoulder_hike_rel_delta: covering ? undefined : body?.comps.shoulder_hike_rel_delta,
    shoulder_elevation_pct: covering ? undefined : body?.comps.shoulder_elevation_pct,
    other_hand_near: otherHandNear(det, hand, side, aspect),
    mass_flexion_pct: massFlexion(hand, ref as PinchGeo | null),
  };
  const view = handVisible(hand);
  const faceAndShoulders = [joints.nose, joints.shoulder, joints.shoulderOther].every(index => inView(landmarks?.[index]));
  const zone = options.zone ?? null;
  const ready = pinchReady(hand, zone, aspect, side, { covering, ref, startGap: options.startGap });
  const rest = covering && hand ? { lapMissing: `Move your hand a little further out, away from your ${covering}.` } : pinchRest(hand, aspect, side, faceAndShoulders, zone);
  return {
    t, values, comps, visible: view.ok, missing: view.missing, geo: body?.geo ? { ...body.geo, ...pinchGeo(hand) } as Geo : undefined,
    ready: ready.ready, placed: ready.placed, readyAlmost: ready.almost, readyHint: ready.hint, ...rest,
  };
}

// ---------- each step's target ----------

/** Touching: the thumb within a quarter palm length (about 2 cm) of the fingertip (closure 75); it stays on until 0.35. */
export const TOUCH_CLOSURE = 75;
const STAY_SLACK = 10;
/** Tip to tip: the thumb at the far end of the finger (a key pinch on its side does not count). */
export const TIP_ALONG_MIN = 0.75;
/** The picture must agree: the tips' image gap at most the goal's gap plus this (palm lengths). */
const IMAGE_SLACK = 0.25;
/** The practice circle: this share of the way from the resting thumb to touching... */
export const PRACTICE_SHARE = 0.5;
/** ...brought closer, to this share, if it is not reached for a while. */
export const EASED_SHARE = 0.25, PINCH_EASE_MS = 12000;
/** Letting go: the thumb opens this share of the way back from the goal to where it rested. */
export const RELEASE_SHARE = 0.6;

/** The practice goal, as a closure: part of the way from the resting thumb to touching. */
export function pinchPracticeGoal(restClosure: number, share = PRACTICE_SHARE): number {
  return restClosure >= TOUCH_CLOSURE ? TOUCH_CLOSURE : restClosure + share * (TOUCH_CLOSURE - restClosure);
}
/** The closure the thumb opens back to when letting go. */
export const releaseClosure = (goal: number, restClosure: number) => goal - RELEASE_SHARE * Math.max(0, goal - restClosure);

export type PinchTargetInput = {
  /** This step's finger's closure, its image gap and where along the finger the thumb is. */
  closure: number | undefined;
  imageGap?: number;
  along?: number;
  /** The other finger's closure: the thumb must be nearer this step's fingertip (not touching the wrong finger). */
  rival?: number;
  rest: number;
  /** The pinch goal (closure): the practice goal or the goal learned in practice. */
  goal: number;
  letGo: boolean;
  armed: boolean;
  practice: boolean;
  t: number;
};

/**
 * Whether the thumb is on this step's target. Pinch: closed to the goal, and the picture agrees; a goal at touching
 * also needs the thumb tip to tip on this step's finger (nearer it than the other finger: a thumb part of the way there
 * is not yet at either fingertip, so short of touching only the closure counts). It stays on until it opens a little
 * past the goal. Let go: opened back to the release. A practice pinch not reached for a while comes closer (as far as
 * is comfortable), timed from the last moment it was on target with the circle active, as the knee's does.
 */
export class PinchTarget {
  private key = "";
  private on = false;
  private armedSince: number | null = null;
  private lastOn: number | null = null;
  private eased = false;

  reset() { this.key = ""; this.on = false; this.armedSince = null; this.lastOn = null; this.eased = false; }

  update(key: string, input: PinchTargetInput): { contact: boolean; progress: number; goal: number; release: number; eased: boolean } {
    if (key !== this.key) { this.reset(); this.key = key; }
    let goal = input.goal;
    if (input.practice && !input.letGo) {
      if (input.armed) this.armedSince ??= input.t;
      if (this.armedSince !== null && input.t - Math.max(this.armedSince, this.lastOn ?? -Infinity) >= PINCH_EASE_MS) this.eased = true;
      if (this.eased) goal = Math.min(goal, pinchPracticeGoal(input.rest, EASED_SHARE));
    }
    const release = releaseClosure(goal, input.rest);
    const closure = input.closure;
    if (closure === undefined || !Number.isFinite(closure)) { this.on = false; return { contact: false, progress: 0, goal, release, eased: this.eased }; }
    if (input.letGo) {
      this.on = this.on ? closure <= release + 5 : closure <= release;
      return { contact: this.on, progress: clamp((goal - closure) / Math.max(1, goal - release), 0, 1), goal, release, eased: this.eased };
    }
    const touching = goal >= TOUCH_CLOSURE - STAY_SLACK;
    const tipToTip = !touching || input.along === undefined || input.along >= TIP_ALONG_MIN - (this.on ? 0.1 : 0);
    const pictured = input.imageGap === undefined || input.imageGap <= gapOf(goal) + IMAGE_SLACK + (this.on ? 0.1 : 0);
    const rightFinger = !touching || input.rival === undefined || !Number.isFinite(input.rival) || closure >= input.rival - (this.on ? 5 : 0);
    this.on = tipToTip && pictured && rightFinger && (this.on ? closure >= goal - STAY_SLACK : closure >= goal);
    if (this.on && input.armed) this.lastOn = input.t;
    return { contact: this.on, progress: clamp((closure - input.rest) / Math.max(1, goal - input.rest), 0, 1), goal, release, eased: this.eased };
  }
}

/** The step's circle on the camera view: round the thumb tip and the fingertip, sized to hold both at the goal (or the release). */
export function pinchCircle(hand: HandInput | null, finger: number, aspect: number, closure: number): { x: number; y: number; radius: number } | null {
  const p = hand?.landmarks, tip = PINCH_FINGERS[finger]?.tip, ring = palmRing(hand, aspect);
  if (!p || tip === undefined || !p[4] || !p[tip] || !ring) return null;
  return { x: (p[4].x + p[tip].x) / 2, y: (p[4].y + p[tip].y) / 2, radius: Math.max(0.02, (0.5 * gapOf(closure) + 0.18) * ring.scale) };
}

// ---------- the peg and its tray ----------

/** A small peg (an upright rounded rod) at a canvas point. */
export function drawPeg(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, held: boolean) {
  const w = size * 0.42, h = size;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(-w / 2, -h / 2, w, h, w / 2); else ctx.rect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = "#e18e6d"; ctx.fill();
  ctx.lineWidth = Math.max(2, size * 0.08); ctx.strokeStyle = held ? "#7fe5a3" : "#fffefa"; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(0, -h / 2 + w * 0.3, w * 0.35, w * 0.18, 0, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,254,250,.55)"; ctx.fill();
  ctx.restore();
}

/** The tray the pegs drop into, with the pegs let go so far this repetition. */
export function drawPegTray(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, pegs: number) {
  const w = size * 2.4, h = size * 0.9;
  ctx.save();
  ctx.lineWidth = Math.max(2, size * 0.08);
  ctx.strokeStyle = "#fffefa"; ctx.fillStyle = "rgba(40,91,73,.75)";
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x - w / 2, y - h / 2, w, h, size * 0.2); else ctx.rect(x - w / 2, y - h / 2, w, h);
  ctx.fill(); ctx.stroke();
  for (let i = 0; i < pegs; i++) drawPeg(ctx, x - w / 4 + (i * w) / 2, y - h * 0.15, size * 0.7, false);
  ctx.font = `700 ${Math.max(12, Math.round(size * 0.42))}px Manrope, sans-serif`;
  ctx.textAlign = "center"; ctx.fillStyle = "#fffefa"; ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 5;
  ctx.fillText("Tray", x, y + h / 2 + size * 0.5);
  ctx.restore();
}

/** Pegs already in the tray before this step (steps alternate pinch, let go): one after each let-go. */
export const pegsDropped = (stepIndex: number) => Math.floor(Math.max(0, stepIndex) / 2);

// ---------- the demonstration and the no-camera simulator (a front-on hand, 300 x 270 drawing space) ----------

const MOVE_MS = 1100;
const GHOST_RADIUS = 22;
const smooth = (k: number) => k * k * (3 - 2 * k);
const unit = (k: number) => clamp(k, 0, 1);

/** The ghost hand's points with the thumb closing on a finger: p 0 apart, 1 tip to tip. */
export function pinchGhostPoints(finger: number, p: number): [number, number][] {
  const points = handGhostPoints(0.55);
  const tip = points[PINCH_FINGERS[finger].tip];
  const k = unit(p);
  const towards = (index: number, share: number): [number, number] => [points[index][0] + (tip[0] - points[index][0]) * share, points[index][1] + (tip[1] - points[index][1]) * share];
  points[4] = towards(4, 0.92 * k);
  points[3] = towards(3, 0.6 * k);
  points[2] = towards(2, 0.25 * k);
  return points;
}

/** A demonstrated step: the finger the thumb meets, whether it is the let-go, and its place in the cycle (for the tray). */
export type PinchStep = { finger: number; letGo: boolean; index: number };

/** The step's circle in the ghost's space: at the fingertip the thumb closes on. */
function ghostCircle(finger: number): [number, number] {
  const points = pinchGhostPoints(finger, 1);
  const tip = points[PINCH_FINGERS[pinchFinger(finger)].tip];
  return [(points[4][0] + tip[0]) / 2, (points[4][1] + tip[1]) / 2];
}

export function pinchGhostTarget(width: number, height: number, step: PinchStep) {
  const s = Math.min(width / 300, height / 270);
  const [x, y] = ghostCircle(step.finger);
  return { x: (width - 300 * s) / 2 + x * s, y: (height - 270 * s) / 2 + y * s, radius: GHOST_RADIUS * s * (step.letGo ? 1.35 : 1) };
}

/** The simulated patient is on target at the end of each movement (level 1 is the pinch, 0 apart). */
export function pinchGhostContact(level: number, letGo: boolean): boolean {
  return letGo ? level <= 0.05 : level >= 0.95;
}

const contactAt = (letGo: boolean) => MOVE_MS * (letGo ? 0.6 : 0.92);
export const pinchDemoDuration = (letGo: boolean) => contactAt(letGo) + TARGET_HOLD_MS + TARGET_COMPLETION_MS;

export function pinchDemoState(elapsedMs: number, step: PinchStep, armed = true) {
  const elapsed = armed ? Math.max(0, elapsedMs) : 0;
  const reached = contactAt(step.letGo);
  const contact = armed && elapsed >= reached;
  const progress = contact ? unit((elapsed - reached) / TARGET_HOLD_MS) : 0;
  const completionElapsedMs = elapsed - reached - TARGET_HOLD_MS;
  const phase = !armed ? "waiting" : !contact ? "move" : progress < 1 ? "hold" : "complete";
  const k = smooth(unit(elapsed / MOVE_MS));
  const pose = step.letGo ? 1 - k : k;
  const target = ghostCircle(step.finger);
  const label = step.letGo ? "Let go" : "Pinch";
  const finger = PINCH_FINGERS[pinchFinger(step.finger)].name;
  const instruction = !armed ? "Listen to the instruction. The circle will become active when the voice finishes."
    : phase === "complete" ? `${label} complete`
    : phase === "hold" ? `${step.letGo ? "Hold your fingers open" : "Hold the peg"} · ${Math.round(progress * 100)}%`
    : step.letGo ? "Open your thumb and finger to let the peg go" : `Bring your thumb to your ${finger}, tip to tip`;
  return { pose, target, radius: GHOST_RADIUS, armed, contact, progress, completionElapsedMs, phase, label, instruction };
}

/** The front-on ghost hand pinching a peg, with the tray below. */
export function drawPinchGhost(ctx: CanvasRenderingContext2D, step: PinchStep, p: number, width: number, height: number, colors = { line: "#3c8255", accent: "#e18e6d", soft: "#b9d3c2" }) {
  const s = Math.min(width / 300, height / 270);
  ctx.save();
  ctx.translate((width - 300 * s) / 2, (height - 270 * s) / 2);
  ctx.scale(s, s);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const finger = pinchFinger(step.finger);
  const points = pinchGhostPoints(finger, p);
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
  // The peg between the tips while it is held (pinching it, or in the hand before it is let go).
  const tip = points[PINCH_FINGERS[finger].tip];
  const held = step.letGo ? p > 0.5 : p > 0.85;
  if (held) drawPeg(ctx, (points[4][0] + tip[0]) / 2, (points[4][1] + tip[1]) / 2, 22, true);
  drawPegTray(ctx, 248, 222, 18, pegsDropped(step.index) + (step.letGo && !held ? 1 : 0));
  ctx.restore();
}

export function drawPinchDemo(ctx: CanvasRenderingContext2D, elapsedMs: number, step: PinchStep, width: number, height: number, now: number, reducedMotion = false, armed = true) {
  const state = pinchDemoState(elapsedMs, step, armed);
  ctx.clearRect(0, 0, width, height);
  drawPinchGhost(ctx, step, state.pose, width, height);
  const { x, y, radius } = pinchGhostTarget(width, height, step);
  if (state.phase === "complete") drawTargetCompletion(ctx, { x, y, radius, elapsed: Math.min(state.completionElapsedMs, TARGET_COMPLETION_MS - 1), now, reducedMotion: reducedMotion || state.completionElapsedMs >= TARGET_COMPLETION_MS });
  else drawTestingTarget(ctx, { x, y, radius, armed, contact: state.contact, progress: state.progress, now, reducedMotion });
  ctx.save();
  ctx.font = "600 12px Manrope, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = state.contact ? "#285b49" : "#a14d32";
  ctx.fillText(state.phase === "complete" ? "Complete" : state.label, x, y - radius - 10);
  ctx.restore();
}

/** Where the tray sits on the camera view: just below the shaded area, kept inside the picture (raw image coordinates). */
export function trayPoint(zone: HandZone): P2 & { size: number } {
  return { x: (zone.x0 + zone.x1) / 2, y: Math.min(0.93, zone.y1 + 0.75 * zone.palm), size: Math.max(0.035, 0.32 * zone.palm) };
}
