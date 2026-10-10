import { describe, expect, it } from "vitest";
import { CAMERA_TASKS, handLevelContact, handLevelGoal, OTHER_HAND_IN_VIEW, pinchLevelGoal } from "../assessment-engine/tasks";
import type { AttemptRecord, CameraTaskId } from "../assessment-engine/types";
import { EXERCISES } from "./config";
import { handRingTarget, LEARNED_RING_SHARE, startLimit, waiveLimit } from "./hand-target";
import { TOUCH_CLOSURE } from "./pinch-target";
import { ASSESSMENT_LINES, ATTEMPT_ENCOURAGE_MS, ATTEMPT_TIMEOUT_MS, ExerciseSession, simFrame, withAssessment, type Snapshot } from "./session";
import { handInViewLine, keepInViewLine } from "./spoken";
import { DEFAULT_EXERCISE_TUNING } from "../../../../shared/alira-adaptation";

// The movement check on the exercise engine: a simulated patient (simFrame plus the page's contact and progress, as the
// no-camera simulator drives it) through set-up, the demonstration, the try-out and the levels ladder.

const FRAME_MS = 50;

/** What the patient does at a level's target: how far they get (1 on it), whether they touch it, and their posture. */
type Move = { reach: number; contact?: boolean; comps?: string[]; measures?: Record<string, number | undefined> };
type At = { level: number; assisted: boolean; phase: Snapshot["phase"]; armedMs: number };
type Patient = (at: At) => Move;

/** Holds every level up to `best` (by itself) and gets part of the way to the others; with help, reaches anything. */
const able = (best: number, short = 0.5): Patient => at => ({ reach: at.level <= best || at.assisted ? 1 : short });

function task(taskId: CameraTaskId, patient: Patient, options: { start?: number; help?: boolean; frames?: number; tuning?: typeof DEFAULT_EXERCISE_TUNING; stopAt?: (snap: Snapshot) => boolean } = {}) {
  const spec = CAMERA_TASKS[taskId];
  const said: string[] = [];
  const session = new ExerciseSession({
    exerciseId: spec.exerciseId, rung: 1, side: "right", tuning: options.tuning,
    assessment: { taskId, levels: spec.levels, startLevel: options.start ?? spec.levels.length - 1, compensations: spec.compensations, cycle: spec.cycle },
  }, { say: text => said.push(text), busy: () => false, stop() {} });
  let t = 0, helped = false, armedKey = "", armedAt = 0;
  const snaps: Snapshot[] = [];
  session.start(t);
  for (let n = 0; n < (options.frames ?? 20000) && session.snapshot().phase !== "done"; n++) {
    t += FRAME_MS;
    const snap = session.snapshot();
    snaps.push(snap);
    if (options.stopAt?.(snap)) break;
    if (snap.assessmentOffer === "help" && options.help !== undefined) {
      helped = options.help;
      session.answerHelp(options.help, t);
      continue;
    }
    const live = (snap.phase === "warm" || snap.phase === "reps") && !snap.review;
    const returning = session.currentStep?.kind === "return";
    const key = `${snap.phase}:${snap.repIndex}:${snap.stepIndex}`;
    if (live && snap.targetArmed && !returning && armedKey !== key) { armedKey = key; armedAt = t; }
    const moving = live && snap.targetArmed && !returning;
    const level = snap.assessmentLevel ?? -1;
    const move: Move = moving ? patient({ level, assisted: helped && snap.phase === "reps", phase: snap.phase, armedMs: t - armedAt }) : { reach: 0 };
    const frame = simFrame(t, session.cfg, session.targets(), { level: move.reach, compensations: move.comps ?? [] });
    // Hand to mouth's simulated body measures only its own checks: the other hand comes from the page (other-hand.ts).
    if (frame.comps.other_hand_arm === undefined && session.cfg.compensations.some(comp => comp.metric === "other_hand_arm")) frame.comps.other_hand_arm = move.comps?.includes("other_hand") ? 7 : 0.25;
    Object.assign(frame.comps, move.measures ?? {});
    if (live) {
      const contact = returning ? move.reach <= 0.05 : move.contact ?? move.reach >= 1;
      frame.targetContact = contact;
      frame.targetProgress = contact ? 1 : Math.min(0.98, returning ? 1 - move.reach : move.reach);
    }
    session.push(frame);
  }
  const snap = session.snapshot();
  return { session, said, snap, snaps, t, result: snap.record?.assessment, attempts: snap.assessmentAttempts ?? [] };
}

