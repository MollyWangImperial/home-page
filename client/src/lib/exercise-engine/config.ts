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

/**
 * Exercises run with the on-screen target flow: a resting position learned at set-up, a demonstration,
 * a practice repetition that learns the personal goal, then scored repetitions on contact targets after a
 * countdown. The seated ones (above), Active Hand Opening (a ring around the palm), Cylindrical Grasp
 * and Transport (a drawn cup picked up, carried across the body and set down), Seated Knee Extension
 * (a knee dial beside the leg whose foot reaches the circle as the knee straightens), Pinch and Peg (a
 * circle round the thumb and fingertip that pick up a drawn peg), and Supported Arm Elevation (a table slide:
 * a slide dial beside the shoulder whose hand slides into the circle as the shoulder elevates).
 */
export const usesTargetFlow = (id: string) => usesSeatedTargets(id) || id === "ex_handopen" || id === "ex_grasp" || id === "ex_lower_selective" || id === "ex_pinch" || id === "ex_wallslide";

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
  /** Target flow: the scored goal is this share of the way from rest to the practice hold (omitted: the hold itself). */
  learnedShare?: number;
  /** Target flow: the scored goal is never above this (pinch: the thumb touching the fingertip). */
  learnedCap?: number;
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
  /** The step starts only once the camera says the hand is ready (hand opening: palm to the camera in the shaded area). */
  readyGate?: boolean;
  /** A short cue said as this step starts in each scored repetition; the full voice line is said in practice only. */
  cue?: string;
  /** Target flow: the measures this step's practice hold learns as personal goals (default: the exercise's own set). */
  learn?: string[];
  /** A close step decided by the camera's target, held like a movement step (not a relaxed pause). */
  contactStep?: boolean;
  /** Not reached in this long: move on with partial credit instead of ending the repetition as a miss. */
  timeoutMs?: number;
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
  /**
   * A spoken reminder to move slowly when a measure changes faster than this (degrees per second): `lift` while it
   * rises on a movement step, `lower` while it falls on the return. Said at most once per step; never scored.
   */
  speedCue?: { metric: string; degPerS: number; lift: string; lower: string };
};

const cr = (id: string, label: string, metric: string, thresholdDeg: number, minFrames: number, minRatio: number, correction: string, extra: Partial<Compensation> = {}): Compensation => ({
  id, label, metric, thresholdDeg, minFrames, minRatio, correction, ...extra,
});

const ret = (caption: string, voice: string): CycleStep => ({ caption, voice, kind: "return", gate: [], holdMs: 500 });

