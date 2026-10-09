// Walking (the movement check's L6), filmed side-on with the phone propped sideways at hip height: a pure, testable
// gait analysis of MediaPipe pose frames, a cheap live counter for the recording, the set-up checks, and a synthetic
// side-view walker for the tests and the simulator. Distances are in leg lengths (L) and speeds in L/s, so the
// camera's distance and the picture's shape cancel out. Engineering defaults, to be reviewed by a clinician; not a
// clinical measure.

import type { Pt } from "../exercise-engine/metrics";
import type { GaitComponentId, GaitComponents, GaitMetrics, GaitResult, WalkAssist } from "./types";

/** One pose frame: time (ms), the 33 MediaPipe pose points (normalised x, y) and the picture's width over its height. */
export type GaitFrame = { t: number; landmarks: Pt[]; aspect: number };
/** 0: the person's left as the pose model labels it (side "A" of the alternating steps); 1: the right ("B"). */
type Side = 0 | 1;

// MediaPipe pose points, each pair left then right.
const SHOULDER = [11, 12], HIP = [23, 24], KNEE = [25, 26], ANKLE = [27, 28], HEEL = [29, 30], TOE = [31, 32];
const NOSE = 0, EAR = [7, 8];
/** Nose, eyes, ears and mouth: the top of the body for the set-up's room check. */
const FACE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const DEG = 180 / Math.PI;

/** A point counts as seen at this visibility (the far leg in a side view is often a little lower than the near one). */
export const SEEN_VISIBILITY = 0.3;
/** The pelvis is median-smoothed over this many frames each side, and its velocity taken over this many ms each side. */
const SMOOTH_HALF = 2, VELOCITY_HALF_MS = 150, MIN_VELOCITY_SPAN_MS = 100;
/** Walking: the smoothed pelvis moves at least this fast (L/s). */
export const WALKING_LEG_PER_S = 0.15;
/** A pass: walking one way for at least this long and this far (L). */
export const PASS_MIN_MS = 1200, PASS_MIN_LEGS = 1.2;
/** Walking frames this close stay one run across a tracking gap, or across a brief slowing below the walking speed. */
const TRACK_GAP_MS = 400, BRIDGE_MS = 250;
/**
 * Runs the same way with a stop of up to this long between them are one pass: a walking-frame or step-to walker stands
 * still between steps, and clinical gait speed counts those stops in the time.
 */
export const PAUSE_BRIDGE_MS = 2000;
/** A drift the other way within such a stop (a weight shift, the frame lifted) at most this long and far is not a turn. */
const DRIFT_MAX_MS = 500, DRIFT_MAX_LEGS = 0.25;
/** A strike in a stop is timed from when the foot landed: the earliest frame with the foot within this much (L) of where it stays. */
const LANDED_LEGS = 0.05;
/** Heel strikes: foot-forward peaks at least this prominent (L); one foot's strikes at least this far apart; both feet's merged when closer. */
export const STRIKE_PROMINENCE_LEGS = 0.12, SAME_FOOT_MS = 350, MERGE_STRIKES_MS = 200;
/** Knee bend is steadied over the neighbouring frames within this many ms before its peak is taken. */
const KNEE_MEDIAN_MS = 50;
/**
 * A step longer than this many median steps, with the same foot leading at both its strikes, hides a missed strike:
 * the parity advances by an even count and its timing is not used. With the other foot leading it is a real slow step.
 */
export const MISSED_STRIKE_RATIO = 1.7;
/** A pass's speed leaves out its first and last half second (starting and stopping), and keeps any stops between. */
export const STEADY_TRIM_MS = 500;
/** An average leg length in metres, for the display-only speed estimate ("about"). */
export const METRES_PER_LEG = 0.85;
/** Quality gates: enough steps (and on each side), the whole body seen while walking, and walking side-on. */
export const MIN_STEPS = 6, MIN_STEPS_PER_SIDE = 3, MIN_SEEN_SHARE = 0.7, MAX_SIDE_ON_RATIO = 0.6;
/** Set-up asks for a clearer side view than the analysis needs (standing a little turned still walks side-on). */
export const SETUP_SIDE_ON_MAX = 0.5;
/** Standing body height as a share of the picture's height: enough room to walk across, big enough to track. */
export const ROOM_MIN_SHARE = 0.35, ROOM_MAX_SHARE = 0.7;
/** Someone holding the patient while walking: the walking area counts at most this. */
export const HELD_WALKING_CAP = 50;

/** The walking score's components and weights (the results dashboard's "How we scored this" lists the same). */
export const GAIT_WEIGHTS: Record<GaitComponentId, number> = {
  speed: 30, cadence: 15, step_length_symmetry: 20, step_time_symmetry: 15, knee_bend: 10, trunk_upright: 10,
};
/** Each component's linear ramp, clamped: 0 at `zero`, 100 at `full` (trunk upright runs down: 100 at 5° extra lean, 0 at 20°). */
export const GAIT_RAMPS: Record<GaitComponentId, { zero: number; full: number }> = {
  speed: { zero: 0.35, full: 1.4 }, cadence: { zero: 50, full: 105 }, step_length_symmetry: { zero: 0.6, full: 0.92 },
  step_time_symmetry: { zero: 0.6, full: 0.92 }, knee_bend: { zero: 20, full: 50 }, trunk_upright: { zero: 20, full: 5 },
};

/** What the patient hears when the walk could not be measured. */
export const GAIT_REASONS = {
  fewSteps: "I saw too few steps. Walk a little further across the picture.",
  body: "Keep your whole body, from head to feet, in the picture.",
  sideOn: "Walk across the picture, side-on to the camera, not toward it.",
  noPass: "I didn't see you walk across.",
} as const;

