// The launch exercise set (section 1 of the Rehyn daily exercise engine plan): 8 camera-led
// exercises, each with 3 rungs. Targets, compensation thresholds and dose presets are copied from
// the Rehyn backend (EXERCISE_MOVEMENT_STANDARDS, SESSION_DIFFICULTY_PRESETS, REHAB_RUNNER_CONFIG),
// not invented here. Anything marked "engineering default" is the plan's own number.

export type Rung = 1 | 2 | 3;
export type Level = "easy" | "medium" | "difficult";
export type Side = "left" | "right";
export type Domain = "upper_limb" | "hand" | "lower_limb";
export type Tracking = "pose" | "hand" | "pose+hand";

export const LEVEL_BY_RUNG: Record<Rung, Level> = { 1: "easy", 2: "medium", 3: "difficult" };
/** Reps per rung, engineering default. */
export const REPS_BY_RUNG: Record<Rung, number> = { 1: 6, 2: 8, 3: 10 };

/**
 * Graded Forward Reach is in every plan, every day, at level 1, and is listed first so it can be
 * used straight away. Alira's plan review and learned settings never change it.
 */
export const EVERYDAY_EXERCISE_ID = "ex_reach";

/** Patient Start buttons launch only the ready exercise; the rest remain available in the admin engine. */
export const patientExerciseReady = (id: string) => id === EVERYDAY_EXERCISE_ID;

/** Exercises with a calibrated lap and an anatomical/contact target. */
export const usesSeatedTargets = (id: string) => id === "ex_reach" || id === "ex_h2m";

/** SESSION_DIFFICULTY_PRESETS from backend/server.py. */
export const DOSE_PRESETS: Record<Level, { repFactor: number; targetYDelta: number; targetDistanceScale: number; radiusScale: number; holdScale: number }> = {
  easy: { repFactor: 0.7, targetYDelta: 0.06, targetDistanceScale: 0.85, radiusScale: 1.2, holdScale: 0.8 },
  medium: { repFactor: 1.0, targetYDelta: 0.0, targetDistanceScale: 1.0, radiusScale: 1.0, holdScale: 1.0 },
  difficult: { repFactor: 1.15, targetYDelta: -0.04, targetDistanceScale: 1.15, radiusScale: 0.9, holdScale: 1.15 },
};

export const DOMAIN_LABEL: Record<Domain, string> = { upper_limb: "Upper limb", hand: "Hand", lower_limb: "Lower limb" };

export type RomStep = {
  id: string;
  label: string;
  /** Key in the per-frame metric table. */
  metric: string;
  targets: Record<Level, number>;
  weight: number;
  /** Cycle step indices where this is measured; omitted = every movement step. */
  steps?: number[];
};

export type Compensation = {
  id: string;
  label: string;
  /** Key in the per-frame compensation table. */
  metric: string;
  thresholdDeg: number;
  /** Most checks are degrees; face approach is percent growth from the setup baseline. */
  unit?: "°" | "%";
  minFrames: number;
  minRatio: number;
  minConsecutive?: number;
  minConsecutiveMs?: number;
  /** An alternative confirmation path: all of these measurements must exceed their thresholds. */
  alternative?: { metric: string; threshold: number }[];
  /**
   * When the named compensation is also confirmed in the same repetition, this one is reported too only if
   * it stayed at `minRatio` times its threshold for its sustained window (the movement went clearly beyond it).
   */
  yieldsTo?: { id: string; minRatio: number };
  steps?: number[];
  correction: string;
};

export type StepKind = "reach" | "open" | "close" | "pinch" | "return";

export type CycleStep = {
  caption: string;
  voice: string;
  kind: StepKind;
  /** ROM step ids that decide whether this step's target is reached (movement steps). */
  gate: string[];
  holdMs: number;
  /** Pinch only: which finger the thumb meets (index 0 .. little 3). */
  finger?: number;
};

export type FeedbackRule = { comp?: string; attainmentBelow?: number; say: string };

export type Ghost = "reach" | "mouth" | "raise" | "hand_open" | "grasp" | "pinch" | "knee" | "toe";

