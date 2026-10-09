import { describe, expect, it } from "vitest";
import {
  cameraFigures, CAMERA_WALKER_SHARE, drawWalkFilmingDemo, WALK_DEMO_CAPTIONS, WALK_DEMO_MS, walkDemoHeight, walkDemoState, WALKER_SPAN,
  walkerPose,
} from "./walk-demo";

/** A 2D context that records what is drawn: fills, strokes, text and every colour set. */
function recordingContext() {
  const texts: string[] = [], colours: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key === "measureText") return (text: string) => ({ width: text.length * 7 });
      if (key === "fillText") return (text: string) => { texts.push(text); };
      if (key in target) return target[key];
      return () => undefined;
    },
    set(target, key: string, value) {
      if (key === "fillStyle" || key === "strokeStyle") colours.push(String(value));
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts, colours };
}

/** The app's colours (and translucent versions of them, and white paper). */
const APP_COLOUR = /^(#285b49|#3c8255|#e18e6d|#b9d3c2|#fffefa|rgba\((185,211,194|225,142,109),[\d.]+\))$/;

describe("walkDemoState", () => {
  it("stands, walks across, turns, walks back and loops", () => {
    expect(walkDemoState(0)).toMatchObject({ phase: 0, progress: 0, facing: 1, turn: 0 });
    const across = walkDemoState(3200);
    expect(across.phase).toBe(1);
    expect(across.facing).toBe(1);
    expect(across.progress).toBeGreaterThan(0.3);
    expect(across.progress).toBeLessThan(0.7);
    const turning = walkDemoState(5050);
    expect(turning.phase).toBe(2);
    expect(turning.progress).toBe(1);
    expect(turning.turn).toBeGreaterThan(0.9);
    const back = walkDemoState(7000);
    expect(back).toMatchObject({ phase: 2, facing: -1 });
    expect(back.progress).toBeLessThan(0.7);
    expect(walkDemoState(WALK_DEMO_MS - 1)).toMatchObject({ phase: 2, progress: 0 });
    expect(walkDemoState(WALK_DEMO_MS + 3200)).toEqual(across);
    expect(WALK_DEMO_MS).toBe(9000);
  });

  it("keeps the walker within the picture and brings the legs together as it stops", () => {
    for (let t = 0; t < WALK_DEMO_MS; t += 50) {
      const state = walkDemoState(t);
      expect(state.progress).toBeGreaterThanOrEqual(0);
      expect(state.progress).toBeLessThanOrEqual(1);
    }
    // Just before each stop, the legs are close to together (a whole number of steps per crossing).
    expect(Math.abs(Math.sin(walkDemoState(4599).cycle))).toBeLessThan(0.02);
    expect(Math.abs(Math.sin(walkDemoState(8299).cycle))).toBeLessThan(0.02);
  });

  it("stands on both feet whenever it stops: at the start, through the turn and at the end", () => {
    const pose = (t: number) => { const s = walkDemoState(t); return walkerPose(0, 100, 100, s.facing, s.cycle, s.turn, s.stride); };
    // Feet at y = 100 for a figure 100 tall: an ankle on the floor sits within 2.
    const onFloor = (t: number) => pose(t).legs.every(leg => Math.abs(leg.ankle.y - 100) < 2 && Math.abs(leg.toe.y - 100) < 2);
    for (const t of [0, 900, 1799, 4599, 4700, 5050, 5400, 8299, 8600, WALK_DEMO_MS - 1]) expect(onFloor(t), `t = ${t}`).toBe(true);
    // Side-on and still, the legs part a little, so both feet are seen.
    const [a, b] = pose(0).legs;
    expect(Math.abs(a.ankle.x - b.ankle.x)).toBeGreaterThan(2);
    // No jump as it starts or stops: the legs ease in and out of the standing pose.
    const close = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y) < 1.5;
    for (const t of [1800, 4600, 5500, 8300]) {
      expect(pose(t - 2).legs.every((leg, k) => close(leg.ankle, pose(t + 2).legs[k].ankle) && close(leg.knee, pose(t + 2).legs[k].knee)), `t = ${t}`).toBe(true);
    }
    // Walking, a foot leaves the floor.
    expect(Math.max(...[2800, 3200, 3600].flatMap(t => pose(t).legs.map(leg => 100 - leg.ankle.y)))).toBeGreaterThan(4);
    expect(walkDemoState(0).stride).toBe(0);
    expect(walkDemoState(3200).stride).toBe(1);
    expect(walkDemoState(5050).stride).toBe(0);
  });
});