// ---------------------------------------------------------------- small helpers

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const median = (values: number[]): number => {
  if (!values.length) return NaN;
  const sorted = values.slice().sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const mean = (values: number[]): number => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;

const visible = (p: Pt | undefined, min = SEEN_VISIBILITY): p is Pt => !!p && finite(p.x) && finite(p.y) && (p.visibility ?? 1) >= min;
const inFrame = (p: Pt) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
const seenIn = (p: Pt | undefined, min = SEEN_VISIBILITY) => visible(p, min) && inFrame(p);
/** Distance in frame heights (x is widened by the aspect, so a circle stays a circle). */
const dist = (a: Pt, b: Pt, aspect: number) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

/** A seen frame: both hips, both knees, both ankles and a shoulder seen, all inside the picture. */
export function bodySeen(lm: Pt[] | null | undefined): boolean {
  if (!lm) return false;
  return [...HIP, ...KNEE, ...ANKLE].every(i => seenIn(lm[i])) && SHOULDER.some(i => seenIn(lm[i]));
}
const hipsSeen = (lm: Pt[] | null | undefined) => !!lm && HIP.every(i => seenIn(lm[i]));

/** The pelvis (mid-hip) across the picture, in frame heights; null when the hips are not seen. */
export function pelvisX(lm: Pt[] | null | undefined, aspect: number): number | null {
  return lm && hipsSeen(lm) ? (lm[HIP[0]].x + lm[HIP[1]].x) / 2 * aspect : null;
}

/** Hip to knee plus knee to ankle on one side, in frame heights (NaN when that leg is not seen). */
function legOn(lm: Pt[], side: Side, aspect: number): number {
  const hip = lm[HIP[side]], knee = lm[KNEE[side]], ankle = lm[ANKLE[side]];
  return visible(hip) && visible(knee) && visible(ankle) ? dist(hip, knee, aspect) + dist(knee, ankle, aspect) : NaN;
}
const legVisibility = (lm: Pt[], side: Side) => [HIP[side], KNEE[side], ANKLE[side]].reduce((sum, i) => sum + (lm[i]?.visibility ?? 1), 0);
/** The better-seen leg over these frames (the one nearer the camera, usually). */
function betterSide(frames: GaitFrame[]): Side {
  let left = 0, right = 0;
  for (const frame of frames) { left += legVisibility(frame.landmarks, 0); right += legVisibility(frame.landmarks, 1); }
  return right > left ? 1 : 0;
}
/** One frame's leg length on its better-seen side, in frame heights; null when the legs are not seen. */
export function legLength(lm: Pt[] | null | undefined, aspect: number): number | null {
  if (!lm || !bodySeen(lm)) return null;
  const length = legOn(lm, legVisibility(lm, 1) > legVisibility(lm, 0) ? 1 : 0, aspect);
  return finite(length) && length > 0 ? length : null;
}

/** The foot's position across the picture: the heel, or the ankle when the heel is not seen (NaN when neither is). */
function footX(lm: Pt[], side: Side, aspect: number): number {
  const heel = lm[HEEL[side]], ankle = lm[ANKLE[side]];
  return visible(heel) ? heel.x * aspect : visible(ankle) ? ankle.x * aspect : NaN;
}
/** Knee bend, 180 − the hip-knee-ankle angle, in degrees (NaN when that leg is not seen). */
function kneeFlexOf(lm: Pt[], side: Side, aspect: number): number {
  const hip = lm[HIP[side]], knee = lm[KNEE[side]], ankle = lm[ANKLE[side]];
  if (!visible(hip) || !visible(knee) || !visible(ankle)) return NaN;
  const ax = (hip.x - knee.x) * aspect, ay = hip.y - knee.y, bx = (ankle.x - knee.x) * aspect, by = ankle.y - knee.y;
  const norm = Math.hypot(ax, ay) * Math.hypot(bx, by);
  return norm > 0 ? 180 - Math.acos(clamp((ax * bx + ay * by) / norm, -1, 1)) * DEG : NaN;
}
/** Shoulder span over torso length: about 0 side-on, about 0.7 facing the camera (NaN without shoulders and hips). */
function sideOnOf(lm: Pt[], aspect: number): number {
  const [ls, rs] = SHOULDER.map(i => lm[i]), [lh, rh] = HIP.map(i => lm[i]);
  if (!ls || !rs || !finite(ls.x) || !finite(rs.x) || !finite(ls.y) || !finite(rs.y) || !hipsSeen(lm)) return NaN;
  const torso = Math.hypot(((ls.x + rs.x) - (lh.x + rh.x)) / 2 * aspect, ((ls.y + rs.y) - (lh.y + rh.y)) / 2);
  return torso > 0 ? dist(ls, rs, aspect) / torso : NaN;
}

/** Which way the person faces across the picture, from the nose ahead of the ears (0 when facing the camera or unseen). */
function facing(lm: Pt[], aspect: number): -1 | 0 | 1 {
  const nose = lm[NOSE], ears = EAR.map(i => lm[i]).filter(p => visible(p));
  const hips = HIP.map(i => lm[i]), shoulders = SHOULDER.map(i => lm[i]).filter(p => visible(p));
  if (!visible(nose) || !ears.length || !hips.every(p => visible(p)) || !shoulders.length) return 0;
  const torso = Math.abs(mean(shoulders.map(p => p.y)) - (hips[0].y + hips[1].y) / 2);
  const ahead = (nose.x - mean(ears.map(p => p.x))) * aspect;
  return Math.abs(ahead) < 0.05 * torso ? 0 : ahead > 0 ? 1 : -1;
}

/**
 * The trunk's angle from vertical (mid-hip to mid-shoulder), in degrees, positive when leaning forward: toward `dir`
 * across the picture (the walking direction), or toward where the face points when no direction is given. Null when
 * the hips, a shoulder or (without a direction) the face are not seen.
 */
export function trunkAngleDeg(landmarks: Pt[] | null | undefined, aspect: number, dir?: -1 | 1): number | null {
  if (!landmarks) return null;
  const hips = HIP.map(i => landmarks[i]), shoulders = SHOULDER.map(i => landmarks[i]).filter(p => visible(p));
  if (!hips.every(p => visible(p)) || !shoulders.length) return null;
  const toward = dir ?? facing(landmarks, aspect);
  if (!toward) return null;
  const dx = (mean(shoulders.map(p => p.x)) - (hips[0].x + hips[1].x) / 2) * aspect * toward;
  const up = (hips[0].y + hips[1].y) / 2 - mean(shoulders.map(p => p.y));
  return Math.atan2(dx, up) * DEG;
}

// ---------------------------------------------------------------- the analysis

type Pass = { dir: 1 | -1; from: number; to: number };
type Strike = { j: number; t: number; foot: Side; f: number };
type Step = { side: Side; ms: number; length: number; knee: number };

/** A centred running median over `half` values each side (the ends use what they have). */
function medianSmooth(values: number[], half: number): number[] {
  return values.map((_, i) => median(values.slice(Math.max(0, i - half), i + half + 1)));
}

/** The pelvis's velocity in L/s at each sample, over ±150 ms (0 when too few samples span it). */
function velocities(ts: number[], xs: number[], leg: number): number[] {
  const out: number[] = [];
  let a = 0, b = 0;
  for (let j = 0; j < ts.length; j++) {
    while (ts[a] < ts[j] - VELOCITY_HALF_MS) a++;
    b = Math.max(b, j);
    while (b + 1 < ts.length && ts[b + 1] <= ts[j] + VELOCITY_HALF_MS) b++;
    const span = ts[b] - ts[a];
    out.push(span >= MIN_VELOCITY_SPAN_MS ? (xs[b] - xs[a]) / (span / 1000) / leg : 0);
  }
  return out;
}

/**
 * Runs of walking frames in one direction, long and far enough to be a pass. Runs the same way with a stop of up to
 * 2 s between them are one pass (a walking frame, stepping to), and a small drift the other way within that stop is
 * left out; a turn is a run the other way that goes on.
 */
function findPasses(ts: number[], xs: number[], v: number[], leg: number): Pass[] {
  const runs: Pass[] = [];
  for (let j = 0; j < ts.length; j++) {
    if (Math.abs(v[j]) < WALKING_LEG_PER_S) continue;
    const dir: 1 | -1 = v[j] > 0 ? 1 : -1;
    const last = runs[runs.length - 1];
    if (last && last.dir === dir && ts[j] - ts[last.to] <= (last.to === j - 1 ? TRACK_GAP_MS : BRIDGE_MS)) last.to = j;
    else runs.push({ dir, from: j, to: j });
  }
  const passes: Pass[] = [];
  runs.forEach((run, k) => {
    const last = passes[passes.length - 1], next = runs[k + 1];
    const drift = last && next && run.dir !== last.dir && next.dir === last.dir && ts[next.from] - ts[last.to] <= PAUSE_BRIDGE_MS
      && ts[run.to] - ts[run.from] <= DRIFT_MAX_MS && Math.abs(xs[run.to] - xs[run.from]) < DRIFT_MAX_LEGS * leg;
    if (drift) return;
    if (last && last.dir === run.dir && ts[run.from] - ts[last.to] <= PAUSE_BRIDGE_MS) last.to = run.to;
    else passes.push({ ...run });
  });
  return passes.filter(pass => ts[pass.to] - ts[pass.from] >= PASS_MIN_MS && Math.abs(xs[pass.to] - xs[pass.from]) >= PASS_MIN_LEGS * leg);
}

/**
 * Local maxima at least `prominence` above the higher of their two bases (the lowest point on each side before a
 * higher value), the larger kept when two are closer than `minGapMs`. A flat top counts once, at its middle.
 */
function findPeaks(values: number[], times: number[], prominence: number, minGapMs: number): number[] {
  const n = values.length, candidates: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (!(values[i - 1] < values[i])) continue;
    let k = i;
    while (k + 1 < n && values[k + 1] === values[i]) k++;
    if (k + 1 < n && values[k + 1] < values[i]) candidates.push((i + k) >> 1);
    i = k;
  }
  const prominent = candidates.filter(c => {
    let left = values[c], right = values[c];
    for (let k = c - 1; k >= 0 && values[k] <= values[c]; k--) left = Math.min(left, values[k]);
    for (let k = c + 1; k < n && values[k] <= values[c]; k++) right = Math.min(right, values[k]);
    return values[c] - Math.max(left, right) >= prominence;
  });
  const kept: number[] = [];
  for (const c of prominent.slice().sort((a, b) => values[b] - values[a] || a - b)) {
    if (kept.every(k => Math.abs(times[k] - times[c]) >= minGapMs)) kept.push(c);
  }
  return kept.sort((a, b) => a - b);
}