export type ExerciseConfig = {
  id: string;
  name: string;
  domain: Domain;
  chain: string;
  dailyTask: string;
  framing: string;
  tracking: Tracking;
  ghost: Ghost;
  setupVoice: string;
  calibrationInstruction: string;
  romSteps: RomStep[];
  compensations: Compensation[];
  cycle: CycleStep[];
  feedback: FeedbackRule[];
  praise: string;
  /** Plain-words name of the best measurement, for the wrap sentence ("your best reach was 58 degrees"). */
  bestLabel: string;
  bestRomId: string;
  /** Cycle steps that the rung rescue makes easier, in the plan's words. */
  rescueNote: string;
};

const cr = (id: string, label: string, metric: string, thresholdDeg: number, minFrames: number, minRatio: number, correction: string, extra: Partial<Compensation> = {}): Compensation => ({
  id, label, metric, thresholdDeg, minFrames, minRatio, correction, ...extra,
});

const ret = (caption: string, voice: string): CycleStep => ({ caption, voice, kind: "return", gate: [], holdMs: 500 });

export const EXERCISES: Record<string, ExerciseConfig> = {
  ex_reach: {
    id: "ex_reach",
    name: "Graded Forward Reach",
    domain: "upper_limb",
    chain: "Shoulder reaches, elbow extends",
    dailyTask: "Reaching a cup or phone on the table",
    framing: "Front, seated, face to upper thigh",
    tracking: "pose",
    ghost: "reach",
    setupVoice: "Welcome. We are going to practice the graded forward reach. Sit upright, with your back away from the chair. Place your affected hand on your lap. I'll guide you through each repetition.",
    calibrationInstruction: "Before we begin, sit still with your affected hand resting on the visible part of your lap. Keep your face, shoulders, affected arm, and the top of your affected thigh in view.",
    romSteps: [
      { id: "shoulder_flexion", label: "Shoulder reach", metric: "shoulder_flexion", targets: { easy: 45, medium: 60, difficult: 75 }, weight: 0.65 },
      { id: "elbow_extension", label: "Elbow extension", metric: "elbow_extension", targets: { easy: 130, medium: 140, difficult: 150 }, weight: 0.35 },
    ],
    compensations: [
      // Debugging defaults, measured against the upright setup posture.
      cr("trunk_lean", "trunk lean", "face_approach_pct", 8, 4, 0, "Keep your chest tall and let your arm travel toward the target.", { unit: "%", minConsecutiveMs: 200, alternative: [{ metric: "face_mean_growth_pct", threshold: 4 }, { metric: "shoulder_approach_pct", threshold: 6 }] }),
      // Allow modest tilt during a normal reach; require a larger, sustained shoulder change.
      cr("shoulder_hike", "shoulder hike", "shoulder_hike_delta", 12, 4, 0, "Relax the shoulder away from your ear before you reach again.", { minConsecutiveMs: 400, alternative: [{ metric: "shoulder_elevation_pct", threshold: 15 }] }),
    ],
    cycle: [
      { caption: "Reach forward to the target", voice: "Slowly reach your hand forward, as far as you comfortably can.", kind: "reach", gate: ["shoulder_flexion", "elbow_extension"], holdMs: 1200 },
      ret("Return to lap", "Now gently return your hand to the same place on your lap."),
    ],
    feedback: [
      { comp: "trunk_lean", say: "I noticed your back leaned forward. On the next repetition, try keeping your spine tall and let your arm do the work." },
      { comp: "shoulder_hike", say: "Your shoulder lifted up toward your ear. Try keeping your shoulder relaxed and dropped down on the next try." },
      { attainmentBelow: 0.7, say: "You almost reached the target. On the next try, push gently from your shoulder to extend a little further." },
    ],
    praise: "Beautiful repetition. Keep that smooth, steady motion from start to finish.",
    bestLabel: "reach",
    bestRomId: "shoulder_flexion",
    rescueNote: "Target ring lower and 15% closer, larger radius",
  },
  ex_h2m: {
    id: "ex_h2m",
    name: "Hand-to-Mouth",
    domain: "upper_limb",
    chain: "Elbow flexes, hand to face",
    dailyTask: "Eating, drinking, brushing teeth",
    framing: "Front, seated, face to upper thigh",
    tracking: "pose",
    ghost: "mouth",
    // Built like the forward reach's setup speech; the head-up cue comes early because, as for the reach,
    // the demonstration may begin 12 s in, before a long introduction has finished.
    setupVoice: "Welcome. We are going to practice hand-to-mouth. Keep your head up: the cup comes to your mouth, not your mouth to the cup. Sit upright, with your back away from the chair. Place your affected hand on your lap. A cup is drawn on your screen, so you do not need a real one.",
    calibrationInstruction: "Before we begin, sit upright and still with your affected hand resting on the visible part of your lap. Keep your face, shoulders, affected arm, and the top of your affected thigh in view while I learn your upright position.",
    romSteps: [
      { id: "elbow_flexion", label: "Elbow bend", metric: "elbow_flexion", targets: { easy: 65, medium: 80, difficult: 95 }, weight: 0.7 },
      { id: "shoulder_flexion", label: "Shoulder lift", metric: "shoulder_flexion", targets: { easy: 20, medium: 30, difficult: 40 }, weight: 0.3 },
    ],
    compensations: [
      // Debugging defaults, measured against the upright setup posture (metrics.ts headLeanMetrics).
      // First: the pattern this exercise trains against, and the one the simulator's "leaning" patient uses.
      // The head travels down/forward to meet the cup while the shoulders stay put: about 4.5 cm (12% of
      // shoulder width, roughly 13-15° of neck flexion) relative to the trunk, held 0.6 s so a glance down
      // at the screen does not count. A natural chin dip (up to about 8°) stays below it.
      // During a confirmed trunk lean it is reported as well only if it stayed at 1.25 times its threshold.
      cr("head_forward", "head leaning forward", "head_forward_pct", 12, 6, 0, "Keep your head up and bring the cup to your mouth, not your mouth to the cup.", { unit: "%", minConsecutiveMs: 600, yieldsTo: { id: "trunk_forward", minRatio: 1.25 } }),
      // Whole-trunk lean: the shoulders come toward the camera together with the face (both grow at least 6%).
      cr("trunk_forward", "trunk leaning forward", "trunk_approach_pct", 6, 4, 0, "Keep your back tall and let your arm bring the cup to your mouth.", { unit: "%", minConsecutiveMs: 200 }),
      // Head lowering also shortens the ear gap: use shoulder tilt here to keep the checks separate.
      cr("shoulder_hike", "shoulder hike", "shoulder_hike_delta", 12, 4, 0, "Relax the shoulder before bending the elbow again.", { minConsecutiveMs: 400 }),
    ],
    cycle: [
      { caption: "Bring the cup to your mouth and hold, as if taking a sip", voice: "Bend your elbow and bring the cup up to your mouth, slowly and smoothly. Hold it at your lips as if taking a sip. Head up, shoulder relaxed.", kind: "reach", gate: ["elbow_flexion", "shoulder_flexion"], holdMs: 1500 },
      ret("Lower the cup and return to your lap", "Now lower the cup and bring your hand back to the same place on your lap."),
    ],
    feedback: [
      // Worded like the reach's advice, so the final repetition's version drops "on the next ..." the same way.
      { comp: "head_forward", say: "I noticed your head leaned forward to meet the cup. On the next repetition, try keeping your head up while you bring the cup to your mouth, not your mouth to the cup." },
      { comp: "trunk_forward", say: "I noticed your back leaned forward to meet the cup. On the next repetition, try keeping your back tall and let your arm bring the cup to your mouth." },
      { comp: "shoulder_hike", say: "Your shoulder lifted toward your ear. Try keeping your shoulder relaxed as you bend your elbow on the next try." },
      { attainmentBelow: 0.7, say: "You almost reached your mouth. On the next try, bend your elbow a little more to bring the cup all the way to your lips." },
    ],
    praise: "Smooth hand-to-mouth. Keep that quality on the next repetition.",
    bestLabel: "elbow bend",
    bestRomId: "elbow_flexion",
    rescueNote: "Mouth target radius larger, shorter hold",
  },
  ex_wallslide: {
    id: "ex_wallslide",
    name: "Supported Arm Elevation",
    domain: "upper_limb",
    chain: "Shoulder lifts with support",
    dailyTask: "Reaching a shelf, combing hair",
    framing: "Front, seated, forearm on table",
    tracking: "pose",
    ghost: "raise",
    setupVoice: "We will practise supported arm elevation. Sit tall with your affected forearm supported on a table or towel. Move only in a comfortable, pain-free range.",
    calibrationInstruction: "Sit tall with your supported forearm, shoulders, and hips visible. Hold the comfortable starting position without pain.",
    romSteps: [
      { id: "shoulder_flexion", label: "Supported arm elevation", metric: "shoulder_flexion", targets: { easy: 60, medium: 80, difficult: 95 }, weight: 0.8 },
      { id: "elbow_extension", label: "Supported elbow position", metric: "elbow_extension", targets: { easy: 120, medium: 132, difficult: 140 }, weight: 0.2 },
    ],
    compensations: [
      cr("shoulder_hike", "shoulder hike", "shoulder_hike_delta", 8, 8, 0.35, "Keep the shoulder heavy and away from your ear as the arm slides."),
      cr("side_lean", "side lean", "trunk_side_lean_delta", 10, 8, 0.35, "Return your chest to the middle before raising the arm again."),
    ],
    cycle: [
      { caption: "Slide toward the upper target", voice: "Using the support, slowly slide your affected arm toward the upper target. Stop before pain and keep your shoulder relaxed.", kind: "reach", gate: ["shoulder_flexion", "elbow_extension"], holdMs: 1500 },
      ret("Slide back with support", "Now slide your arm back to the starting position, slowly and with control."),
    ],
    feedback: [
      { comp: "shoulder_hike", say: "Your shoulder lifted toward your ear. Try keeping your shoulder relaxed and pressed down as you raise your arm." },
      { comp: "side_lean", say: "I noticed you leaned to one side. On the next repetition, try to stay tall and centered." },
      { attainmentBelow: 0.7, say: "Almost reached the top. On the next try, exhale gently and try to go a little higher." },
    ],
    praise: "Wonderful shoulder elevation. Keep that same control on the next repetition.",
    bestLabel: "arm lift",
    bestRomId: "shoulder_flexion",
    rescueNote: "Upper target lower",
  },
  ex_handopen: {
    id: "ex_handopen",
    name: "Active Hand Opening",
    domain: "hand",
    chain: "Hand opens and relaxes",
    dailyTask: "Letting go of a cup, putting on a glove",
    framing: "Front, forearm on table, hand in frame",
    tracking: "hand",
    ghost: "hand_open",
    setupVoice: "We will practise opening and relaxing your affected hand with your forearm supported on a table. A soft ball is drawn on your screen. Imagine opening your hand around it, no real object is needed.",
    calibrationInstruction: "Support your forearm and hold your affected hand toward the camera. Keep the whole hand, wrist, and fingertips visible, and let the fingers rest in their comfortable starting position.",
    romSteps: [{ id: "finger_extension", label: "Finger opening", metric: "finger_extension", targets: { easy: 130, medium: 145, difficult: 158 }, weight: 1 }],
    compensations: [],
    cycle: [
      { caption: "Open your hand around the ball", voice: "Slowly open your affected hand around the ball on your screen, as wide as is comfortable. Hold for a moment, then let the fingers relax.", kind: "open", gate: ["finger_extension"], holdMs: 1000 },
      ret("Let the fingers relax", "Now let your fingers relax."),
    ],
    feedback: [{ attainmentBelow: 0.7, say: "Nearly open. On the next one, try to open your hand a little wider." }],
    praise: "Wonderful finger extension. Try to hold for a full second before relaxing.",
    bestLabel: "finger opening",
    bestRomId: "finger_extension",
    rescueNote: "Ball smaller (less opening needed), longer relax",
  },
  ex_grasp: {
    id: "ex_grasp",
    name: "Cylindrical Grasp and Transport",
    domain: "hand",
    chain: "Hand grips, arm carries across midline",
    dailyTask: "Moving a cup, holding a handrail",
    framing: "Front, seated, both hands visible",
    tracking: "pose+hand",
    ghost: "grasp",
    setupVoice: "We will practise reaching for a cup, opening your hand, grasping it, and carrying it across. The cup is drawn on your screen, so you do not need a real object.",
    calibrationInstruction: "Sit square to the camera with both shoulders, hips, elbows, and wrists visible, and your affected hand in view. Rest your hands and hold still.",
    romSteps: [
      { id: "elbow_extension", label: "Elbow extension at the cup", metric: "elbow_extension", targets: { easy: 118, medium: 130, difficult: 142 }, weight: 0.3, steps: [0, 1, 2] },
      { id: "shoulder_flexion", label: "Reach to the object", metric: "shoulder_flexion", targets: { easy: 30, medium: 42, difficult: 52 }, weight: 0.2, steps: [0, 1, 2] },
      { id: "hand_opening", label: "Hand opening", metric: "finger_extension", targets: { easy: 115, medium: 130, difficult: 145 }, weight: 0.25, steps: [1] },
      { id: "shoulder_abduction", label: "Controlled transport", metric: "shoulder_abduction", targets: { easy: 25, medium: 35, difficult: 45 }, weight: 0.25, steps: [3, 4] },
    ],
    compensations: [
      cr("trunk_lean", "trunk lean", "trunk_lean_delta", 12, 8, 0.35, "Keep your shoulders square and move the light object with your arm."),
      cr("trunk_side_lean", "trunk side lean", "trunk_side_lean_delta", 10, 8, 0.3, "Keep your body upright and carry the cup across with your arm.", { steps: [3, 4] }),
      cr("shoulder_hike", "shoulder hike", "shoulder_hike_delta", 20, 12, 0.45, "Set the shoulder down before lifting the object again."),
    ],
    cycle: [
      { caption: "Reach to the cup", voice: "Reach toward the cup on your screen with your affected hand.", kind: "reach", gate: ["elbow_extension", "shoulder_flexion"], holdMs: 900 },
      { caption: "Open your hand wide around the cup", voice: "Now open your hand wide, ready to take the cup.", kind: "open", gate: ["hand_opening"], holdMs: 400 },
      { caption: "Close your fingers around the cup", voice: "Close your fingers around the cup to grasp it.", kind: "close", gate: [], holdMs: 500 },
      { caption: "Carry the cup across", voice: "The cup is in your hand. Carry it slowly across to the other side.", kind: "reach", gate: ["shoulder_abduction"], holdMs: 1200 },
      { caption: "Open your hand to set the cup down", voice: "Open your fingers to set the cup down.", kind: "open", gate: ["hand_opening"], holdMs: 500 },
      ret("Return your empty hand to your lap", "Now bring your empty hand back to your lap. Nicely done."),
    ],
    feedback: [
      { comp: "trunk_lean", say: "I noticed your chest leaned toward the cup. Keep your shoulders square and let your arm do the reaching." },
      { comp: "trunk_side_lean", say: "Your body leaned to the side to carry the cup. Keep upright and let your arm cross the midline." },
      { comp: "shoulder_hike", say: "Your shoulder lifted toward your ear. Set it down before lifting the cup again." },
      { attainmentBelow: 0.6, say: "Almost reached the far target. On the next try, extend a little further across your body." },
    ],
    praise: "Beautiful transport. Focus on a smooth release at the end.",
    bestLabel: "reach",
    bestRomId: "elbow_extension",
    rescueNote: "Transport distance 0.85, cup nearer midline",
  },
  ex_pinch: {
    id: "ex_pinch",
    name: "Pinch and Peg",
    domain: "hand",
    chain: "Fingers pinch",
    dailyTask: "Buttons, zips, picking up a pill",
    framing: "Front, hand close to camera",
    tracking: "hand",
    ghost: "pinch",
    setupVoice: "We will practice pinch. A small peg and a container are drawn on your screen, so you do not need real objects. Pinch your thumb to each finger in turn as I call it, and let go between each one.",
    calibrationInstruction: "Support your forearm and hold your affected hand toward the camera. Keep your thumb, all four fingers, and wrist clearly visible.",
    romSteps: [{ id: "pinch_flexion", label: "Thumb and finger control", metric: "pinch_flexion", targets: { easy: 35, medium: 50, difficult: 65 }, weight: 1 }],
    compensations: [],
    cycle: [], // built per rung: 1 / 3 / 5 oppositions, see pinchCycle()
    feedback: [{ attainmentBelow: 0.7, say: "Nearly there. Curl the finger a little more to meet your thumb." }],
    praise: "Lovely pinch control. Keep the thumb and finger meeting cleanly.",
    bestLabel: "pinch",
    bestRomId: "pinch_flexion",
    rescueNote: "Fewer oppositions (5 to 3 to 1)",
  },
  ex_lower_selective: {
    id: "ex_lower_selective",
    name: "Seated Knee Extension",
    domain: "lower_limb",
    chain: "Leg straightens",
    dailyTask: "Standing up from a chair, stepping",
    framing: "Front, seated, hips to feet in frame",
    tracking: "pose",
    ghost: "knee",
    setupVoice: "Welcome. Sit in a stable chair with both feet supported, and keep a carer nearby if you need help with balance. We will practise one slow knee movement at a time.",
    calibrationInstruction: "Move the phone back until I can see your hips, knees and feet. Sit still with both feet supported.",
    romSteps: [{ id: "knee_extension", label: "Knee extension", metric: "knee_extension", targets: { easy: 125, medium: 140, difficult: 152 }, weight: 1 }],
    compensations: [
      cr("hip_hike", "hip hike", "hip_hike_delta", 8, 8, 0.35, "Keep both hips settled on the chair while the lower leg moves."),
      cr("trunk_lean", "trunk leaning back", "trunk_lean_delta", 10, 8, 0.35, "Stay tall and avoid leaning back to lift the foot."),
    ],
    cycle: [
      { caption: "Straighten your knee and hold", voice: "Slowly straighten your affected knee within a comfortable range. Keep your thigh supported and breathe normally. Hold it there.", kind: "reach", gate: ["knee_extension"], holdMs: 1500 },
      ret("Lower slowly", "Now gently bend the knee and lower your foot back to the floor, slowly."),
    ],
    feedback: [
      { comp: "hip_hike", say: "Your hip lifted off the chair. Keep both hips settled while the lower leg moves." },
      { comp: "trunk_lean", say: "You leaned back to lift the foot. Stay tall on the next one." },
      { attainmentBelow: 0.7, say: "Almost straight. On the next try, reach a little further if it feels comfortable." },
    ],
    praise: "Well done. Keep the movement slow and let the leg do as much as it safely can.",
    bestLabel: "knee straightening",
    bestRomId: "knee_extension",
    rescueNote: "Lower hold, smaller angle target",
  },
  ex_ankle_dorsiflexion: {
    id: "ex_ankle_dorsiflexion",
    name: "Seated Toe Lift",
    domain: "lower_limb",
    chain: "Foot clears",
    dailyTask: "Walking without catching the toe",
    framing: "Front, seated, knees to feet in frame",
    tracking: "pose",
    ghost: "toe",
    setupVoice: "Sit securely with your affected foot flat and your heel supported on the floor. We will practise lifting the front of your foot without lifting the heel.",
    calibrationInstruction: "Move the phone back until I can see your hips, knees and feet. Keep the heel down and hold still.",
    romSteps: [{ id: "ankle_dorsiflexion", label: "Ankle dorsiflexion", metric: "ankle_dorsiflexion", targets: { easy: 6, medium: 10, difficult: 14 }, weight: 1 }],
    compensations: [cr("knee_motion", "knee lift", "knee_motion_delta", 10, 8, 0.4, "Keep the knee quiet while the ankle moves.")],
    cycle: [
      { caption: "Lift your toes and forefoot, and hold", voice: "Keeping the heel down, gently lift your toes and the front of your foot. Hold for a comfortable moment.", kind: "reach", gate: ["ankle_dorsiflexion"], holdMs: 1000 },
      ret("Lower slowly", "Lower the front of your foot slowly until it rests on the floor."),
    ],
    feedback: [
      { comp: "knee_motion", say: "Your knee lifted with the foot. Keep the knee quiet while the ankle moves." },
      { attainmentBelow: 0.7, say: "Nearly there. Keep the heel planted and aim for a slightly higher toe lift." },
    ],
    praise: "Great effort. Keep the heel planted and the lift smooth.",
    bestLabel: "toe lift",
    bestRomId: "ankle_dorsiflexion",
    rescueNote: "Shorter hold",
  },
};

