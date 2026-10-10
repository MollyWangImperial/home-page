import { describe, expect, it } from "vitest";
import { CONTRAST_HINTS, contrastPart, contrastRegions, judgeContrast, SIMILAR_DELTA_E, toLab } from "./contrast";
import { LightingProbe } from "./lighting";
import type { PoseInput, Pt } from "./metrics";
import { LAUNCH_EXERCISE_IDS } from "./config";

const ASPECT = 4 / 3;

/** A seated patient facing the camera (raw image: the patient's right side is on the left), every point visible. */
function pose(overrides: Record<number, [number, number]> = {}): PoseInput {
  const points: Record<number, [number, number]> = {
    0: [0.5, 0.2], 11: [0.6, 0.35], 12: [0.4, 0.35], 13: [0.63, 0.5], 14: [0.37, 0.5], 15: [0.6, 0.62], 16: [0.4, 0.62],
    17: [0.61, 0.65], 18: [0.39, 0.65], 19: [0.6, 0.66], 20: [0.4, 0.66], 21: [0.585, 0.64], 22: [0.415, 0.64],
    23: [0.56, 0.6], 24: [0.44, 0.6], 25: [0.57, 0.75], 26: [0.43, 0.75], 27: [0.57, 0.92], 28: [0.43, 0.92], ...overrides,
  };
  const landmarks: Pt[] = Array.from({ length: 33 }, (_, index) => {
    const p = points[index];
    return p ? { x: p[0], y: p[1], z: 0, visibility: 1 } : { x: 0.5, y: 0.5, z: 0, visibility: 0 };
  });
  return { landmarks, world: landmarks.map(p => ({ ...p })) };
}

/** A small RGBA frame filled with `background`, with `body` painted round the given points (3 x 3 each). */
function frame(width: number, height: number, background: [number, number, number], body: [number, number, number], points: { x: number; y: number }[]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) { pixels.set([...background, 255], i * 4); }
  for (const p of points) {
    const cx = Math.round(p.x * width - 0.5), cy = Math.round(p.y * height - 0.5);
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) if (x >= 0 && y >= 0 && x < width && y < height) pixels.set([...body, 255], (y * width + x) * 4);
  }
  return pixels;
}

describe("clothing against the background at set-up", () => {
  it("looks at the part each exercise tracks", () => {
    expect(LAUNCH_EXERCISE_IDS.map(id => contrastPart(id))).toEqual(["arm", "arm", "arm", "hand", "arm", "hand", "leg", "leg"]);
    for (const part of ["arm", "leg", "hand"] as const) expect(CONTRAST_HINTS[part]).toMatch(/If you can/);
  });
  it.each(["left", "right"] as const)("samples along the affected limb and beside it, out from the body (%s side)", side => {
    const out = side === "left" ? 1 : -1; // the patient's left is toward +x in the raw image
    for (const part of ["arm", "leg"] as const) {
      const regions = contrastRegions(pose(), side, part, ASPECT)!;
      expect(regions.part).toBe(part);
      expect(regions.inside.length).toBeGreaterThanOrEqual(3);
      // Each background point lies further out from the middle of the body than its point on the limb.
      regions.inside.forEach((p, i) => expect((regions.outside[i].x - p.x) * out).toBeGreaterThan(0.02));
    }
  });
  it("rings the hand away from the forearm, and needs the part in view", () => {
    const regions = contrastRegions(pose(), "right", "hand", ASPECT)!;
    const wrist = pose().landmarks[16], elbow = pose().landmarks[14];
    // No ring point toward the elbow (it would land on the sleeve).
    for (const p of regions.outside) {
      const towardElbow = ((p.x - wrist.x) * (elbow.x - wrist.x) * ASPECT * ASPECT + (p.y - wrist.y) * (elbow.y - wrist.y)) / (Math.hypot((p.x - wrist.x) * ASPECT, p.y - wrist.y) * Math.hypot((elbow.x - wrist.x) * ASPECT, elbow.y - wrist.y));
      expect(towardElbow).toBeLessThan(0.95);
    }
    const hidden = pose();
    hidden.landmarks[14] = { ...hidden.landmarks[14], visibility: 0.1 };
    expect(contrastRegions(hidden, "right", "arm", ASPECT)).toBeNull();
    expect(contrastRegions(null, "right", "leg", ASPECT)).toBeNull();
  });
  it("tells a top that blends into the wall from one that stands out", () => {
    const regions = contrastRegions(pose(), "right", "arm", ASPECT)!;
    const [w, h] = [128, 96];
    const blend = judgeContrast(frame(w, h, [200, 196, 190], [192, 190, 186], regions.inside), w, h, regions)!;
    expect(blend.ok).toBe(false);
    expect(blend.deltaE).toBeLessThan(SIMILAR_DELTA_E);
    expect(blend.hint).toBe(CONTRAST_HINTS.arm);
    const clear = judgeContrast(frame(w, h, [200, 196, 190], [40, 60, 120], regions.inside), w, h, regions)!;
    expect(clear).toMatchObject({ ok: true, part: "arm" });
    expect(clear.hint).toBeUndefined();
    // Too few pixels in the frame to judge (points off its edge).
    expect(judgeContrast(frame(w, h, [0, 0, 0], [0, 0, 0], []), w, h, { part: "arm", inside: [{ x: 2, y: 2 }], outside: [{ x: 2, y: 2 }] })).toBeNull();
  });
  it("converts colours to CIELAB", () => {
    expect(toLab([255, 255, 255])[0]).toBeCloseTo(100, 0);
    expect(toLab([0, 0, 0])[0]).toBeCloseTo(0, 0);
    expect(Math.abs(toLab([128, 128, 128])[1])).toBeLessThan(0.5);
  });
  it("steadies the verdict over recent samples and, as a reminder only, lets set-up go on after a while", () => {
    const probe = new LightingProbe();
    const poor = { ok: false, part: "arm" as const, deltaE: 5, hint: CONTRAST_HINTS.arm }, good = { ok: true, part: "arm" as const, deltaE: 30 };
    expect(probe.contrast()).toBeNull();
    probe.addContrast(poor); probe.addContrast(good);
    // A tie keeps the verdict shown.
    expect(probe.contrast()?.ok).toBe(false);
    probe.addContrast(good);
    expect(probe.contrast()?.ok).toBe(true);
    for (let i = 0; i < 3; i++) probe.addContrast(poor);
    expect(probe.contrast()?.ok).toBe(false);
    for (let t = 0; t <= 8000; t += 500) probe.tick(t);
    expect(probe.contrastWaived()).toBe(true);
    probe.reset();
    expect(probe.contrast()).toBeNull();
    expect(probe.contrastWaived()).toBe(false);
  });
});