/** How far a foot is ahead of the pelvis in the walking direction (frame heights; NaN when the foot is unseen). */
const forward = (frame: GaitFrame, foot: Side, pelvis: number, dir: 1 | -1) => (footX(frame.landmarks, foot, frame.aspect) - pelvis) * dir;

/**
 * A pass's heel strikes: each foot's foot-forward peaks, then both feet's merged when closer than 0.2 s. A strike keeps
 * its peak's frame (for the step's length and the swing before it). Its time is the peak's, or, when the pelvis had
 * stopped there (a stop on both feet keeps the foot's lead flat, so the peak could fall anywhere in it), when the foot
 * landed.
 */
function passStrikes(pass: Pass, frameAt: (j: number) => GaitFrame, xs: number[], v: number[], leg: number): Strike[] {
  const found: Strike[] = [];
  const groundX = (j: number, foot: Side) => footX(frameAt(j).landmarks, foot, frameAt(j).aspect);
  for (const foot of [0, 1] as Side[]) {
    const points: { j: number; t: number; f: number }[] = [];
    for (let j = pass.from; j <= pass.to; j++) {
      const f = forward(frameAt(j), foot, xs[j], pass.dir);
      if (finite(f)) points.push({ j, t: frameAt(j).t, f });
    }
    for (const k of findPeaks(points.map(p => p.f), points.map(p => p.t), STRIKE_PROMINENCE_LEGS * leg, SAME_FOOT_MS)) {
      // The stretch around the peak where the foot's lead stays at its peak (one stray frame does not end it): a frame
      // or two in walking, the whole stop when the walker stopped there.
      const level = (m: number) => points[m].f >= points[k].f - LANDED_LEGS * leg;
      const reach = (step: 1 | -1) => {
        let end = k;
        for (let m = k + step, strays = 0; m >= 0 && m < points.length && strays < 2; m += step) {
          if (level(m)) { end = m; strays = 0; } else strays++;
        }
        return end;
      };
      let landed = k;
      if (points.slice(reach(-1), reach(1) + 1).some(p => Math.abs(v[p.j]) < WALKING_LEG_PER_S)) {
        // A stop: back from the peak while the foot stays where it is planted, to when it landed.
        const planted = groundX(points[k].j, foot);
        for (let m = k - 1, strays = 0; m >= 0 && strays < 2; m--) {
          if (Math.abs(groundX(points[m].j, foot) - planted) <= LANDED_LEGS * leg) { landed = m; strays = 0; }
          else strays++;
        }
      }
      found.push({ ...points[k], t: points[landed].t, foot });
    }
  }
  found.sort((a, b) => a.t - b.t);
  const merged: Strike[] = [];
  for (const strike of found) {
    const last = merged[merged.length - 1];
    if (last && strike.t - last.t < MERGE_STRIKES_MS) { if (strike.f > last.f) merged[merged.length - 1] = strike; }
    else merged.push(strike);
  }
  return merged;
}

/**
 * A pass's speed in L/s: net pelvis travel over the time it took, stops included (as clinical gait speed counts them),
 * leaving out its first and last half second (starting and stopping, as a timed walk's run-up does).
 */
function steadySpeed(ts: number[], xs: number[], pass: Pass, leg: number): number {
  let a = pass.from, b = pass.to;
  while (a < pass.to && ts[a] < ts[pass.from] + STEADY_TRIM_MS) a++;
  while (b > pass.from && ts[b] > ts[pass.to] - STEADY_TRIM_MS) b--;
  if (b <= a || ts[b] - ts[a] < 300) { a = pass.from; b = pass.to; }
  return Math.abs(xs[b] - xs[a]) / ((ts[b] - ts[a]) / 1000) / leg;
}

const ramp = (value: number, { zero, full }: { zero: number; full: number }) => clamp((value - zero) / (full - zero), 0, 1) * 100;

/** Each measured component on its 0-100 ramp (unrounded); a metric that was not measured has no component. */
export function gaitComponents(metrics: Partial<GaitMetrics>): GaitComponents {
  const out: GaitComponents = {};
  const add = (id: GaitComponentId, value: number | undefined) => { if (finite(value)) out[id] = ramp(value, GAIT_RAMPS[id]); };
  add("speed", metrics.speedLegPerS);
  add("cadence", metrics.cadence);
  add("step_length_symmetry", metrics.stepLengthSymmetry);
  add("step_time_symmetry", metrics.stepTimeSymmetry);
  add("knee_bend", metrics.kneeFlexPeak);
  add("trunk_upright", metrics.trunkLeanDeg);
  return out;
}

/** The weighted mean of the measured components, unrounded; null unless speed, cadence and one symmetry were measured. */
export function gaitScore(components: GaitComponents): number | null {
  if (!finite(components.speed) || !finite(components.cadence) || !(finite(components.step_length_symmetry) || finite(components.step_time_symmetry))) return null;
  let sum = 0, weight = 0;
  for (const id of Object.keys(GAIT_WEIGHTS) as GaitComponentId[]) {
    const value = components[id];
    if (finite(value)) { sum += GAIT_WEIGHTS[id] * value; weight += GAIT_WEIGHTS[id]; }
  }
  return sum / weight;
}

/**
 * The walk, measured from side-on pose frames: passes across the picture from the pelvis (stops of up to 2 s kept
 * inside), heel strikes from each foot's lead over the pelvis, alternating steps (a missed strike moves the parity on,
 * its gap unused), knee bend in swing, trunk lean beyond standing. Not measurable → the reason in the patient's words,
 * never a score.
 */