/** The 8 launch exercises in plan order. */
export const LAUNCH_EXERCISE_IDS = ["ex_reach", "ex_h2m", "ex_wallslide", "ex_handopen", "ex_grasp", "ex_pinch", "ex_lower_selective", "ex_ankle_dorsiflexion"] as const;
export type LaunchExerciseId = (typeof LAUNCH_EXERCISE_IDS)[number];

/** Left out of the solo set: therapist-set plans only (SUPERVISED_EXERCISE_IDS plus these two). */
export const SOLO_EXCLUDED_IDS = ["ex_trunk", "ex_scapdepress", "ex_bilateral", "ex_sit_to_stand", "ex_supported_stand", "ex_supported_step", "ex_weight_shift", "ex_step_stance"];

/** ex_trunk folded into ex_reach: same cycle, chair-back cue, stricter approach threshold. */
export const CHAIR_BACK_SETUP_CUE = "Settle your back firmly against the chair and keep it touching the chair the whole time.";
const CHAIR_BACK_TRUNK = cr("trunk_lean", "trunk lean", "face_approach_pct", 6, 5, 0, "Settle your back against the chair before the next reach.", { minConsecutiveMs: 250, unit: "%", alternative: [{ metric: "face_mean_growth_pct", threshold: 3 }, { metric: "shoulder_approach_pct", threshold: 5 }] });