const levelsOf = (attempts: AttemptRecord[]) => attempts.map(attempt => `${attempt.levelId}${attempt.assist ? "+help" : ""}:${attempt.completed ? "held" : attempt.touched ? "touched" : "missed"}`);
/** Lines that would be a score or an exercise's repetition count: never said in the movement check. */
const SCORE_LINE = /\bscore\b|out of 100|good reps|Repetition \d|level \d of 3|Now \w+ repetitions|The next repetition/i;

describe("movement check: the levels ladder", () => {
  it("T1 reach climbs from the easiest level to the top, one countdown and review per level", () => {
    const { result, said, attempts } = task("T1", able(2), { start: 0 });
    expect(levelsOf(attempts)).toEqual(["r80:held", "r120:held", "r160:held"]);
    expect(result).toMatchObject({ taskId: "T1", exerciseId: "ex_reach", levelIds: ["r80", "r120", "r160"], startLevel: 0, stoppedBy: "top_reached", measured: true, movementSeen: true, side: "right" });
    // Each level is named as its countdown starts, after the levels line.
    expect(said.filter(line => line.startsWith("Next, "))).toEqual(["Next, reach to the circle at chest height.", "Next, reach to the circle above your shoulder.", "Next, reach to the circle overhead."]);
    expect(said).toContain(ASSESSMENT_LINES.levels);
    expect(said.filter(line => line === ASSESSMENT_LINES.reached)).toHaveLength(3);
    expect(said.at(-1)).toBe(ASSESSMENT_LINES.done);
  });
  it("T1 stops at a reversal: overhead missed, then above the shoulder held", () => {
    const { result, attempts, said } = task("T1", able(1));
    expect(levelsOf(attempts)).toEqual(["r160:missed", "r120:held"]);
    expect(result?.stoppedBy).toBe("reversal");
    expect(said).toContain(ASSESSMENT_LINES.another);
  });
  it("T1 starting at the top and holding it stops at once", () => {
    const { result, attempts } = task("T1", able(2));
    expect(levelsOf(attempts)).toEqual(["r160:held"]);
    expect(result?.stoppedBy).toBe("top_reached");
  });
  it("T3 at its lowest failure offers help; yes gives one assisted try at the chest, then stops", () => {
    const { result, attempts, said, snaps } = task("T3", able(-1, 0.4), { help: true });
    expect(levelsOf(attempts)).toEqual(["mouth:missed", "chest:missed", "chest+help:held"]);
    expect(result).toMatchObject({ stoppedBy: "lowest_failed", measured: true, movementSeen: true });
    expect(said).toContain(ASSESSMENT_LINES.offerHelp);
    expect(said).toContain(ASSESSMENT_LINES.withHelp);
    // The offer waits on the review card: no target is live while the patient answers.
    expect(snaps.some(snap => snap.assessmentOffer === "help" && snap.review === "complete" && !snap.targetArmed)).toBe(true);
  });
  it("H4 at its lowest failure, help declined, stops without another try", () => {
    const { result, attempts, said } = task("H4", able(-1, 0.2), { start: 0, help: false });
    expect(levelsOf(attempts)).toEqual(["partial:missed"]);
    expect(result).toMatchObject({ stoppedBy: "help_declined", movementSeen: false, measured: true });
    expect(said).toContain(ASSESSMENT_LINES.offerHelp);
    expect(said).not.toContain(ASSESSMENT_LINES.withHelp);
    expect(said.at(-1)).toBe(ASSESSMENT_LINES.done);
  });
  it("the help offer is made once and waits for the patient's answer", () => {
    const { session, said, snap } = task("H4", able(-1, 0.2), { start: 0, frames: 4000 });
    expect(snap).toMatchObject({ phase: "reps", assessmentOffer: "help", review: "complete" });
    expect(said.filter(line => line === ASSESSMENT_LINES.offerHelp)).toHaveLength(1);
    session.answerHelp(false, 999999);
    expect(session.snapshot().record?.assessment?.stoppedBy).toBe("help_declined");
    // A second answer changes nothing.
    session.answerHelp(true, 1000000);
    expect(session.snapshot().phase).toBe("done");
  });
  it("H3 pinch climbs from close to the finger to tip to tip, the first finger only", () => {
    const { session, result, attempts, snaps } = task("H3", able(1), { start: 0 });
    expect(levelsOf(attempts)).toEqual(["partial:held", "full:held"]);
    expect(result?.stoppedBy).toBe("top_reached");
    expect(session.cfg.cycle).toHaveLength(2);
    // Only the first finger's steps: the demonstration and every attempt run step 0 (pinch) and step 1 (let go).
    expect(Math.max(...snaps.map(snap => snap.stepIndex))).toBe(1);
    expect(Math.max(...snaps.map(snap => snap.demoStepIndex))).toBe(1);
  });
});

