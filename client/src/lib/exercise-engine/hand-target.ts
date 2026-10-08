import type { Side } from "./config";
import { fingerExtension, handVisible, inView, poseFrameValues, poseJoints, type Frame, type Geo, type HandInput, type PoseInput, type Pt } from "./metrics";
import { TARGET_COMPLETION_MS, TARGET_HOLD_MS } from "./target-timing";
import { drawTargetCompletion, drawTestingTarget } from "./target-visual";
import { chooseHand } from "./tracker";

// Active Hand Opening, set up palm to the camera: the elbow rests on an armrest or table and the hand is up beside the
// body at chest height. MediaPipe hand landmarks: wrist 0; thumb 1-4; index 5-8; middle 9-12; ring 13-16; little 17-20.

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const times = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const size = (a: V) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): V => { const n = size(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const vec = (p: Pt): V => [p.x, p.y, p.z];
const DEG = 180 / Math.PI;
const finite = (...values: (number | undefined)[]) => values.every(value => typeof value === "number" && Number.isFinite(value));

const TIPS = [8, 12, 16, 20];
const PALM = [0, 5, 9, 13, 17];

// ---------- the palm's orientation: wrist bend and palm turn ----------

/**
 * The palm's axes from the 3D hand landmarks (smaller z is nearer the camera, as MediaPipe documents):
 * a = wrist to middle knuckle, b = little to index knuckle (made square to a), n = the palm's face, pointed
 * toward the camera. Opening the fingers barely moves these points, so the axes follow the wrist and forearm.
 */
export function palmAxes(hand: HandInput | null): { a: V; b: V; n: V } | null {
  const w = hand?.world;
  if (!w || PALM.some(index => !w[index] || !finite(w[index].x, w[index].y, w[index].z))) return null;
  const a = unit(sub(vec(w[9]), vec(w[0])));
  const across = unit(sub(vec(w[5]), vec(w[17])));
  const b = unit(sub(across, times(a, dot(across, a))));
  let n = unit(cross(a, b));
  if (n[2] > 0) n = times(n, -1);
  return { a, b, n };
}

/** Palm axes as scalars, so the set-up reference (a median of Geo snapshots) learns the relaxed hand. */
export function palmGeo(hand: HandInput | null): Partial<Geo> {
  const axes = palmAxes(hand);
  if (!axes) return {};
  return { palmAx: axes.a[0], palmAy: axes.a[1], palmAz: axes.a[2], palmBx: axes.b[0], palmBy: axes.b[1], palmBz: axes.b[2] };
}

/**
 * How squarely the palm faces the camera: 1 straight on, 0 edge-on. Given the side, it is signed: the palm's
 * own side comes from the hand's chirality in the raw camera image (a right palm's normal is (little to index)
 * x (wrist to knuckle) reversed), so the back of the hand, or the other hand, reads negative. Checked on a real
 * recording: a raised right palm +0.95, the right hand resting palm-down on the lap -0.4.
 */
export function palmFacing(hand: HandInput | null, side?: Side): number {
  const axes = palmAxes(hand);
  if (!axes) return 0;
  if (!side) return Math.max(0, -axes.n[2]);
  const raw = cross(axes.a, axes.b);
  return side === "right" ? raw[2] : -raw[2];
}

/**
 * Wrist bend and palm turn against the relaxed hand learned at set-up:
 * - wrist_flexion_deg: the knuckles tipping toward the camera, the palm's side (wrist flexion, which lets the
 *   fingers open passively: tenodesis). Bending the other way (extension) is not counted.
 * - forearm_turn_deg: the palm turning about its long axis, away from facing the camera (forearm rotation). A palm
 *   turned to face the camera more squarely than at set-up is not turning away, so it counts as no turn.
 */
export function handTurnComps(hand: HandInput | null, ref: Geo | null): { wrist_flexion_deg?: number; forearm_turn_deg?: number } {
  const axes = palmAxes(hand);
  if (!axes || !ref || !finite(ref.palmAx, ref.palmAy, ref.palmAz, ref.palmBx, ref.palmBy, ref.palmBz)) return {};
  const a0 = unit([ref.palmAx!, ref.palmAy!, ref.palmAz!]);
  const across0 = unit([ref.palmBx!, ref.palmBy!, ref.palmBz!]);
  const b0 = unit(sub(across0, times(a0, dot(across0, a0))));
  let n0 = unit(cross(a0, b0));
  if (n0[2] > 0) n0 = times(n0, -1);
  const squarer = -axes.n[2] >= -n0[2];
  return {
    wrist_flexion_deg: Math.max(0, Math.atan2(dot(axes.a, n0), dot(axes.a, a0)) * DEG),
    forearm_turn_deg: squarer ? 0 : Math.abs(Math.atan2(dot(axes.b, n0), dot(axes.b, b0)) * DEG),
  };
}

// ---------- how open the hand is, and the rings ----------

/** Image points with x scaled by the frame's aspect ratio, so distances are in frame heights. */
const flat = (p: Pt, aspect: number): [number, number] => [p.x * aspect, p.y];
/** Palm segments; the one lying flattest to the camera shows the hand's true size in the image. */
const PALM_SEGMENTS: [number, number][] = [[0, 5], [0, 9], [0, 13], [0, 17], [5, 17]];

/**
 * The palm's centre (normalized image coordinates) and its length as it would look facing the camera, in frame
 * heights. A tilted palm looks shorter in the image, so the size comes from the 3D landmarks (wrist to middle
 * knuckle) times the image scale of the least foreshortened palm segment.
 */
export function palmRing(hand: HandInput | null, aspect: number): { x: number; y: number; scale: number } | null {
  const p = hand?.landmarks, w = hand?.world;
  if (!p || !w || PALM.some(index => !p[index] || !w[index])) return null;
  const centre = PALM.reduce((sum, index) => [sum[0] + flat(p[index], aspect)[0] / PALM.length, sum[1] + flat(p[index], aspect)[1] / PALM.length], [0, 0]);
  const perMetre = Math.max(...PALM_SEGMENTS.map(([a, b]) => {
    const [ax, ay] = flat(p[a], aspect), [bx, by] = flat(p[b], aspect);
    const metres = size(sub(vec(w[a]), vec(w[b])));
    return metres > 0.005 ? Math.hypot(ax - bx, ay - by) / metres : 0;
  }));
  const scale = perMetre * size(sub(vec(w[9]), vec(w[0])));
  return scale > 0.005 ? { x: centre[0] / aspect, y: centre[1], scale } : null;
}

/**
 * How open the hand is: the four fingertips' mean distance from the palm's centre within the palm's own plane,
 * in palm lengths, from the 3D hand landmarks. It reads as a straight-on view of the palm would, however the hand
 * is tilted, so a palm-up hand on the lap cannot look open, and fingers curling out of the palm read as closed.
 * Measured on a real recording: a closed hand 0.2-0.25, a relaxed hand 0.45-0.7, an open hand about 1.0. A ring
 * around the palm at that distance is the target the fingertips reach.
 */
export function handOpenness(hand: HandInput | null): number | undefined {
  const w = hand?.world;
  const axes = palmAxes(hand);
  if (!w || !axes || TIPS.some(index => !w[index] || !finite(w[index].x, w[index].y, w[index].z))) return undefined;
  const centre = times(PALM.reduce((sum, index) => add(sum, vec(w[index])), [0, 0, 0] as V), 1 / PALM.length);
  const palm = size(sub(vec(w[9]), vec(w[0])));
  if (palm < 0.01) return undefined;
  return TIPS.reduce((sum, index) => { const d = sub(vec(w[index]), centre); return sum + Math.hypot(dot(d, axes.a), dot(d, axes.b)); }, 0) / TIPS.length / palm;
}

/** A comfortably open hand, in palm lengths (about 1.0 measured): the practice ring sits part of the way toward it. */
export const HAND_OPEN_TYPICAL = 1.05;
/** The most open a resting hand may be at set-up: above this the fingers are already opening (an open palm is about 1.0). */
export const REST_OPEN_MAX = 0.8;
/** The practice ring: this share of the way from the relaxed hand to a typical open hand (at least 0.25 palm lengths of room). */
export const PRACTICE_RING_SHARE = 0.3;
/** Scored rings sit just inside the opening held at the practice ring. */
export const LEARNED_RING_SHARE = 0.95;
/** The relax circle: the fingertips come back within this share of the way from the relaxed hand to the ring. */
export const RELAX_RING_SHARE = 0.35;

/** Openness of the ring the fingertips reach: the practice ring, or the opening learned there. */
export function openRing(rest: number, learned?: number): number {
  if (learned !== undefined && Number.isFinite(learned)) return Math.max(rest + 0.05, learned * LEARNED_RING_SHARE);
  return rest + PRACTICE_RING_SHARE * Math.max(0.25, HAND_OPEN_TYPICAL - rest);
}

/** Openness of the relax circle the fingertips come back into. */
export const relaxRing = (rest: number, ring: number) => rest + RELAX_RING_SHARE * (ring - rest);

/**
 * This step's rings (openness, in palm lengths) and whether the fingertips are on target: out at the ring while
 * opening, back inside the relax circle while relaxing. progress: how far toward the ring the hand has opened.
 */
export function handRingTarget(openness: number, rest: number, learned: number | undefined, returning: boolean) {
  const ring = openRing(rest, learned);
  const relax = relaxRing(rest, ring);
  const contact = returning ? openness <= relax : openness >= ring;
  return { ring, relax, contact, progress: Math.max(0, Math.min(1, (openness - rest) / Math.max(0.05, ring - rest))) };
}

/** How squarely the palm must face the camera to start a step (1 straight on; 0.6 is about 50 degrees off)... */
export const READY_FACING = 0.6;
/** ...or nearly as squarely as at set-up, for a forearm that cannot turn that far (set-up itself accepts 0.5). */
const READY_FACING_SLACK = 0.1;
/** Once a step has started, the hand stays "placed" until the palm faces the camera this much less squarely. */
const PLACED_FACING_DROP = 0.2;
/** A step starts with the wrist and palm close to the set-up hand: under the wrist-bend and palm-turn checks' thresholds. */
const START_BEND_MAX = 18, START_TURN_MAX = 25;

/** How squarely the set-up (reference) palm faced the camera, signed as palmFacing is. */
export function referenceFacing(ref: Geo | null, side: Side): number | undefined {
  if (!ref || !finite(ref.palmAx, ref.palmAy, ref.palmAz, ref.palmBx, ref.palmBy, ref.palmBz)) return undefined;
  const a = unit([ref.palmAx!, ref.palmAy!, ref.palmAz!]);
  const across = unit([ref.palmBx!, ref.palmBy!, ref.palmBz!]);
  const raw = cross(a, unit(sub(across, times(a, dot(across, a)))));
  return side === "right" ? raw[2] : -raw[2];
}

export type HandReadiness = { ready: boolean; placed: boolean; hint?: string; almost?: boolean };

/**
 * Whether the hand is ready to start a step (ready: in the shaded area, palm to the camera, wrist and palm close
 * to the set-up hand, fingers relaxed up to startLimit, not covering the face or a shoulder), whether it is still
 * placed once the step is under way (placed: looser, so a flicker cannot pause it), and what to fix first, in the
 * patient's words. almost: ready but for the wrist, the palm's turn or fingers not yet relaxed (well short of the
 * ring): the session waives these after a while, so nobody waits for ever.
 */
export function handReady(hand: HandInput | null, zone: HandZone | null, aspect: number, side: Side, options: { startLimit?: number; waiveLimit?: number; covering?: "face" | "shoulder" | null; ref?: Geo | null } = {}): HandReadiness {
  if (!hand) return { ready: false, placed: false, hint: `Hold your ${side} hand up in the shaded area with your palm facing the camera.` };
  const view = handVisible(hand);
  if (!view.ok) return { ready: false, placed: false, hint: view.missing };
  const centre = palmRing(hand, aspect), facing = palmFacing(hand, side);
  const setupFacing = referenceFacing(options.ref ?? null, side);
  const facingMin = Math.min(READY_FACING, setupFacing === undefined ? READY_FACING : setupFacing - READY_FACING_SLACK);
  const placed = (!zone || inHandZone(centre, zone, aspect, 1)) && facing >= facingMin - PLACED_FACING_DROP;
  if (zone && !inHandZone(centre, zone, aspect)) return { ready: false, placed, hint: "Bring your hand into the shaded area." };
  if (options.covering) return { ready: false, placed, hint: `Move your hand a little further out, away from your ${options.covering}.` };
  if (facing < facingMin) return { ready: false, placed, hint: "Turn your palm to face the camera." };
  const openness = handOpenness(hand) ?? 0;
  // "Almost" (waived after a while) only for a hand still well short of the ring, so it cannot reach it without moving.
  const short = options.startLimit === undefined || openness <= (options.waiveLimit ?? Infinity);
  // Relative to the set-up hand: a palm turned further away than then, or a wrist bent further than then.
  const turn = handTurnComps(hand, options.ref ?? null);
  if ((turn.forearm_turn_deg ?? 0) >= START_TURN_MAX) return { ready: false, placed, almost: short, hint: "Turn your palm to face the camera." };
  if ((turn.wrist_flexion_deg ?? 0) >= START_BEND_MAX) return { ready: false, placed, almost: short, hint: "Hold your wrist as you did at the start." };
  if (options.startLimit !== undefined && openness > options.startLimit) return { ready: false, placed, almost: short, hint: "Let your fingers relax first." };
  return { ready: true, placed };
}

/**
 * Each repetition starts from a relaxed hand: at most as open as the close circle, and at least a little above
 * the resting hand (which set-up learns gently curled, so a hand simply relaxed is more open than that), but
 * always well inside the ring, so a hand passed as ready still has to open to reach it.
 */
export const startLimit = (rest: number, learned?: number) => {
  const ring = openRing(rest, learned);
  return Math.min(Math.max(relaxRing(rest, ring), rest + 0.12), rest + 0.6 * (ring - rest));
};
/** The most open a hand may be for the start to be waived after a while: halfway from the start limit to the ring. */
export const waiveLimit = (rest: number, learned?: number) => (startLimit(rest, learned) + openRing(rest, learned)) / 2;

/**
 * Whether any point of the hand hides the face (eyes to mouth) or a shoulder, whose landmarks the posture checks
 * need: a circle of 0.18 shoulder widths around each shoulder and an ellipse around the nose.
 */
export function handCovers(hand: HandInput | null, pose: PoseInput | null, side: Side, aspect: number): "face" | "shoulder" | null {
  const landmarks = pose?.landmarks, joints = poseJoints(side);
  const shoulder = landmarks?.[joints.shoulder], other = landmarks?.[joints.shoulderOther], nose = landmarks?.[joints.nose];
  if (!hand || !shoulder || !other) return null;
  const width = Math.hypot((shoulder.x - other.x) * aspect, shoulder.y - other.y);
  const near = (p: Pt, q: Pt) => Math.hypot((p.x - q.x) * aspect, p.y - q.y) < 0.18 * width;
  if (hand.landmarks.some(p => near(p, shoulder) || near(p, other))) return "shoulder";
  if (nose && hand.landmarks.some(p => ((p.x - nose.x) * aspect / (0.3 * width)) ** 2 + ((p.y - nose.y) / (0.4 * width)) ** 2 < 1)) return "face";
  return null;
}

/**
 * Whether the hand, once open, would reach into a shoulder's circle: the palm's centre is closer to a shoulder than
 * that circle plus an open hand's reach (the abducted thumb reaches about 0.9 palm lengths from the centre).
 */
export function handNearShoulder(hand: HandInput | null, pose: PoseInput | null, side: Side, aspect: number): boolean {
  const landmarks = pose?.landmarks, joints = poseJoints(side);
  const shoulder = landmarks?.[joints.shoulder], other = landmarks?.[joints.shoulderOther];
  const palm = palmRing(hand, aspect);
  if (!palm || !shoulder || !other) return false;
  const width = Math.hypot((shoulder.x - other.x) * aspect, shoulder.y - other.y);
  const reach = 0.18 * width + 0.9 * palm.scale;
  return [shoulder, other].some(q => Math.hypot((palm.x - q.x) * aspect, palm.y - q.y) < reach);
}

/**
 * The resting hand at set-up, in the shape the seated exercises use for the lap: where the wrist rests and
 * how big the hand is (its palm length), or what to fix first. The hand must be in the shaded area with its
 * palm to the camera and its fingers relaxed, not already open (an open palm learned as "relaxed" made opening
 * impossible to detect).
 */
export function handRest(hand: HandInput | null, aspect: number, side: Side, faceAndShoulders: boolean, zone: HandZone | null = null): { lapRest?: { x: number; y: number; bodyScale: number }; lapMissing?: string } {
  if (!hand) return { lapMissing: `Hold your ${side} hand up in the shaded area with your palm facing the camera.` };
  if ([4, ...TIPS].some(index => { const p = hand.landmarks[index]; return !p || p.x < 0.01 || p.x > 0.99 || p.y < 0.01 || p.y > 0.99; })) return { lapMissing: "Move your hand back a little so I can see every fingertip." };
  if (!faceAndShoulders) return { lapMissing: "Keep your face and both shoulders in view." };
  const ring = palmRing(hand, aspect);
  if (zone && !inHandZone(ring, zone, aspect)) return { lapMissing: "Bring your hand into the shaded area." };
  if (palmFacing(hand, side) < 0.5) return { lapMissing: "Turn your palm to face the camera." };
  if ((handOpenness(hand) ?? 0) > REST_OPEN_MAX) return { lapMissing: "Let your fingers relax and curl gently. Don't open your hand yet." };
  return ring ? { lapRest: { x: hand.landmarks[0].x, y: hand.landmarks[0].y, bodyScale: ring.scale } } : { lapMissing: "Hold your hand toward the camera so I can see every finger." };
}

// ---------- where the hand is held: the shaded area ----------

/** Palm length as a share of the shoulder width (a real recording: about 0.3). */
const ZONE_PALM = 0.3;
/** The palm's centre sits between these distances out from the affected shoulder, in shoulder widths... */
const ZONE_INNER = 0.48, ZONE_OUTER = 1.05;
/** ...and from just below the shoulder line to chest height (less load on a weak shoulder; the open fingers stay below it). */
const ZONE_TOP = 0.15, ZONE_BOTTOM = 0.85;
/** Where beside the shoulder does not fit: in front of the chest, from 0.2 in to 0.6 out and 0.6 to 1.15 below the shoulder. */
const ZONE_CHEST_INNER = 0.2, ZONE_CHEST_OUTER = 0.6, ZONE_CHEST_ABOVE = 0.6, ZONE_CHEST_BELOW = 1.15;

/**
 * The shaded area: where the palm's centre should be so the open hand covers neither the face nor a shoulder.
 * It sits out beside the body on the affected side at chest height (where the hand is with the elbow on an armrest,
 * or on the table out to the side), from just below the shoulder line down, kept far enough inside the frame for
 * the open fingers. Normalized image coordinates (x in frame widths, y in frame heights); palm is the expected palm
 * length in frame heights. tight: the frame edge leaves too little room beside the shoulder.
 */
export type HandZone = { x0: number; x1: number; y0: number; y1: number; palm: number; tight: boolean; hint?: string };

/** Shoulders wider than this share of the frame height: the patient is too close for the shaded area to fit. */
const ZONE_TOO_CLOSE = 0.5;

export function handZone(pose: PoseInput | null, side: Side, aspect: number): HandZone | null {
  const landmarks = pose?.landmarks;
  const joints = poseJoints(side);
  const shoulder = landmarks?.[joints.shoulder], other = landmarks?.[joints.shoulderOther];
  if (!shoulder || !other || !inView(shoulder) || !inView(other)) return null;
  const sx = shoulder.x * aspect, width = Math.abs(sx - other.x * aspect);
  if (width < 0.05) return null;
  const out = Math.sign(shoulder.x - other.x);
  const palm = ZONE_PALM * width;
  const lo = 0.8 * palm, hi = aspect - 0.8 * palm, sliver = 0.05 * width;
  const fit = (inner: number, outer: number, above: number, below: number) => {
    const [a, b] = [sx + out * inner * width, sx + out * outer * width];
    const x0 = Math.max(Math.min(a, b), lo), x1 = Math.min(Math.max(a, b), hi);
    const y0 = Math.max(shoulder.y + above * width, 1.3 * palm), y1 = Math.min(shoulder.y + below * width, 1 - 0.9 * palm);
    const room = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    const shortY = y1 - y0 < 0.3 * width;
    const tight = x1 - x0 < 0.2 * width || shortY;
    // With no room at all, a sliver at the inner edge (nearest the shoulder), kept inside the frame, still shows
    // where the hand should go.
    const inside = Math.min(Math.max(a, lo + sliver), hi - sliver);
    const [left, right] = x1 > x0 ? [x0, x1] : [inside - sliver, inside + sliver];
    const top = Math.min(y0, 1 - 2 * sliver), bottom = Math.max(Math.min(y1, 1 - sliver), top + sliver);
    return { zone: { x0: left / aspect, x1: right / aspect, y0: top, y1: bottom, palm, tight } as HandZone, room, shortY };
  };
  const beside = fit(ZONE_INNER, ZONE_OUTER, ZONE_TOP, ZONE_BOTTOM);
  if (!beside.zone.tight) return beside.zone;
  // No room beside the shoulder (the camera close, or sitting off-centre): in front of the chest on the affected
  // side instead, low enough that the open fingers stay clear of the shoulder.
  const chest = fit(-ZONE_CHEST_INNER, ZONE_CHEST_OUTER, ZONE_CHEST_ABOVE, ZONE_CHEST_BELOW);
  if (!chest.zone.tight) return chest.zone;
  // Neither fits well: the one with more room, and what to change so it fits.
  const best = chest.room > beside.room ? chest : beside;
  const hint = width > ZONE_TOO_CLOSE ? "Sit back a little, or move the camera back, so the shaded area fits."
    : best.shortY ? "Tilt the camera down a little, or lower it, so your chest is in view."
    : "Move a little toward the middle of the camera so the shaded area fits beside you.";
  return { ...best.zone, hint };
}

/** The shaded area follows the body steadily during set-up: each new estimate moves it this share of the way. */
export function followZone(last: HandZone | null, next: HandZone | null, share = 0.2): HandZone | null {
  if (!next) return last;
  if (!last) return next;
  const mix = (a: number, b: number) => a + (b - a) * share;
  return { x0: mix(last.x0, next.x0), x1: mix(last.x1, next.x1), y0: mix(last.y0, next.y0), y1: mix(last.y1, next.y1), palm: mix(last.palm, next.palm), tight: next.tight, hint: next.hint };
}

/**
 * Draw the shaded area on the mirrored camera view. Emphasised (set-up, and before each step starts) it shows a
 * faint outline of a hand, palm to the camera, and a label; once the palm is there it turns solid green. During
 * the movement it stays as a faint reminder of where to keep the hand.
 */
export function drawHandZone(ctx: CanvasRenderingContext2D, zone: HandZone, width: number, height: number, state: { emphasis: boolean; ready: boolean; side: Side; now: number; reducedMotion: boolean }) {
  const pad = 0.6 * zone.palm * height;
  const xs = [(1 - zone.x0) * width, (1 - zone.x1) * width];
  const left = Math.min(...xs) - pad, right = Math.max(...xs) + pad;
  const top = zone.y0 * height - 1.6 * pad, bottom = zone.y1 * height + pad;
  const radius = Math.min(24, (right - left) / 4);
  const pulse = state.reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(state.now / 450);
  ctx.save();
  ctx.beginPath();
  // roundRect is missing from some browsers still in use (Firefox before 112): a plain rectangle there.
  if (typeof ctx.roundRect === "function") ctx.roundRect(left, top, right - left, bottom - top, radius);
  else ctx.rect(left, top, right - left, bottom - top);
  ctx.fillStyle = state.ready ? "rgba(127,229,163,.22)" : `rgba(255,254,250,${state.emphasis ? 0.18 * pulse : 0.07})`;
  ctx.fill();
  ctx.lineWidth = Math.max(2, width / 320);
  ctx.setLineDash(state.ready ? [] : [10, 8]);
  ctx.strokeStyle = state.ready ? "rgba(127,229,163,.95)" : `rgba(255,254,250,${state.emphasis ? 0.9 : 0.35})`;
  ctx.stroke();
  ctx.setLineDash([]);
  if (state.emphasis) {
    if (!state.ready) {
      // A faint hand, palm to the camera, where the patient's hand goes (mirrored like the video).
      const points = handGhostPoints(0.35), palm = ghostPalm();
      const scale = (zone.palm * height) / palm.scale;
      const cx = (left + right) / 2, cy = (top + bottom) / 2 + 0.2 * pad;
      const flip = state.side === "right" ? -1 : 1;
      const at = (p: [number, number]): [number, number] => [cx + flip * (p[0] - palm.x) * scale, cy + (p[1] - palm.y) * scale];
      ctx.strokeStyle = `rgba(255,254,250,${0.75 * pulse})`;
      ctx.lineWidth = Math.max(2, zone.palm * height * 0.09);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const chain of [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [0, 17, 18, 19, 20], [5, 9, 13, 17]]) {
        ctx.beginPath();
        chain.forEach((index, i) => { const [x, y] = at(points[index]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.stroke();
      }
    }
    ctx.font = `700 ${Math.max(13, Math.round(height / 34))}px Manrope, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = state.ready ? "#7fe5a3" : "#fffefa";
    ctx.shadowColor = "rgba(0,0,0,.55)";
    ctx.shadowBlur = 6;
    ctx.fillText(state.ready ? "✓ Palm ready" : "Hand here, palm to camera", (left + right) / 2, top - 10);
  }
  ctx.restore();
}

/** "Open" or "Close" beside the ring on the camera view, so each step reads at a glance. */
export function drawRingLabel(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, text: string, height: number, active: boolean) {
  ctx.save();
  ctx.font = `800 ${Math.max(14, Math.round(height / 28))}px Manrope, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = active ? "#fffefa" : "rgba(255,254,250,.7)";
  ctx.shadowColor = "rgba(0,0,0,.6)";
  ctx.shadowBlur = 6;
  ctx.fillText(text, x, y - radius - 12);
  ctx.restore();
}

/** Whether the palm's centre is in the shaded area, allowing a little slack (a share of a palm length) around it. */
export function inHandZone(point: { x: number; y: number } | null, zone: HandZone | null, aspect: number, slack = 0.5): boolean {
  if (!point || !zone) return false;
  const x = point.x * aspect, pad = slack * zone.palm;
  return x >= zone.x0 * aspect - pad && x <= zone.x1 * aspect + pad && point.y >= zone.y0 - pad && point.y <= zone.y1 + pad;
}

/**
 * The affected hand: of the hands on the affected side of the body's midline, the one nearest the affected
 * wrist. The other hand resting on the lap is never used.
 */
export function affectedHand(det: { pose: PoseInput | null; hands: HandInput[] }, side: Side): HandInput | null {
  const landmarks = det.pose?.landmarks;
  const joints = poseJoints(side);
  const shoulder = landmarks?.[joints.shoulder], other = landmarks?.[joints.shoulderOther];
  const hands = shoulder && other && inView(shoulder) && inView(other)
    ? det.hands.filter(hand => (hand.landmarks[0].x - (shoulder.x + other.x) / 2) * (shoulder.x - other.x) > 0)
    : det.hands;
  return chooseHand(hands, landmarks?.[joints.wrist]);
}

/**
 * One camera frame. The hand model measures the fingers and the palm's turn; the body model checks only the
 * trunk and shoulders, so the arm and hips (often behind the table) need not be in view. Set-up learns the
 * resting hand once the hand is relaxed in the shaded area and the face and both shoulders are seen; each step
 * starts once the hand is ready there (ready / readyHint).
 */
export function handOpenFrame(det: { pose: PoseInput | null; hands: HandInput[] }, side: Side, t: number, aspect: number, ref: Geo | null, options: { zone?: HandZone | null; startLimit?: number; waiveLimit?: number } = {}): Frame {
  const joints = poseJoints(side);
  const landmarks = det.pose?.landmarks;
  const hand = affectedHand(det, side);
  const body = det.pose ? poseFrameValues(det.pose, side, ref) : null;
  const covering = handCovers(hand, det.pose, side, aspect);
  // Readiness also keeps the hand far enough from a shoulder that the opening fingers will not reach it.
  const crowding = covering ?? (handNearShoulder(hand, det.pose, side, aspect) ? "shoulder" : null);
  const values: Frame["values"] = hand ? { finger_extension: fingerExtension(hand), hand_openness: handOpenness(hand) } : {};
  // A hand hiding the face or a shoulder leaves the trunk and shoulder checks unmeasured rather than misread.
  const comps: Frame["comps"] = { ...handTurnComps(hand, ref), trunk_approach_pct: covering ? undefined : body?.comps.trunk_approach_pct, shoulder_hike_rel_delta: covering ? undefined : body?.comps.shoulder_hike_rel_delta };
  const view = handVisible(hand);
  const faceAndShoulders = [joints.nose, joints.shoulder, joints.shoulderOther].every(index => inView(landmarks?.[index]));
  const zone = options.zone ?? null;
  const ready = handReady(hand, zone, aspect, side, { startLimit: options.startLimit, waiveLimit: options.waiveLimit, covering: crowding, ref });
  // Set-up never learns from frames where the hand hides (or, opening, would hide) a shoulder or the face.
  const rest = crowding && hand ? { lapMissing: `Move your hand a little further out, away from your ${crowding}.` } : handRest(hand, aspect, side, faceAndShoulders, zone);
  return {
    t, values, comps, visible: view.ok, missing: view.missing, geo: body?.geo ? { ...body.geo, ...palmGeo(hand) } : undefined,
    ready: ready.ready, placed: ready.placed, readyAlmost: ready.almost, readyHint: ready.hint, ...rest,
  };
}

// ---------- a simulated hand (tests, the demonstration and the no-camera simulator) ----------

export type SimulatedHand = {
  /** 0 = fingers relaxed, 1 = fully open. */
  open?: number;
  /** Fingers curled into a fist instead (overrides open). */
  fist?: boolean;
  /** Wrist flexion: the knuckles tip toward the camera (degrees; negative is extension). */
  wristFlexDeg?: number;
  /** Forearm rotation: the palm turns about its long axis (degrees). */
  forearmTurnDeg?: number;
  side?: Side;
  /** Wrist position from the camera, metres (x right, y down, z away from the camera). */
  at?: V;
};

// Knuckle positions along the palm (u, toward the fingers) and across it (v, toward the thumb), metres; phalanx
// lengths; and how far each finger fans out when open (degrees).
const FINGERS: { mcp: [number, number]; len: [number, number, number]; spread: number }[] = [
  { mcp: [0.082, 0.026], len: [0.040, 0.024, 0.019], spread: 9 },
  { mcp: [0.088, 0.006], len: [0.045, 0.028, 0.021], spread: 1 },
  { mcp: [0.083, -0.014], len: [0.042, 0.026, 0.020], spread: -7 },
  { mcp: [0.074, -0.032], len: [0.033, 0.020, 0.018], spread: -15 },
];
const RELAXED_FLEX = [30, 70, 45];
const FIST_FLEX = [85, 100, 70];
const THUMB_OPEN: V[] = [[0.022, 0.024, 0.012], [0.040, 0.046, 0.018], [0.055, 0.062, 0.02], [0.068, 0.075, 0.02]];
const THUMB_RELAXED: V[] = [[0.022, 0.024, 0.012], [0.040, 0.04, 0.025], [0.052, 0.04, 0.035], [0.062, 0.03, 0.04]];
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** The hand in its own frame: u along the palm, v across it toward the thumb, w out of the palm. */
function handLocal(open: number, fist: boolean): V[] {
  const points: V[] = new Array(21);
  points[0] = [0, 0, 0];
  const flexion = fist ? FIST_FLEX : RELAXED_FLEX.map(angle => angle * (1 - open));
  FINGERS.forEach((finger, f) => {
    const spread = finger.spread * (fist ? 0.2 : 0.4 + 0.6 * open) / DEG;
    let point: V = [finger.mcp[0], finger.mcp[1], 0];
    points[5 + 4 * f] = point;
    let bend = 0;
    finger.len.forEach((length, joint) => {
      bend += flexion[joint] / DEG;
      point = add(point, times([Math.cos(spread) * Math.cos(bend), Math.sin(spread) * Math.cos(bend), Math.sin(bend)], length));
      points[6 + 4 * f + joint] = point;
    });
  });
  THUMB_OPEN.forEach((joint, index) => { points[1 + index] = fist ? THUMB_RELAXED[index] : [lerp(THUMB_RELAXED[index][0], joint[0], open), lerp(THUMB_RELAXED[index][1], joint[1], open), lerp(THUMB_RELAXED[index][2], joint[2], open)]; });
  return points;
}

/** The simulated hand's 3D points seen from the camera (metres), palm to the camera, fingers up. */
function handCamera(sim: SimulatedHand): V[] {
  const open = Math.max(0, Math.min(1, sim.open ?? 0));
  const side = sim.side ?? "right";
  // The raw (unmirrored) camera image shows the patient's right hand with its thumb toward the image right.
  let u: V = [0, -1, 0], v: V = [side === "right" ? 1 : -1, 0, 0], w: V = [0, 0, -1];
  const turn = (sim.forearmTurnDeg ?? 0) / DEG;
  [v, w] = [add(times(v, Math.cos(turn)), times(w, Math.sin(turn))), add(times(w, Math.cos(turn)), times(v, -Math.sin(turn)))];
  const flexion = (sim.wristFlexDeg ?? 0) / DEG;
  [u, w] = [add(times(u, Math.cos(flexion)), times(w, Math.sin(flexion))), add(times(w, Math.cos(flexion)), times(u, -Math.sin(flexion)))];
  const at = sim.at ?? [0.04, 0.06, 0.55];
  return handLocal(open, Boolean(sim.fist)).map(p => add(at, add(add(times(u, p[0]), times(v, p[1])), times(w, p[2]))));
}

/** MediaPipe-style hand landmarks (image and world) for a simulated hand, seen by a 4:3 front camera. */
export function simulatedHand(sim: SimulatedHand = {}): HandInput {
  const points = handCamera(sim);
  const wristZ = points[0][2];
  const centre = times(points.reduce((sum, p) => add(sum, p), [0, 0, 0] as V), 1 / points.length);
  return {
    // Focal length 0.75 frame widths; y is in frame heights (4:3, so 4/3 as many as widths).
    landmarks: points.map(([x, y, z]) => ({ x: 0.5 + 0.75 * x / z, y: 0.5 + 0.75 * (4 / 3) * y / z, z: 0.75 * (z - wristZ) / wristZ, visibility: 1 })),
    world: points.map(p => { const q = sub(p, centre); return { x: q[0], y: q[1], z: q[2], visibility: 1 }; }),
  };
}

// ---------- the ghost hand (demonstration and simulator), drawn front-on in a 300 x 270 space ----------

const GHOST_WRIST: [number, number] = [150, 236];
const GHOST_SCALE = 880;

/** The ghost hand's 21 points: the simulated hand seen straight on, wrist at the bottom. */
export function handGhostPoints(open: number): [number, number][] {
  return handLocal(Math.max(0, Math.min(1, open)), false).map(([u, v]) => [GHOST_WRIST[0] + v * GHOST_SCALE, GHOST_WRIST[1] - u * GHOST_SCALE]);
}

/** Openness of the ghost hand, on the same scale as the camera's (palm lengths). */
export function ghostOpenness(open: number): number {
  return handOpenness(ghostAsHand(open))!;
}

function ghostAsHand(open: number): HandInput {
  const landmarks = handGhostPoints(open).map(([x, y]) => ({ x: x / 300, y: y / 300, z: 0, visibility: 1 }));
  return { landmarks, world: landmarks };
}

/** The ghost's palm centre and palm length (300 x 270 space). */
export function ghostPalm(): { x: number; y: number; scale: number } {
  const ring = palmRing(ghostAsHand(0), 1)!;
  return { x: ring.x * 300, y: ring.y * 300, scale: ring.scale * 300 };
}

/** The demonstration's and simulator's rings: the open ring a little inside the ghost's full opening. */
export function ghostRings() {
  const rest = ghostOpenness(0);
  const open = openRing(rest, ghostOpenness(1));
  return { rest, open, relax: relaxRing(rest, open) };
}

/** The simulated patient touches the ring (open step) or comes back inside the relax circle (return step). */
export function handGhostContact(level: number, returning: boolean): boolean {
  const rings = ghostRings();
  const openness = ghostOpenness(level);
  return returning ? openness <= rings.relax : openness >= rings.open;
}

export function drawHandGhost(ctx: CanvasRenderingContext2D, open: number, width: number, height: number, colors = { line: "#3c8255", accent: "#e18e6d", soft: "#b9d3c2" }) {
  const s = Math.min(width / 300, height / 270);
  ctx.save();
  ctx.translate((width - 300 * s) / 2, (height - 270 * s) / 2);
  ctx.scale(s, s);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Table and forearm, elbow resting on the table.
  ctx.strokeStyle = colors.soft;
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(40, 262); ctx.lineTo(260, 262); ctx.stroke();
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 26;
  ctx.beginPath(); ctx.moveTo(GHOST_WRIST[0], 258); ctx.lineTo(GHOST_WRIST[0], GHOST_WRIST[1]); ctx.stroke();
  const p = handGhostPoints(open);
  // Palm.
  ctx.fillStyle = colors.line;
  ctx.beginPath();
  [0, 1, 5, 9, 13, 17].forEach((index, i) => (i ? ctx.lineTo(p[index][0], p[index][1]) : ctx.moveTo(p[index][0], p[index][1])));
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = colors.line; ctx.lineWidth = 12; ctx.stroke();
  // Fingers and thumb.
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 11;
  [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]].forEach(chain => {
    ctx.beginPath();
    chain.forEach((index, i) => (i ? ctx.lineTo(p[index][0], p[index][1]) : ctx.moveTo(p[index][0], p[index][1])));
    ctx.stroke();
  });
  ctx.restore();
}

// ---------- the demonstration: same states, fields and wording pattern as the reach and mouth demos ----------

const MOVE_MS = 1100;
const easeAt = (fraction: number, returning: boolean) => { const smooth = fraction * fraction * (3 - 2 * fraction); return returning ? 1 - smooth : smooth; };
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function contactStart(returning: boolean) {
  let low = 0, high = 1;
  for (let index = 0; index < 24; index++) {
    const middle = (low + high) / 2;
    if (handGhostContact(easeAt(middle, returning), returning)) high = middle; else low = middle;
  }
  return high * MOVE_MS;
}
let contactMs: [number, number] | null = null;
const contactAt = (returning: boolean) => (contactMs ??= [contactStart(false), contactStart(true)])[returning ? 1 : 0];

export const handDemoDuration = (returning: boolean) => contactAt(returning) + TARGET_HOLD_MS + TARGET_COMPLETION_MS;

export function handDemoState(elapsedMs: number, returning: boolean, armed = true) {
  const elapsed = armed ? Math.max(0, elapsedMs) : 0;
  const reached = contactAt(returning);
  const contact = armed && elapsed >= reached;
  const progress = contact ? clamp((elapsed - reached) / TARGET_HOLD_MS) : 0;
  const completionElapsedMs = elapsed - reached - TARGET_HOLD_MS;
  const phase = !armed ? "waiting" : !contact ? "move" : progress < 1 ? "hold" : "complete";
  const pose = easeAt(clamp(elapsed / MOVE_MS), returning);
  const palm = ghostPalm();
  const target: [number, number] = [palm.x, palm.y];
  const radius = (returning ? ghostRings().relax : ghostRings().open) * palm.scale;
  const label = returning ? "Close target" : "Open target";
  const instruction = !armed ? "Listen to the instruction. The circle will become active when the voice finishes."
    : phase === "complete" ? returning ? "Close target complete" : "Target complete — now close your hand"
    : phase === "hold" ? `${returning ? "Hold it closed" : "Hold your hand open"} · ${Math.round(progress * 100)}%`
    : returning ? "Close your hand into the small circle" : "Open your fingers out to the ring, keeping your wrist straight";
  return { pose, target, radius, armed, contact, progress, completionElapsedMs, phase, label, instruction };
}

/** The ring (or relax circle) around the ghost's palm, in canvas pixels. */
export function handGhostTarget(width: number, height: number, returning: boolean) {
  const palm = ghostPalm();
  const rings = ghostRings();
  const s = Math.min(width / 300, height / 270);
  return { x: (width - 300 * s) / 2 + palm.x * s, y: (height - 270 * s) / 2 + palm.y * s, radius: (returning ? rings.relax : rings.open) * palm.scale * s };
}

export function drawHandDemo(ctx: CanvasRenderingContext2D, elapsedMs: number, returning: boolean, width: number, height: number, now: number, reducedMotion = false, armed = true) {
  const state = handDemoState(elapsedMs, returning, armed);
  ctx.clearRect(0, 0, width, height);
  drawHandGhost(ctx, state.pose, width, height);
  const { x, y, radius } = handGhostTarget(width, height, returning);
  if (state.phase === "complete") {
    drawTargetCompletion(ctx, { x, y, radius, elapsed: Math.min(state.completionElapsedMs, TARGET_COMPLETION_MS - 1), now, reducedMotion: reducedMotion || state.completionElapsedMs >= TARGET_COMPLETION_MS });
  } else {
    drawTestingTarget(ctx, { x, y, radius, armed, contact: state.contact, progress: state.progress, now, reducedMotion });
  }
  ctx.save();
  ctx.font = "600 12px Manrope, sans-serif";
  ctx.fillStyle = state.contact ? "#285b49" : "#a14d32";
  const text = state.phase === "complete" ? "Complete" : state.label;
  // Above the ring, as for the reach; the small close circle's label goes beside it, clear of the fingers.
  if (returning) { ctx.textAlign = "right"; ctx.fillText(text, x - radius - 8, y + 4); }
  else { ctx.textAlign = "center"; ctx.fillText(text, x, y - radius - 10); }
  ctx.restore();
}
