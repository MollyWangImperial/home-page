import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASSESSMENT_RESULT_KEY, rememberAssessment, rememberAssessmentPlan } from "./assessment";
import { SAMPLE_ASSESSMENT } from "./journey-demo";
import { JOURNEY_SESSIONS_KEY, launchablePlan, recordExerciseResult } from "./journey";
import { EXERCISES_DONE_KEY, dayKey } from "./home-stage";
import { exerciseCompletionMessages, exerciseCompletionPath, finishPreviewExercises, loadExerciseCompletion } from "./exercise-completion";

const now = new Date(2026, 9, 1, 10);
let values: Map<string, string>;
const ready = () => rememberAssessmentPlan(rememberAssessment(SAMPLE_ASSESSMENT)!, SAMPLE_ASSESSMENT, true);
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  values = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("exercise completion to Alira", () => {
  it("celebrates the completed exercise without claiming the whole session is done", () => {
    const assessment = ready();
    recordExerciseResult("ex_reach", 75);
    const completion = loadExerciseCompletion("from=exercise&exercise=ex_reach", assessment);
    expect(completion).toEqual({ exerciseName: "Graded Forward Reach", allDone: false });
    const messages = exerciseCompletionMessages(completion!, "Alex");
    expect(messages[0]).toContain("Congratulations, Alex");
    expect(messages[0]).toContain("Graded Forward Reach");
    expect(messages[0]).toContain("good rest");
    expect(messages.join(" ")).not.toMatch(/assessment|random test|marks|today’s exercises/i);
  });

  it("offers a journal note and My Time after the whole session, including on a later visit today", () => {
    const assessment = ready();
    for (const exercise of launchablePlan(assessment)) recordExerciseResult(exercise.id, 80);
    const completion = loadExerciseCompletion("", assessment);
    expect(completion).toEqual({ exerciseName: null, allDone: true });
    const messages = exerciseCompletionMessages(completion!, "Zak");
    expect(messages[0]).toContain("today’s exercises");
    expect(messages[1]).toMatch(/journal.*My Time/);
  });

  it("does not claim completion from a URL, old scores, or an invalid result", () => {
    const assessment = ready();
    expect(loadExerciseCompletion("from=exercise&exercise=ex_reach", assessment)).toBeNull();
    recordExerciseResult("ex_reach", 80, new Date(2026, 8, 30));
    expect(loadExerciseCompletion("from=exercise&exercise=ex_reach", assessment)).toBeNull();
    values.set(JOURNEY_SESSIONS_KEY, JSON.stringify({ [dayKey(now)]: { ex_reach: { score: "80" }, other: { score: 80 } } }));
    expect(loadExerciseCompletion("from=exercise&exercise=ex_reach", assessment)).toBeNull();
    expect(loadExerciseCompletion("from=exercise&exercise=other", assessment)).toBeNull();
  });

  it("does not announce a session from a stale done marker or a partial session", () => {
    const assessment = ready();
    recordExerciseResult("ex_reach", 70);
    values.set(EXERCISES_DONE_KEY, dayKey(now));
    expect(loadExerciseCompletion("", assessment)).toBeNull();
  });

  it("preserves fresh assessments, onboarding, warm-ups and medal conversations", () => {
    const assessment = ready();
    for (const exercise of launchablePlan(assessment)) recordExerciseResult(exercise.id, 80);
    expect(loadExerciseCompletion("", { ...assessment, planChatCompleted: false })).toBeNull();
    for (const query of ["onboarding=1", "from=home", "from=warm-up", "medal=seven-sunrises"]) expect(loadExerciseCompletion(query, assessment)).toBeNull();
  });

  it("the ready-plan test records exercise results and preserves the assessment and plan", () => {
    vi.stubEnv("DEV", true); vi.stubEnv("VITE_ASSESSMENT_BASE", "http://localhost:8002");
    const assessment = ready();
    const before = values.get(ASSESSMENT_RESULT_KEY);
    expect(finishPreviewExercises(assessment, () => 0.5)?.allDone).toBe(true);
    expect(values.get(ASSESSMENT_RESULT_KEY)).toBe(before);
    expect(JSON.parse(values.get(JOURNEY_SESSIONS_KEY)!)[dayKey(now)]).toBeDefined();
  });

  it("never creates testing scores on unrelated production sites or a local preview targeting a hosted assessment service", () => {
    const assessment = ready();
    vi.stubEnv("DEV", false);
    expect(finishPreviewExercises(assessment)).toBeNull();
    vi.stubEnv("DEV", true); vi.stubEnv("VITE_ASSESSMENT_BASE", "https://rehyn.onrender.com");
    expect(finishPreviewExercises(assessment)).toBeNull();
    expect(values.get(JOURNEY_SESSIONS_KEY)).toBeUndefined();
  });

  it("completes exercises on the Render review site without altering the assessment", () => {
    vi.stubEnv("DEV", false);
    vi.stubGlobal("window", { location: { origin: "https://rehyn-recovery-companion.onrender.com" }, dispatchEvent: vi.fn() });
    const assessment = ready();
    const before = values.get(ASSESSMENT_RESULT_KEY);
    expect(finishPreviewExercises(assessment, () => 0.5)?.allDone).toBe(true);
    expect(values.get(ASSESSMENT_RESULT_KEY)).toBe(before);
    expect(values.get(JOURNEY_SESSIONS_KEY)).toBeDefined();
  });

  it("returns to Alira with an explicit exercise context", () => {
    expect(exerciseCompletionPath("ex_reach")).toBe("/alira?from=exercise&exercise=ex_reach");
  });
});
