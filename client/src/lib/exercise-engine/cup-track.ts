import type { Side } from "./config";
import { poseJoints, type PoseInput, type Pt } from "./metrics";

/**
 * Where to DRAW the hand-to-mouth cup and the affected arm, so the drawing does not jump. Display only:
 * contact, holds and scores still come from the measured pose (mouth-hold.ts, buildFrame).
 *
 * With the hand in front of the face the pose model flips the forearm from folded to hanging down within one
 * frame, with high confidence, for 100 ms to about a second. A real hand never teleports, so:
 * - a reading that follows on from the drawn one at a real hand's speed is drawn at once;
 * - a reading that does not starts a rival place, drawn only once readings have stayed there for CONFIRM_MS,
 *   or, for a drop while the cup is meant to rise or stay (the known forearm flip), for DROP_CONFIRM_MS,
 *   which outlasts the flips;
 * - a reading that leaves the rival place again, for somewhere the hand could have reached since it was last
 *   drawn, ends the excursion at once (the tracker found the hand again after it moved);
 * - while MouthHold holds the arm at the mouth, the held arm is drawn and no rival takes over: the hold's own
 *   exit decides, and a rival that has already lasted long enough is drawn as soon as the hold lets go. The
 *   one exception is a hand seen leaving the mouth smoothly: it is drawn moving, not frozen until the hold
 *   lets go, and any flicker hands the drawing back to the hold;
 * - a hand unseen for a while is no longer drawn, but its last place still judges the next readings, so the
 *   first reading after the gap cannot be a flip drawn unchecked.
 * The drawn arm and cup are smoothed together (a One Euro filter driven by the cup, one blend factor for every
 * arm point so the skeleton stays on the cup) and never move faster than GLIDE_SPEED, so a takeover slides.
 */
export const CUP_TRACK = {
  /** A real hand's top speed, torso lengths per second (measured peaks 4-5). */
  speed: 5,
  /** Landmark noise allowed on top of that per step, torso lengths. */
  slack: 0.08,
  /** Steps after a gap in readings are judged as if at most this much time had passed (as MOUTH_HOLD). */
  maxStepGapMs: 100,
  /** A rival place is drawn once readings have stayed there this long... */
  confirmMs: 200,
  /** ...or this long for a drop while the cup should rise or stay: past the longest flips (about 1 s), short of MOUTH_HOLD.exitMs. */
  dropConfirmMs: 1200,
  /** A rival at least this far below the drawn place (torso lengths) is a drop. */
  dropTorso: 0.15,
  /** With the hand missing, the last drawing stays this long... */
  graceMs: 300,
  /** ...and after this long the track starts afresh with the next reading. */
  lostMs: 1000,
  /** The drawing never moves faster than this (torso lengths per second): a takeover glides. */
  glideSpeed: 8,
  /** One Euro filter: cutoff at rest (Hz), its rise per torso length per second, and the speed estimate's cutoff (Hz). */
  minCutoff: 1,
  beta: 2,
  speedCutoff: 1,
};

type Point = { x: number; y: number };
type Reading = Point & { t: number };
export type CupTrackScale = { torso: number; aspect: number };
export type CupTrackContext = {
  /** MouthHold's pose when it holds the arm at the mouth this frame (MouthHoldResult.held). */
  held?: PoseInput | null;
  /** The patient is lowering the cup (the return step): a drop is expected, not suspect. */
  lowering?: boolean;
};
export type CupDisplay = {
  /** Where to draw the cup, or null when the hand has not been seen for a while. */
  cup: Point | null;
  /** The pose to DRAW (never to measure): the live pose with the affected arm from the drawn track, smoothed. */
  pose: PoseInput | null;
  /** This reading was not drawn (it disagreed with the drawn track). */
  flicker: boolean;
};