export function analyzeGait(frames: GaitFrame[], options: { standingTrunkDeg?: number; assist: WalkAssist }): GaitResult {
  const assist = options.assist;
  const list = (Array.isArray(frames) ? frames : [])
    .filter(frame => frame && finite(frame.t) && Array.isArray(frame.landmarks) && finite(frame.aspect) && frame.aspect > 0)
    .sort((a, b) => a.t - b.t);
  const fail = (reason: string, metrics: Partial<GaitMetrics> = {}): GaitResult => ({ status: "not_measured", reason, assist, metrics });

  const seen = list.map(frame => bodySeen(frame.landmarks));
  // The pelvis series: frames with both hips seen (j indexes it; pelvis[j] is the frame).
  const pelvis = list.flatMap((frame, i) => hipsSeen(frame.landmarks) ? [i] : []);
  if (pelvis.length < 5) return fail(GAIT_REASONS.noPass, { passes: 0, steps: 0 });
  const seenFrames = list.filter((_, i) => seen[i]);
  const side = betterSide(seenFrames);
  const leg = median(seenFrames.map(frame => legOn(frame.landmarks, side, frame.aspect)).filter(finite));
  // Never the whole lower body: no leg length to measure by.
  if (seenFrames.length < 3 || !(leg > 0)) return fail(GAIT_REASONS.body, { seenShare: 0, passes: 0, steps: 0 });

  const frameAt = (j: number) => list[pelvis[j]];
  const ts = pelvis.map(i => list[i].t);
  const xs = medianSmooth(pelvis.map(i => pelvisX(list[i].landmarks, list[i].aspect) as number), SMOOTH_HALF);
  const v = velocities(ts, xs, leg);
  const walking = pelvis.flatMap((_, j) => Math.abs(v[j]) >= WALKING_LEG_PER_S ? [j] : []);
  // How side-on: while walking, or (no walking across, e.g. toward the camera) whenever the hips were seen.
  const sideOnRatio = median((walking.length ? walking : pelvis.map((_, j) => j)).map(j => sideOnOf(frameAt(j).landmarks, frameAt(j).aspect)).filter(finite));
  const seenShare = walking.length ? walking.filter(j => seen[pelvis[j]]).length / walking.length : 0;
  const known: Partial<GaitMetrics> = { seenShare, sideOnRatio, passes: 0, steps: 0 };
  if (sideOnRatio > MAX_SIDE_ON_RATIO) return fail(GAIT_REASONS.sideOn, known);
  if (!walking.length) return fail(GAIT_REASONS.noPass, known);
  if (seenShare < MIN_SEEN_SHARE) return fail(GAIT_REASONS.body, known);
  const passes = findPasses(ts, xs, v, leg);
  if (!passes.length) return fail(GAIT_REASONS.noPass, known);

  const strikesBy = passes.map(pass => passStrikes(pass, frameAt, xs, v, leg));
  const typical = median(strikesBy.flatMap(strikes => strikes.slice(1).map((strike, k) => strike.t - strikes[k].t)));
  const steps: Step[] = [];
  let taken = 0;
  passes.forEach((pass, p) => {
    const strikes = strikesBy[p];
    if (!strikes.length) return;
    taken += 1;
    // The leg leading at each strike (the foot further forward then; the striking foot when the other is unseen).
    const lead = strikes.map(strike => {
      const a = forward(frameAt(strike.j), 0, xs[strike.j], pass.dir), b = forward(frameAt(strike.j), 1, xs[strike.j], pass.dir);
      return finite(a) && finite(b) ? (a >= b ? 0 : 1) : strike.foot;
    });
    // Parity alternates. A step much longer than usual with the same leg leading at both ends hid a strike: the parity
    // moves on by an even count and that gap is not used. With the other leg leading it is a real slow step, kept.
    const parity: number[] = [0], used: boolean[] = [false];
    for (let k = 1; k < strikes.length; k++) {
      const ms = strikes[k].t - strikes[k - 1].t;
      const missed = ms > MISSED_STRIKE_RATIO * typical && lead[k] === lead[k - 1];
      const advance = missed ? 2 * Math.max(1, Math.round(ms / typical / 2)) : 1;
      parity.push((parity[k - 1] + advance) % 2);
      used.push(!missed);
      taken += advance;
    }
    // Side A is the parity the leading legs mostly call the left (a pass cannot tell which leg is which otherwise).
    const agree = lead.filter((foot, k) => foot === parity[k]).length;
    const swap = agree * 2 < strikes.length || (agree * 2 === strikes.length && lead[0] !== parity[0]);
    for (let k = 1; k < strikes.length; k++) {
      if (!used[k]) continue;
      const at = frameAt(strikes[k].j);
      const a = forward(at, 0, xs[strikes[k].j], pass.dir), b = forward(at, 1, xs[strikes[k].j], pass.dir);
      // The leading leg's peak bend while it swung through, since the previous strike (over a running median of the
      // frames within 50 ms, so one jittery frame cannot set the peak, yet a slow camera's few frames are not flattened).
      const flexAt = (j: number, near: number) => j >= 0 && j < pelvis.length && Math.abs(frameAt(j).t - frameAt(near).t) <= KNEE_MEDIAN_MS ? kneeFlexOf(frameAt(j).landmarks, lead[k] as Side, frameAt(j).aspect) : NaN;
      let knee = NaN;
      for (let j = strikes[k - 1].j + 1; j <= strikes[k].j; j++) {
        const flex = median([flexAt(j - 1, j), flexAt(j, j), flexAt(j + 1, j)].filter(finite));
        if (finite(flex) && (!finite(knee) || flex > knee)) knee = flex;
      }
      steps.push({ side: (swap ? 1 - parity[k] : parity[k]) as Side, ms: strikes[k].t - strikes[k - 1].t, length: finite(a) && finite(b) ? Math.abs(a - b) / leg : NaN, knee });
    }
  });

  const bySide = [0, 1].map(s => steps.filter(step => step.side === s));
  const ratio = (pair: number[]) => pair.every(value => finite(value) && value > 0) ? Math.min(pair[0], pair[1]) / Math.max(pair[0], pair[1]) : undefined;
  const lengths = bySide.map(rows => mean(rows.map(step => step.length).filter(finite)));
  const times = bySide.map(rows => mean(rows.map(step => step.ms)));
  const knees = bySide.map(rows => median(rows.map(step => step.knee).filter(finite)));
  const speedLegPerS = median(passes.map(pass => steadySpeed(ts, xs, pass, leg)));
  // Steps a minute over the time they took (stops included, as clinical cadence counts it): a median would jump between
  // a stop-and-go walker's short and long steps.
  const cadence = 60000 / mean(steps.map(step => step.ms));
  const trunk = median(walking.map(j => trunkAngleDeg(frameAt(j).landmarks, frameAt(j).aspect, v[j] > 0 ? 1 : -1)).filter(finite));
  const stepLengthSymmetry = ratio(lengths), stepTimeSymmetry = ratio(times);
  const kneeFlexPeak = knees.some(finite) ? Math.min(...knees.filter(finite)) : NaN;
  const metrics: GaitMetrics = {
    speedLegPerS, speedMpsEstimate: speedLegPerS * METRES_PER_LEG, cadence,
    ...(stepLengthSymmetry !== undefined ? { stepLengthSymmetry } : {}),
    ...(stepTimeSymmetry !== undefined ? { stepTimeSymmetry } : {}),
    ...(finite(knees[0]) ? { kneeFlexA: knees[0] } : {}),
    ...(finite(knees[1]) ? { kneeFlexB: knees[1] } : {}),
    ...(finite(kneeFlexPeak) ? { kneeFlexPeak } : {}),
    // trunkBaseline: the lean is beyond a standing angle the set-up saw (false: the raw lean, no stand-still was seen).
    ...(finite(trunk) ? { trunkLeanDeg: trunk - (finite(options.standingTrunkDeg) ? options.standingTrunkDeg : 0), trunkBaseline: finite(options.standingTrunkDeg) } : {}),
    ...(finite(lengths[0]) ? { stepLengthA: lengths[0] } : {}),
    ...(finite(lengths[1]) ? { stepLengthB: lengths[1] } : {}),
    steps: taken, passes: passes.length, seenShare, sideOnRatio,
  };
  if (steps.length < MIN_STEPS || bySide.some(rows => rows.length < MIN_STEPS_PER_SIDE)) return fail(GAIT_REASONS.fewSteps, metrics);
  const components = gaitComponents(metrics);
  const score = gaitScore(components);
  if (score === null || !(speedLegPerS > 0) || !(cadence > 0)) return fail(GAIT_REASONS.fewSteps, metrics);
  return { status: "scored", score, areaScore: assist === "holds" ? Math.min(score, HELD_WALKING_CAP) : score, assist, metrics, components };
}

// ---------------------------------------------------------------- set-up

export type GaitSetupRow = { ok: boolean; hint: string };
export type GaitSetup = { upright: GaitSetupRow; wholeBody: GaitSetupRow; sideOn: GaitSetupRow; room: GaitSetupRow };

