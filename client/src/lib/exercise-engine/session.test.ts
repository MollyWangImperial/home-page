import { describe, expect, it } from "vitest";
import { LAUNCH_EXERCISE_IDS, type Rung } from "./config";
import { ExerciseSession, simFrame, type Voice } from "./session";

const FRAME_MS = 33;

type Profile = (repNumber: number) => { level: number; compensations: string[] };

/** Runs a simulated patient through a whole session. Returns the session and what Alira said. */
function run(exerciseId: string, rung: Rung, profile: Profile, opts: { reps?: number; maxSeconds?: number; stopAt?: (s: ExerciseSession) => boolean } = {}) {
  const said: string[] = [];
  const voice: Voice = { say: text => said.push(text), busy: () => false, stop: () => {} };
  const session = new ExerciseSession({ exerciseId, rung, side: "right", repsOverride: opts.reps ?? 3 }, voice);
  let t = 0;
  session.start(t);
  const limit = (opts.maxSeconds ?? 600) * 1000;
  while (t < limit && session.snapshot().phase !== "done") {
    t += FRAME_MS;
    const snap = session.snapshot();
    const step = session.currentStep;
    const moving = (snap.phase === "warm" || snap.phase === "reps") && step && (step.kind === "reach" || step.kind === "open" || step.kind === "pinch");
    const p = snap.phase === "reps" ? profile(snap.repIndex) : { level: 1, compensations: [] as string[] };
    const frame = simFrame(t, session.cfg, session.targets(), { level: moving && snap.holdProgress < 1 ? p.level : 0, compensations: moving ? p.compensations : [] });
    session.push(frame);
    if (opts.stopAt?.(session)) break;
  }
  return { session, said, seconds: t / 1000 };
}

describe("six-beat session (simulated patient)", () => {
  it("runs every launch exercise through all beats and scores clean reps 100", () => {
    for (const id of LAUNCH_EXERCISE_IDS) {
      const { session, said } = run(id, 2, () => ({ level: 1, compensations: [] }));
      const snap = session.snapshot();
      expect(snap.phase, id).toBe("done");
      const record = snap.record!;
      expect(record.not_attempted, id).toBe(false);
      expect(record.repetition_scores, id).toEqual([100, 100, 100]);
      expect(record.quality_reps, id).toBe(3);
      expect(record.score, id).toBe(100);
      expect(said[0], id).toBe(session.cfg.setupVoice);
      expect(said.some(line => line.includes("practice repetition")), id).toBe(true);
    }
  });

  it("stores clean, one-compensation and two-compensation scores and averages them", () => {
    const { session } = run("ex_reach", 2, rep => ({ level: 1, compensations: rep === 1 ? [] : rep === 2 ? ["trunk_lean"] : ["trunk_lean", "shoulder_hike"] }));
    const record = session.snapshot().record!;
    expect(record.repetition_scores).toEqual([100, 30, 15]);
    expect(record.compensation_counts).toEqual({ trunk_lean: 2, shoulder_hike: 1 });
    expect(record.score).toBe(48);
    expect(record.quality_reps).toBe(1);
  });

  it("rescue: two misses in a row drop one rung for the remaining reps", () => {
    const { session, said } = run("ex_reach", 3, rep => ({ level: rep <= 2 ? 0.55 : 1, compensations: [] }), { reps: 5 });
    const record = session.snapshot().record!;
    expect(record.rung_start).toBe(3);
    expect(record.rung_end).toBe(2);
    expect(said).toContain("Let's bring the target a little closer.");
    expect(record.repetition_scores.length).toBe(5);
  });

  it("says one correction and stays quiet the second time in a row", () => {
    const { said } = run("ex_reach", 2, () => ({ level: 1, compensations: ["trunk_lean"] }), { reps: 3 });
    const corrections = said.filter(line => line.includes("back leaned forward"));
    expect(corrections).toHaveLength(1);
  });

  it("a skip before any scored rep stores not_attempted with the rung and no score", () => {
    const { session } = run("ex_reach", 2, () => ({ level: 1, compensations: [] }), { stopAt: s => s.snapshot().phase === "warm" });
    session.skip(9999);
    const record = session.snapshot().record!;
    expect(record.not_attempted).toBe(true);
    expect(record.score).toBeNull();
    expect(record.rung_start).toBe(2);
  });

  it("stopping early scores the planned reps not attempted as zero", () => {
    const { session } = run("ex_reach", 2, () => ({ level: 1, compensations: [] }), { reps: 4, stopAt: s => s.snapshot().reps.length === 2 });
    session.skip(99999);
    const record = session.snapshot().record!;
    expect(record.not_attempted).toBe(false);
    expect(record.score).toBe(50);
  });

  it("asks to skip after 20 s without movement", () => {
    const { session, said } = run("ex_reach", 2, () => ({ level: 0, compensations: [] }), { maxSeconds: 120, stopAt: s => s.snapshot().idlePrompt });
    expect(session.snapshot().idlePrompt).toBe(true);
    expect(said).toContain("Do you want to skip this one for today?");
  });

  it("prompts about a missing landmark at most once every 8 s", () => {
    const said: string[] = [];
    const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 2, side: "right" }, { say: t => said.push(t), busy: () => false, stop: () => {} });
    session.start(0);
    for (let t = 33; t <= 20000; t += 33) session.push({ t, values: {}, comps: {}, visible: false, missing: "Lift the phone a little so I can see your shoulder." });
    expect(said.filter(line => line.includes("Lift the phone"))).toHaveLength(3);
  });

  it("chair-back mode adds the cue and the stricter trunk check", () => {
    const voice: Voice = { say: () => {}, busy: () => false, stop: () => {} };
    const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 2, side: "right", chairBack: true }, voice);
    expect(session.cfg.setupVoice).toContain("back firmly against the chair");
    expect(session.cfg.compensations.find(c => c.id === "trunk_lean")!.thresholdDeg).toBe(6);
    expect(session.cfg.compensations.find(c => c.id === "trunk_lean")!.minConsecutiveMs).toBe(250);
  });
});



