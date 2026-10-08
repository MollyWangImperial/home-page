import type { Side } from "./config";
import { fingerExtension, handVisible, inView, poseFrameValues, poseJoints, type Frame, type Geo, type HandInput, type PoseInput, type Pt } from "./metrics";
import { TARGET_COMPLETION_MS, TARGET_HOLD_MS } from "./target-timing";
import { drawTargetCompletion, drawTestingTarget } from "./target-visual";
import { chooseHand } from "./tracker";

// Active Hand Opening, set up palm to the camera: the elbow rests on the table and the hand is up beside the
// shoulder. MediaPipe hand landmarks: wrist 0; thumb 1-4; index 5-8; middle 9-12; ring 13-16; little 17-20.

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

/** How squarely the palm faces the camera: 1 straight on, 0 edge-on. */
export function palmFacing(hand: HandInput | null): number {
  const axes = palmAxes(hand);
  return axes ? Math.max(0, -axes.n[2]) : 0;
}

/**
 * Wrist bend and palm turn against the relaxed hand learned at set-up:
 * - wrist_flexion_deg: the knuckles tipping toward the camera, the palm's side (wrist flexion, which lets the
 *   fingers open passively: tenodesis). Bending the other way (extension) is not counted.
 * - forearm_turn_deg: the palm turning about its long axis, away from facing the camera (forearm rotation).
 */
export function handTurnComps(hand: HandInput | null, ref: Geo | null): { wrist_flexion_deg?: number; forearm_turn_deg?: number } {
  const axes = palmAxes(hand);
  if (!axes || !ref || !finite(ref.palmAx, ref.palmAy, ref.palmAz, ref.palmBx, ref.palmBy, ref.palmBz)) return {};
  const a0 = unit([ref.palmAx!, ref.palmAy!, ref.palmAz!]);
  const across0 = unit([ref.palmBx!, ref.palmBy!, ref.palmBz!]);
  const b0 = unit(sub(across0, times(a0, dot(across0, a0))));
  let n0 = unit(cross(a0, b0));
  if (n0[2] > 0) n0 = times(n0, -1);
  return {
    wrist_flexion_deg: Math.max(0, Math.atan2(dot(axes.a, n0), dot(axes.a, a0)) * DEG),
    forearm_turn_deg: Math.abs(Math.atan2(dot(axes.b, n0), dot(axes.b, b0)) * DEG),
  };
}

// ---------- how open the hand is, and the rings ----------

/** Image points with x scaled by the frame's aspect ratio, so distances are in frame heights. */
const flat = (p: Pt, aspect: number): [number, number] => [p.x * aspect, p.y];

/** The palm's centre (normalized image coordinates) and the palm's length (wrist to middle knuckle, in frame heights). */
export function palmRing(hand: HandInput | null, aspect: number): { x: number; y: number; scale: number } | null {
  const p = hand?.landmarks;
  if (!p || PALM.some(index => !p[index])) return null;
  const centre = PALM.reduce((sum, index) => [sum[0] + flat(p[index], aspect)[0] / PALM.length, sum[1] + flat(p[index], aspect)[1] / PALM.length], [0, 0]);
  const [wx, wy] = flat(p[0], aspect), [mx, my] = flat(p[9], aspect);
  const scale = Math.hypot(mx - wx, my - wy);
  return scale > 0.005 ? { x: centre[0] / aspect, y: centre[1], scale } : null;
}

/**
 * How open the hand is: the four fingertips' mean distance from the palm's centre, in palm lengths. With the
 * palm to the camera a relaxed hand is about 0.6 and a fully open one about 1.15; a ring around the palm at
 * that distance is the target the fingertips reach.
 */
export function handOpenness(hand: HandInput | null, aspect: number): number | undefined {
  const ring = palmRing(hand, aspect);
  if (!ring || !hand) return undefined;
  const cx = ring.x * aspect, cy = ring.y;
  const mean = TIPS.reduce((sum, index) => { const [x, y] = flat(hand.landmarks[index], aspect); return sum + Math.hypot(x - cx, y - cy); }, 0) / TIPS.length;
  return mean / ring.scale;
}