const HAND: Record<Side, number[]> = { left: [19, 17, 21], right: [20, 18, 22] };
const armIndices = (side: Side) => { const j = poseJoints(side); return [j.elbow, j.wrist, ...HAND[side]]; };
const inFrame = (point: Pt | undefined): point is Pt => !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x > 0.01 && point.x < 0.99 && point.y > 0.01 && point.y < 0.99;

/**
 * The middle of the affected hand (index, pinky and thumb), steadier than any one of them. A fixed set: a
 * point's own confidence flickering across a threshold does not move it. Needs the wrist in view, as
 * mouthContactPoints does.
 */
export function handCentre(pose: PoseInput | null, side: Side): Point | null {
  const wrist = pose?.landmarks[poseJoints(side).wrist];
  if (!pose || !inFrame(wrist) || (wrist.visibility ?? 1) < 0.5) return null;
  const points = HAND[side].map(index => pose.landmarks[index]).filter(inFrame);
  if (!points.length) return null;
  return { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length };
}

/** A One Euro filter driven by the cup, applied with one blend factor to the whole arm. */
class ArmSmoother {
  private arm: Pt[] | null = null;
  private cup: Point | null = null;
  private target: Point | null = null;
  private velocity: Point = { x: 0, y: 0 };
  private t = 0;

  reset() {
    this.arm = null;
    this.cup = null;
    this.target = null;
    this.velocity = { x: 0, y: 0 };
  }

  next(t: number, arm: Pt[], cup: Point, scale: CupTrackScale): { arm: Pt[]; cup: Point } {
    if (!this.arm || !this.cup || !this.target) {
      this.arm = arm.map(point => ({ ...point }));
      this.cup = { ...cup };
      this.target = { ...cup };
      this.t = t;
      return { arm: this.arm.map(point => ({ ...point })), cup: { ...cup } };
    }
    const dt = Math.min(CUP_TRACK.maxStepGapMs, Math.max(1, t - this.t)) / 1000;
    this.t = t;
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    // The speed estimate filters the velocity, not its size, so a still hand's noise averages out.
    const k = alpha(CUP_TRACK.speedCutoff);
    this.velocity = {
      x: this.velocity.x + k * ((cup.x - this.target.x) * scale.aspect / scale.torso / dt - this.velocity.x),
      y: this.velocity.y + k * ((cup.y - this.target.y) / scale.torso / dt - this.velocity.y),
    };
    this.target = { ...cup };
    let a = alpha(CUP_TRACK.minCutoff + CUP_TRACK.beta * Math.hypot(this.velocity.x, this.velocity.y));
    const gap = Math.hypot((cup.x - this.cup.x) * scale.aspect, cup.y - this.cup.y) / scale.torso;
    if (a * gap > CUP_TRACK.glideSpeed * dt) a = CUP_TRACK.glideSpeed * dt / gap;
    const mix = (from: number, to: number) => from + a * (to - from);
    this.arm = this.arm.map((from, i) => arm[i] ? { ...arm[i], x: mix(from.x, arm[i].x), y: mix(from.y, arm[i].y), z: mix(from.z, arm[i].z) } : from);
    this.cup = { x: mix(this.cup.x, cup.x), y: mix(this.cup.y, cup.y) };
    return { arm: this.arm.map(point => ({ ...point })), cup: { ...this.cup } };
  }
}

export class CupTrack {
  /** The last reading drawn, with its pose. */
  private drawn: { at: Reading; pose: PoseInput } | null = null;
  /** Readings that broke away from the drawn place and stay together. */
  private rival: { at: Reading; since: number; drop: boolean } | null = null;
  /** The previous reading, drawn or not. */
  private last: Reading | null = null;
  /** The hand went unseen for LOST_MS: `drawn` only judges the next readings and is not drawn. */
  private stale = false;
  /** This frame's reading simply followed on from the drawn place. */
  private followed = false;
  /** The drawn track has followed the hand continuously from the mouth while MouthHold still holds. */
  private departing = false;
  private smoother = new ArmSmoother();