const PINCH_FINGER_NAMES = ["index finger", "middle finger", "ring finger", "little finger"];
const PINCH_SEQUENCE = [0, 1, 2, 3, 0];
export const PINCH_OPPOSITIONS: Record<Rung, number> = { 1: 1, 2: 3, 3: 5 };

function pinchCycle(rung: Rung): CycleStep[] {
  const steps: CycleStep[] = [];
  PINCH_SEQUENCE.slice(0, PINCH_OPPOSITIONS[rung]).forEach(finger => {
    steps.push({ caption: `Pinch your thumb to your ${PINCH_FINGER_NAMES[finger]}`, voice: `Pinch your thumb and ${PINCH_FINGER_NAMES[finger]} together, as if lifting the peg.`, kind: "pinch", gate: ["pinch_flexion"], holdMs: 500, finger });
    steps.push(ret("Let go", "Now let go and open your hand."));
  });
  return steps;
}

export type RungSpec = {
  exerciseId: string;
  rung: Rung;
  level: Level;
  reps: number;
  /** ROM target per ROM step id at this rung. */
  targets: Record<string, number>;
  holdScale: number;
  preset: (typeof DOSE_PRESETS)[Level];
  cycle: CycleStep[];
  oppositions?: number;
};

/** EXERCISE_RUNGS[exercise_id][rung]: ROM target + dose preset + rep count, all built from existing tables. */
export function buildRung(exerciseId: string, rung: Rung, opts: { chairBack?: boolean } = {}): RungSpec {
  const ex = EXERCISES[exerciseId];
  const level = LEVEL_BY_RUNG[rung];
  const preset = DOSE_PRESETS[level];
  return {
    exerciseId,
    rung,
    level,
    reps: REPS_BY_RUNG[rung],
    targets: Object.fromEntries(ex.romSteps.map(step => [step.id, step.targets[level]])),
    holdScale: preset.holdScale,
    preset,
    cycle: exerciseId === "ex_pinch" ? pinchCycle(rung) : ex.cycle,
    oppositions: exerciseId === "ex_pinch" ? PINCH_OPPOSITIONS[rung] : undefined,
  };
}

export const EXERCISE_RUNGS: Record<string, Record<Rung, RungSpec>> = Object.fromEntries(
  LAUNCH_EXERCISE_IDS.map(id => [id, { 1: buildRung(id, 1), 2: buildRung(id, 2), 3: buildRung(id, 3) }])
);

/** The exercise as it runs today: ex_reach in chair-back mode swaps in the stricter trunk check and the setup cue. */
export function resolveExercise(exerciseId: string, chairBack: boolean): ExerciseConfig {
  const ex = EXERCISES[exerciseId];
  if (exerciseId !== "ex_reach" || !chairBack) return ex;
  return {
    ...ex,
    setupVoice: `${ex.setupVoice} ${CHAIR_BACK_SETUP_CUE}`,
    compensations: ex.compensations.map(comp => (comp.id === "trunk_lean" ? CHAIR_BACK_TRUNK : comp)),
  };
}

export function cycleFor(exerciseId: string, rung: Rung): CycleStep[] {
  return buildRung(exerciseId, rung).cycle;
}