/** A portrait picture, or a person lying sideways in it: the phone is upright, or rotation lock kept the picture turned. */
export const TURN_PHONE_HINT = "Turn the phone on its side. If the picture turns too, switch off rotation lock.";

/**
 * The walking set-up rows from one standing frame (`aspect`: the picture's width over its height): the phone on its
 * side with the person upright in a landscape picture, head to feet in the picture, side-on to the camera, and enough
 * room to walk across (standing body height 35-70% of the picture's height).
 */
export function gaitSetupCheck(landmarks: Pt[] | null | undefined, aspect: number): GaitSetup {
  // The whole method needs a landscape picture (a portrait one is only 2-2.5 leg lengths wide), the right way up.
  const landscape = finite(aspect) && aspect > 1;
  const turnFirst = { ok: false, hint: "First, turn the phone on its side." };
  if (!landmarks || !hipsSeen(landmarks)) {
    const hint = "Stand where the camera can see you, about 3 big steps away.";
    return { upright: { ok: false, hint: landscape ? hint : TURN_PHONE_HINT }, wholeBody: { ok: false, hint }, sideOn: { ok: false, hint }, room: landscape ? { ok: false, hint } : turnFirst };
  }
  const lm = landmarks;
  // Upright: the shoulders above the hips, the hip-to-shoulder line within 45° of vertical (a stoop is still upright).
  const shoulders = SHOULDER.map(i => lm[i]).filter(p => visible(p));
  const rise = (lm[HIP[0]].y + lm[HIP[1]].y) / 2 - mean(shoulders.map(p => p.y));
  const lean = Math.abs(mean(shoulders.map(p => p.x)) - (lm[HIP[0]].x + lm[HIP[1]].x) / 2) * (finite(aspect) ? aspect : 1);
  const uprightOk = landscape && shoulders.length > 0 && rise > lean;
  const upright = { ok: uprightOk, hint: uprightOk ? "" : landscape && !shoulders.length ? "Stand where the camera can see you, about 3 big steps away." : TURN_PHONE_HINT };
  // A small margin: a foot on the picture's edge is often cut off.
  const inside = (p: Pt) => p.x >= 0.01 && p.x <= 0.99 && p.y >= 0.01 && p.y <= 0.99;
  const head = FACE.filter(i => visible(lm[i], 0.5) && inside(lm[i]));
  const feetOk = ANKLE.every(i => visible(lm[i]) && inside(lm[i])) && [...HEEL, ...TOE].every(i => !visible(lm[i]) || inside(lm[i]));
  const headOk = head.length > 0;
  const wholeOk = feetOk && headOk && [...KNEE].every(i => visible(lm[i]) && inside(lm[i]));
  const wholeBody = {
    ok: wholeOk,
    hint: wholeOk ? "" : !feetOk && !headOk ? "Step back until your head and feet are both in the picture."
      : !feetOk ? "Your feet are out of the picture. Step back, or tilt the phone down a little."
      : !headOk ? "Your head is out of the picture. Step back, or tilt the phone up a little."
      : "Step back until your whole body is in the picture.",
  };
  const ratio = sideOnOf(lm, aspect);
  const sideOk = finite(ratio) && ratio <= SETUP_SIDE_ON_MAX;
  const sideOn = { ok: sideOk, hint: sideOk ? "" : "Turn side-on, so one shoulder points at the camera." };
  // Room is measured up and down the picture: it means nothing until the picture is the right way round.
  if (!uprightOk && (!landscape || shoulders.length)) return { upright, wholeBody, sideOn, room: turnFirst };
  if (!wholeOk) return { upright, wholeBody, sideOn, room: { ok: false, hint: "First, bring your head and feet into the picture." } };
  // Eyes and ears sit about 7% of standing height below the top of the head.
  const top = Math.min(...head.map(i => lm[i].y));
  const bottom = Math.max(...[...ANKLE, ...HEEL, ...TOE].filter(i => visible(lm[i])).map(i => lm[i].y));
  const share = (bottom - top) * 1.075;
  const room = share < ROOM_MIN_SHARE ? { ok: false, hint: "You're quite far away. Come about one big step closer." }
    : share > ROOM_MAX_SHARE ? { ok: false, hint: "You're a little close. Take a big step back, so there's room to walk across." }
    : { ok: true, hint: "" };
  return { upright, wholeBody, sideOn, room };
}

// ---------------------------------------------------------------- live counter for the recording

export type LiveGaitState = { walking: boolean; direction: -1 | 0 | 1; passes: number; steps: number; still: boolean };

/**
 * Not moving: slower than this (L/s) for STILL_MS, or out of the picture that long. Longer than a stop within a pass,
 * so a walker who stops between steps is not taken as done.
 */
const STILL_LEG_PER_S = 0.1, STILL_MS = PAUSE_BRIDGE_MS + 500;
type FootTrack = { rising: boolean; extreme: number; at: number };
const freshFoot = (): FootTrack => ({ rising: false, extreme: Infinity, at: 0 });

/**
 * A cheap, incremental view of the recording for the live step counter and the automatic stop (two passes, then
 * standing still 2.5 s). Causal versions of the analysis: the last 5 pelvis positions' median, velocity over the last
 * 300 ms, and heel strikes found once a foot has dropped back by the prominence. A run survives a stop of up to 2 s
 * the same way (and a small drift the other way within it), as the analysis's passes do. A pass counts only when it
 * goes the other way from the last one, so a crossing split by a longer stop still counts once.
 */
export class LiveGait {
  private legs: number[] = [];
  private raw: number[] = [];
  private smooth: { t: number; x: number }[] = [];
  private run: { dir: 1 | -1; t0: number; x0: number; last: number; counted: boolean } | null = null;
  /** Walking the other way within a stop: a drift, until it goes on long or far enough to be a turn. */
  private drift: { dir: 1 | -1; t0: number; x0: number; last: number } | null = null;
  private lastPassDir: -1 | 0 | 1 = 0;
  private feet: FootTrack[] = [freshFoot(), freshFoot()];
  private lastStrike = [-Infinity, -Infinity];
  private lastMoving: number | null = null;
  private passes = 0;
  private steps = 0;

  push(frame: GaitFrame): LiveGaitState {
    const t = frame.t, lm = frame.landmarks, aspect = frame.aspect;
    if (this.lastMoving === null) this.lastMoving = t;
    const state = (walking: boolean, direction: -1 | 0 | 1): LiveGaitState => ({ walking, direction, passes: this.passes, steps: this.steps, still: t - (this.lastMoving as number) >= STILL_MS });
    const x = pelvisX(lm, aspect);
    if (x === null) { this.resetFeet(); return state(false, 0); }
    const length = legLength(lm, aspect);
    if (length !== null) { this.legs.push(length); if (this.legs.length > 90) this.legs.shift(); }
    this.raw.push(x);
    if (this.raw.length > 5) this.raw.shift();
    const smoothed = median(this.raw);
    this.smooth.push({ t, x: smoothed });
    while (this.smooth.length > 1 && this.smooth[0].t < t - 1000) this.smooth.shift();
    const leg = median(this.legs);
    if (!(leg > 0)) return state(false, 0);
    const old = this.smooth.find(sample => sample.t >= t - 2 * VELOCITY_HALF_MS) ?? this.smooth[0];
    const span = t - old.t;
    const v = span >= VELOCITY_HALF_MS ? (smoothed - old.x) / (span / 1000) / leg : 0;
    if (Math.abs(v) >= STILL_LEG_PER_S) this.lastMoving = t;
    if (Math.abs(v) < WALKING_LEG_PER_S) {
      if (this.run && t - this.run.last > PAUSE_BRIDGE_MS) { this.run = null; this.drift = null; this.resetFeet(); }
      return state(false, 0);
    }
    const dir: 1 | -1 = v > 0 ? 1 : -1;
    if (this.run && t - this.run.last <= PAUSE_BRIDGE_MS && this.run.dir !== dir) {
      if (!this.drift || this.drift.dir !== dir || t - this.drift.last > TRACK_GAP_MS) this.drift = { dir, t0: t, x0: smoothed, last: t };
      this.drift.last = t;
      if (t - this.drift.t0 <= DRIFT_MAX_MS && Math.abs(smoothed - this.drift.x0) < DRIFT_MAX_LEGS * leg) return state(true, dir);
      // It went on: a turn, and a new run from where it began.
      this.run = { dir, t0: this.drift.t0, x0: this.drift.x0, last: t, counted: false };
      this.resetFeet();
    } else if (!this.run || t - this.run.last > PAUSE_BRIDGE_MS) { this.run = { dir, t0: t, x0: smoothed, last: t, counted: false }; this.resetFeet(); }
    this.drift = null;
    this.run.last = t;
    if (!this.run.counted && t - this.run.t0 >= PASS_MIN_MS && Math.abs(smoothed - this.run.x0) >= PASS_MIN_LEGS * leg) {
      this.run.counted = true;
      if (dir !== this.lastPassDir) { this.passes++; this.lastPassDir = dir; }
    }
    for (const foot of [0, 1] as Side[]) {
      const f = (footX(lm, foot, aspect) - smoothed) * dir;
      if (finite(f)) this.track(foot, f, t, STRIKE_PROMINENCE_LEGS * leg);
    }
    return state(true, dir);
  }

