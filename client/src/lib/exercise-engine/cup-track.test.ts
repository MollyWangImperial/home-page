import { beforeEach, describe, expect, it } from "vitest";
import type { Side } from "./config";
import { poseJoints, type PoseInput } from "./metrics";
import { MouthHold } from "./mouth-hold";
import { observedMouth, seatedPose } from "./mouth-target";
import { CUP_TRACK, CupTrack, handCentre, type CupDisplay, type CupTrackContext } from "./cup-track";

const SIDES: Side[] = ["left", "right"];
const ASPECT = 4 / 3;
const FPS = [30, 15];

let FLIP_SIZE = 0.8;
/**
 * The affected forearm swung down from where the elbow is now, as the tracker guesses with a hand at the face:
 * the hand centre lands FLIP_SIZE torso lengths from where it really is (camera: 0.5 to 1.1).
 */
function flipped(side: Side, hand: number): PoseInput {
  const pose = seatedPose(side, { hand });
  const rest = seatedPose(side);
  const j = poseJoints(side);
  const torso = Math.abs(rest.landmarks[j.hip].y - rest.landmarks[j.shoulder].y);
  const elbow = pose.landmarks[j.elbow], restElbow = rest.landmarks[j.elbow];
  const arm = [j.wrist, ...(side === "left" ? [17, 19, 21] : [18, 20, 22])];
  const hanging = arm.map(index => ({ ...rest.landmarks[index], x: rest.landmarks[index].x + elbow.x - restElbow.x, y: rest.landmarks[index].y + elbow.y - restElbow.y + 0.2 }));
  const from = handCentre(pose, side)!;
  const probe = { landmarks: [...pose.landmarks], world: pose.world };
  arm.forEach((index, i) => { probe.landmarks[index] = hanging[i]; });
  const to = handCentre(probe, side)!;
  const f = FLIP_SIZE / (Math.hypot((to.x - from.x) * ASPECT, to.y - from.y) / torso);
  arm.forEach((index, i) => {
    const p = pose.landmarks[index];
    pose.landmarks[index] = { ...p, x: p.x + f * (hanging[i].x - p.x), y: p.y + f * (hanging[i].y - p.y) };
  });
  return pose;
}
/** The tracker's other guess: the affected hand drawn on the lap, wherever the elbow is. */
function onLap(side: Side, hand: number): PoseInput {
  const pose = seatedPose(side, { hand });
  const rest = seatedPose(side);
  const j = poseJoints(side);
  for (const index of [j.wrist, ...(side === "left" ? [17, 19, 21] : [18, 20, 22])]) pose.landmarks[index] = rest.landmarks[index];
  return pose;
}

beforeEach(() => { FLIP_SIZE = 0.8; });

function scene(side: Side, fps = 30) {
  const frame = 1000 / fps;
  const rest = seatedPose(side);
  const j = poseJoints(side);
  const torso = Math.abs(rest.landmarks[j.hip].y - rest.landmarks[j.shoulder].y);
  const scale = { torso, aspect: ASPECT };
  const track = new CupTrack();
  let t = 0;
  const feed = (pose: PoseInput | null, context: CupTrackContext = {}) => track.update(t += frame, pose, side, scale, context);
  const at = (hand: number, context?: CupTrackContext) => feed(seatedPose(side, { hand }), context);
  const flip = (hand: number, context?: CupTrackContext) => feed(flipped(side, hand), context);
  const centre = (hand: number) => handCentre(seatedPose(side, { hand }), side)!;
  /** Torso lengths from the hand `hand` of the way to the lips. */
  const away = (shown: CupDisplay, hand: number) => shown.cup ? Math.hypot((shown.cup.x - centre(hand).x) * ASPECT, shown.cup.y - centre(hand).y) / torso : Infinity;
  const gap = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot((a.x - b.x) * ASPECT, a.y - b.y) / torso;
  return { track, feed, at, flip, away, gap, centre, scale, frame, torso, now: () => t, advance: (ms: number) => { t += ms; } };
}