/** A fully open hand, in palm lengths: the practice ring sits part of the way from the relaxed hand toward it. */
export const HAND_OPEN_TYPICAL = 1.15;
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

/**
 * The resting hand at set-up, in the shape the seated exercises use for the lap: where the wrist rests and
 * how big the hand is (its palm length), or what to fix first.
 */
export function handRest(hand: HandInput | null, aspect: number, side: Side, faceAndShoulders: boolean): { lapRest?: { x: number; y: number; bodyScale: number }; lapMissing?: string } {
  if (!hand) return { lapMissing: `Hold your ${side} hand up beside your shoulder with your palm facing the camera.` };
  if ([4, ...TIPS].some(index => { const p = hand.landmarks[index]; return !p || p.x < 0.01 || p.x > 0.99 || p.y < 0.01 || p.y > 0.99; })) return { lapMissing: "Move your hand back a little so I can see every fingertip." };
  if (palmFacing(hand) < 0.5) return { lapMissing: "Turn your palm to face the camera." };
  if (!faceAndShoulders) return { lapMissing: "Keep your face and both shoulders in view." };
  const ring = palmRing(hand, aspect);
  return ring ? { lapRest: { x: hand.landmarks[0].x, y: hand.landmarks[0].y, bodyScale: ring.scale } } : { lapMissing: "Hold your hand toward the camera so I can see every finger." };
}

/**
 * One camera frame. The hand model measures the fingers and the palm's turn; the body model checks only the
 * trunk and shoulders, so the arm and hips (often behind the table) need not be in view. Set-up learns the
 * resting hand once the hand, the face and both shoulders are seen.
 */
export function handOpenFrame(det: { pose: PoseInput | null; hands: HandInput[] }, side: Side, t: number, aspect: number, ref: Geo | null): Frame {
  const joints = poseJoints(side);
  const landmarks = det.pose?.landmarks;
  const hand = chooseHand(det.hands, landmarks?.[joints.wrist]);
  const body = det.pose ? poseFrameValues(det.pose, side, ref) : null;
  const values: Frame["values"] = hand ? { finger_extension: fingerExtension(hand), hand_openness: handOpenness(hand, aspect) } : {};
  const comps: Frame["comps"] = { ...handTurnComps(hand, ref), trunk_approach_pct: body?.comps.trunk_approach_pct, shoulder_hike_rel_delta: body?.comps.shoulder_hike_rel_delta };
  const view = handVisible(hand);
  const faceAndShoulders = [joints.nose, joints.shoulder, joints.shoulderOther].every(index => inView(landmarks?.[index]));
  return { t, values, comps, visible: view.ok, missing: view.missing, geo: body?.geo ? { ...body.geo, ...palmGeo(hand) } : undefined, ...handRest(hand, aspect, side, faceAndShoulders) };
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
  return handOpenness(ghostAsHand(open), 1)!;
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
  const label = returning ? "Relax target" : "Open target";
  const instruction = !armed ? "Listen to the instruction. The circle will become active when the voice finishes."
    : phase === "complete" ? returning ? "Relax target complete" : "Target complete — now let your fingers relax"
    : phase === "hold" ? `${returning ? "Hold relaxed" : "Hold your hand open"} · ${Math.round(progress * 100)}%`
    : returning ? "Let your fingers relax into the small circle" : "Open your fingers out to the ring, keeping your wrist straight";
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
  // Above the ring, as for the reach; the small relax circle's label goes beside it, clear of the fingers.
  if (returning) { ctx.textAlign = "right"; ctx.fillText(text, x - radius - 8, y + 4); }
  else { ctx.textAlign = "center"; ctx.fillText(text, x, y - radius - 10); }
  ctx.restore();
}