  /** Peak-and-trough tracking with the prominence as hysteresis: a strike once the foot has dropped back from a peak. */
  private track(foot: Side, f: number, t: number, prominence: number) {
    const track = this.feet[foot];
    if (track.rising) {
      if (f > track.extreme) { track.extreme = f; track.at = t; }
      else if (track.extreme - f >= prominence) { this.strike(foot, track.at); track.rising = false; track.extreme = f; }
    } else if (f < track.extreme) track.extreme = f;
    else if (f - track.extreme >= prominence) { track.rising = true; track.extreme = f; track.at = t; }
  }

  private strike(foot: Side, at: number) {
    if (at - this.lastStrike[foot] < SAME_FOOT_MS || Math.abs(at - this.lastStrike[1 - foot]) < MERGE_STRIKES_MS) return;
    this.lastStrike[foot] = at;
    this.steps++;
  }

  private resetFeet() { this.feet = [freshFoot(), freshFoot()]; }
}

// ---------------------------------------------------------------- synthetic walker (tests and the simulator)

export type SyntheticWalkParams = {
  /** Leg length (hip to ankle) in frame heights at scale 1. */
  legLength?: number;
  /** The camera's distance: every size × this (smaller is further away). */
  scale?: number;
  /** The picture's width over its height. */
  aspect?: number;
  fps?: number;
  /** Steps a minute, and the mean step length in leg lengths. */
  cadence?: number;
  stepLength?: number;
  /** Side B's step length and step time over side A's (1 = even). */
  stepLengthRatio?: number;
  stepTimeRatio?: number;
  /** Peak knee bend in swing, degrees: one value for both legs, or [A, B]. */
  kneeFlex?: number | [number, number];
  /** Forward trunk lean while walking and while standing, degrees. */
  trunkLean?: number;
  standingLean?: number;
  /** Walks across and back (2); 0 stands still throughout. */
  passes?: number;
  /** Share of the picture's width walked in each pass. */
  across?: number;
  /** Standing before the walk, turning between passes, standing after it (ms). */
  startMs?: number;
  turnMs?: number;
  endMs?: number;
  /** Landmark visibility, and noise (standard deviation in frame heights) on every point. */
  visibility?: number;
  noise?: number;
  seed?: number;
  /** "side": across the picture, side-on (as set up); "toward": facing the camera, walking toward it and back. */
  view?: "side" | "toward";
  /** Moves the whole figure down (+) or up (−), in frame heights: feet or head out of the picture. */
  yShift?: number;
  /** Heel strikes (counted from the first, across passes) around which the camera loses that foot. */
  missStrikes?: number[];
  /** 1: the first pass walks toward the picture's right; −1: toward its left. */
  startDir?: 1 | -1;
  /**
   * Stop-and-go (a walking frame, stepping to): after every `pauseEvery` steps, and after the heel strikes listed in
   * `pauseAfter` (counted from the first, across passes), the walker stands still on both feet for `pauseMs`.
   */
  pauseMs?: number;
  pauseEvery?: number;
  pauseAfter?: number[];
};

type P2 = { X: number; Y: number };
/** One moment of the stick figure, in frame heights (X across, Y down). */
type Body = { pelvis: P2; leg: number; fx: number; breadth: number; lean: number; ankles: [P2, P2]; kneeDir: 1 | -1 };

/**
 * The swinging foot's share of its way at u (0-1 of the swing): it leaves the floor at rest and lands moving at `end`
 * (its share per swing), the pelvis's own speed, so its lead over the pelvis peaks right at the heel strike.
 */
const swingEase = (u: number, end: number) => u * u * (3 - 2 * u) + end * (u * u * u - u * u);
/** The share of a step both feet are on the floor before the swinging foot leaves it. */
const DOUBLE_SUPPORT = 0.2;
/** The stance leg is this share of the leg's length from hip to ankle (nearly straight). */
const REACH = 0.995;
const ANKLE_HEIGHT = 0.08;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The knee of a two-part leg (thigh and shank each half the leg) between hip and ankle, bending toward `dir`. */
function kneeBetween(hip: P2, ankle: P2, leg: number, dir: 1 | -1): P2 {
  const dx = ankle.X - hip.X, dy = ankle.Y - hip.Y, d = Math.hypot(dx, dy) || 1e-9;
  const h = Math.sqrt(Math.max(0, (leg / 2) ** 2 - (d / 2) ** 2));
  const mid = { X: hip.X + dx / 2, Y: hip.Y + dy / 2 }, nx = -dy / d, ny = dx / d;
  const a = { X: mid.X + h * nx, Y: mid.Y + h * ny }, b = { X: mid.X - h * nx, Y: mid.Y - h * ny };
  return (a.X - b.X) * dir >= 0 ? a : b;
}