describe("movement check: the try-out", () => {
  it("is one unscored try at the easiest level that never loops, even when it is not reached", () => {
    const { said, result, snaps } = task("T1", at => ({ reach: at.phase === "warm" ? 0.5 : 1 }), { start: 1 });
    expect(said.filter(line => line.startsWith(ASSESSMENT_LINES.tryOut))).toEqual([`${ASSESSMENT_LINES.tryOut} Reach to the circle at chest height and hold, then return your hand to your lap.`]);
    expect(said.some(line => line.includes("practice repetition") || line.includes("learn your movement"))).toBe(false);
    expect(result?.tryOut).toEqual({ completed: false, peakProgress: 0.5 });
    expect(snaps.filter(snap => snap.phase === "warm").every(snap => snap.assessmentLevel === 0)).toBe(true);
    expect(levelsOf(result!.attempts)).toEqual(["r120:held", "r160:held"]);
  });
  it("says each task's try-out in its own words", () => {
    const lines = (["T3", "H4", "H3"] as const).map(id => task(id, able(9), { start: 0 }).said.find(line => line.startsWith(ASSESSMENT_LINES.tryOut)));
    expect(lines).toEqual([
      `${ASSESSMENT_LINES.tryOut} Bring your hand to your chest and hold, then return your hand to your lap.`,
      `${ASSESSMENT_LINES.tryOut} Show me your palm in the shaded area. Then open your fingers out to the inner ring and hold, then close your hand gently.`,
      `${ASSESSMENT_LINES.tryOut} Show me your palm in the shaded area. Then bring your thumb close to your first finger and hold, then let go.`,
    ]);
  });
  it("hand to mouth's chest level is worded for the chest; its mouth level keeps the cup's words", () => {
    const { said, snaps } = task("T3", able(1), { start: 0 });
    const reach = EXERCISES.ex_h2m.cycle[0];
    expect(said.filter(line => line.includes("circle on your chest"))).toHaveLength(1);
    expect(said).not.toContain(reach.voice);
    expect(snaps.some(snap => snap.phase === "warm" && snap.kind === "reach" && snap.caption === "Bring your hand to your chest and hold")).toBe(true);
    expect(snaps.some(snap => snap.phase === "reps" && snap.assessmentLevel === 1 && snap.kind === "reach" && snap.caption === reach.caption)).toBe(true);
  });
});

