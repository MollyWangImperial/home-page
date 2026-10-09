// The native movement check (assessment) on the exercise engine: the shapes shared by the ladder, the camera tasks
// (ExerciseRunner in assessment mode), the walking task, the scoring and the results dashboard.

export type AssessmentTaskId = "T1" | "T3" | "H4" | "H3" | "L6";
/** The four camera tasks run by ExerciseRunner in assessment mode (walking has its own task). */
export type CameraTaskId = Exclude<AssessmentTaskId, "L6">;

/** A posture check in one attempt: confirmed, watched and clean, or not seen well enough to judge. */
export type CompStatus = "detected" | "not_detected" | "not_measured";

/** One level of a task, easiest first: its stored id (the runner's rung id), a short label and the patient's words. */
export type LevelSpec = { id: string; label: string; say: string };

export type StopReason = "top_reached" | "reversal" | "lowest_failed" | "help_declined" | "max_attempts" | "skipped" | "not_measured";

/** One measured attempt at a level. completed: the level's target held for the full hold; touched: reached, not held. */
export type AttemptRecord = {
  level: number;
  levelId: string;
  assist: null | "helper";
  completed: boolean;
  touched: boolean;
  /** How far toward the level's target the movement got (0-1, 1 on target). */
  peakProgress: number;
  compensations: Record<string, CompStatus>;
  durationMs: number;
};

export type AssessmentTaskResult = {
  taskId: CameraTaskId;
  exerciseId: string;
  levelIds: string[];
  startLevel: number;
  /** The unscored try at the easiest level, before the levels. */
  tryOut: { completed: boolean; peakProgress: number };
  attempts: AttemptRecord[];
  /** The hand moved at least part of the way toward a target (try-out included). */
  movementSeen: boolean;
  stoppedBy: StopReason;
  /** False when the camera never saw enough to run an attempt (tracking or set-up failed). */
  measured: boolean;
  side: "left" | "right";
  /** Real measurements for the dashboard, e.g. peak shoulder_flexion, elbow_flexion, hand_openness, pinch_index. */
  insights: Record<string, number>;
};

/** Whether anyone held the patient while walking (physical help), stood nearby, or no one was there. */
export type WalkAssist = "holds" | "nearby" | "none";

export type GaitMetrics = {
  /** Walking speed in leg lengths per second, and a display-only estimate in metres per second (× 0.85 m). */
  speedLegPerS: number;
  speedMpsEstimate: number;
  /** Steps per minute. */
  cadence: number;
  /** Shorter over longer of the two alternating steps' mean length (1 = even). */
  stepLengthSymmetry?: number;
  /** Shorter over longer of the two alternating steps' mean time (1 = even). */
  stepTimeSymmetry?: number;
  /** Peak knee bend in swing (degrees) of each alternating side, and the stiffer side's. */
  kneeFlexA?: number;
  kneeFlexB?: number;
  kneeFlexPeak?: number;
  /** Forward trunk lean while walking beyond standing, degrees. */
  trunkLeanDeg?: number;
  /** True when trunkLeanDeg is beyond a standing angle the set-up recorded; false when it is the raw lean (no baseline). */
  trunkBaseline?: boolean;
  /** Mean step length in leg lengths for each alternating side (for the footprint picture). */
  stepLengthA?: number;
  stepLengthB?: number;
  steps: number;
  passes: number;
  /** Share of walking frames with the whole lower body seen, and how side-on the walk was (shoulder span / torso). */
  seenShare: number;
  sideOnRatio: number;
};

export type GaitComponentId = "speed" | "cadence" | "step_length_symmetry" | "step_time_symmetry" | "knee_bend" | "trunk_upright";
export type GaitComponents = Partial<Record<GaitComponentId, number>>;

/**
 * One task's row in the native function score: the stored FunctionScore task fields (task_id, task_label, points,
 * level) plus what the results dashboard shows. level 0-4 (null: not measured); points = level × 25, or walking's score.
 */
export type NativeTaskScore = {
  task_id: AssessmentTaskId;
  task_label: string;
  points: number | null;
  level: number | null;
  /** "Not yet", "Getting started", "Partly", "Can do", "Can do well", "Not measured", "Walking score", "Not assessed"... */
  label: string;
  /** The hardest level held without help (its LevelSpec label), if any. */
  best_level?: string;
  next_step?: string;
  compensations?: Record<string, CompStatus>;
  assisted?: boolean;
};

export type GaitResult =
  | {
    status: "scored";
    /** Unrounded 0-100; displays round once, half up. */
    score: number;
    /** The walking area's score: the score, or at most 50 when someone held the patient while walking. */
    areaScore: number;
    assist: WalkAssist;
    metrics: GaitMetrics;
    components: GaitComponents;
  }
  | { status: "not_measured" | "skipped"; reason: string; assist?: WalkAssist; metrics?: Partial<GaitMetrics> };