describe("demonstration and earlier steps", () => {
  it("waits for the spoken introduction even beyond the old eight-second cap", () => {
    let busy = false;
    const voice: Voice = { say: () => {}, busy: () => busy, stop: () => {} };
    const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "right" }, voice);
    session.start(0);
    session.skipAhead(1);
    busy = true;
    session.push(simFrame(10000, session.cfg, session.targets(), { level: 0, compensations: [] }));
    expect(session.snapshot().demoReady).toBe(false);
    expect(session.snapshot().demoProgress).toBe(0);
    busy = false;
    session.push(simFrame(10033, session.cfg, session.targets(), { level: 0, compensations: [] }));
    expect(session.snapshot().demoReady).toBe(true);
    expect(session.snapshot().demoProgress).toBe(0);
  });

  it("replays the demonstration and practice while preserving completed scores and rep numbering", () => {
    const { session, seconds } = run("ex_reach", 2, () => ({ level: 1, compensations: [] }), { stopAt: s => s.snapshot().reps.length === 1 });
    const scores = session.snapshot().reps;
    let t = seconds * 1000;
    expect(session.goBack(2, t)).toBe(true);
    expect(session.snapshot().demoReady).toBe(false);
    expect(session.snapshot().reps).toEqual(scores);
    session.skipAhead(++t);
    expect(session.snapshot().phase).toBe("warm");
    for (let n = 0; n < 1000 && session.snapshot().phase === "warm"; n++) {
      t += FRAME_MS;
      const moving = session.currentStep?.kind === "reach" && session.snapshot().holdProgress < 1;
      session.push(simFrame(t, session.cfg, session.targets(), { level: moving ? 1 : 0, compensations: [] }));
    }
    expect(session.snapshot().phase).toBe("reps");
    expect(session.snapshot().repIndex).toBe(2);
    expect(session.snapshot().reps).toEqual(scores);
    expect(session.goBack(1, ++t)).toBe(true);
    expect(session.snapshot().calibrationProgress).toBe(0);
    expect(session.goBack(3, ++t)).toBe(false);
  });
});

it("requires ring contact and a continuous hold for camera reach", () => {
  const voice: Voice = { say: () => {}, busy: () => false, stop: () => {} };
  const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "right" }, voice);
  session.start(0); session.skipAhead(1); session.skipAhead(2);
  let t = 2;
  const push = (contact: boolean, visible = true) => {
    t += 33;
    const frame = simFrame(t, session.cfg, session.targets(), { level: 1, compensations: [] });
    session.push({ ...frame, visible, targetContact: contact, targetProgress: contact ? 1 : 0.5 });
  };
  for (let i = 0; i < 40; i++) push(false);
  expect(session.snapshot().holdProgress).toBe(0);
  for (let i = 0; i < 10; i++) push(true);
  expect(session.snapshot().liveAttainment).toBe(1);
  expect(session.snapshot().holdProgress).toBeGreaterThan(0);
  push(false);
  expect(session.snapshot().holdProgress).toBe(0);
  for (let i = 0; i < 10; i++) push(true);
  push(true, false);
  expect(session.snapshot().holdProgress).toBe(0);
  for (let i = 0; i < 80 && session.currentStep?.kind === "reach"; i++) push(true);
  expect(session.currentStep?.kind).toBe("return");
});