describe("movement check: an attempt's time", () => {
  it("moves a missed attempt on to the return after 20 s (not ending the repetition), with one encouragement at 10 s", () => {
    const { said, attempts, snaps } = task("T1", able(-1, 0.4), { start: 0, help: false });
    expect(levelsOf(attempts)).toEqual(["r80:missed"]);
    expect(said.filter(line => line === ASSESSMENT_LINES.encourage)).toHaveLength(2); // the try-out's and the attempt's
    expect(attempts[0].durationMs).toBeGreaterThanOrEqual(ATTEMPT_TIMEOUT_MS);
    expect(attempts[0].durationMs).toBeLessThan(ATTEMPT_TIMEOUT_MS + 200);
    // After the time ran out the attempt went back to the lap circle before it was reviewed.
    const firstReturn = snaps.findIndex(snap => snap.phase === "reps" && snap.kind === "return" && !snap.review);
    const firstReview = snaps.findIndex(snap => snap.phase === "reps" && snap.review === "complete");
    expect(firstReturn).toBeGreaterThan(-1);
    expect(firstReturn).toBeLessThan(firstReview);
  });
  it("never cuts a hold under way when the time runs out", () => {
    const late = ATTEMPT_TIMEOUT_MS - 400;
    const { attempts } = task("T1", at => ({ reach: at.phase === "reps" && at.armedMs >= late ? 1 : at.phase === "warm" ? 1 : 0.3 }), { start: 2 });
    expect(levelsOf(attempts)).toEqual(["r160:held"]);
    expect(attempts[0].durationMs).toBeGreaterThan(ATTEMPT_TIMEOUT_MS);
  });
  it("does not say the encouragement over a hold under way", () => {
    const { said, attempts } = task("T1", at => ({ reach: at.phase === "warm" || at.armedMs >= ATTEMPT_ENCOURAGE_MS - 300 ? 1 : 0.3 }), { start: 2 });
    expect(levelsOf(attempts)).toEqual(["r160:held"]);
    expect(said).not.toContain(ASSESSMENT_LINES.encourage);
  });
  it("records a touch that is not held as touched, a failure", () => {
    const { attempts, result } = task("T1", at => ({ reach: at.phase === "reps" && at.armedMs < 1500 ? at.armedMs < 600 ? 0.6 : 1 : at.phase === "warm" ? 1 : 0.3 }), { start: 2, frames: 6000, stopAt: snap => (snap.assessmentAttempts?.length ?? 0) >= 1 });
    expect(attempts[0]).toMatchObject({ levelId: "r160", completed: false, touched: true });
    void result;
  });
});

describe("movement check: posture checks per attempt", () => {
  it("T1: detected, not detected and not measured, with the exercise's note on the review card (never a score)", () => {
    const { attempts, snaps } = task("T1", at => ({ reach: 1, comps: at.phase === "reps" ? ["trunk_lean"] : [], measures: at.phase === "reps" ? { other_hand_arm: undefined } : {} }), { start: 2 });
    expect(attempts[0].compensations).toEqual({ trunk_lean: "detected", shoulder_hike: "not_detected", other_hand: "not_measured" });
    const review = snaps.find(snap => snap.review === "complete")!;
    expect(review.reviewAdvice[0]).toBe("Overhead reached");
    expect(review.reviewAdvice.some(line => line.includes("back leaned forward"))).toBe(true);
    // Only the other hand went unseen: the note names it, not the face and shoulders that were in view.
    expect(review.reviewAdvice).toContain(OTHER_HAND_IN_VIEW);
    expect(review.reviewAdvice.some(line => line.startsWith("Keep your face and both shoulders in view"))).toBe(false);
    expect(review.reviewAdvice.join(" ")).not.toMatch(/\d/);
  });
  it("T1 and T3: the other hand out of view says so; other checks out of view too add the face-and-shoulders line", () => {
    for (const id of ["T1", "T3"] as const) {
      // Started at the top and held there: one attempt, its review the task's last.
      const top = CAMERA_TASKS[id].levels.length - 1;
      const only = task(id, at => ({ reach: 1, measures: at.phase === "reps" ? { other_hand_arm: undefined } : {} }), { start: top });
      const onlyNotes = only.snaps.find(snap => snap.review === "complete")!.reviewAdvice.slice(1);
      expect(onlyNotes, id).toEqual([OTHER_HAND_IN_VIEW]);
      const unseen = Object.fromEntries(CAMERA_TASKS[id].compensations.map(rule => [rule.metric, undefined]));
      const all = task(id, at => ({ reach: 1, measures: at.phase === "reps" ? unseen : {} }), { start: top });
      expect(Object.values(all.attempts[0].compensations).every(status => status === "not_measured"), id).toBe(true);
      expect(all.snaps.find(snap => snap.review === "complete")!.reviewAdvice.slice(1), id).toEqual([keepInViewLine(true), OTHER_HAND_IN_VIEW]);
    }
    // The hand tasks keep their own line: their other hand is the hand model's, judged with the hand in its area.
    const unseen = Object.fromEntries(CAMERA_TASKS.H4.compensations.map(rule => [rule.metric, undefined]));
    const hand = task("H4", at => ({ reach: 1, measures: at.phase === "reps" ? unseen : {} }), { start: 1 });
    expect(hand.snaps.find(snap => snap.review === "complete")!.reviewAdvice.slice(1)).toEqual([handInViewLine(true)]);
  });
  it("a helped attempt leaves the other-hand check unmeasured and unspoken: the helper's hand is a second hand too", () => {
    for (const id of ["H4", "T1"] as const) {
      const { attempts, snaps, snap } = task(id, at => ({ reach: at.assisted ? 1 : 0.2, comps: at.assisted ? ["other_hand"] : [] }), { start: 0, help: true });
      expect(levelsOf(attempts), id).toEqual([`${CAMERA_TASKS[id].levels[0].id}:missed`, `${CAMERA_TASKS[id].levels[0].id}+help:held`]);
      expect(attempts[1].compensations.other_hand, id).toBe("not_measured");
      const notes = snaps.filter(item => item.review === "complete").at(-1)!.reviewAdvice;
      expect(notes, id).toEqual([`${CAMERA_TASKS[id].levels[0].label} reached`]);
      expect(snap.record!.compensation_counts.other_hand, id).toBeUndefined();
    }
    // Without help the same hand is the patient's own, and it is detected.
    const alone = task("H4", () => ({ reach: 1, comps: ["other_hand"] }), { start: 0 });
    expect(alone.attempts[0].compensations.other_hand).toBe("detected");
  });
  it("T1 and T3: the other hand at the affected forearm is detected", () => {
    for (const id of ["T1", "T3"] as const) {
      const { attempts, snaps } = task(id, () => ({ reach: 1, comps: ["other_hand"] }), { start: 1 });
      expect(attempts[0].compensations.other_hand, id).toBe("detected");
      expect(snaps.find(snap => snap.review === "complete")!.reviewAdvice, id).toContain("I noticed your other hand helping. Keep your other hand resting on your lap.");
    }
  });
  it("H4: the other hand near the palm and a bent wrist are detected; the rest are clean", () => {
    const { attempts } = task("H4", () => ({ reach: 1, comps: ["other_hand", "wrist_bend"] }), { start: 1 });
    expect(attempts[0].compensations).toEqual({ wrist_bend: "detected", forearm_turn: "not_detected", trunk_forward: "not_detected", shoulder_hike: "not_detected", other_hand: "detected" });
  });
  it("H3: the pinch's own checks, the whole-hand squeeze among them", () => {
    const { attempts } = task("H3", () => ({ reach: 1, comps: ["mass_flexion"] }), { start: 1 });
    expect(Object.keys(attempts[0].compensations)).toEqual(["trunk_forward", "shoulder_hike", "forearm_turn", "other_hand", "wrist_bend", "mass_flexion"]);
    expect(attempts[0].compensations.mass_flexion).toBe("detected");
    expect(attempts[0].compensations.trunk_forward).toBe("not_detected");
  });
  it("T3: hand to mouth's head and trunk checks come from its simulated body", () => {
    const { attempts } = task("T3", at => ({ reach: 1, comps: at.phase === "reps" ? ["head_forward"] : [] }), { start: 1 });
    expect(attempts[0].compensations.head_forward).toBe("detected");
    expect(attempts[0].compensations.other_hand).toBe("not_detected");
  });
});

