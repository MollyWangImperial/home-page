import { EXERCISES, type ExerciseConfig } from "./config";

/**
 * Tests only. Every launch exercise now runs the on-screen target flow, so the engine's angle-scored path (a hold
 * once the measured angle nears its target, the target zone and the miss rule) is covered with this copy of the
 * former Seated Toe Lift, registered under its own id when a test imports this file.
 */
export const ANGLE_SCORED_ID = "ex_angle_scored_test";

const angleScored: ExerciseConfig = {
  ...EXERCISES.ex_ankle_dorsiflexion,
  id: ANGLE_SCORED_ID,
  name: "Angle-scored test exercise",
  framing: "Front, seated, knees to feet in frame",
  romSteps: [{ id: "ankle_dorsiflexion", label: "Ankle dorsiflexion", metric: "ankle_dorsiflexion", targets: { easy: 6, medium: 10, difficult: 14 }, weight: 1 }],
  compensations: [{ id: "knee_motion", label: "knee lift", metric: "knee_motion_delta", thresholdDeg: 10, minFrames: 8, minRatio: 0.4, correction: "Keep the knee quiet while the ankle moves." }],
  cycle: [
    { caption: "Lift your toes and forefoot, and hold", voice: "Keeping the heel down, gently lift your toes and the front of your foot. Hold for a comfortable moment.", kind: "reach", gate: ["ankle_dorsiflexion"], holdMs: 1000 },
    { caption: "Lower slowly", voice: "Lower the front of your foot slowly until it rests on the floor.", kind: "return", gate: [], holdMs: 500 },
  ],
  feedback: [
    { comp: "knee_motion", say: "Your knee lifted with the foot. Keep the knee quiet while the ankle moves." },
    { attainmentBelow: 0.7, say: "Nearly there. Keep the heel planted and aim for a slightly higher toe lift." },
  ],
  bestRomId: "ankle_dorsiflexion",
  speedCue: undefined,
};
EXERCISES[ANGLE_SCORED_ID] = angleScored;