describe("hand-to-mouth cup display: steady through forearm flips", () => {
  it.each(SIDES)("the simulated flip is the size asked for, mostly downward (%s)", side => {
    const s = scene(side);
    for (const size of [0.5, 1.1]) {
      FLIP_SIZE = size;
      const to = handCentre(flipped(side, 1), side)!, from = s.centre(1);
      expect(s.gap(to, from)).toBeCloseTo(size, 6);
      expect((to.y - from.y) / s.torso).toBeGreaterThan(0.4);
    }
    FLIP_SIZE = 0.8;
  });

  for (const [fps, size] of [[30, 0.5], [30, 1.1], [15, 0.5], [15, 1.1]]) {
    it.each(SIDES)(`keeps the cup and the arm at the lips through flips of 1 frame to 1 s (%s, ${fps} fps, ${size} torso)`, side => {
      FLIP_SIZE = size;
      const s = scene(side, fps);
      for (let n = 0; n < fps; n++) s.at(1);
      const j = poseJoints(side);
      const lipsWrist = seatedPose(side, { hand: 1 }).landmarks[j.wrist];
      for (const ms of [33, 100, 300, 600, 1000]) {
        const run = Math.max(1, Math.round(ms / s.frame));
        for (let n = 0; n < run; n++) {
          const shown = s.flip(1);
          expect(shown.flicker).toBe(true);
          expect(s.away(shown, 1)).toBeLessThan(0.02);
          expect(s.gap(shown.pose!.landmarks[j.wrist], lipsWrist)).toBeLessThan(0.02);
        }
        for (let n = 0; n < 3; n++) expect(s.away(s.at(1), 1)).toBeLessThan(0.02);
      }
    });
  }

  it.each(SIDES)("never moves while readings alternate between the lips and a hanging arm (%s)", side => {
    const s = scene(side);
    for (let n = 0; n < 30; n++) s.at(1);
    for (let n = 0; n < 120; n++) expect(s.away(n % 3 === 2 ? s.at(1) : s.flip(1), 1)).toBeLessThan(0.02);
  });

  it.each(SIDES)("draws a drop that outlasts the flips, gliding, and comes back quickly (%s)", side => {
    const s = scene(side);
    for (let n = 0; n < 30; n++) s.at(1);
    const shown: CupDisplay[] = [];
    for (let n = 0; n < 60; n++) shown.push(s.flip(1));
    const first = shown.findIndex(display => !display.flicker);
    expect(first * s.frame).toBeGreaterThanOrEqual(CUP_TRACK.dropConfirmMs - s.frame);
    expect(first * s.frame).toBeLessThan(CUP_TRACK.dropConfirmMs + 2 * s.frame);
    for (let n = 1; n < shown.length; n++) expect(s.gap(shown[n].cup!, shown[n - 1].cup!)).toBeLessThanOrEqual(CUP_TRACK.glideSpeed * s.frame / 1000 + 1e-9);
    const hanging = handCentre(flipped(side, 1), side)!;
    expect(s.gap(shown.at(-1)!.cup!, hanging)).toBeLessThan(0.05);
    // Back at the lips: up, so drawn after CONFIRM_MS (plus the glide).
    const back: CupDisplay[] = [];
    for (let n = 0; n < 20; n++) back.push(s.at(1));
    const returned = back.findIndex(display => !display.flicker);
    expect(returned * s.frame).toBeLessThanOrEqual(CUP_TRACK.confirmMs + s.frame);
    expect(s.away(back.at(-1)!, 1)).toBeLessThan(0.03);
  });

  for (const fps of FPS) {
    it.each(SIDES)(`follows real movements up and down promptly (%s, ${fps} fps)`, side => {
      const s = scene(side, fps);
      for (let n = 0; n < fps; n++) s.at(0);
      // Lap to lips in 0.6 s, then (lowering) back in 0.4 s: about 2 and 3 torso lengths per second.
      const up = Math.round(600 / s.frame), down = Math.round(400 / s.frame);
      let worst = 0;
      for (let step = 1; step <= up; step++) { const shown = s.at(step / up); expect(shown.flicker).toBe(false); worst = Math.max(worst, s.away(shown, step / up)); }
      for (let n = 0; n < fps / 2; n++) s.at(1);
      for (let step = 1; step <= down; step++) { const shown = s.at(1 - step / down, { lowering: true }); expect(shown.flicker).toBe(false); worst = Math.max(worst, s.away(shown, 1 - step / down)); }
      expect(worst).toBeLessThan(0.2);
      let settled = Infinity;
      for (let n = 0; n < fps / 2; n++) settled = s.away(s.at(0), 0);
      expect(settled).toBeLessThan(0.01);
    });
  }

  it.each(SIDES)("a drop that is not the flip (the hand really lowered) is drawn quickly while lowering (%s)", side => {
    const s = scene(side);
    for (let n = 0; n < 30; n++) s.at(1);
    // The tracker misses the movement and finds the hand on the lap.
    const shown: CupDisplay[] = [];
    for (let n = 0; n < 20; n++) shown.push(s.at(0, { lowering: true }));
    expect(shown.findIndex(display => !display.flicker) * s.frame).toBeLessThanOrEqual(CUP_TRACK.confirmMs + s.frame);
  });

  it.each(SIDES)("a flip while the hand keeps rising ends at once where the hand has got to (%s)", side => {
    const s = scene(side);
    for (let n = 0; n < 15; n++) s.at(0.4);
    // 400 ms of the forearm hanging while the hand rises from 0.4 to 1.
    for (let n = 1; n <= 12; n++) expect(s.feed(onLap(side, 0.4 + 0.6 * n / 12)).flicker).toBe(true);
    const back = s.at(1);
    expect(back.flicker).toBe(false);
    let settled = Infinity;
    for (let n = 0; n < 10; n++) settled = s.away(s.at(1), 1);
    expect(settled).toBeLessThan(0.02);
  });

  it.each(SIDES)("smooths the jitter of a still hand (%s)", side => {
    const s = scene(side);
    for (let n = 0; n < 15; n++) s.at(1);
    const xs: number[] = [];
    for (let n = 0; n < 90; n++) {
      const pose = seatedPose(side, { hand: 1 });
      const wobble = (n % 2 ? 1 : -1) * 0.006;
      for (const index of side === "left" ? [15, 17, 19, 21] : [16, 18, 20, 22]) pose.landmarks[index] = { ...pose.landmarks[index], x: pose.landmarks[index].x + wobble };
      xs.push(s.feed(pose).cup!.x);
    }
    const spread = Math.max(...xs.slice(30)) - Math.min(...xs.slice(30));
    expect(spread).toBeLessThan(0.012 * 0.35);
  });

  it.each(SIDES)("draws the skeleton on the cup (%s)", side => {
    const s = scene(side);
    for (let n = 0; n < 10; n++) s.at(0);
    for (let step = 1; step <= 15; step++) {
      const shown = s.at(step / 15);
      expect(s.gap(handCentre(shown.pose, side)!, shown.cup!)).toBeLessThan(1e-6);
    }
    const shown = s.flip(1);
    expect(s.gap(handCentre(shown.pose, side)!, shown.cup!)).toBeLessThan(1e-6);
  });
});

