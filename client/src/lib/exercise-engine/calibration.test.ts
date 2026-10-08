import { expect, it } from "vitest";
import { EXERCISES } from "./config";
import { reachAngleProgress, ReachRestCalibration, ReachTargetCalibration } from "./calibration";
import { ExerciseSession, simFrame, type Voice } from "./session";

it("requires five valid target-hold measurements and uses their median instead of a noisy peak", () => {
  const learner = new ReachTargetCalibration();
  const frame = simFrame(0, EXERCISES.ex_reach, { shoulder_flexion: 45, elbow_extension: 130 }, { level: 1, compensations: [] });
  for (let n = 0; n < 4; n++) learner.observe(frame);
  expect(learner.capture()).toBeNull();
  learner.observe({ ...frame, values: { shoulder_flexion: 160, elbow_extension: 179 } });
  learner.observe({ ...frame, values: { shoulder_flexion: NaN, elbow_extension: 300 } });
  expect(learner.capture()).toEqual({ shoulder_flexion: 45, elbow_extension: 130 });
  learner.reset();
  expect(learner.capture()).toBeNull();
});

it("keeps lap posture separate and scores against the practice target without adding any increment", () => {
  const voice: Voice = { say: () => {}, busy: () => false, stop: () => {} };
  const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "right", repsOverride: 2, reviewBetweenReps: true }, voice);
  session.start(0);
  let t = 0;
  // Capture a real setup sequence, rather than injecting session state.
  while (session.snapshot().phase === "setup") {
    t += 33;
    const frame = simFrame(t, session.cfg, session.targets(), { level: 0, compensations: [] });
    frame.values.shoulder_flexion = 20; frame.values.elbow_extension = 120;
    session.push(frame);
  }
  expect(session.snapshot().targetsReady).toBe(false);
  session.skipAhead(++t);
  expect(session.snapshot().phase).toBe("warm");
  while (session.snapshot().phase === "warm") {
    t += 33;
    const reaching = session.currentStep?.kind === "reach";
    const frame = simFrame(t, session.cfg, session.targets(), { level: 0, compensations: [] });
    frame.values.shoulder_flexion = reaching ? 37.5 : 22;
    frame.values.elbow_extension = reaching ? 136.2 : 122;
    frame.targetContact = true;
    session.push(frame);
    expect(t).toBeLessThan(20000);
  }
  expect(session.snapshot().targetsReady).toBe(true);
  expect(session.snapshot().startingAngles).toEqual({ shoulder_flexion: 20, elbow_extension: 120 });
  expect(session.targets()).toEqual({ shoulder_flexion: 37.5, elbow_extension: 136.2 });
  // Half of each personalized excursion gives 50%, even though the absolute angles are much higher.
  while (session.snapshot().review !== "complete") {
    t += 33;
    const reaching = session.currentStep?.kind === "reach";
    const frame = simFrame(t, session.cfg, session.targets(), { level: 0, compensations: [] });
    frame.values.shoulder_flexion = reaching ? 28.75 : 26;
    frame.values.elbow_extension = reaching ? 128.1 : 126;
    frame.targetContact = true;
    session.push(frame);
    expect(t).toBeLessThan(30000);
  }
  const result = session.snapshot().reps[0];
  expect(result.attainment).toBe(0.5);
  expect(result.score).toBe(50);
  expect(result.startingAngles).toEqual({ shoulder_flexion: 20, elbow_extension: 120 });
  expect(result.targets).toEqual({ shoulder_flexion: 37.5, elbow_extension: 136.2 });
  expect(session.targets()).toEqual(result.targets);
  session.goBack(1, ++t);
  expect(session.snapshot().targetsReady).toBe(false);
  expect(session.snapshot().startingAngles).toEqual({});
  expect(session.lapPoint).toBeNull();
});

it.each(["left", "right"] as const)("learns lap posture and practice target separately without moving the lap point (%s)", side => {
  const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side }, { say() {}, busy: () => false, stop() {} });
  session.start(0);
  let t = 0;
  for (; t < 3000; t += 33) session.push(simFrame(t, session.cfg, session.targets(), { level: 1, compensations: [] }));
  expect(session.snapshot().phase).toBe("setup");
  expect(session.snapshot().calibrationProgress).toBe(0);
  expect(session.snapshot().startingAngles).toEqual({});
  for (let n = 0; n < 150 && session.snapshot().phase === "setup"; n++) {
    const outlier = n === 12 || n === 34 || n === 51;
    const frame = simFrame(t += 33, session.cfg, session.targets(), { level: n === 12 ? 1 : 0, compensations: [] });
    if (n === 34) frame.lapRest = { ...frame.lapRest!, x: 0.85 };
    frame.values.shoulder_flexion = outlier ? 90 : 20;
    frame.values.elbow_extension = outlier ? 170 : 120;
    session.push(frame);
  }
  expect(session.snapshot().phase).toBe("demo");
  expect(session.startingAngles()).toEqual({ shoulder_flexion: 20, elbow_extension: 120 });
  const lap = session.lapPoint;
  session.skipAhead(++t);
  // The raised-arm target reference cannot replace upright posture or the locked lap point.
  for (let n = 0; n < 300 && session.snapshot().phase === "warm"; n++) {
    const frame = simFrame(t += 33, session.cfg, session.targets(), { level: 1, compensations: [] });
    frame.values.shoulder_flexion = 85; frame.values.elbow_extension = 165; frame.targetContact = true;
    session.push(frame);
  }
  expect(session.snapshot().phase).toBe("reps");
  expect(session.startingAngles()).toEqual({ shoulder_flexion: 20, elbow_extension: 120 });
  expect(session.targets()).toEqual({ shoulder_flexion: 85, elbow_extension: 165 });
  expect(session.lapPoint).toEqual(lap);
});