describe("movement check: what it says and stores", () => {
  it.each(["T1", "T3", "H4", "H3"] as const)("%s never says a score, a repetition count or a level of three", id => {
    const { said, snap, snaps } = task(id, able(0), { start: 1, help: true });
    expect(said.filter(line => SCORE_LINE.test(line))).toEqual([]);
    expect(snaps.every(snap => snap.reps.length === 0)).toBe(true);
    expect(snap.record).toMatchObject({ score: null, repetition_scores: [], wrap: ASSESSMENT_LINES.done });
    expect(said.at(-1)).toBe(ASSESSMENT_LINES.done);
  });
  it("stores the task's result in the record, with real peaks as insights", () => {
    const { result } = task("T1", able(1), { start: 1 });
    expect(Object.keys(result!).sort()).toEqual(["attempts", "exerciseId", "insights", "levelIds", "measured", "movementSeen", "side", "startLevel", "stoppedBy", "taskId", "tryOut"]);
    expect(Object.keys(result!.attempts[0]).sort()).toEqual(["assist", "compensations", "completed", "durationMs", "level", "levelId", "peakProgress", "touched"]);
    expect(result!.attempts.map(attempt => attempt.peakProgress)).toEqual([1, 0.5]);
    expect(result!.tryOut).toEqual({ completed: true, peakProgress: 1 });
    // The simulated reach's own angles at its goal: shoulder 45 degrees, elbow 130.
    expect(result!.insights.shoulder_flexion).toBeCloseTo(45, 5);
    expect(result!.insights.elbow_extension).toBeCloseTo(130, 5);
    expect(result!.attempts.every(attempt => attempt.durationMs > 1400 || !attempt.completed)).toBe(true);
  });
  it("hand opening's insight is its openness; the pinch's is its first finger's closure", () => {
    expect(task("H4", able(1), { start: 1 }).result!.insights.hand_openness).toBeCloseTo(1.15, 5);
    const pinch = task("H3", able(1), { start: 1 }).result!.insights;
    expect(pinch.pinch_index).toBeCloseTo(TOUCH_CLOSURE, 5);
    expect(pinch.pinch_middle).toBeUndefined();
  });
  it("an assisted attempt's peaks are not the patient's own insights", () => {
    const { result } = task("T1", at => ({ reach: at.assisted ? 1 : at.phase === "warm" ? 0.2 : 0.2 }), { start: 0, help: true });
    expect(levelsOf(result!.attempts)).toEqual(["r80:missed", "r80+help:held"]);
    expect(result!.insights.shoulder_flexion).toBeLessThan(20);
  });
  it("a task skipped before any attempt is not measured, and nothing is said at the end", () => {
    const said: string[] = [];
    const spec = CAMERA_TASKS.T1;
    const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "left", assessment: { taskId: "T1", levels: spec.levels, startLevel: 1, compensations: spec.compensations } }, { say: text => said.push(text), busy: () => false, stop() {} });
    session.start(0);
    session.skipAhead(1);
    session.skip(2);
    const record = session.snapshot().record!;
    expect(record.assessment).toMatchObject({ measured: false, stoppedBy: "skipped", attempts: [], movementSeen: false, side: "left", startLevel: 1, tryOut: { completed: false, peakProgress: 0 } });
    expect(record).toMatchObject({ not_attempted: true, score: null, wrap: ASSESSMENT_LINES.skipped });
    expect(said).not.toContain(ASSESSMENT_LINES.done);
  });
  it("Skip this task during the try-out: not measured, and nothing is said at the end", () => {
    const { session, said, t } = task("H4", able(1), { start: 1, stopAt: snap => snap.phase === "warm" && snap.targetArmed });
    session.skip(t + FRAME_MS);
    expect(session.snapshot().record!.assessment).toMatchObject({ measured: false, stoppedBy: "skipped", attempts: [] });
    expect(said).not.toContain(ASSESSMENT_LINES.done);
  });
  it("Skip this task after an attempt keeps the attempts made: measured, stopped as skipped", () => {
    const { session, t } = task("T1", able(1), { start: 1, stopAt: snap => (snap.assessmentAttempts?.length ?? 0) === 1 && snap.review === "countdown" });
    session.skip(t + FRAME_MS);
    const record = session.snapshot().record!;
    expect(record.assessment).toMatchObject({ measured: true, stoppedBy: "skipped" });
    expect(levelsOf(record.assessment!.attempts)).toEqual(["r120:held"]);
    expect(record).toMatchObject({ not_attempted: false, wrap: ASSESSMENT_LINES.done });
    // A second skip changes nothing.
    session.skip(t + 2 * FRAME_MS);
    expect(session.snapshot().record).toBe(record);
  });
  it("exposes the level being tried: the try-out's in the warm, the next level's at its countdown", () => {
    const { snaps } = task("T1", able(1), { start: 1 });
    const countdowns = snaps.filter(snap => snap.review === "countdown").map(snap => snap.assessmentLevel);
    expect(countdowns.filter((level, i) => countdowns.indexOf(level) === i)).toEqual([1, 2]);
    expect(snaps.filter(snap => snap.phase === "setup" || snap.phase === "demo").every(snap => snap.assessmentLevel === -1)).toBe(true);
    expect(snaps.at(-1)!.assessmentLevelIds).toEqual(["r80", "r120", "r160"]);
  });
});