  reset() {
    this.drawn = null;
    this.rival = null;
    this.last = null;
    this.stale = false;
    this.followed = false;
    this.departing = false;
    this.smoother.reset();
  }

  /**
   * `live` is the tracker's own pose (not MouthHold's): the track has to see the flips to time them.
   * `scale.torso` is session.lapPoint.bodyScale (image heights); `scale.aspect` is width / height.
   */
  update(t: number, live: PoseInput | null, side: Side, scale: CupTrackScale, context: CupTrackContext = {}): CupDisplay {
    if (this.last && t - this.last.t > CUP_TRACK.lostMs) {
      this.rival = null;
      this.last = null;
      this.stale = this.drawn !== null;
      this.smoother.reset();
    }
    const held = context.held ?? null;
    const point = handCentre(live, side);
    const drawnNow = point ? this.observe({ ...point, t }, live!, scale, !!context.lowering, !!held) : false;
    if (point) this.last = { ...point, t };
    // At the mouth (or with no hold) the track agrees with the live reading; a flicker, gap or takeover while
    // held hands the drawing back to MouthHold for the rest of the hold.
    if (!held) this.departing = drawnNow;
    else if (!(drawnNow && this.followed)) this.departing = false;
    const drawHeld = held && !this.departing ? held : null;
    const source = drawHeld ?? (this.drawn && !this.stale && this.last && t - this.last.t <= CUP_TRACK.graceMs ? this.drawn.pose : null);
    const cup = handCentre(source, side) ?? (source && this.drawn ? this.drawn.at : null);
    if (!source || !cup) {
      this.smoother.reset();
      return { cup: null, pose: live, flicker: !!point && !drawnNow };
    }
    const indices = armIndices(side);
    const shown = this.smoother.next(t, indices.map(index => source.landmarks[index]), cup, scale);
    const base = drawHeld ?? live ?? source;
    const landmarks = [...base.landmarks];
    indices.forEach((index, i) => { landmarks[index] = shown.arm[i]; });
    return { cup: shown.cup, pose: { landmarks, world: base.world }, flicker: !!point && !drawnNow };
  }

  /** Sorts one reading of the hand; true when it is drawn. */
  private observe(at: Reading, pose: PoseInput, scale: CupTrackScale, lowering: boolean, holding: boolean): boolean {
    this.followed = false;
    const drawn = this.drawn;
    const accept = () => { this.drawn = { at, pose }; this.rival = null; this.stale = false; return true; };
    if (!drawn) return accept();
    const distance = (from: Point) => Math.hypot((at.x - from.x) * scale.aspect, at.y - from.y) / scale.torso;
    const step = CUP_TRACK.speed * Math.min(Math.max(0, at.t - (this.last?.t ?? drawn.at.t)), CUP_TRACK.maxStepGapMs) / 1000 + CUP_TRACK.slack;
    const drop = (at.y - drawn.at.y) / scale.torso >= CUP_TRACK.dropTorso;
    // The hand moving on, or the tracker back where the hand was.
    if (distance(drawn.at) <= step) { this.followed = true; return accept(); }
    if (this.rival && distance(this.rival.at) <= step) {
      this.rival.at = at;
      const wait = this.rival.drop && !lowering ? CUP_TRACK.dropConfirmMs : CUP_TRACK.confirmMs;
      return !holding && at.t - this.rival.since >= wait ? accept() : false;
    }
    // Away from the rival as well, somewhere the hand could have reached since it was last drawn: the tracker
    // has found the hand again after it moved. A drop is never let in this way unless the cup is being lowered.
    const reach = CUP_TRACK.speed * (at.t - drawn.at.t) / 1000 + CUP_TRACK.slack;
    if ((this.rival || this.stale) && (!drop || lowering) && distance(drawn.at) <= reach) return accept();
    this.rival = { at, since: at.t, drop };
    return false;
  }
}