it.each([['warm', 'reach'], ['warm', 'return'], ['reps', 'reach'], ['reps', 'return']] as const)("ignores contact during the %s %s instruction, then holds immediately when speech finishes", (phase, kind) => {
  let busy = false;
  let instructionStarted = false;
  const voice: Voice = { say: text => {
    if (session.snapshot().phase === phase && text === session.cfg.cycle.find(step => step.kind === kind)?.voice) {
      instructionStarted = true;
      busy = true;
    }
  }, busy: () => busy, stop: () => {} };
  const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "right" }, voice);
  session.start(0); session.skipAhead(1); session.skipAhead(2);
  let t = 2;
  const push = () => {
    t += 100;
    session.push({ ...simFrame(t, session.cfg, session.targets(), { level: 0, compensations: [] }), targetContact: true, targetProgress: 1 });
  };
  for (let n = 0; n < 200 && !instructionStarted; n++) push();
  expect(instructionStarted).toBe(true);
  const previousReps = session.snapshot().reps.length;
  // Longer than both former speech caps: contact must still do nothing.
  for (let n = 0; n < 200; n++) {
    push();
    expect(session.snapshot().targetArmed).toBe(false);
    expect(session.snapshot().holdProgress).toBe(0);
    expect(session.snapshot().inZone).toBe(false);
  }
  expect(session.snapshot().phase).toBe(phase);
  expect(session.currentStep?.kind).toBe(kind);
  expect(session.snapshot().reps).toHaveLength(previousReps);
  busy = false;
  push();
  expect(session.snapshot().targetArmed).toBe(true);
  expect(session.snapshot().holdProgress).toBeCloseTo(1 / 15);
  expect(session.snapshot().inZone).toBe(true);
});

it("fills reach and lap holds at the same rate and resets the lap hold on lost tracking", () => {
  const voice: Voice = { say: () => {}, busy: () => false, stop: () => {} };
  const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "right" }, voice);
  session.start(0); session.skipAhead(1); session.skipAhead(2);
  let t = 2;
  const push = (contact = true, visible = true) => {
    t += 100;
    session.push({ ...simFrame(t, session.cfg, session.targets(), { level: session.currentStep?.kind === "reach" ? 1 : 0, compensations: [] }), visible, targetContact: contact });
  };
  while (!session.snapshot().targetArmed) push(false);
  for (let n = 0; n < 5; n++) push();
  const reachAt500 = session.snapshot().holdProgress;
  expect(reachAt500).toBeCloseTo(1 / 3);
  for (let n = 0; n < 10; n++) push();
  expect(session.currentStep?.kind).toBe("return");
  while (!session.snapshot().targetArmed) push(false);
  for (let n = 0; n < 5; n++) push();
  expect(session.snapshot().holdProgress).toBe(reachAt500);
  for (let n = 0; n < 5; n++) push();
  expect(session.currentStep?.kind).toBe("return");
  expect(session.snapshot().holdProgress).toBeCloseTo(2 / 3);
  push(true, false);
  expect(session.snapshot().holdProgress).toBe(0);
  push();
  expect(session.snapshot().holdProgress).toBeCloseTo(1 / 15);
  push(false);
  expect(session.snapshot().holdProgress).toBe(0);
  for (let n = 0; n < 14; n++) push();
  expect(session.currentStep?.kind).toBe("return");
  push();
  expect(session.snapshot().phase).toBe("reps");
});

it("makes an active target inactive and resets its hold if another instruction starts", () => {
  let busy = false;
  const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "right" }, { say: () => {}, busy: () => busy, stop: () => {} });
  session.start(0); session.skipAhead(1); session.skipAhead(2);
  let t = 2;
  const push = (contact: boolean) => {
    t += 100;
    session.push({ ...simFrame(t, session.cfg, session.targets(), { level: 1, compensations: [] }), targetContact: contact });
  };
  while (!session.snapshot().targetArmed) push(false);
  for (let n = 0; n < 5; n++) push(true);
  expect(session.snapshot().holdProgress).toBeCloseTo(1 / 3);
  busy = true;
  push(true);
  expect(session.snapshot().targetArmed).toBe(false);
  expect(session.snapshot().holdProgress).toBe(0);
  expect(session.snapshot().inZone).toBe(false);
  busy = false;
  push(true);
  expect(session.snapshot().targetArmed).toBe(true);
  expect(session.snapshot().holdProgress).toBeCloseTo(1 / 15);
});