describe("hand-to-mouth cup display: with MouthHold", () => {
  function both(side: Side) {
    const s = scene(side);
    const rest = seatedPose(side);
    const target = { mouth: observedMouth(rest)!, radius: Math.max(0.045, Math.min(0.08, s.torso * 0.18)), aspect: ASPECT, torso: s.torso };
    const hold = new MouthHold();
    let t = 0;
    const step = (live: PoseInput | null, lowering = false) => {
      t += s.frame;
      const held = hold.update(t, live, side, target);
      const shown = s.track.update(t, live, side, s.scale, { held: held.held ? held.pose : null, lowering });
      return { held, shown };
    };
    return { s, step };
  }

  it.each(SIDES)("draws the held arm while MouthHold holds, and a long flip only once the hold lets go (%s)", side => {
    const { s, step } = both(side);
    for (let n = 0; n <= 20; n++) step(seatedPose(side, { hand: n / 20 }));
    for (let n = 0; n < 10; n++) step(seatedPose(side, { hand: 1 }));
    // 1.4 s of the forearm hanging: held all along (MOUTH_HOLD.exitMs is 1.5 s), cup still.
    for (let n = 0; n < 42; n++) {
      const { held, shown } = step(flipped(side, 1));
      expect(held.held).toBe(true);
      expect(s.away(shown, 1)).toBeLessThan(0.02);
    }
    expect(s.away(step(seatedPose(side, { hand: 1 })).shown, 1)).toBeLessThan(0.02);
    // 2 s of it: when the hold lets go the cup glides to the hanging hand at once (the rival has lasted long enough).
    const out = Array.from({ length: 60 }, () => step(flipped(side, 1), true));
    const released = out.findIndex(frame => !frame.held.atMouth);
    expect(released).toBeGreaterThan(0);
    const hanging = handCentre(flipped(side, 1), side)!;
    expect(s.gap(out[released + 8].shown.cup!, hanging)).toBeLessThan(0.05);
  });

  it.each(SIDES)("follows a smooth lowering continuously, without stopping while the hold lets go (%s)", side => {
    const { s, step } = both(side);
    for (let n = 0; n <= 20; n++) step(seatedPose(side, { hand: n / 20 }));
    for (let n = 0; n < 10; n++) step(seatedPose(side, { hand: 1 }));
    // A 1.2 s lowering: the cup stays with the hand and never lurches.
    const frames = 36;
    const lowering = Array.from({ length: frames }, (_, n) => ({ hand: 1 - (n + 1) / frames, ...step(seatedPose(side, { hand: 1 - (n + 1) / frames }), true) }));
    expect(lowering.some(frame => frame.held.held)).toBe(true);
    expect(lowering.every(frame => !frame.shown.flicker)).toBe(true);
    const handStep = s.gap(s.centre(1), s.centre(0)) / frames;
    for (let n = 0; n < frames; n++) {
      expect(s.away(lowering[n].shown, lowering[n].hand)).toBeLessThan(0.1);
      if (n) expect(s.gap(lowering[n].shown.cup!, lowering[n - 1].shown.cup!)).toBeLessThan(Math.max(1.5 * handStep, 0.06));
    }
    for (let n = 0; n < 15; n++) step(seatedPose(side, { hand: 0 }), true);
    expect(s.away(step(seatedPose(side, { hand: 0 }), true).shown, 0)).toBeLessThan(0.01);
  });

  it.each(SIDES)("keeps the cup at the lips through flips during the return step while the hold lasts (%s)", side => {
    const { s, step } = both(side);
    for (let n = 0; n <= 20; n++) step(seatedPose(side, { hand: n / 20 }));
    for (let n = 0; n < 10; n++) step(seatedPose(side, { hand: 1 }));
    for (let n = 0; n < 42; n++) {
      FLIP_SIZE = [0.5, 0.8, 1.1][n % 3];
      const { held, shown } = step(n % 2 ? flipped(side, 1) : onLap(side, 1), true);
      if (held.held) expect(s.away(shown, 1)).toBeLessThan(0.02);
    }
  });

  it.each(SIDES)("during a hold, a hand unseen for over a second and then flipped does not move the cup (%s)", side => {
    const { s, step } = both(side);
    for (let n = 0; n <= 20; n++) step(seatedPose(side, { hand: n / 20 }));
    for (let n = 0; n < 10; n++) step(seatedPose(side, { hand: 1 }));
    for (let n = 0; n < 33; n++) step(null);
    for (let n = 0; n < 3; n++) expect(s.away(step(flipped(side, 1)).shown, 1)).toBeLessThan(0.02);
    for (let n = 0; n < 15; n++) expect(s.away(step(seatedPose(side, { hand: 1 })).shown, 1)).toBeLessThan(0.02);
  });
});

