import type { StoredAssessment } from "./assessment";
import { dayKey, loadLastExerciseDay } from "./home-stage";
import { EXERCISES } from "./exercise-engine/config";
import { journeyNow, launchablePlan, loadSessionStore, planDesigned, recordExerciseResult } from "./journey";
import { randomAssessmentEnabled } from "./assessment-plan";

export type ExerciseCompletion = { exerciseName: string | null; allDone: boolean };
export const EXERCISE_JOURNAL_PATH = "/journey?tab=journal";
export const EXERCISE_MY_TIME_PATH = "/my-time?activity=memory_game";
export const exerciseCompletionPath = (exerciseId: string) => `/alira?from=exercise&exercise=${encodeURIComponent(exerciseId)}`;

/** A route alone cannot claim completion: use today's saved exercise results and the prepared plan. */
export function loadExerciseCompletion(search: string, assessment: StoredAssessment | null, now = journeyNow()): ExerciseCompletion | null {
  const query = new URLSearchParams(search);
  if (!planDesigned(assessment) || query.get("onboarding") === "1" || ["home", "warm-up"].includes(query.get("from") ?? "") || query.has("medal")) return null;
  const day = loadSessionStore()[dayKey(now)] ?? {};
  const completed = (id: string) => {
    const result = day[id];
    return typeof result?.score === "number" && Number.isFinite(result.score) && result.score >= 0 && result.score <= 100;
  };
  const plan = launchablePlan(assessment);
  const allDone = plan.length > 0 && plan.every(exercise => completed(exercise.id));
  if (query.get("from") === "exercise") {
    const id = query.get("exercise") ?? "";
    return Object.hasOwn(EXERCISES, id) && completed(id) ? { exerciseName: EXERCISES[id].name, allDone } : null;
  }
  return allDone && loadLastExerciseDay() === dayKey(now) ? { exerciseName: null, allDone: true } : null;
}

export function exerciseCompletionMessages(completion: ExerciseCompletion, name: string) {
  const finished = completion.allDone ? "today’s exercises" : completion.exerciseName ?? "your exercise";
  return [
    `Congratulations, ${name}. You’ve completed ${finished}! Thank you for the effort you put in today. Settle into a good rest; you’ve earned a quiet moment.`,
    "Before the day slips by, tuck a little note into your journal: a small win, a tricky moment, or simply how you feel. A few words are enough. Or visit My Time for a gentle game of Pairs or a quiet moment by the koi pond. What would feel good now?",
  ];
}

/** The ready-plan testing button completes exercise scores without creating another assessment. */
export function finishPreviewExercises(assessment: StoredAssessment | null, random = Math.random): ExerciseCompletion | null {
  if (!randomAssessmentEnabled() || !planDesigned(assessment)) return null;
  const plan = launchablePlan(assessment);
  if (!plan.length) return null;
  for (const exercise of plan) recordExerciseResult(exercise.id, 60 + Math.floor(random() * 36));
  return loadExerciseCompletion("", assessment);
}