// Pinch and Peg (pinch-target.ts): the thumb meets the first or the middle finger, tip to tip, the two fingers a front
// camera tracks reliably. Each pinch picks up a drawn peg and holds; each let-go drops it into the drawn tray.
const PINCH_FINGER_NAMES = ["first finger", "middle finger"];
const PINCH_METRICS = ["pinch_index", "pinch_middle"];
const PINCH_SEQUENCE = [0, 1, 0, 1, 0];
export const PINCH_OPPOSITIONS: Record<Rung, number> = { 1: 2, 2: 3, 3: 5 };
function pinchSteps(fingers: number[]): CycleStep[] {
  return fingers.flatMap((finger, index) => {
    const name = PINCH_FINGER_NAMES[finger], first = index === 0;
    const pinch: CycleStep = {
      caption: `Pinch your thumb to your ${name}`,
      voice: first ? `Bring your thumb and ${name} together, tip to tip like an O, to pick up the peg in the circle, and hold.` : `Now bring your thumb and ${name} together, tip to tip, to pick up the next peg, and hold.`,
      kind: "reach", gate: [PINCH_METRICS[finger]], holdMs: 1500, finger, learn: [PINCH_METRICS[finger]], cue: `Pinch your ${name}.`,
      // Each repetition starts once the palm faces the camera in the shaded area with the thumb apart.
      ...(first ? { readyGate: true } : {}),
    };
    return [pinch, { ...ret("Let go", "Now open your thumb and finger to let the peg drop into the tray."), cue: "Let go." }];
  });
}

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
      // Head lowering also shortens the ear gap: use shoulder tilt here to keep the checks separate, measured
      // against the trunk so a sideways lean of the whole upper body is not called a shrug.
      // Measured on camera: a natural shrug to reach the mouth stays above 7 degrees for well over a second of
      // the hold; normal movement stays within 1-3 and a head-lean repetition under 5. So 7 degrees for 0.3 s
      // flags a shrug used to reach the mouth without flagging a normal movement.
      cr("shoulder_hike", "shoulder hike", "shoulder_hike_rel_delta", 7, 4, 0, "Relax the shoulder before bending the elbow again.", { minConsecutiveMs: 300 }),
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
    // A table slide: the table beside the affected side, so the hips, lap and other hand stay in view (slide-target.ts).
    framing: "Front, seated, table beside the affected side, forearm on a towel, head to thighs in view",
    tracking: "pose",
    ghost: "raise",
    setupVoice: "Welcome. We are going to practise sliding your arm forward along a table. Sit at the corner of a table so it is beside your affected side, with your forearm resting on a towel on the table and your other hand on your thigh. Place the camera in front of you at chest height, above the table, so I can see you from your head to your thighs. Move only in a comfortable, pain-free range.",
    calibrationInstruction: "Sit tall with your elbow bent and your forearm resting on the towel. Make sure the room is well lit, with the light in front of you. Hold still while I learn your starting position.",
    // Shoulder elevation and the elbow from the pose model's 3D landmarks. A flat table allows about 55-63 degrees, so
    // the live goal is the one learned in practice, just inside the practice hold; the levels stay for planning.
    romSteps: [
      { id: "shoulder_flexion", label: "Supported arm elevation", metric: "shoulder_flexion", targets: { easy: 60, medium: 80, difficult: 95 }, weight: 0.8, learnedShare: 0.9 },
      { id: "elbow_extension", label: "Supported elbow position", metric: "elbow_extension", targets: { easy: 120, medium: 132, difficult: 140 }, weight: 0.2, learnedShare: 0.9 },
    ],
    compensations: [
      // Engineering defaults, measured against the upright set-up posture while the hand slides forward (step 0).
      // Leaning forward pushes the hand further and inflates the shoulder angle: the main one here.
      cr("trunk_forward", "leaning forward", "trunk_approach_pct", 6, 4, 0, "Sit tall and let your shoulder do the sliding.", { unit: "%", minConsecutiveMs: 200, steps: [0] }),
      cr("shoulder_hike", "shoulder hike", "shoulder_hike_rel_delta", 7, 4, 0, "Keep your shoulder down and relaxed as you slide.", { minConsecutiveMs: 300, alternative: [{ metric: "shoulder_elevation_pct", threshold: 15 }], steps: [0] }),
      cr("side_lean", "leaning sideways", "trunk_side_lean_delta", 8, 4, 0, "Stay tall and centred as you slide.", { minConsecutiveMs: 300, steps: [0] }),
      // The hand rising in the picture: lifted off the support instead of sliding along it (% of the shoulder span).
      cr("hand_lift", "hand lifting off the table", "hand_lift_pct", 13, 4, 0, "Keep your hand and forearm resting on the towel as you slide.", { unit: "%", minConsecutiveMs: 300, steps: [0] }),
      // The other hand off its thigh or at the affected forearm (% of its limit).
      cr("other_hand", "other hand helping", "other_hand_pct", 100, 4, 0, "Keep your other hand resting on your thigh.", { unit: "%", minConsecutiveMs: 400, steps: [0] }),
    ],
    cycle: [
      { caption: "Slide your hand forward and hold", voice: "Slowly slide your hand forward along the table until the hand on the dial reaches the circle. Keep your shoulder relaxed and your body upright, and stop before pain. Hold it there.", kind: "reach", gate: ["shoulder_flexion"], holdMs: 1500, cue: "Slide forward." },
      { ...ret("Slide your hand back", "Now slowly slide your hand back to where it started."), cue: "Slide back slowly." },
    ],
    feedback: [
      // Worded like the other target-flow exercises, so the final repetition's version drops "on the next ..." the same way.
      { comp: "trunk_forward", say: "I noticed your body leaned forward to push your hand further. On the next repetition, try sitting tall and let your shoulder do the sliding." },
      { comp: "shoulder_hike", say: "I noticed your shoulder lifted toward your ear. On the next repetition, try keeping your shoulder down and relaxed as you slide." },
      { comp: "side_lean", say: "I noticed you leaned to one side. On the next repetition, try staying tall and centred as you slide." },
      { comp: "hand_lift", say: "I noticed your hand lifted off the table. On the next repetition, try keeping your hand and forearm resting on the towel as you slide." },
      { comp: "other_hand", say: "I noticed your other hand moved to help. On the next repetition, try keeping your other hand resting on your thigh." },
      { attainmentBelow: 0.7, say: "Nearly there. On the next repetition, try sliding a little further if it feels comfortable." },
    ],
    praise: "Wonderful controlled slide. Keep that same smooth movement on the next repetition.",
    bestLabel: "arm lift",
    bestRomId: "shoulder_flexion",
    rescueNote: "Smaller slide target",
    // Flinging the hand forward or dropping it back: a reminder only, the hold already keeps a fling from counting.
    speedCue: { metric: "shoulder_flexion", degPerS: 60, lift: "Nice and slow as you slide.", lower: "Slide back a little more slowly." },
  },
  ex_handopen: {
    id: "ex_handopen",
    name: "Active Hand Opening",
    domain: "hand",
    chain: "Hand opens and relaxes",
    dailyTask: "Letting go of a cup, putting on a glove",
    framing: "Front, elbow on an armrest or table, hand up beside the body at chest height, palm to the camera",
    // The hand every frame; the body every third frame, for the trunk and shoulder checks (tracker.ts).
    tracking: "pose+hand",
    ghost: "hand_open",
    setupVoice: "Welcome. We are going to practise opening and closing your hand. Rest your affected elbow on an armrest or a table, and hold your hand up in the shaded area beside your body, at chest height, with your palm facing the camera. Keeping your hand there leaves your face and both shoulders in view.",
    calibrationInstruction: "Before we begin, hold your hand in the shaded area with your palm facing the camera, and let your fingers relax and curl gently. Do not open your hand yet. Hold still while I learn your starting position.",
    romSteps: [{ id: "finger_extension", label: "Finger opening", metric: "finger_extension", targets: { easy: 130, medium: 145, difficult: 158 }, weight: 1 }],
    compensations: [
      // Engineering defaults (hand-target.ts), measured against the relaxed hand learned at set-up.
      // First: the wrist bending so the fingers open passively (tenodesis), the backend's 18° rule for this
      // exercise, here as the palm tipping toward the camera; held 0.3 s.
      cr("wrist_bend", "wrist bending", "wrist_flexion_deg", 18, 4, 0, "Keep your wrist straight and let your fingers do the opening.", { minConsecutiveMs: 300 }),
      // The palm turning away from the camera to flick the fingers open (forearm rotation).
      cr("forearm_turn", "palm turning", "forearm_turn_deg", 25, 4, 0, "Keep your palm facing the camera as your fingers open.", { minConsecutiveMs: 300 }),
      // The same trunk and shoulder checks as Hand-to-Mouth.
      cr("trunk_forward", "trunk leaning forward", "trunk_approach_pct", 6, 4, 0, "Sit tall and let your fingers do the work.", { unit: "%", minConsecutiveMs: 200 }),
      cr("shoulder_hike", "shoulder hike", "shoulder_hike_rel_delta", 7, 4, 0, "Relax the shoulder before opening your hand again.", { minConsecutiveMs: 300 }),
    ],
    cycle: [
      // Each step starts once the palm faces the camera in the shaded area; scored repetitions say only the short cue.
      { caption: "Open your hand to the ring and hold", voice: "Slowly open your fingers out to the ring, as wide as is comfortable, and hold. Keep your wrist straight and your palm facing the camera.", kind: "open", gate: ["finger_extension"], holdMs: 1500, readyGate: true, cue: "Open your hand." },
      { ...ret("Close your hand gently", "Now gently close your hand, letting your fingers curl back into the small circle."), cue: "Now close it gently." },
    ],
    feedback: [
      // Worded like the reach's advice, so the final repetition's version drops "on the next ..." the same way.
      { comp: "wrist_bend", say: "I noticed your wrist bent to help your fingers open. On the next repetition, try keeping your wrist straight and let your fingers do the opening." },
      { comp: "forearm_turn", say: "I noticed your palm turned away from the camera. On the next repetition, try keeping your palm facing the camera as your fingers open." },
      { comp: "trunk_forward", say: "I noticed your body leaned forward. On the next repetition, try sitting tall and let your fingers do the work." },
      { comp: "shoulder_hike", say: "Your shoulder lifted toward your ear. Try keeping your shoulder relaxed as you open your hand on the next try." },
      { attainmentBelow: 0.7, say: "Nearly open. On the next repetition, try to open your fingers a little wider, out to the ring." },
    ],
    praise: "Lovely hand opening. Keep that steady hold on the next repetition.",
    bestLabel: "finger opening",
    bestRomId: "finger_extension",
    rescueNote: "Ring closer to your relaxed hand, shorter hold",
  },
  ex_grasp: {
    id: "ex_grasp",
    name: "Cylindrical Grasp and Transport",
    domain: "hand",
    chain: "Hand grips, arm carries across midline",
    dailyTask: "Moving a cup, holding a handrail",
    framing: "Front, seated without a table, head to mid-thigh in view, both hands resting on your thighs",
    // The hand every frame (open, close, wrist, cup), the body every second frame (grasp-target.ts).
    tracking: "pose+hand",
    ghost: "grasp",
    setupVoice: "Welcome. We are going to practise picking up a cup, carrying it across your body and setting it down. The cup is drawn on your screen, so you do not need a real one. Sit back so your head, both shoulders, both hips and both hands are in view, with your hands resting on your thighs.",
    calibrationInstruction: "Before we begin, rest both hands on your thighs and sit tall. Make sure the room is well lit, with the light in front of you. Hold still while I learn your starting position.",
    romSteps: [
      { id: "elbow_extension", label: "Elbow extension at the cup", metric: "elbow_extension", targets: { easy: 118, medium: 130, difficult: 142 }, weight: 0.3, steps: [0] },
      { id: "shoulder_flexion", label: "Reach to the cup", metric: "shoulder_flexion", targets: { easy: 30, medium: 42, difficult: 52 }, weight: 0.2, steps: [0] },
      { id: "finger_extension", label: "Hand opening", metric: "finger_extension", targets: { easy: 115, medium: 130, difficult: 145 }, weight: 0.25, steps: [0] },
      // Sideways travel of the hand across the body, in shoulder widths: 0.5 at the midline (grasp-target.ts).
      { id: "carry_across", label: "Carry across", metric: "carry_across", targets: { easy: 0.8, medium: 0.95, difficult: 1.1 }, weight: 0.25, steps: [2] },
    ],
    compensations: [
      // Engineering defaults, measured against the upright set-up posture. Steps: 0 reach, 1 grasp, 2 carry, 3 let go.
      // The same camera-tuned checks as Hand-to-Mouth and Active Hand Opening.
      cr("trunk_forward", "leaning forward", "trunk_approach_pct", 6, 4, 0, "Sit tall and let your arm do the reaching.", { unit: "%", minConsecutiveMs: 200, steps: [0, 1, 2, 3] }),
      // Sideways lean of the whole trunk (frontal plane, which a front camera sees best).
      cr("trunk_side_lean", "leaning sideways", "trunk_side_lean_delta", 8, 4, 0, "Keep your body upright and let your arm carry the cup across.", { minConsecutiveMs: 300, steps: [0, 1, 2, 3] }),
      cr("shoulder_hike", "shoulder hike", "shoulder_hike_rel_delta", 7, 4, 0, "Keep your shoulder down and relaxed as you move the cup.", { minConsecutiveMs: 300, alternative: [{ metric: "shoulder_elevation_pct", threshold: 15 }], steps: [0, 1, 2, 3] }),
      // The upper arm swinging out to the side while carrying across (flexor synergy): above the healthy upper quartile.
      cr("elbow_out", "elbow swinging out", "elbow_out_deg", 40, 4, 0, "Keep your elbow close to your side and carry the cup across with your forearm.", { minConsecutiveMs: 400, steps: [2] }),
      // The wrist out of line with the forearm while gripping, carrying or letting go (the backend's grasp rule, 25 deg).
      cr("wrist_bend", "wrist bending", "wrist_bend_deg", 25, 4, 0, "Keep your wrist in line with your forearm while you hold the cup.", { minConsecutiveMs: 400, steps: [1, 2, 3] }),
      // The cup tipping from its upright grip while it is carried (the knuckle line's change from vertical, which
      // reads a little under the true tip when the grip itself leans, so the limit is set a little lower).
      cr("cup_tipping", "cup tipping", "cup_tilt_deg", 20, 4, 0, "Keep the cup upright as you carry it.", { minConsecutiveMs: 300, steps: [2] }),
    ],
    cycle: [
      { caption: "Reach to the cup and open your hand", voice: "Reach toward the cup on your screen, opening your hand as you go, and hold your open hand at the cup.", kind: "reach", gate: ["elbow_extension", "shoulder_flexion"], holdMs: 1500, learn: ["elbow_extension", "shoulder_flexion", "finger_extension", "hand_openness"], cue: "Reach for the cup." },
      { caption: "Close your hand around the cup", voice: "Now close your fingers around the cup and hold it.", kind: "close", gate: [], holdMs: 1500, learn: [], contactStep: true, timeoutMs: 10000, cue: "Grasp the cup." },
      { caption: "Carry the cup across", voice: "Carry the cup slowly across your body to the other circle, keeping it upright, and hold it there.", kind: "reach", gate: ["carry_across"], holdMs: 1500, learn: ["carry_across"], cue: "Carry it across." },
      { caption: "Open your hand to let go", voice: "Now open your hand to set the cup down.", kind: "open", gate: [], holdMs: 1500, learn: [], contactStep: true, timeoutMs: 10000, cue: "Let it go." },
      { ...ret("Return your hand to your lap", "Now bring your empty hand back to rest on your lap."), cue: "Back to your lap." },
    ],
    feedback: [
      // Worded like the other target-flow exercises, so the final repetition's version drops "on the next ..." the same way.
      { comp: "trunk_forward", say: "I noticed your body leaned forward toward the cup. On the next repetition, try sitting tall and let your arm do the reaching." },
      { comp: "trunk_side_lean", say: "I noticed your body leaned to the side to carry the cup. On the next repetition, try keeping upright and let your arm carry it across." },
      { comp: "shoulder_hike", say: "Your shoulder lifted toward your ear. Try keeping your shoulder down and relaxed as you move the cup on the next try." },
      { comp: "elbow_out", say: "I noticed your elbow swung out to the side as you carried the cup. On the next repetition, try keeping your elbow close and carry it across with your forearm." },
      { comp: "wrist_bend", say: "I noticed your wrist bent while you held the cup. On the next repetition, try keeping your wrist in line with your forearm." },
      { comp: "cup_tipping", say: "I noticed the cup tipped as you carried it. On the next repetition, try keeping the cup upright all the way across." },
      { attainmentBelow: 0.7, say: "Nearly there. On the next repetition, try to reach a little further and carry the cup a little further across." },
    ],
    praise: "Beautiful transport. Keep that smooth reach and steady carry on the next repetition.",
    bestLabel: "reach",
    bestRomId: "elbow_extension",
    rescueNote: "Put-down circle nearer the midline",
  },
  ex_pinch: {
    id: "ex_pinch",
    name: "Pinch and Peg",
    domain: "hand",
    chain: "Fingers pinch",
    dailyTask: "Buttons, zips, picking up a pill",
    // Set up as Active Hand Opening: the hand up in the shaded area leaves the face and both shoulders in view.
    framing: "Front, elbow on an armrest or table, hand up beside the body at chest height, palm to the camera",
    // The hand every frame; the body every third frame, for the trunk, shoulder and other-hand checks (tracker.ts).
    tracking: "pose+hand",
    ghost: "pinch",
    setupVoice: "Welcome. We are going to practise pinching, as if picking up a small peg. The peg and a tray are drawn on your screen, so you do not need real objects. Rest your affected elbow on an armrest or a table, and hold your hand up in the shaded area beside your body, at chest height, with your palm facing the camera. Keeping your hand there leaves your face and both shoulders in view.",
    calibrationInstruction: "Before we begin, hold your hand in the shaded area with your palm facing the camera, your fingers relaxed and your thumb resting a little away from your first finger. Make sure the room is well lit, with the light in front of you. Hold still while I learn your starting position.",
    // How far the thumb has closed on each fingertip (pinch-target.ts), 0-100: 75 is touching. The scored goal sits just
    // inside the closest pinch held in practice, and is never more than touching.
    romSteps: [
      { id: "pinch_index", label: "Thumb to first finger", metric: "pinch_index", targets: { easy: 60, medium: 68, difficult: 75 }, weight: 0.5, steps: [0], learnedShare: 0.95, learnedCap: 75 },
      { id: "pinch_middle", label: "Thumb to middle finger", metric: "pinch_middle", targets: { easy: 60, medium: 68, difficult: 75 }, weight: 0.5, steps: [2], learnedShare: 0.95, learnedCap: 75 },
    ],
    compensations: [
      // Engineering defaults, measured against the hand and posture learned at set-up, while the thumb closes (steps
      // 0 and 2). The trunk, shoulder, wrist and palm checks are Active Hand Opening's.
      cr("trunk_forward", "leaning forward", "trunk_approach_pct", 6, 4, 0, "Sit tall and let your fingers do the work.", { unit: "%", minConsecutiveMs: 200, steps: [0, 2] }),
      cr("shoulder_hike", "shoulder hike", "shoulder_hike_rel_delta", 7, 4, 0, "Keep your shoulder relaxed as you pinch.", { minConsecutiveMs: 300, alternative: [{ metric: "shoulder_elevation_pct", threshold: 15 }], steps: [0, 2] }),
      cr("forearm_turn", "palm turning away", "forearm_turn_deg", 25, 4, 0, "Keep your palm facing the camera as you pinch.", { minConsecutiveMs: 300, steps: [0, 2] }),
      // The other hand within a palm length of the affected palm (1 / its distance in palm lengths).
      cr("other_hand", "other hand helping", "other_hand_near", 1, 4, 0, "Rest your other hand on your lap.", { minConsecutiveMs: 500, steps: [0, 2] }),
      // The palm tipping toward the camera: the wrist flexing to help the pinch (the backend's 18° pinch rule).
      cr("wrist_bend", "wrist bending", "wrist_flexion_deg", 18, 4, 0, "Keep your wrist straight and let your thumb and finger do the work.", { minConsecutiveMs: 300, steps: [0, 2] }),
      // The middle, ring and little fingers curling in with the first finger's pinch (loss of finger independence),
      // in hundredths of a palm length. Not judged for the middle finger, which naturally pulls the ring finger along.
      cr("mass_flexion", "other fingers curling", "mass_flexion_pct", 25, 4, 0, "Keep your other fingers relaxed and out as you pinch.", { minConsecutiveMs: 400, steps: [0] }),
    ],
    cycle: pinchSteps(PINCH_SEQUENCE.slice(0, PINCH_OPPOSITIONS[1])),
    feedback: [
      // Worded like the other target-flow exercises, so the final repetition's version drops "on the next ..." the same way.
      { comp: "trunk_forward", say: "I noticed your body leaned forward toward your hand. On the next repetition, try sitting tall and let your fingers do the work." },
      { comp: "shoulder_hike", say: "I noticed your shoulder lifted toward your ear. On the next repetition, try keeping your shoulder relaxed as you pinch." },
      { comp: "forearm_turn", say: "I noticed your palm turned away from the camera. On the next repetition, try keeping your palm facing the camera as you pinch." },
      { comp: "other_hand", say: "I noticed your other hand came over to help. On the next repetition, try resting your other hand on your lap." },
      { comp: "wrist_bend", say: "I noticed your wrist bent to help the pinch. On the next repetition, try keeping your wrist straight and let your thumb and finger do the work." },
      { comp: "mass_flexion", say: "I noticed your other fingers curled in with the pinch. On the next repetition, try keeping your other fingers relaxed and out." },
      { attainmentBelow: 0.7, say: "Nearly there. On the next repetition, try bringing your thumb a little closer to your fingertip." },
    ],
    praise: "Lovely pinch control. Keep the thumb and finger meeting cleanly, tip to tip.",
    bestLabel: "pinch closure",
    bestRomId: "pinch_index",
    rescueNote: "Fewer pinches (5 to 3 to 2)",
  },
  ex_lower_selective: {
    id: "ex_lower_selective",
    name: "Seated Knee Extension",
    domain: "lower_limb",
    chain: "Leg straightens",
    dailyTask: "Standing up from a chair, stepping",
    // Seated the whole time, so the patient never moves out of view; the face and shoulders carry the trunk checks.
    framing: "Front, seated, head to feet in view, both feet flat on the floor",
    tracking: "pose",
    ghost: "knee",
    setupVoice: "Welcome. We are going to practise straightening your knee while you sit. Sit in a stable chair with a back, with both feet flat on the floor, and keep a carer nearby if you need help with balance. Place the camera about two metres in front of you, at about knee to hip height, so I can see you from your head to your feet.",
    calibrationInstruction: "Sit tall with your back against the chair, both feet flat on the floor and your hands resting on your thighs. Make sure the room is well lit, with the light in front of you. Hold still while I learn your starting position.",
    // The knee angle from the pose model's 3D landmarks (knee-target.ts); the scored goal sits just inside the practice hold.
    romSteps: [{ id: "knee_extension", label: "Knee extension", metric: "knee_extension", targets: { easy: 125, medium: 140, difficult: 152 }, weight: 1, learnedShare: 0.9 }],
    compensations: [
      // Engineering defaults, measured against the upright set-up posture while the knee straightens (step 0).
      // Leaning back: the shoulders and the face both smaller in the picture (the mirror of leaning forward). With the
      // camera about 2 m away (head to feet) a lean changes the size half as much as at arm's length, so both leans
      // use 4% (about a 10 degree lean) where the arm exercises use 6%.
      cr("trunk_lean", "leaning back", "trunk_retreat_pct", 4, 4, 0, "Sit tall and let your knee do the lifting.", { unit: "%", minConsecutiveMs: 300, steps: [0] }),
      cr("trunk_forward", "leaning forward", "trunk_approach_pct", 4, 4, 0, "Sit tall with your back against the chair.", { unit: "%", minConsecutiveMs: 300, steps: [0] }),
      cr("trunk_side_lean", "leaning sideways", "trunk_side_lean_delta", 8, 4, 0, "Keep your weight even on both hips.", { minConsecutiveMs: 300, steps: [0] }),
      // The affected hip rising above the other (the backend's pelvic hiking, at its scoring limit).
      cr("hip_hike", "hip lifting", "hip_hike_delta", 10, 4, 0, "Keep both hips settled on the chair.", { minConsecutiveMs: 400, steps: [0] }),
      // The knee rising in the picture: the hip flexors lifting the thigh instead of the knee straightening.
      cr("thigh_lift", "thigh lifting", "thigh_lift_pct", 15, 4, 0, "Keep your thigh resting on the chair and let your knee straighten.", { unit: "%", minConsecutiveMs: 300, steps: [0] }),
      // The other foot moving in the picture, or the other knee straightening with it (mirror movement or helping).
      cr("other_leg", "other leg helping", "other_leg_pct", 20, 4, 0, "Keep your other foot still on the floor.", { unit: "%", minConsecutiveMs: 400, alternative: [{ metric: "other_knee_delta", threshold: 20 }], steps: [0] }),
    ],
    cycle: [
      { caption: "Straighten your knee and hold", voice: "Slowly straighten your knee until your foot reaches the circle, keeping your thigh on the chair and sitting tall. Hold it there.", kind: "reach", gate: ["knee_extension"], holdMs: 1500, cue: "Straighten your knee." },
      { ...ret("Lower your foot to the floor", "Now slowly bend your knee and lower your foot back to the floor."), cue: "Lower slowly." },
    ],
    feedback: [
      // Worded like the other target-flow exercises, so the final repetition's version drops "on the next ..." the same way.
      { comp: "trunk_lean", say: "I noticed you leaned back to lift your foot. On the next repetition, try sitting tall and let your knee do the work." },
      { comp: "trunk_forward", say: "I noticed you leaned forward as you straightened your knee. On the next repetition, try sitting tall with your back against the chair." },
      { comp: "trunk_side_lean", say: "I noticed you leaned to one side. On the next repetition, try keeping your weight even on both hips." },
      { comp: "hip_hike", say: "I noticed your hip lifted off the chair. On the next repetition, try keeping both hips settled on the seat." },
      { comp: "thigh_lift", say: "I noticed your thigh lifted off the chair. On the next repetition, try keeping your thigh resting on the seat as your knee straightens." },
      { comp: "other_leg", say: "I noticed your other leg moved to help. On the next repetition, try keeping your other foot still on the floor." },
      { attainmentBelow: 0.7, say: "Nearly there. On the next repetition, try straightening your knee a little further if it feels comfortable." },
    ],
    praise: "Lovely controlled movement. Keep straightening slowly and lowering gently.",
    bestLabel: "knee straightening",
    bestRomId: "knee_extension",
    rescueNote: "Smaller knee target",
    // Kicking the foot up or dropping it: a reminder only, the hold already keeps a kick from counting.
    speedCue: { metric: "knee_extension", degPerS: 150, lift: "Nice and slow as you straighten.", lower: "Lower your foot slowly." },
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

/** Pinch and Peg's cycle at each level (the target flow runs level 1: the first finger, then the middle finger). */
function pinchCycle(rung: Rung): CycleStep[] {
  return pinchSteps(PINCH_SEQUENCE.slice(0, PINCH_OPPOSITIONS[rung]));
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