it("does not count contact in the frame that starts an idle voice prompt", () => {
  let busy = false;
  const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "right" }, { say: text => { if (text.includes("skip this one")) busy = true; }, busy: () => busy, stop: () => {} });
  session.start(0);
  session.push(simFrame(100, session.cfg, session.targets(), { level: 0, compensations: [] }));
  session.skipAhead(101); session.skipAhead(102);
  let t = 102;
  const push = (contact: boolean) => session.push({ ...simFrame(t, session.cfg, session.targets(), { level: 0, compensations: [] }), targetContact: contact });
  while (!session.snapshot().targetArmed) { t += 100; push(false); }
  t += 21000;
  push(true);
  expect(session.snapshot().idlePrompt).toBe(true);
  expect(session.snapshot().targetArmed).toBe(false);
  expect(session.snapshot().holdProgress).toBe(0);
  expect(session.snapshot().inZone).toBe(false);
});

it("gives elbow-specific advice when elbow extension is below target", () => {
  const { session } = run("ex_reach", 2, () => ({ level: 1, compensations: [] }), { stopAt: s => s.snapshot().phase === "reps" });
  let t = 100000;
  for (let n = 0; n < 300 && session.snapshot().reps.length === 0; n++) {
    t += 33;
    const reaching = session.currentStep?.kind === "reach";
    const frame = simFrame(t, session.cfg, session.targets(), { level: reaching ? 1 : 0, compensations: [] });
    if (reaching) { frame.values.elbow_extension = 105; frame.targetContact = true; frame.targetProgress = 1; }
    session.push(frame);
  }
  expect(session.snapshot().reps).toHaveLength(1);
  expect(session.snapshot().feedback).toContain("straighten your elbow");
});

it("fills setup progress while introductory speech is still playing", () => {
  const voice: Voice = { say: () => {}, busy: () => true, stop: () => {} };
  const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "right" }, voice);
  session.start(0);
  for (const t of [100, 1100]) session.push(simFrame(t, session.cfg, session.targets(), { level: 0, compensations: [] }));
  expect(session.snapshot().calibrationProgress).toBe(0.5);
});

it("speaks feedback in one completion popup, then counts down three seconds before resuming", () => {
  let speechBusy = false;
  const spoken: string[] = [];
  const voice: Voice = { say: line => spoken.push(line), busy: () => speechBusy, stop: () => {} };
  const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "right", reviewBetweenReps: true, repsOverride: 3 }, voice);
  session.start(0); session.skipAhead(1); session.skipAhead(2);
  let t = 2;
  for (let n = 0; n < 3000 && !session.snapshot().review; n++) {
    t += 33;
    session.push(simFrame(t, session.cfg, session.targets(), { level: session.currentStep?.kind === "reach" && session.snapshot().holdProgress < 1 ? 1 : 0, compensations: [] }));
  }
  expect(session.snapshot().review).toBe("complete");
  expect(session.snapshot().reps).toHaveLength(1);
  expect(spoken.join(" ")).toContain("Repetition 1 complete.");
  expect(spoken.at(-1)).toBe(session.snapshot().reviewAdvice.at(-1));
  speechBusy = true;
  t += 2000;
  session.push(simFrame(t, session.cfg, session.targets(), { level: 1, compensations: [] }));
  expect(session.snapshot().review).toBe("complete");
  expect(session.snapshot().countdownProgress).toBe(0);
  speechBusy = false;
  t += 33;
  session.push(simFrame(t, session.cfg, session.targets(), { level: 1, compensations: [] }));
  expect(session.snapshot().review).toBe("countdown");
  expect(session.snapshot().repIndex).toBe(1);
  t += 1500;
  session.push(simFrame(t, session.cfg, session.targets(), { level: 1, compensations: [] }));
  expect(session.snapshot().countdownProgress).toBe(0.5);
  expect(session.snapshot().reps).toHaveLength(1);
  t += 1500;
  session.push(simFrame(t, session.cfg, session.targets(), { level: 1, compensations: [] }));
  expect(session.snapshot().review).toBeNull();
  expect(session.snapshot().repIndex).toBe(2);
});

it("clears queued setup guidance before announcing the demonstration", () => {
  const events: string[] = [];
  const voice: Voice = { say: line => events.push(line), busy: () => false, stop: () => events.push("STOP") };
  const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "right" }, voice);
  session.start(0);
  session.skipAhead(1);
  expect(events.slice(-2)).toEqual(["STOP", "Now watch the demonstration on the right. I will show you how to do the movement. Just watch; nothing is scored."]);
  expect(session.snapshot().prompt).toBe("Watch me first. Nothing is scored.");
});

