import { describe, expect, it } from "vitest";
import { compensationStatus, faceApproachPercent, faceGeometry, geoFrom, medianGeo, poseFrameValues, reachLapRest, poseJoints, type PoseInput, type Pt } from "./metrics";
import { resolveExercise } from "./config";

function pose(): PoseInput {
  const landmarks: Pt[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  Object.assign(landmarks[2], { x: 0.44, y: 0.25 });
  Object.assign(landmarks[5], { x: 0.56, y: 0.25 });
  Object.assign(landmarks[9], { x: 0.47, y: 0.35 });
  Object.assign(landmarks[10], { x: 0.53, y: 0.35 });
  Object.assign(landmarks[7], { x: 0.42, y: 0.3 });
  Object.assign(landmarks[8], { x: 0.58, y: 0.3 });
  Object.assign(landmarks[11], { x: 0.35, y: 0.5 });
  Object.assign(landmarks[12], { x: 0.65, y: 0.5 });
  const world = landmarks.map(p => ({ ...p }));
  Object.assign(world[11], { x: 0.35, y: 0.4 });
  Object.assign(world[12], { x: 0.65, y: 0.4 });
  Object.assign(world[23], { x: 0.4, y: 0.8 });
  Object.assign(world[24], { x: 0.6, y: 0.8 });
  return { landmarks, world };
}

it.each(["left", "right"] as const)("accepts the selected hand at the upper thigh and rejects raised, wrong-hand and off-lap positions (%s)", side => {
  const input = pose();
  const j = poseJoints(side);
  const x = side === "left" ? 0.4 : 0.6;
  Object.assign(input.landmarks[j.hip], { x, y: 0.8 });
  Object.assign(input.landmarks[j.wrist], { x, y: 0.78 });
  // No knee or full-thigh view is needed.
  input.landmarks[j.knee].visibility = 0;
  expect(reachLapRest(input, side).lapRest?.y).toBe(0.78);
  input.landmarks[j.wrist].y = 0.3;
  expect(reachLapRest(input, side).lapMissing).toContain(`Lower your ${side} hand`);
  const other = poseJoints(side === "left" ? "right" : "left");
  Object.assign(input.landmarks[other.wrist], { x, y: 0.78 });
  expect(reachLapRest(input, side).lapRest).toBeUndefined();
  Object.assign(input.landmarks[j.wrist], { x: 0.95, y: 0.78 });
  expect(reachLapRest(input, side).lapMissing).toContain("closer to your body");
  Object.assign(input.landmarks[j.wrist], { x, y: 0.78 });
  input.landmarks[j.hip].visibility = 0.1;
  expect(reachLapRest(input, side).lapMissing).toContain(`top of your ${side} thigh`);
});

describe("face approach for forward-reach trunk lean", () => {
  it("does not identify shoulder hiking or unreliable torso depth as face approach", () => {
    const baseline = pose();
    const hiking = pose();
    Object.assign(hiking.world[12], { y: 0.15, z: -0.4 });
    const measured = poseFrameValues(hiking, "right", geoFrom(baseline, "right"));
    expect(measured.comps.shoulder_hike_delta).toBeGreaterThan(20);
    expect(measured.comps.trunk_lean_delta).toBeGreaterThan(12);
    expect(measured.comps.face_approach_pct).toBe(0);
    expect(resolveExercise("ex_reach", false).compensations.find(c => c.id === "trunk_lean")?.metric).toBe("face_approach_pct");
  });

  it("detects increased face size as the face moves closer", () => {
    const baseline = pose();
    const closer = pose();
    for (const index of [2, 5, 9, 10]) {
      const point = closer.landmarks[index];
      point.x = 0.5 + (point.x - 0.5) * 1.2;
      point.y = 0.3 + (point.y - 0.3) * 1.2;
    }
    expect(faceApproachPercent(faceGeometry(closer), faceGeometry(baseline))).toBeCloseTo(20);
  });

  it("ignores lateral face motion and requires growth in both face dimensions", () => {
    const baseline = pose();
    const moved = pose();
    for (const index of [2, 5, 9, 10]) moved.landmarks[index].x += 0.1;
    expect(faceApproachPercent(faceGeometry(moved), faceGeometry(baseline))).toBeCloseTo(0);
    expect(faceApproachPercent({ faceEyeSpan: 0.15, faceHeight: 0.1 }, { faceEyeSpan: 0.1, faceHeight: 0.1 })).toBe(0);
  });

  it("leaves occluded face data unmeasured and ignores missing baseline samples", () => {
    const baseline = pose();
    const occluded = pose();
    occluded.landmarks[2].visibility = 0.1;
    expect(faceGeometry(occluded)).toEqual({});
    expect(faceApproachPercent(faceGeometry(occluded), faceGeometry(baseline))).toBeUndefined();
    const median = medianGeo([geoFrom(occluded, "right"), geoFrom(baseline, "right")]);
    expect(median?.faceEyeSpan).toBeCloseTo(0.12);
  });
});

describe("sensitive reach compensation signals", () => {
  const rules = resolveExercise("ex_reach", false).compensations;
  const lean = rules.find(rule => rule.id === "trunk_lean")!;
  const hike = rules.find(rule => rule.id === "shoulder_hike")!;

  it("confirms moderate shared face and shoulder growth without reporting shoulder hiking", () => {
    const baseline = pose();
    const approached = pose();
    approached.landmarks.forEach(point => { point.x = 0.5 + (point.x - 0.5) * 1.065; point.y = 0.5 + (point.y - 0.5) * 1.065; });
    const { comps } = poseFrameValues(approached, "right", geoFrom(baseline, "right"));
    expect(comps.face_approach_pct).toBeCloseTo(6.5);
    expect(compensationStatus(comps, lean).over).toBe(true);
    expect(compensationStatus(comps, hike).over).toBe(false);
  });

  it("allows a modest shoulder change but detects larger image-based elevation without confusing it with lean", () => {
    const baseline = pose();
    const raised = pose();
    raised.landmarks[12].y -= 0.025;
    const { comps } = poseFrameValues(raised, "right", geoFrom(baseline, "right"));
    expect(comps.shoulder_elevation_pct).toBeCloseTo(12.5);
    expect(compensationStatus(comps, hike).over).toBe(false);
    expect(compensationStatus(comps, lean).over).toBe(false);
    raised.landmarks[12].y -= 0.01;
    const elevated = poseFrameValues(raised, "right", geoFrom(baseline, "right")).comps;
    expect(elevated.shoulder_elevation_pct).toBeCloseTo(17.5);
    expect(compensationStatus(elevated, hike).over).toBe(true);
    expect(compensationStatus(elevated, lean).over).toBe(false);
  });

  it.each(["left", "right"] as const)("tells a sideways lean from a shoulder hike (%s side)", side => {
    const sideLean = rules.find(rule => rule.id === "trunk_side_lean")!;
    const over = (comps: ReturnType<typeof poseFrameValues>["comps"]) => [lean, hike, sideLean].filter(rule => compensationStatus(comps, rule).over).map(rule => rule.id);
    // As a front camera sees the patient (the right shoulder on the picture's left), unlike the mirrored pose() above.
    const seen = () => { const p = pose(); for (const q of [...p.landmarks, ...p.world]) q.x = 1 - q.x; return p; };
    const ref = geoFrom(seen(), side);
    // The upper body tipped sideways about the hips, either way: only the sideways lean.
    for (const deg of [12, -12]) {
      const leaned = seen(), a = deg * Math.PI / 180;
      for (let index = 0; index <= 22; index++) {
        for (const p of [leaned.landmarks[index], leaned.world[index]]) {
          const dx = p.x - 0.5, dy = p.y - 0.8;
          Object.assign(p, { x: 0.5 + dx * Math.cos(a) - dy * Math.sin(a), y: 0.8 + dx * Math.sin(a) + dy * Math.cos(a) });
        }
      }
      expect(over(poseFrameValues(leaned, side, ref).comps), String(deg)).toEqual(["trunk_side_lean"]);
    }
    // The affected shoulder lifted toward the ear, the trunk upright: only the shoulder hike.
    const j = poseJoints(side), hiked = seen();
    hiked.world[j.shoulder].y -= 0.12; hiked.landmarks[j.shoulder].y -= 0.04;
    expect(over(poseFrameValues(hiked, side, ref).comps)).toEqual(["shoulder_hike"]);
  });

  it("requires face corroboration for shoulder growth and handles missing measurements", () => {
    expect(compensationStatus({ face_approach_pct: 0, face_mean_growth_pct: 0, shoulder_approach_pct: 30 }, lean).over).toBe(false);
    expect(compensationStatus({ face_approach_pct: 8 }, lean).over).toBe(true);
    expect(compensationStatus({ shoulder_hike_rel_delta: 10.9, shoulder_elevation_pct: 0 }, hike).over).toBe(false);
    expect(compensationStatus({ shoulder_hike_rel_delta: 12 }, hike).over).toBe(true);
    expect(compensationStatus({ shoulder_elevation_pct: 15 }, hike).over).toBe(true);
    expect(compensationStatus({}, hike).ratio).toBeUndefined();
  });
});
