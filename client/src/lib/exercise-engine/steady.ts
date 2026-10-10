import type { PoseInput } from "./metrics";

// Steadied points for DRAWING only: every measure, hold and score uses the trackers' own readings. A One Euro filter
// per point: still while the point is still (the tracker's frame-to-frame jitter averaged away), following at once as
// it moves, and never faster than a body part could move, so a one-frame glitch glides instead of jumping. No extra
// tracking work: a few multiplications a point a frame. Positions are raw (unmirrored) image coordinates: x in frame
// widths, y in frame heights.

type P2 = { x: number; y: number };
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export type SteadyOptions = {
  /** Cutoff with the point still (Hz), its rise per `scale` unit a second of speed, and the speed estimate's cutoff (Hz). */
  minCutoff: number; beta: number; speedCutoff: number;
  /** The drawn point's top speed, frame heights a second. */
  glide: number;
};

/** One steadied point. `scale` (frame heights) sets the size its speed is measured in, so near and far patients suit the same settings. */
export class SteadyPoint {
  private at: P2 | null = null;
  private raw: P2 | null = null;
  private speed = { x: 0, y: 0 };
  private t = 0;

  constructor(private readonly options: SteadyOptions) {}

  /** Start the drawing at `from` (where the thing was), so it slides to the next reading rather than jumping. */
  start(from: P2, t: number) { this.at = { ...from }; this.raw = { ...from }; this.speed = { x: 0, y: 0 }; this.t = t; }

  get current(): P2 | null { return this.at ? { ...this.at } : null; }

  /** No reading this frame: the point stays, and the clock moves on (so the next reading cannot jump it far). */
  touch(t: number) { if (this.at) this.t = t; }

  /** The drawn point after a reading `p` at `t` ms. aspect: the picture's width over its height. */
  next(t: number, p: P2, aspect: number, scale: number): P2 {
    if (!this.at || !this.raw) { this.start(p, t); return { ...p }; }
    const dt = clamp((t - this.t) / 1000, 0.001, 0.1);
    this.t = t;
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    // The speed estimate filters the velocity, not its size, so a still point's noise averages out.
    const k = alpha(this.options.speedCutoff), unit = Math.max(0.01, scale);
    this.speed = {
      x: this.speed.x + k * ((p.x - this.raw.x) * aspect / unit / dt - this.speed.x),
      y: this.speed.y + k * ((p.y - this.raw.y) / unit / dt - this.speed.y),
    };
    this.raw = { ...p };
    let a = alpha(this.options.minCutoff + this.options.beta * Math.hypot(this.speed.x, this.speed.y));
    const gap = Math.hypot((p.x - this.at.x) * aspect, p.y - this.at.y);
    if (gap > 0 && a * gap > this.options.glide * dt) a = this.options.glide * dt / gap;
    this.at = { x: this.at.x + a * (p.x - this.at.x), y: this.at.y + a * (p.y - this.at.y) };
    return { ...this.at };
  }
}

/** The drawn body's settings: the body model may run every other frame, so its readings step and jitter. */
export const POSE_STEADY: SteadyOptions = { minCutoff: 1.2, beta: 0.5, speedCutoff: 1, glide: 3 };
/**
 * The elbows' second pass. The body model's elbow shakes far more than the rest of the drawn body (replaying the
 * user's warm-up recording: about 9 times the shoulder's shake after the first pass), so each elbow is steadied twice:
 * the second pass takes out about two thirds of that shake, for about 60 ms more trail while the arm moves.
 */
export const ELBOW_STEADY: SteadyOptions = { minCutoff: 1.5, beta: 1, speedCutoff: 1, glide: 3 };
/** Second passes for single landmarks: the elbows (13 left, 14 right). */
const POSE_SECOND: Record<number, SteadyOptions> = { 13: ELBOW_STEADY, 14: ELBOW_STEADY };
/** After this long without a body, the drawing starts afresh rather than gliding from where it was, ms. */
const POSE_LOST_MS = 1000;

/**
 * The drawn body: each landmark steadied (SteadyPoint; the elbows twice, ELBOW_STEADY), with `override` points (the
 * hand model's wrist, which sits on the real wrist and updates every frame) drawn in place of the body model's own,
 * and shown even where the body model was unsure of them. scale: a body size in frame heights (the shoulder width),
 * for the speeds.
 */
export class SteadyPose {
  private points: SteadyPoint[][] = [];
  private lastT = -Infinity;

  constructor(private readonly options: SteadyOptions = POSE_STEADY, private readonly second: Record<number, SteadyOptions> = POSE_SECOND) {}

  reset() { this.points = []; this.lastT = -Infinity; }

  next(t: number, pose: PoseInput | null, aspect: number, scale: number, override: Record<number, P2> = {}): PoseInput | null {
    if (!pose) return null;
    if (t - this.lastT > POSE_LOST_MS) this.points = [];
    this.lastT = t;
    const landmarks = pose.landmarks.map((p, index) => {
      const own = override[index], source = own ?? p;
      if (!Number.isFinite(source.x) || !Number.isFinite(source.y)) return p;
      const passes = (this.points[index] ??= [this.options, this.second[index]].filter((o): o is SteadyOptions => !!o).map(o => new SteadyPoint(o)));
      const at = passes.reduce((q, pass) => pass.next(t, q, aspect, scale), { x: source.x, y: source.y });
      return own ? { ...p, x: at.x, y: at.y, visibility: 1 } : { ...p, x: at.x, y: at.y };
    });
    return { landmarks, world: pose.world };
  }
}