it("shows and speaks final-repetition feedback before the summary without another countdown", () => {
  let busy = false;
  const spoken: string[] = [];
  const voice: Voice = { say: line => spoken.push(line), busy: () => busy, stop: () => {} };
  const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "right", reviewBetweenReps: true, repsOverride: 1 }, voice);
  session.start(0); session.skipAhead(1); session.skipAhead(2);
  let t = 2;
  for (let n = 0; n < 3000 && !session.snapshot().review; n++) {
    t += 33;
    const reaching = session.currentStep?.kind === "reach";
    const scored = session.snapshot().phase === "reps";
    session.push({ ...simFrame(t, session.cfg, session.targets(), { level: reaching ? 1 : 0, compensations: scored && reaching ? ["trunk_lean", "shoulder_hike"] : [] }), targetContact: true });
  }
  expect(session.snapshot().review).toBe("complete");
  expect(session.snapshot().phase).toBe("reps");
  expect(session.snapshot().record).toBeNull();
  expect(session.snapshot().reps[0].score).toBe(15);
  expect(spoken.join(" ")).toContain("Repetition 1 complete. Your score is 15 out of 100.");
  expect(spoken.join(" ")).toContain("back leaned forward");
  expect(spoken.join(" ")).toContain("shoulder lifted");
  expect(spoken.at(-1)).not.toContain("next repetition");
  busy = true;
  session.push(simFrame(t += 2000, session.cfg, session.targets(), { level: 0, compensations: [] }));
  expect(session.snapshot().review).toBe("complete");
  busy = false;
  session.push(simFrame(t += 33, session.cfg, session.targets(), { level: 0, compensations: [] }));
  expect(session.snapshot().phase).toBe("done");
  expect(session.snapshot().review).toBeNull();
  expect(session.snapshot().record?.score).toBe(15);
  expect(spoken.some(line => line.includes("next repetition starts"))).toBe(false);
});

it("speaks each missed movement target and confirmed compensation in the completion popup", () => {
  const spoken: string[] = [];
  const voice: Voice = { say: line => spoken.push(line), busy: () => false, stop: () => {} };
  const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "right", reviewBetweenReps: true, repsOverride: 3 }, voice);
  session.start(0);
  session.push(simFrame(1, session.cfg, session.targets(), { level: 0, compensations: [] }));
  session.skipAhead(2); session.skipAhead(3);
  let t = 3;
  for (let n = 0; n < 3000 && !session.snapshot().review; n++) {
    t += 33;
    const reaching = session.currentStep?.kind === "reach";
    const scored = session.snapshot().phase === "reps";
    const frame = simFrame(t, session.cfg, session.targets(), { level: reaching ? 1 : 0, compensations: scored ? ["shoulder_hike"] : [] });
    frame.targetContact = true;
    if (scored && reaching) {
      frame.values.shoulder_flexion = 30;
      frame.values.elbow_extension = 110;
    }
    session.push(frame);
  }
  expect(session.snapshot().review).toBe("complete");
  expect(session.snapshot().reps[0].compensations).toEqual(["shoulder_hike"]);
  const advice = session.snapshot().reviewAdvice;
  expect(advice).toHaveLength(3);
  expect(advice.join(" ")).toContain("Lift your arm");
  expect(advice.join(" ")).toContain("Straighten your elbow");
  // Each piece of advice is spoken as its own line, right after the score.
  expect(spoken.slice(-advice.length)).toEqual(advice);
});

it.each([[6, []], [7, ["trunk_lean"]], [12, ["trunk_lean"]], [13, ["trunk_lean", "shoulder_hike"]]] as const)("requires 200ms for lean and 400ms for shoulder hiking (%i frames)", (overFrames, detected) => {
  const voice: Voice = { say: () => {}, busy: () => false, stop: () => {} };
  const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "right", reviewBetweenReps: true, repsOverride: 3 }, voice);
  session.start(0); session.skipAhead(1); session.skipAhead(2);
  let t = 2;
  let scoredFrames = 0;
  for (let n = 0; n < 3000 && !session.snapshot().review; n++) {
    t += 33;
    const reaching = session.currentStep?.kind === "reach";
    const scored = session.snapshot().phase === "reps";
    const over = scored && reaching && session.snapshot().targetArmed && ++scoredFrames <= overFrames;
    const frame = simFrame(t, session.cfg, session.targets(), { level: reaching ? 1 : 0, compensations: over ? ["trunk_lean", "shoulder_hike"] : [] });
    frame.targetContact = true;
    session.push(frame);
  }
  expect(session.snapshot().reps[0].compensations).toEqual(detected);
});