describe("cameraFigures: what the camera sees", () => {
  const frame = { x: 10, y: 20, w: 400, h: 300 };
  const times = Array.from({ length: WALK_DEMO_MS / 100 }, (_, k) => k * 100);

  it("shows the walker at 55-60% of the picture's height, with floor below and room above, always inside it", () => {
    expect(CAMERA_WALKER_SHARE).toBeGreaterThanOrEqual(0.55);
    expect(CAMERA_WALKER_SHARE).toBeLessThanOrEqual(0.6);
    for (const t of times) {
      const state = walkDemoState(t), { walker } = cameraFigures(frame, state);
      const pose = walkerPose(walker.x, walker.footY, walker.height, state.facing, state.cycle, state.turn, state.stride);
      const top = pose.head.y - pose.headR, xs = [...pose.legs.flatMap(leg => [leg.ankle.x, leg.toe.x, leg.knee.x]), ...pose.arms.map(arm => arm.hand.x), pose.head.x];
      const share = (walker.footY - top) / frame.h;
      expect(share).toBeGreaterThan(0.55);
      expect(share).toBeLessThan(0.6);
      expect(walker.footY - top).toBeCloseTo(walker.height * WALKER_SPAN, 6);
      // Headroom and floor: at least 15% of the picture each.
      expect((top - frame.y) / frame.h).toBeGreaterThan(0.15);
      expect((frame.y + frame.h - walker.footY) / frame.h).toBeGreaterThan(0.15);
      expect(Math.min(...xs)).toBeGreaterThan(frame.x);
      expect(Math.max(...xs)).toBeLessThan(frame.x + frame.w);
    }
  });

  it("puts the helper further back (smaller, feet higher), beside the walker, not trailing as a copy, and inside the picture", () => {
    for (const t of times) {
      const state = walkDemoState(t), { walker, helper } = cameraFigures(frame, state);
      expect(helper.height).toBeLessThan(walker.height * 0.85);
      expect(helper.footY).toBeLessThan(walker.footY - frame.h * 0.04);
      // Hips on the same camera-height line: the helper is further away, not floating.
      expect(helper.footY - helper.height / 2).toBeCloseTo(walker.footY - walker.height / 2, 6);
      // Head to feet inside the picture, whatever its legs are doing.
      for (const offset of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]) {
        const pose = walkerPose(helper.x, helper.footY, helper.height, state.facing, state.cycle + offset, state.turn, state.stride);
        const xs = [...pose.legs.flatMap(leg => [leg.ankle.x, leg.toe.x, leg.knee.x]), ...pose.arms.map(arm => arm.hand.x), pose.head.x - pose.headR, pose.head.x + pose.headR];
        expect(Math.min(...xs)).toBeGreaterThan(frame.x);
        expect(Math.max(...xs)).toBeLessThan(frame.x + frame.w);
        expect(pose.head.y - pose.headR).toBeGreaterThan(frame.y);
      }
      // While walking, a clear step ahead of the walker (never behind it, like a trail); never behind it at a stop.
      if (state.stride === 1) expect((helper.x - walker.x) * state.facing).toBeGreaterThan(frame.w * 0.12);
      if (state.turn === 0) expect((helper.x - walker.x) * state.facing).toBeGreaterThan(frame.w * 0.05);
    }
  });
});

describe("drawWalkFilmingDemo", () => {
  it("wants a landscape canvas when wide and a taller one when narrow", () => {
    expect(walkDemoHeight(700, false)).toBe(350);
    expect(walkDemoHeight(340, false)).toBeGreaterThan(340);
    expect(walkDemoHeight(700, true)).toBeLessThan(700);
    expect(walkDemoHeight(340, true)).toBeGreaterThan(walkDemoHeight(340, false));
  });

  for (const [name, width, reduced] of [["wide", 700, false], ["narrow", 340, false], ["wide, reduced motion", 700, true], ["narrow, reduced motion", 340, true]] as const) {
    it(`draws both panels and the captions in the app's colours (${name})`, () => {
      const { ctx, texts, colours } = recordingContext();
      const times = reduced ? [0] : [500, 3200, 7000];
      for (const t of times) drawWalkFilmingDemo(ctx, t, width, walkDemoHeight(width, reduced), reduced);
      expect(texts).toEqual(expect.arrayContaining(["Set up", "What the camera sees", "Start", "Turn", "3 big steps", "Hip height", "Helper"]));
      expect(texts).toEqual(expect.arrayContaining([...WALK_DEMO_CAPTIONS]));
      expect(colours.filter(colour => !APP_COLOUR.test(colour))).toEqual([]);
    });
  }
});