/** The 33 pose points of one moment of the stick figure (before noise and visibility), in frame heights. */
function bodyPoints(body: Body): { p: P2; side: -1 | 0 | 1 }[] {
  const { pelvis, leg: L, fx, breadth: b, lean } = body;
  const torso = 0.66 * L, rad = lean / DEG;
  const hips: P2[] = [{ X: pelvis.X + 0.17 * L * b, Y: pelvis.Y }, { X: pelvis.X - 0.17 * L * b, Y: pelvis.Y }];
  const forwardSign = fx >= 0 ? 1 : -1;
  const shoulderMid = { X: pelvis.X + torso * Math.sin(rad) * fx, Y: pelvis.Y - torso * Math.cos(rad) };
  const shoulders: P2[] = [
    { X: shoulderMid.X + 0.25 * L * b + 0.03 * L * fx, Y: shoulderMid.Y },
    { X: shoulderMid.X - 0.25 * L * b - 0.03 * L * fx, Y: shoulderMid.Y },
  ];
  const ankles = body.ankles.map((ankle, s) => {
    // A leg cannot stretch past straight: a foot too far behind lifts its heel (the ankle rises).
    const hip = hips[s], dx = ankle.X - hip.X, reach = REACH * L;
    return Math.hypot(dx, ankle.Y - hip.Y) > reach ? { X: ankle.X, Y: hip.Y + Math.sqrt(Math.max(0, reach * reach - dx * dx)) } : ankle;
  });
  const knees = ankles.map((ankle, s) => kneeBetween(hips[s], ankle, L, body.kneeDir));
  // Arms swing against the legs on the same side.
  const arm = (s: number) => {
    const thigh = Math.atan2((knees[s].X - hips[s].X) * forwardSign, knees[s].Y - hips[s].Y);
    const swing = -0.7 * thigh;
    const elbow = { X: shoulders[s].X + 0.3 * L * Math.sin(swing) * forwardSign, Y: shoulders[s].Y + 0.3 * L * Math.cos(swing) };
    const wrist = { X: elbow.X + 0.27 * L * Math.sin(swing + 0.25) * forwardSign, Y: elbow.Y + 0.27 * L * Math.cos(swing + 0.25) };
    return { elbow, wrist };
  };
  const arms = [arm(0), arm(1)];
  const headX = shoulderMid.X + 0.05 * L * fx, earY = shoulderMid.Y - 0.3 * L;
  const at = (X: number, Y: number): P2 => ({ X, Y });
  const points: { p: P2; side: -1 | 0 | 1 }[] = [];
  const set = (i: number, p: P2, side: -1 | 0 | 1 = 0) => { points[i] = { p, side }; };
  set(0, at(headX + 0.1 * L * fx, earY + 0.03 * L));
  [1, 2, 3].forEach((i, k) => set(i, at(headX + 0.07 * L * fx + (0.03 + 0.01 * k) * L * b, earY - 0.01 * L)));
  [4, 5, 6].forEach((i, k) => set(i, at(headX + 0.07 * L * fx - (0.03 + 0.01 * k) * L * b, earY - 0.01 * L)));
  set(7, at(headX - 0.02 * L * fx + 0.07 * L * b, earY));
  set(8, at(headX - 0.02 * L * fx - 0.07 * L * b, earY));
  set(9, at(headX + 0.08 * L * fx + 0.02 * L * b, earY + 0.08 * L));
  set(10, at(headX + 0.08 * L * fx - 0.02 * L * b, earY + 0.08 * L));
  for (const s of [0, 1]) {
    const side = s === 0 ? -1 : 1;
    set(11 + s, shoulders[s], side);
    set(13 + s, arms[s].elbow, side);
    set(15 + s, arms[s].wrist, side);
    set(17 + s, at(arms[s].wrist.X + 0.03 * L * forwardSign, arms[s].wrist.Y + 0.06 * L), side);
    set(19 + s, at(arms[s].wrist.X + 0.04 * L * forwardSign, arms[s].wrist.Y + 0.05 * L), side);
    set(21 + s, at(arms[s].wrist.X + 0.04 * L * forwardSign, arms[s].wrist.Y + 0.02 * L), side);
    set(23 + s, hips[s], side);
    set(25 + s, knees[s], side);
    set(27 + s, ankles[s], side);
    set(29 + s, at(ankles[s].X - 0.07 * L * fx, ankles[s].Y + 0.06 * L), side);
    set(31 + s, at(ankles[s].X + 0.2 * L * fx, ankles[s].Y + 0.07 * L), side);
  }
  return points;
}

/**
 * A synthetic walker as the pose model would report it: a stick figure standing at one edge of the picture, walking
 * across side-on (feet planted in stance, swinging through with the asked-for knee bend, the pelvis bobbing over the
 * stance leg), turning toward the camera, walking back and standing still. Or, with view "toward", facing the camera
 * and walking toward it and back. For the tests and the simulator.
 */