describe("hand-to-mouth cup display: hand missing and resets", () => {
  it.each(SIDES)("keeps the drawing briefly, hides it, and judges the first readings after a long gap against the last place (%s)", side => {
    const s = scene(side);
    for (let n = 0; n < 10; n++) s.at(1);
    expect(s.feed(null).cup).not.toBeNull();
    s.advance(CUP_TRACK.graceMs);
    expect(s.feed(null).cup).toBeNull();
    s.advance(CUP_TRACK.lostMs);
    // A flip right after the gap is not drawn: the cup stays hidden until the hand is seen at the lips.
    for (let n = 0; n < 10; n++) expect(s.flip(1)).toMatchObject({ cup: null, flicker: true });
    const back = s.at(1);
    expect(back.flicker).toBe(false);
    expect(s.away(back, 1)).toBeLessThan(1e-9);
    // A reading that is not a drop is drawn at once after a gap.
    s.advance(CUP_TRACK.lostMs + 100);
    const moved = s.at(0.7);
    expect(moved.flicker).toBe(false);
    expect(s.away(moved, 0.7)).toBeLessThan(1e-9);
  });

  it.each(SIDES)("before contact, a hand unseen for over a second and then flipped is not drawn at the lap (%s)", side => {
    const s = scene(side);
    for (let n = 0; n < 15; n++) s.at(0.8);
    for (let n = 0; n < 33; n++) s.feed(null);
    for (let n = 0; n < 15; n++) expect(s.feed(onLap(side, 0.8)).cup).toBeNull();
    const back = s.at(1);
    expect(back.flicker).toBe(false);
    expect(s.away(back, 1)).toBeLessThan(1e-9);
  });

  it("starts again with nothing drawn after a reset", () => {
    const s = scene("right");
    for (let n = 0; n < 10; n++) s.at(1);
    s.track.reset();
    const fresh = s.at(0);
    expect(fresh.flicker).toBe(false);
    expect(s.away(fresh, 0)).toBeLessThan(1e-9);
  });
});
