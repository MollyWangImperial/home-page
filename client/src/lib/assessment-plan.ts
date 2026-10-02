import { getAssessmentBase, type AssessmentReport, type PlanExercise, type StoredAssessment } from "./assessment";
import { companionTaskPlan } from "./assessment";
import type { OnboardingAnswers } from "./alira-onboarding";
import { renderReviewControlsEnabled } from "./administrative-controls";

export const EXERCISES_PATH = "/journey?tab=progress&section=exercises";
export const ASSESSMENT_PLAN_READY_MESSAGE = "Congratulations, you've unlocked Journey! Your exercise plan is ready. Tap View my exercises below to open Journey and try your first movement with me.";
export const assessmentServiceBase = () => getAssessmentBase(import.meta.env.VITE_ASSESSMENT_BASE, import.meta.env.DEV);
export const randomAssessmentEnabled = () => renderReviewControlsEnabled() || (import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(new URL(assessmentServiceBase()).hostname));

export function planExerciseUrl(exercise: PlanExercise, affectedSide: "left" | "right") {
  const query = new URLSearchParams({ exercise_id: exercise.id, reps: String(exercise.reps),
    difficulty: exercise.difficulty ?? "easy", affected_side: affectedSide });
  if (exercise.target_rung) query.set("target_rung", exercise.target_rung);
  return `${assessmentServiceBase()}/api/rehab/runner?${query}`;
}

export function scoreSummary(report: AssessmentReport): string {
  const score = report.metrics?.function_score;
  if (!score) return "your completed movement check";
  const labels: Record<string, string> = { arm: "Arm", upper_limb: "Arm", hand: "Hand", walking: "Walking", lower_limb: "Walking" };
  const parts = Object.entries(score.areas ?? {}).flatMap(([key, area]) =>
    typeof area.display_score === "number" && Number.isFinite(area.display_score) ? [`${labels[key] ?? key} ${area.display_score}/100`] : []);
  return parts.length ? parts.join(" · ") : "your completed movement check; some movements were not measured";
}

export function assessmentCongratulations(report: AssessmentReport): string {
  return report.testing_random
    ? "Well done—your test assessment is complete!"
    : `Well done—you’ve completed your movement check! Thank you for the effort you put in. Your marks today: ${scoreSummary(report)}.`;
}

export function assessmentCompletionMessages(report: AssessmentReport) {
  return {
    congratulations: report.testing_random
      ? "Well done—your test assessment is complete!"
      : "Well done—you’ve completed your movement check! Thank you for the effort you put in.",
    marks: report.testing_random ? null : `Your marks today: ${scoreSummary(report)}.`,
    designing: "I’m designing your exercise plan from your movement check, choosing movements to help you build on today’s effort.",
    ready: ASSESSMENT_PLAN_READY_MESSAGE,
  };
}

/** A completed line must be read before the next starts; readiness waits for both the API and the final line. */
export async function runAssessmentConversation(report: AssessmentReport, callbacks: {
  showMessage: (text: string) => Promise<void>;
  preparePlan: () => Promise<AssessmentReport>;
  onPlanWaiting?: (waiting: boolean) => void;
}, signal: AbortSignal, retry = false): Promise<AssessmentReport> {
  const copy = assessmentCompletionMessages(report);
  const show = async (text: string) => {
    signal.throwIfAborted();
    await callbacks.showMessage(text);
    signal.throwIfAborted();
  };
  if (!retry) {
    await show(copy.congratulations);
    if (copy.marks) await show(copy.marks);
  }
  // Attach rejection handling immediately, even if preparation fails while Alira is still typing.
  const preparation = callbacks.preparePlan().then(value => ({ value }), error => ({ error }));
  await show(copy.designing);
  callbacks.onPlanWaiting?.(true);
  let outcome: Awaited<typeof preparation>;
  try {
    // Keep the dots readable even when the plan arrived during the design message.
    [outcome] = await Promise.all([preparation, callbacks.onPlanWaiting ? pauseAssessmentChat(3000, signal) : Promise.resolve()]);
  } finally {
    callbacks.onPlanWaiting?.(false);
  }
  signal.throwIfAborted();
  if ("error" in outcome) throw outcome.error;
  await show(copy.ready);
  return outcome.value;
}

export function pauseAssessmentChat(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function requestAssessmentPlan(stored: StoredAssessment, answers: OnboardingAnswers, signal?: AbortSignal): Promise<AssessmentReport> {
  const report = stored.report;
  if (!report) throw new Error("This older result does not contain its movement scores. Complete a new movement check to prepare your plan.");
  if (Array.isArray(report.rehab_plan)) return report;
  if (!report.preview_only) throw new Error("Your assessment did not include an exercise plan. Please try your movement check again.");
  return postPreview("preview-plan", {
    assessment_package: stored.package ?? "initial", task_results: report.task_results,
    assigned_task_ids: report.task_results?.map(row => row.task_id), patient_parameters: { companion_answers: answers },
  }, signal);
}

export async function randomAssessment(answers: OnboardingAnswers, signal?: AbortSignal): Promise<AssessmentReport> {
  if (!randomAssessmentEnabled()) throw new Error("Random assessments are available in the local or Render review testing preview only.");
  const selected = companionTaskPlan(answers).taskIds;
  if (!selected.length) throw new Error("Your answers call for supported movement rather than a camera assessment. No test marks were created.");
  if (renderReviewControlsEnabled()) {
    // Send bounded test options, never the survey's free text or patient records.
    const goal = ["eating", "dressing", "walking_house", "going_out", "other"].includes(String(answers.main_goal)) ? answers.main_goal : "";
    const movement = ["none", "little_help", "tires", "fairly_well"].includes(String(answers.arm_hand_movement)) ? answers.arm_hand_movement : "";
    return readPreviewResponse(await fetch(`${assessmentServiceBase()}/api/assessment/review-random-results`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_ids: selected, goal, movement, has_helper: answers.help_at_home !== "own" }), signal,
    }), true);
  }
  return postPreview("preview-random-results", {
    assessment_package: "initial", assigned_task_ids: selected,
    task_results: [], patient_parameters: { companion_answers: answers },
  }, signal, false);
}

async function postPreview(route: string, body: unknown, signal?: AbortSignal, requirePlan = true): Promise<AssessmentReport> {
  const response = await fetch(`${assessmentServiceBase()}/api/assessment/${route}?local_preview=1`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  return readPreviewResponse(response, requirePlan);
}

async function readPreviewResponse(response: Response, requirePlan: boolean): Promise<AssessmentReport> {
  if (!response.ok) throw new Error("I couldn’t prepare your exercise plan just yet. Your results are still here. Please try again.");
  const report = await response.json() as AssessmentReport;
  if (!report.metrics?.function_score || (requirePlan && !Array.isArray(report.rehab_plan))) throw new Error("The exercise plan was incomplete. Please try again.");
  return report;
}
