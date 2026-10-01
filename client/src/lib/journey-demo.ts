// Local testing only (pnpm dev): a sample first assessment so the Journey can be walked through
// without the camera, matching the design canvas's temporary demo strip. Never part of the patient UI.
import { rememberAssessment, rememberAssessmentPlan, type AssessmentReport, type StoredAssessment } from "./assessment";

export const journeyDemoEnabled = () => import.meta.env.DEV;

export const SAMPLE_ASSESSMENT: AssessmentReport = {
  id: "sample-first-assessment",
  assessment_package: "initial",
  preview_only: true,
  testing_random: true,
  metrics: {
    function_score: {
      display_total: 60,
      areas: { upper_limb: { display_score: 62 }, hand: { display_score: 48 }, lower_limb: { display_score: 71 } },
      tasks: [],
    },
  },
  rehab_plan: [
    { id: "ex_reach", name: "Graded Forward Reach", description: "Seated. Reach forward to the target and back, slowly, with your affected arm.", sets: 3, reps: 8, frequency: "Daily", difficulty: "easy", linked_goal: "eating" },
    { id: "ex_grasp", name: "Grasp and Release", description: "Squeeze for three seconds, open fully, rest. Keep the wrist straight.", sets: 2, reps: 10, frequency: "Daily", difficulty: "easy" },
    { id: "ex_lower_selective", name: "Selective Knee Movement", description: "Seated. Straighten the knee on its own, hold, and lower slowly.", sets: 3, reps: 6, frequency: "Daily", difficulty: "easy" },
  ],
};

/** Stores the sample as a finished first assessment with Alira's plan ready, so the Journey unlocks. */
export function seedSampleAssessment(): StoredAssessment | null {
  if (!journeyDemoEnabled()) return null;
  const stored = rememberAssessment(SAMPLE_ASSESSMENT);
  return stored ? rememberAssessmentPlan(stored, SAMPLE_ASSESSMENT, true) : null;
}