it("does not learn a baseline from continuously moving or too few resting frames", () => {
  const cfg = EXERCISES.ex_reach;
  const targets = { shoulder_flexion: 45, elbow_extension: 130 };
  const moving = new ReachRestCalibration();
  for (let n = 0; n < 120; n++) {
    const frame = simFrame(n * 33, cfg, targets, { level: 0, compensations: [] });
    frame.lapRest!.x = n % 2 ? 0.5 : 0.7;
    expect(moving.observe(frame, 2000).ready).toBe(false);
  }
  const sparse = new ReachRestCalibration();
  for (const t of [0, 1000, 2000]) expect(sparse.observe(simFrame(t, cfg, targets, { level: 0, compensations: [] }), 2000).ready).toBe(false);
});

it.each([1, 2, 3].flatMap(rung => [128, 136.2].map(elbow => ({ rung: rung as 1 | 2 | 3, elbow }))))("locks the held practice angles with no difficulty increment, excluding speech, approach and interrupted holds (rung $rung, elbow $elbow)", ({ rung, elbow }) => {
  let busy = false;
  const session = new ExerciseSession({ exerciseId: "ex_reach", rung, side: "right", repsOverride: 1, reviewBetweenReps: true }, { say() {}, busy: () => busy, stop() {} });
  session.start(0);
  let t = 0;
  const push = (shoulder: number, elbow: number, contact = true, visible = true) => {
    const frame = simFrame(t += 100, session.cfg, session.targets(), { level: 0, compensations: [] });
    frame.values = { shoulder_flexion: shoulder, elbow_extension: elbow };
    frame.targetContact = contact;
    frame.visible = visible;
    session.push(frame);
  };
  while (session.snapshot().phase === "setup") push(20, 136.2);
  session.skipAhead(++t);
  const lap = session.lapPoint;
  busy = true;
  for (let n = 0; n < 30; n++) push(90, 175);
  expect(session.snapshot().holdProgress).toBe(0);
  busy = false;
  for (let n = 0; n < 10; n++) push(100, 179, false);
  for (let n = 0; n < 5; n++) push(80, 170);
  expect(session.snapshot().holdProgress).toBeCloseTo(1 / 3);
  push(80, 170, true, false);
  expect(session.snapshot().holdProgress).toBe(0);
  // The decreasing projected elbow angle is still a usable personal reference.
  for (let n = 0; n < 15; n++) push(n === 4 ? 150 : 37.5, n === 4 ? 178 : elbow);
  expect(session.currentStep?.kind).toBe("return");
  expect(session.targets()).toEqual({ shoulder_flexion: 37.5, elbow_extension: elbow });
  while (session.snapshot().phase === "warm") push(20, 136.2);
  expect(session.snapshot().targetsReady).toBe(true);
  expect(session.startingAngles()).toEqual({ shoulder_flexion: 20, elbow_extension: 136.2 });
  expect(session.lapPoint).toEqual(lap);
  while (!session.snapshot().targetArmed) push(100, 175, false);
  for (let n = 0; n < 4; n++) push(100, 175, false);
  for (let n = 0; n < 200 && !session.snapshot().review; n++) {
    const reach = session.currentStep?.kind === "reach";
    push(reach ? 37.5 : 20, reach ? elbow : 136.2);
  }
  expect(session.snapshot().reps[0].score).toBe(100);
  expect(session.snapshot().reps[0].good).toBe(true);
  expect(session.snapshot().reps[0].targets).toEqual({ shoulder_flexion: 37.5, elbow_extension: elbow });
  expect(session.snapshot().reviewAdvice.join(" ")).not.toContain("Straighten your elbow");
  session.goBack(3, ++t);
  expect(session.snapshot().targetsReady).toBe(false);
  expect(session.targets()).toEqual({ shoulder_flexion: 45, elbow_extension: 130 });
});

it("retries learning rather than starting scored repetitions after the practice target is never reached", () => {
  const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "left" }, { say() {}, busy: () => false, stop() {} });
  session.start(0);
  let t = 0;
  while (session.snapshot().phase === "setup") session.push(simFrame(t += 100, session.cfg, session.targets(), { level: 0, compensations: [] }));
  session.skipAhead(++t);
  for (let n = 0; n < 350; n++) session.push({ ...simFrame(t += 100, session.cfg, session.targets(), { level: 0, compensations: [] }), targetContact: false });
  expect(session.snapshot().phase).toBe("warm");
  expect(session.snapshot().targetsReady).toBe(false);
  expect(session.snapshot().reps).toHaveLength(0);
});

it("handles a projected elbow with no resolvable rest-to-target change without inflating its goal", () => {
  expect(reachAngleProgress(136.2, 136.2, 136.2)).toBe(1);
  expect(reachAngleProgress(130, 136.2, 136.2)).toBe(0);
  expect(reachAngleProgress(undefined, 136.2, 136.2)).toBe(0);
  expect(reachAngleProgress(132.1, 128, 136.2)).toBeCloseTo(0.5);
  expect(reachAngleProgress(128, 128, 136.2)).toBe(1);
});
