/** Design milestones, separate from the daily code-change diary.
 * Update these records when a review or an agreed planning estimate changes.
 * A missing estimate stays unknown; file/line counts cannot establish completion.
 */
export type ProjectAreaProgress = {
  id: "exercise" | "assessment" | "frontend" | "alira";
  label: string;
  status: string;
  completedPercent: number | null;
  remainingPercent: number | null;
  measure: string;
  done: string;
  next: string;
  sources: readonly string[];
};

export const EXERCISE_DESIGN_REVIEW = {
  total: 8,
  reviewed: ["ex_reach", "ex_h2m"],
  scope: "Easy-level design review",
} as const;

/** There is no approved overall completion estimate for the other finite areas yet. */
export const PROJECT_PROGRESS_ESTIMATES: Record<"assessment" | "frontend", number | null> = {
  assessment: null,
  frontend: null,
};

export function progressPercentages(completed: number | null) {
  if (completed === null || !Number.isFinite(completed) || completed < 0 || completed > 100) {
    return { completedPercent: null, remainingPercent: null };
  }
  const completedPercent = Math.round(completed * 10) / 10;
  return { completedPercent, remainingPercent: Math.round((100 - completedPercent) * 10) / 10 };
}

export type ProjectProgress = { updatedAt: string; note: string; areas: ProjectAreaProgress[] };

export const PROJECT_PROGRESS: ProjectProgress = {
  updatedAt: "2026-10-01",
  note: "Design review coverage, not a measure of hours worked or clinical readiness. Unagreed completion estimates stay unset.",
  areas: [
    {
      id: "exercise", label: "Exercise library design", status: "In progress",
      ...progressPercentages(EXERCISE_DESIGN_REVIEW.reviewed.length / EXERCISE_DESIGN_REVIEW.total * 100),
      measure: EXERCISE_DESIGN_REVIEW.scope,
      done: "2 of 8 Easy exercise designs refined: Forward Reach and Hand-to-Mouth.",
      next: "6 Easy designs remain to review. Higher levels and patient-camera validation are separate work.",
      sources: ["client/src/lib/exercise-engine/config.ts", "work/hand-to-mouth-review/verification.md", "work/screen-preview-review/verification.md"],
    },
    {
      id: "assessment", label: "Assessment task design", status: "In progress",
      ...progressPercentages(PROJECT_PROGRESS_ESTIMATES.assessment),
      measure: "Completion estimate not set",
      done: "Five tasks are implemented: reach, hand-to-mouth, hand opening, pinch and walking.",
      next: "Agree the remaining design and validation checklist before assigning a completion percentage.",
      sources: ["docs/assessment-v2-copy.md", "docs/first-assessment-flow.md"],
    },
    {
      id: "frontend", label: "Web front end", status: "Nearly finished",
      ...progressPercentages(PROJECT_PROGRESS_ESTIMATES.frontend),
      measure: "Completion estimate not set",
      done: "The main pages and flows are in place; you described the front end as nearly finished.",
      next: "Final UI refinements and checks. Confirm an estimate to show the percentage left.",
      sources: ["design-qa.md", "docs/first-assessment-flow.md"],
    },
    {
      id: "alira", label: "Alira agentic development", status: "Keeps learning",
      ...progressPercentages(null), measure: "Ongoing development",
      done: "Molly has built source-based answers and conversations about your plan and her progress.",
      next: "Keeps learning",
      sources: ["server/alira-channel.ts", "docs/alira-agent.md", "docs/molly-progress.md"],
    },
  ] satisfies ProjectAreaProgress[],
};