export function syntheticWalk(params: SyntheticWalkParams = {}): GaitFrame[] {
  const aspect = params.aspect ?? 4 / 3, fps = params.fps ?? 30, scale = params.scale ?? 1;
  const L = (params.legLength ?? 0.27) * scale, reach = REACH * L, ankleH = ANKLE_HEIGHT * L;
  const ground = 0.5 + 1.05 * L + (params.yShift ?? 0);
  const meanLength = (params.stepLength ?? 0.75) * L, lengthRatio = params.stepLengthRatio ?? 1, timeRatio = params.stepTimeRatio ?? 1;
  const meanMs = 60000 / (params.cadence ?? 100);
  const stepLen = [2 * meanLength / (1 + lengthRatio), 2 * meanLength * lengthRatio / (1 + lengthRatio)];
  const stepMs = [2 * meanMs / (1 + timeRatio), 2 * meanMs * timeRatio / (1 + timeRatio)];
  const flex = Array.isArray(params.kneeFlex) ? params.kneeFlex : [params.kneeFlex ?? 60, params.kneeFlex ?? 60];
  const walkLean = params.trunkLean ?? 2, standLean = params.standingLean ?? 0;
  const passes = Math.max(0, Math.round(params.passes ?? 2));
  const startMs = params.startMs ?? 1000, turnMs = params.turnMs ?? 1400, endMs = params.endMs ?? 2000;
  const across = (params.across ?? 0.75) * aspect;
  const pauseMs = Math.max(0, params.pauseMs ?? 0), pauseEvery = Math.max(0, Math.round(params.pauseEvery ?? 0)), pauseAfter = params.pauseAfter ?? [];
  const random = mulberry32(params.seed ?? 1);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

  type Swing = { t0: number; t1: number; x0: number; x1: number; lift: number; end: number };
  const swings: Swing[][] = [[], []];
  const pelvisKeys: { t: number; x: number }[] = [];
  const spans: { t0: number; t1: number }[] = [];
  const turns: { t0: number; t1: number; from: 1 | -1 }[] = [];
  const strikes: { t: number; foot: Side }[] = [];
  const firstDir: 1 | -1 = params.startDir ?? 1;
  let dir = firstDir;
  let x = params.view === "toward" ? aspect / 2 : dir > 0 ? (aspect - across) / 2 : (aspect + across) / 2;
  const feet = [x, x], startX = x;
  let t = startMs;
  pelvisKeys.push({ t: 0, x });
  if (params.view === "toward") {
    // Facing the camera: steps in place while the figure grows (coming closer) and shrinks (going back).
    const stepsEach = 6;
    for (let p = 0; p < passes; p++) {
      const start = t;
      for (let k = 0; k < stepsEach; k++) {
        const foot = (k % 2) as Side, ms = stepMs[foot];
        swings[foot].push({ t0: t + DOUBLE_SUPPORT * ms, t1: t + ms, x0: x, x1: x, lift: 0.1 * L, end: 0 });
        t += ms;
        strikes.push({ t, foot });
      }
      spans.push({ t0: start, t1: t });
      if (p < passes - 1) { turns.push({ t0: t, t1: t + turnMs, from: 1 }); t += turnMs; }
    }
  } else {
    for (let p = 0; p < passes; p++) {
      pelvisKeys.push({ t, x });
      const start = t, end = x + dir * across;
      let placed = x, foot = (p % 2) as Side, moved = false;
      while ((placed + dir * stepLen[foot] - end) * dir <= 1e-9) {
        const next = placed + dir * stepLen[foot], ms = stepMs[foot];
        swings[foot].push({ t0: t + DOUBLE_SUPPORT * ms, t1: t + ms, x0: feet[foot], x1: next, lift: 0, end: 0 });
        pelvisKeys.push({ t: t + ms, x: (placed + next) / 2 });
        feet[foot] = next;
        t += ms;
        strikes.push({ t, foot });
        // A stop on both feet, the pelvis between them.
        const struck = strikes.length;
        if (pauseMs > 0 && ((pauseEvery > 0 && struck % pauseEvery === 0) || pauseAfter.includes(struck - 1))) {
          t += pauseMs;
          pelvisKeys.push({ t, x: (placed + next) / 2 });
        }
        placed = next;
        foot = (1 - foot) as Side;
        moved = true;
      }
      if (moved) {
        // The trailing foot comes alongside, and the walker stops.
        const ms = stepMs[foot];
        swings[foot].push({ t0: t + DOUBLE_SUPPORT * ms, t1: t + ms, x0: feet[foot], x1: placed, lift: 0, end: 0 });
        feet[foot] = placed;
        t += ms;
        pelvisKeys.push({ t, x: placed });
      }
      spans.push({ t0: start, t1: t });
      x = placed;
      if (p < passes - 1) { turns.push({ t0: t, t1: t + turnMs, from: dir }); t += turnMs; pelvisKeys.push({ t, x }); dir = -dir as 1 | -1; }
    }
  }
  const total = t + endMs;
  pelvisKeys.push({ t: total, x });

  const pelvisAt = (time: number) => {
    for (let k = 1; k < pelvisKeys.length; k++) {
      const a = pelvisKeys[k - 1], b = pelvisKeys[k];
      if (time <= b.t) return b.t > a.t ? a.x + (b.x - a.x) * clamp((time - a.t) / (b.t - a.t), 0, 1) : b.x;
    }
    return pelvisKeys[pelvisKeys.length - 1].x;
  };
  const footAt = (foot: Side, time: number): { x: number; lift: number; planted: boolean } => {
    let x0 = startX;
    for (const swing of swings[foot]) {
      if (time < swing.t0) break;
      if (time <= swing.t1) {
        const u = (time - swing.t0) / (swing.t1 - swing.t0);
        return { x: swing.x0 + (swing.x1 - swing.x0) * swingEase(u, swing.end), lift: swing.lift * Math.sin(Math.PI * u), planted: false };
      }
      x0 = swing.x1;
    }
    return { x: x0, lift: 0, planted: true };
  };
  // The pelvis rides on the planted feet: the stance leg nearly straight, lowest when both feet are down and apart.
  const hipDrop = (time: number, P: number) => {
    let height = reach;
    for (const foot of [0, 1] as Side[]) {
      const at = footAt(foot, time);
      if (at.planted) height = Math.min(height, Math.sqrt(Math.max(0, reach * reach - (at.x - P) ** 2)));
    }
    return height;
  };
  // Each side-on swing lands at the pelvis's speed, and lifts the foot just enough for its knee to bend to the
  // asked-for peak.
  if (params.view !== "toward") {
    for (const foot of [0, 1] as Side[]) {
      for (const swing of swings[foot]) {
        const way = Math.abs(swing.x1 - swing.x0), pelvisSpeed = Math.abs(pelvisAt(swing.t1) - pelvisAt(swing.t1 - 1));
        swing.end = way > 0 ? clamp(pelvisSpeed * (swing.t1 - swing.t0) / way, 0, 2) : 0;
      }
    }
    for (const foot of [0, 1] as Side[]) {
      for (const swing of swings[foot]) {
        const peak = (lift: number) => {
          let most = 0;
          for (let k = 0; k <= 32; k++) {
            const u = k / 32, time = swing.t0 + u * (swing.t1 - swing.t0), P = pelvisAt(time);
            const sx = swing.x0 + (swing.x1 - swing.x0) * swingEase(u, swing.end);
            const d = Math.min(reach, Math.hypot(sx - P, hipDrop(time, P) - lift * Math.sin(Math.PI * u)));
            most = Math.max(most, 2 * Math.acos(Math.min(1, d / L)) * DEG);
          }
          return most;
        };
        if (peak(0) >= flex[foot]) continue;
        let low = 0, high = 0.9 * L;
        for (let k = 0; k < 30; k++) { const middle = (low + high) / 2; if (peak(middle) < flex[foot]) low = middle; else high = middle; }
        swing.lift = (low + high) / 2;
      }
    }
  }
  const meanStepMs = (stepMs[0] + stepMs[1]) / 2;
  const hidden = (params.missStrikes ?? []).flatMap(k => strikes[k] ? [{ foot: strikes[k].foot, t0: strikes[k].t - 0.85 * meanStepMs, t1: strikes[k].t + 0.85 * meanStepMs }] : []);
  const baseVisibility = params.visibility ?? 0.95, noise = params.noise ?? 0;

  const bodyAt = (time: number): Body => {
    const turn = turns.find(item => time > item.t0 && time < item.t1);
    const turnsDone = turns.filter(item => time >= item.t1).length;
    const walking = spans.some(span => time >= span.t0 && time <= span.t1);
    const P = pelvisAt(time);
    if (params.view === "toward") {
      // Toward the camera on even passes, away on odd ones; the hips stay at the camera's height, mid-picture.
      const pass = spans.findIndex(span => time >= span.t0 && time <= span.t1);
      const grow = (span: { t0: number; t1: number }) => clamp((time - span.t0) / (span.t1 - span.t0), 0, 1);
      const sizeAt = pass < 0 ? (time < spans[0]?.t0 || !spans.length ? 1 : turnsDone % 2 ? 1 : 1.35) : pass % 2 ? 1.35 - 0.35 * grow(spans[pass]) : 1 + 0.35 * grow(spans[pass]);
      const size = turn ? 1.35 : sizeAt;
      const leg = L * size, u = turn ? (time - turn.t0) / (turn.t1 - turn.t0) : 0;
      const breadth = turn ? Math.cos(Math.PI * u) : turnsDone % 2 ? -1 : 1;
      const hipY = 0.5 + (params.yShift ?? 0) - 0.05;
      const sway = 0.015 * leg * Math.sin(2 * Math.PI * time / (2 * meanStepMs));
      const ankles = ([0, 1] as Side[]).map(foot => {
        const at = footAt(foot, time), spread = (foot === 0 ? 1 : -1) * 0.12 * leg * breadth;
        return { X: P + sway + spread, Y: hipY + REACH * leg - at.lift * size };
      }) as [P2, P2];
      return { pelvis: { X: P + sway, Y: hipY }, leg, fx: turn ? Math.sin(Math.PI * u) : 0, breadth, lean: 0, ankles, kneeDir: 1 };
    }
    const from = turn ? turn.from : turnsDone % 2 ? -firstDir as 1 | -1 : firstDir;
    const u = turn ? (time - turn.t0) / (turn.t1 - turn.t0) : 0;
    const fx = turn ? Math.cos(Math.PI * u) * from : from;
    const breadth = turn ? Math.sin(Math.PI * u) : 0;
    const hipY = ground - ankleH - hipDrop(time, P);
    const ankles = ([0, 1] as Side[]).map(foot => {
      const at = footAt(foot, time), spread = (foot === 0 ? 1 : -1) * 0.12 * L * breadth;
      return { X: at.x + spread, Y: ground - ankleH - at.lift };
    }) as [P2, P2];
    return { pelvis: { X: P, Y: hipY }, leg: L, fx, breadth, lean: walking ? walkLean : standLean, ankles, kneeDir: fx > 0.05 ? 1 : fx < -0.05 ? -1 : from };
  };

  const frames: GaitFrame[] = [];
  for (let k = 0; k * 1000 / fps <= total; k++) {
    const time = k * 1000 / fps, body = bodyAt(time);
    const lostFeet = hidden.filter(item => time > item.t0 && time < item.t1).map(item => item.foot);
    const landmarks = bodyPoints(body).map(({ p, side }, i) => {
      const X = p.X + gauss() * noise, Y = p.Y + gauss() * noise;
      const point = { x: X / aspect, y: Y, z: 0 };
      // The far side is seen a little less well; a point outside the picture hardly at all; a lost foot not at all.
      const far = side === -1 ? Math.max(0, body.fx) : side === 1 ? Math.max(0, -body.fx) : 0;
      const footSide = i >= 27 && (i - 27) % 2 === 0 ? 0 : i >= 27 ? 1 : -1;
      const lost = footSide >= 0 && lostFeet.includes(footSide as Side);
      const visibility = lost ? 0.02 : !inFrame(point) ? 0.05 : baseVisibility * (1 - 0.15 * far);
      return { ...point, visibility };
    });
    frames.push({ t: time, landmarks, aspect });
  }
  return frames;
}
