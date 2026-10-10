import { describe, expect, it } from "vitest";
import type { PoseInput, Pt } from "./metrics";
import { POSE_STEADY, SteadyPoint, SteadyPose } from "./steady";

const ASPECT = 4 / 3;
const SCALE = 0.25;

/** A body whose landmarks all sit at `at`, or each where `place` puts it. */
function body(place: (index: number) => { x: number; y: number }, visibility = 1): PoseInput {
  const landmarks: Pt[] = Array.from({ length: 33 }, (_, index) => ({ ...place(index), z: 0, visibility }));
  return { landmarks, world: landmarks.map(p => ({ ...p })) };
}
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot((a.x - b.x) * ASPECT, a.y - b.y);

describe("steadied drawing (display only)", () => {
  it("holds a still point still though its readings jitter, and follows a real move at once", () => {
    const point = new SteadyPoint(POSE_STEADY), home = { x: 0.5, y: 0.5 }, jitter = 0.01;
    for (let t = 0; t < 1000; t += 33) point.next(t, home, ASPECT, SCALE);
    let wander = 0;
    for (let n = 0; n < 30; n++) {
      const p = { x: home.x + (n % 2 ? jitter : -jitter) / ASPECT, y: home.y + (n % 4 < 2 ? jitter : -jitter) };
      wander = Math.max(wander, distance(point.next(1000 + n * 33, p, ASPECT, SCALE), home));
    }
    expect(wander).toBeLessThan(0.5 * jitter);
    // A move of a quarter of the picture over a fifth of a second: most of the way there a tenth of a second later.
    const goal = { x: 0.7, y: 0.5 };
    let at = point.current!;
    for (let n = 1; n <= 9; n++) at = point.next(2000 + n * 33, { x: home.x + (goal.x - home.x) * Math.min(1, n / 6), y: home.y }, ASPECT, SCALE);
    expect(Math.abs(at.x - goal.x)).toBeLessThan(0.3 * (goal.x - home.x));
  });
  it("glides past a one-frame glitch instead of jumping to it", () => {
    const point = new SteadyPoint(POSE_STEADY), home = { x: 0.5, y: 0.5 };
    let t = 0;
    for (; t < 1000; t += 33) point.next(t, home, ASPECT, SCALE);
    const glitch = point.next(t, { x: 0.5, y: 0.8 }, ASPECT, SCALE);
    // At most the top speed for one frame (3 frame heights a second): a tenth of the picture, not the whole 0.3.
    expect(distance(glitch, home)).toBeLessThanOrEqual(POSE_STEADY.glide * 0.033 + 1e-9);
    const back = point.next(t + 33, home, ASPECT, SCALE);
    expect(distance(back, home)).toBeLessThan(distance(glitch, home));
  });
  it("draws the body steadied, the affected wrist on the hand model's wrist and shown though the body model doubted it", () => {
    const shown = new SteadyPose(), wrist = 16, handWrist = { x: 0.62, y: 0.71 };
    let pose: PoseInput | null = null;
    // The body model's wrist up the forearm and unsure (visibility 0.3); the hand model's on the real wrist.
    for (let t = 0; t < 1500; t += 33) pose = shown.next(t, body(i => (i === wrist ? { x: 0.6, y: 0.62 } : { x: 0.5, y: 0.5 }), 0.3), ASPECT, SCALE, { [wrist]: handWrist });
    expect(distance(pose!.landmarks[wrist], handWrist)).toBeLessThan(0.002);
    expect(pose!.landmarks[wrist].visibility).toBe(1);
    // Every other point keeps the body model's own visibility, and the world points are untouched.
    expect(pose!.landmarks[11].visibility).toBe(0.3);
    expect(shown.next(1500, null, ASPECT, SCALE)).toBeNull();
  });
  it("steadies a body read only every other frame (repeated in between), and starts afresh after a long gap", () => {
    const shown = new SteadyPose();
    // The body moving steadily right, read every other frame: the drawing moves every frame, never back.
    let last = -Infinity, backward = 0;
    for (let n = 0; n < 40; n++) {
      const reading = 0.3 + 0.01 * (n - (n % 2));
      const x = shown.next(n * 33, body(() => ({ x: reading, y: 0.5 })), ASPECT, SCALE)!.landmarks[0].x;
      if (x < last - 1e-9) backward++;
      last = x;
    }
    expect(backward).toBe(0);
    // Unseen for two seconds and back elsewhere: drawn there at once, not gliding from the old place.
    const back = shown.next(40 * 33 + 2000, body(() => ({ x: 0.8, y: 0.3 })), ASPECT, SCALE)!;
    expect(back.landmarks[0]).toMatchObject({ x: 0.8, y: 0.3 });
  });
});