describe("movement check: the exercise as the task runs it", () => {
  it("uses the task's posture checks and steps, and the standard hold whatever Alira has learned", () => {
    const spec = CAMERA_TASKS.H3;
    const tuning = { ...DEFAULT_EXERCISE_TUNING, holdFactor: 2, adapted: true, changed: { "exercise.hold_seconds": 3 } };
    const { session, attempts } = task("H3", able(1), { start: 1, tuning });
    expect(session.cfg.compensations.map(comp => comp.id)).toEqual(spec.compensations.map(comp => comp.id));
    // The task's steps, saying the check's own wording.
    expect(session.cfg.cycle).toEqual(spec.cycle!.map(step => ({ ...step, voice: step.checkVoice ?? step.voice, ...(step.checkCue ? { cue: step.checkCue } : {}) })));
    expect(session.tuning.holdFactor).toBe(1);
    expect(attempts[0].completed).toBe(true);
    expect(withAssessment(EXERCISES.ex_reach, null)).toBe(EXERCISES.ex_reach);
  });
  it("keeps the check's fuller instructions where it reuses an exercise's shorter steps", () => {
    const voices = (id: CameraTaskId, exercise: keyof typeof EXERCISES) => withAssessment(EXERCISES[exercise], CAMERA_TASKS[id]).cycle;
    const h4 = voices("H4", "ex_handopen");
    expect(h4[0].voice).toBe("Slowly open your fingers out to the ring, as wide as is comfortable, and hold. Keep your wrist straight and your palm facing the camera.");
    expect(h4[1].cue).toBe("Now close it gently.");
    expect(voices("T3", "ex_h2m")[1].voice).toBe("Now lower the cup and bring your hand back to the same place on your lap.");
    const h3 = voices("H3", "ex_pinch");
    expect(h3[0].voice).toBe("Bring your thumb and first finger together, tip to tip like an O, to pick up the peg in the circle, and hold.");
    expect(h3[1].voice).toBe("Now open your thumb and finger to let the peg drop into the tray.");
    // The daily exercises say the short lines.
    expect(EXERCISES.ex_handopen.cycle[0].voice).toBe("Open your fingers out to the ring and hold, wrist straight.");
  });
  it("the pinch's goal is its level's, from the resting thumb", () => {
    const { session } = task("H3", able(1), { start: 0, stopAt: snap => snap.phase === "reps" });
    const rest = session.restValues().pinch_index;
    expect(session.assessmentLevelId).toBe("partial");
    expect(session.targets().pinch_index).toBeCloseTo(pinchLevelGoal("partial", rest), 6);
    expect(pinchLevelGoal("full", rest)).toBe(TOUCH_CLOSURE);
  });
  it("hand opening: fingertips jittering either side of the wide ring still hold it, with the page's stay-slack", () => {
    const ring = handLevelGoal("full", 0.6);
    for (const slack of [true, false]) {
      let n = 0, on = false;
      const { attempts } = task("H4", at => {
        if (at.phase !== "reps") return { reach: 1 };
        // Out at the ring, then 0.03 palm lengths either side of it, frame by frame.
        const openness = ring + (n++ % 2 ? -0.03 : 0.03);
        on = handLevelContact(openness, ring, slack && on);
        return { reach: 0.97, contact: on };
      }, { start: 1, stopAt: snap => (snap.assessmentAttempts?.length ?? 0) >= 1 });
      expect(attempts[0].completed, slack ? "with the stay-slack" : "without it").toBe(slack);
    }
  });
  it("hand opening's ring sits at its level's goal, with a start limit inside it", () => {
    for (const rest of [0.5, 0.6, 0.75]) {
      for (const id of ["partial", "full"]) {
        const goal = handLevelGoal(id, rest);
        const learned = goal / LEARNED_RING_SHARE;
        expect(handRingTarget(goal, rest, learned, false)).toMatchObject({ contact: true });
        expect(handRingTarget(goal, rest, learned, false).ring).toBeCloseTo(goal, 6);
        expect(handRingTarget(goal - 0.02, rest, learned, false).contact).toBe(false);
        expect(startLimit(rest, learned)).toBeLessThan(goal);
        expect(waiveLimit(rest, learned)).toBeLessThan(goal);
      }
    }
  });
  it("leaves an exercise session without any of the movement check's fields", () => {
    const session = new ExerciseSession({ exerciseId: "ex_reach", rung: 1, side: "right" }, { say() {}, busy: () => false, stop() {} });
    session.start(0);
    const snap = session.snapshot();
    expect("assessmentLevel" in snap || "assessmentAttempts" in snap || "assessmentOffer" in snap).toBe(false);
    expect(session.assessing).toBe(false);
    expect(session.assessmentLevelId).toBeNull();
  });
});
