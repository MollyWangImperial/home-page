import { describe, expect, it } from "vitest";
import { reachGhostPose } from "./ghost";
import { reachDemoDuration, reachDemoState } from "./reach-demo";
import { TARGET_COMPLETION_MS, TARGET_HOLD_MS } from "./target-timing";
import { ExerciseSession, simFrame } from "./session";

describe.each([false, true])("reach demonstration (returning=%s)", returning => {
  it("keeps the target inactive and the arm still while its instruction is speaking", () => {
    const waiting = reachDemoState(30000, returning, false);
    expect(waiting.armed).toBe(false);
    expect(waiting.phase).toBe("waiting");
    expect(waiting.pose).toBe(returning ? 1 : 0);
    expect(waiting.contact).toBe(false);
    expect(waiting.progress).toBe(0);
  });
  it("places the fixed target on the hand's final position and starts outside the ring", () => {
    const start = reachDemoState(0, returning);
    const end = reachDemoState(reachDemoDuration(returning), returning);
    expect(start.target).toEqual(end.target);
    expect(start.contact).toBe(false);
    expect(start.progress).toBe(0);
    const hand = reachGhostPose(start.pose).wrist;
    expect(Math.hypot(hand[0] - start.target[0], hand[1] - start.target[1])).toBeGreaterThan(start.radius);
    expect(reachGhostPose(end.pose).wrist).toEqual(end.target);
  });

  it("activates on ring contact, fills for 1.5 seconds and completes before return", () => {
    const contactAt = reachDemoDuration(returning) - TARGET_HOLD_MS - TARGET_COMPLETION_MS;
    expect(reachDemoState(contactAt - 1, returning).contact).toBe(false);
    const touch = reachDemoState(contactAt, returning);
    const hand = reachGhostPose(touch.pose).wrist;
    expect(Math.hypot(hand[0] - touch.target[0], hand[1] - touch.target[1])).toBeCloseTo(touch.radius, 4);
    expect(touch.phase).toBe("hold");
    expect(touch.progress).toBeCloseTo(0);
    expect(reachDemoState(contactAt + 750, returning).progress).toBeCloseTo(0.5);
    const complete = reachDemoState(contactAt + TARGET_HOLD_MS, returning);
    expect(complete.phase).toBe("complete");
    expect(complete.progress).toBe(1);
    expect(complete.completionElapsedMs).toBeCloseTo(0);
    expect(reachGhostPose(complete.pose).wrist).toEqual(complete.target);
  });
});

it("keeps the hand on each target through completion before advancing the demonstration", () => {
  const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "right" }, { say: () => {}, busy: () => false, stop: () => {} });
  session.start(0); session.skipAhead(1);
  const push = (t: number) => session.push(simFrame(t, session.cfg, session.targets(), { level: 0, compensations: [] }));
  push(2);
  push(3);
  const reachDuration = reachDemoDuration(false);
  push(3 + reachDuration - 1);
  expect(session.snapshot().demoStepIndex).toBe(0);
  expect(reachDemoState(session.snapshot().demoStepElapsedMs, false).phase).toBe("complete");
  push(3 + reachDuration);
  expect(session.snapshot().phase).toBe("demo");
  expect(session.snapshot().demoStepIndex).toBe(1);
  expect(session.snapshot().demoStepElapsedMs).toBe(0);
  push(4 + reachDuration);
  const lapDuration = reachDemoDuration(true);
  push(4 + reachDuration + lapDuration - 1);
  expect(session.snapshot().phase).toBe("demo");
  expect(reachDemoState(session.snapshot().demoStepElapsedMs, true).phase).toBe("complete");
  push(4 + reachDuration + lapDuration);
  expect(session.snapshot().phase).toBe("warm");
});

it("waits for the full demonstration speech before moving toward either target", () => {
  let busy = false;
  const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "right" }, { say: () => { busy = true; }, busy: () => busy, stop: () => { busy = false; } });
  session.start(0); session.skipAhead(1);
  const push = (t: number) => session.push(simFrame(t, session.cfg, session.targets(), { level: 0, compensations: [] }));
  push(20000);
  expect(session.snapshot().targetArmed).toBe(false);
  expect(session.snapshot().demoStepElapsedMs).toBe(0);
  busy = false;
  push(20001); // Announce the reach step.
  push(40000);
  expect(session.snapshot().demoStepIndex).toBe(0);
  expect(session.snapshot().targetArmed).toBe(false);
  expect(session.snapshot().demoStepElapsedMs).toBe(0);
  busy = false;
  push(40001);
  expect(session.snapshot().targetArmed).toBe(true);
  push(40001 + reachDemoDuration(false)); // Announce the lap step.
  push(70000);
  expect(session.snapshot().demoStepIndex).toBe(1);
  expect(session.snapshot().targetArmed).toBe(false);
  expect(session.snapshot().demoStepElapsedMs).toBe(0);
  busy = false;
  push(70001);
  expect(session.snapshot().targetArmed).toBe(true);
  expect(session.snapshot().demoStepElapsedMs).toBe(0);
});
