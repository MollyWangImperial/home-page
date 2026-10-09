// The six-beat session script (section 2): set up, show me once, warm rep, scored reps, rescue, wrap.
// Frame-driven and free of DOM and speech APIs so it can run against camera frames, simulated frames
// or a test harness. Timing comes from frame.t.

import { ANGLE_ADVICE, bestLine, CLOSER_TARGET_LINE, ELBOW_ADVICE, finalRepAdvice, finishedLevelLine, goodRepsLine, keepInViewLine, handInViewLine, graspHandInViewLine, bodyInViewLine, slideHandsInViewLine, moveFurtherLine, NEXT_REP_COUNTDOWN_LINE, reachedTargetsLine, repCompleteLine, repsAheadLine, repScoreLine, SHOULDER_ADVICE, word, cap } from "./spoken";
import { cycleFor, EVERYDAY_EXERCISE_ID, REPS_BY_RUNG, resolveExercise, DOSE_PRESETS, LEVEL_BY_RUNG, usesTargetFlow, type CycleStep, type ExerciseConfig, type Rung, type Side } from "./config";
import { compensationStatus, medianGeo, type Frame, type Geo, type LapRest } from "./metrics";
import { attainment, romAttainment, EXERCISE_SCORE_VERSION, isGoodRep, isMiss, repScore, sessionScore, type HoldOutcome } from "./scoring";
import { metricUnit, metricUnitName, reachAngleProgress, ReachRestCalibration, ReachTargetCalibration } from "./calibration";
import { TARGET_HOLD_MS } from "./target-timing";
import { reachDemoDuration } from "./reach-demo";
import { mouthDemoDuration } from "./mouth-demo";
import { handDemoDuration } from "./hand-target";
import { GRASP_STEP, graspDemoDuration } from "./grasp-target";
import { curlJudged, pinchDemoDuration } from "./pinch-target";
import { kneeDemoDuration } from "./knee-target";
import { toeDemoDuration } from "./toe-target";
import { slideDemoDuration, slideRestPrompt, type SlideGeo } from "./slide-target";
import { MouthCalibration, simulatedMouthComps, type MouthPoint } from "./mouth-target";
// Relative on purpose: engine files must also build where the @shared alias is not available.
import { ADAPTATION_VERSION, DEFAULT_EXERCISE_TUNING, tunedReps, type ExerciseTuning } from "../../../../shared/alira-adaptation";
import { Ladder } from "../assessment-engine/ladder";
import { OTHER_HAND_ARM, OTHER_HAND_IN_VIEW, pinchLevelGoal } from "../assessment-engine/tasks";
import type { AssessmentTaskResult, AttemptRecord, CameraTaskId, CompStatus, LevelSpec } from "../assessment-engine/types";

export type Voice = { say(text: string): void; busy(t: number): boolean; stop(): void };
export type Phase = "setup" | "demo" | "warm" | "reps" | "done";

export type SessionOptions = {
  exerciseId: string;
  rung: Rung;
  side: Side;
  chairBack?: boolean;
  /** Supported Arm Elevation: the forearm rests on the chair's armrest (lifted from it) rather than a table beside it. */
  armrest?: boolean;
  /** Quick test: fewer reps than the rung's 6 / 8 / 10. Wins over the tuned repetition count. */
  repsOverride?: number;
  assisted?: boolean;
  reviewBetweenReps?: boolean;
  /** Settings from Alira's learning, read once when the session starts. Omitted = the defaults. */
  tuning?: ExerciseTuning;
  /** The movement check: run one task's levels (a try-out, then ladder attempts) instead of scored repetitions. */
  assessment?: SessionAssessment;
};

/**
 * A movement check task on this exercise (assessment-engine/tasks.ts): its levels, easiest first, where its ladder
 * starts, its posture checks (they replace the exercise's own) and, when given, its repetition's steps.
 */
export type SessionAssessment = { taskId: CameraTaskId; levels: LevelSpec[]; startLevel: number; compensations: ExerciseConfig["compensations"]; cycle?: CycleStep[] };

export type RepResult = {
  index: number;
  rung: Rung;
  attainment: number;
  hold: HoldOutcome;
  compensations: string[];
  score: number;
  good: boolean;
  peaks: Record<string, number>;
  startingAngles?: Record<string, number>;
  targets?: Record<string, number>;
  unmeasured?: string[];
};

export type SessionRecord = {
  engine: string;
  exercise_id: string;
  rung_start: Rung;
  rung_end: Rung;
  reps_planned: number;
  repetition_scores: number[];
  quality_reps: number;
  best_attainment: number;
  best_value: number | null;
  best_label: string;
  compensation_counts: Record<string, number>;
  hold_pass_count: number;
  not_attempted: boolean;
  assisted: boolean;
  chair_back: boolean;
  score: number | null;
  wrap: string;
  finished_at: string;
  /** The tuning this session ran with: whether any setting differed from its default, and which. */
  adaptation?: { version: string; adapted: boolean; changed: Partial<Record<string, number>> };
  /** The movement check: the task's result (no scores, no repetitions). */
  assessment?: AssessmentTaskResult;
};

export type Snapshot = {
  phase: Phase;
  /** 1 set up, 2 show me once, 3 warm rep, 4 scored reps, 6 wrap. Beat 5 (rescue) is flagged separately. */
  beat: 1 | 2 | 3 | 4 | 6;
  rung: Rung;
  rungStart: Rung;
  repIndex: number;
  repsPlanned: number;
  stepIndex: number;
  stepCount: number;
  caption: string;
  kind: CycleStep["kind"] | null;
  liveAttainment: number;
  inZone: boolean;
  targetArmed: boolean;
  holdProgress: number;
  prompt: string;
  idlePrompt: boolean;
  rescued: boolean;
  arrow: string | null;
  feedback: string;
  reps: RepResult[];
  demoProgress: number;
  demoReady: boolean;
  demoStepIndex: number;
  demoStepElapsedMs: number;
  calibrationProgress: number;
  targetsReady: boolean;
  startingAngles: Record<string, number>;
  record: SessionRecord | null;
  paused: boolean;
  review: "complete" | "countdown" | null;
  reviewAdvice: string[];
  countdownProgress: number;
  /** Hand opening: the step waits for the palm to face the camera in the shaded area. */
  awaitingReady: boolean;
  // The movement check only (absent otherwise):
  /** The level being tried, as an index into the task's levels (the try-out is the easiest), or -1 between levels. */
  assessmentLevel?: number;
  /** Every measured attempt so far (the try-out is not one). */
  assessmentAttempts?: AttemptRecord[];
  /** The offer of one more try with someone helping, awaiting the patient's answer (answerHelp). */
  assessmentOffer?: "help" | null;
  assessmentLevelIds?: string[];
};

// engineering default, needs clinician review
export const TIMING = {
  stableMs: 2000,
  targetHoldMs: TARGET_HOLD_MS,
  promptEveryMs: 8000,
  idleMs: 20000,
  maxWaitMs: 30000,
  returnMaxMs: 12000,
  restFraction: 0.4,
  zoneExit: 0.6,
  pauseBetweenRepsMs: 900,
  demoStepMs: 2600,
  lostMs: 1200,
  speechCapMs: 8000,
} as const;

/** Smallest movement away from the resting value that counts as "moved", per metric, in degrees. */
const MIN_EXCURSION: Record<string, number> = { shoulder_flexion: 15, elbow_extension: 20, elbow_flexion: 20, finger_extension: 20, knee_extension: 20, shoulder_abduction: 10, ankle_dorsiflexion: 3, toe_lift: 2, pinch_flexion: 0 };

// ---------- the movement check (assessment mode), engineering defaults to be reviewed by a clinician ----------

/** An attempt whose target is not on 20 s after it armed moves on to the return as a failure; one encouragement at 10 s. */
export const ATTEMPT_TIMEOUT_MS = 20000, ATTEMPT_ENCOURAGE_MS = 10000;
/** Movement counts as seen once any try got this far toward its target (the try-out included). */
export const MOVEMENT_SEEN_PROGRESS = 0.3;
/** What the movement check says, as short fixed lines: never a score, never a count of good repetitions. */
export const ASSESSMENT_LINES = {
  tryOut: "Now try it once. It is not scored.",
  levels: "Now the levels. Each try starts after a short countdown.",
  reached: "Level reached.",
  hard: "That one was hard.",
  another: "That one was hard. Let's try another level.",
  encourage: "Give it your best try, as far as is comfortable.",
  offerHelp: "Would you like to try once more with someone helping you?",
  withHelp: "Ask your helper to support you gently. Let's try once more.",
  done: "That's this task done. Well done.",
  skipped: "No problem, we will skip this one for today.",
} as const;
/** How each task asks for a level ("Next, reach to the circle overhead."), and how its try-out ends. */
const LEVEL_ASK: Record<string, string> = { ex_reach: "reach to", ex_h2m: "bring your hand to", ex_handopen: "open your fingers out to", ex_pinch: "bring your thumb" };
const TRY_OUT_THEN: Record<string, string> = { ex_reach: "and hold, then return your hand to your lap.", ex_h2m: "and hold, then return your hand to your lap.", ex_handopen: "and hold, then close your hand gently.", ex_pinch: "and hold, then let go." };
/** Hand to mouth's chest level: the movement step worded for the chest (the exercise's own words are for the mouth). */
const CHEST_STEP = { caption: "Bring your hand to your chest and hold", voice: "Bend your elbow and bring your hand up to the circle on your chest. Hold it there. Head up, shoulder relaxed." };

/** The exercise as the movement check runs it: the task's posture checks, and its own repetition steps when it has them. */
export function withAssessment(cfg: ExerciseConfig, assessment?: { compensations: ExerciseConfig["compensations"]; cycle?: CycleStep[] } | null): ExerciseConfig {
  return assessment ? { ...cfg, compensations: assessment.compensations, ...(assessment.cycle ? { cycle: assessment.cycle } : {}) } : cfg;
}


type RepRun = {
  peaks: Record<string, number>;
  peakExc: Record<string, number>;
  eligible: Record<string, number>;
  over: Record<string, number>;
  consec: Record<string, number>;
  maxConsec: Record<string, number>;
  consecMs: Record<string, number>;
  maxConsecMs: Record<string, number>;
  /** Sustained time at a rule's `yieldsTo.minRatio` (well beyond its threshold). */
  strongMs: Record<string, number>;
  maxStrongMs: Record<string, number>;
  holds: HoldOutcome[];
  ended: boolean;
  /** Recorded frames in which posture counts (hand-to-mouth: the hand near the mouth). */
  postureFrames: number;
  /** How long the hand has been away from the mouth (hand-to-mouth posture). */
  postureGapMs: number;
};

/** The resting posture each target exercise learns at set-up (the reach's default: shoulder and elbow). */
/** Hand opening: what to do before a step can start, when the camera does not say more precisely. */
const READY_HINT = "Hold your hand up in the shaded area with your palm facing the camera.";
/** The hand must be ready this long before a step starts, away this long before it counts as gone, and the hint is spoken after this long. */
const READY_HOLD_MS = 500, READY_AWAY_MS = 700, READY_SPEAK_MS = 5000, READY_WAIVE_MS = 8000;
/** A step's short cue is not said again within this long. */
const CUE_REPEAT_MS = 4000;
/** A closed hand the tracker loses for a moment at the cup does not restart the grasp's hold. */
const CONTACT_GRACE_MS = 300;
/** The grasp's checks that need the hand model, not the body: missing only these, the patient hears about the hand. */
const GRASP_HAND_CHECKS = ["wrist_bend", "cup_tipping", "finger_extension"];
/** Seated Knee Extension (knee-target.ts). */
const KNEE_ID = "ex_lower_selective";
/** Seated Toe Lift (toe-target.ts). */
const TOE_ID = "ex_ankle_dorsiflexion";
/** Supported Arm Elevation: the hand out to a drawn cup from a table or the armrest beside the body (slide-target.ts). */
const SLIDE_ID = "ex_wallslide";
/** Pinch and Peg (pinch-target.ts): set up and started as Active Hand Opening is. */
const PINCH_ID = "ex_pinch";
/** The table slide's checks that need its hands, not the body: missing only these, the patient hears about the hands. */
const SLIDE_HAND_CHECKS = ["hand_lift", "other_hand"];
// The grasp also needs the resting hand itself (its fingers' start), not only the arm. The knee rests with its foot
// (the resting point) still to within a sixth of the lower leg, and allows its 3D angle a little more jitter. The
// arm elevation rests with its hand still beside the body (a tenth of a shoulder span), its 3D shoulder angle within 10°.
const restCalibrationFor = (id: string) => id === TOE_ID ? new ReachRestCalibration(["toe_lift"], 0.1, 5) : id === KNEE_ID ? new ReachRestCalibration(["knee_extension"], 0.15, 12)
  : id === SLIDE_ID ? new ReachRestCalibration(["shoulder_flexion"], 0.1, 10)
  // The pinch rests with its hand still (a quarter palm length) and the thumb's closure on each finger within 12 points.
  : id === PINCH_ID ? new ReachRestCalibration(["pinch_index", "pinch_middle"], 0.25, 12)
  : new ReachRestCalibration(id === "ex_h2m" ? ["shoulder_flexion", "elbow_flexion"] : id === "ex_handopen" ? ["finger_extension"] : id === "ex_grasp" ? ["shoulder_flexion", "elbow_extension", "finger_extension"] : undefined, id === "ex_handopen" ? 0.25 : undefined);
/** What the practice hold learns: the goal angles, and for hand opening also how open the hand was (for its ring). */
const targetCalibrationFor = (id: string) => id === TOE_ID ? new ReachTargetCalibration(["toe_lift"], [-100, 100]) : new ReachTargetCalibration(id === "ex_h2m" ? ["elbow_flexion", "shoulder_flexion"] : id === "ex_handopen" ? ["finger_extension", "hand_openness"] : id === KNEE_ID ? ["knee_extension"] : id === SLIDE_ID ? ["shoulder_flexion", "slide_out"] : undefined);
/** The speed cue compares the measure now with this long ago (a short median at each end steadies it). */
const SPEED_WINDOW_MS = 200;

const freshRep = (): RepRun => ({ peaks: {}, peakExc: {}, eligible: {}, over: {}, consec: {}, maxConsec: {}, consecMs: {}, maxConsecMs: {}, strongMs: {}, maxStrongMs: {}, holds: [], ended: false, postureFrames: 0, postureGapMs: 0 });
/**
 * Hand-to-mouth: leaning the head or trunk, or shrugging, to bring the mouth to the cup happens with the hand
 * near the mouth. Posture counts once the hand is this far along its path from the lap to the mouth target (or
 * at the mouth). Measured against the target learned upright, not a mouth that follows the face: on camera,
 * leaning in to the screen brings the face toward a hand on the lap, which a following mouth would count...
 */
const MOUTH_POSTURE_PROGRESS = 0.6;
/** ...and a running stretch breaks only once the hand has stayed away this long, not on a one-frame wrist glitch. */
const MOUTH_POSTURE_GAP_MS = 300;
const worst = (holds: HoldOutcome[]): HoldOutcome => (holds.includes("none") ? "none" : holds.includes("touched") ? "touched" : "full");

export class ExerciseSession {
  readonly cfg: ExerciseConfig;
  private opts: SessionOptions;
  private voice: Voice;
  private rung: Rung;
  private rungStart: Rung;
  private plannedReps: number;
  private phase: Phase = "setup";
  private rest: Record<string, number> = {};
  private ref: Geo | null = null;
  private targetsReady = false;
  private calibratedStart: Record<string, number> | null = null;
  private restSamples: Frame["values"][] = [];
  private geoSamples: Geo[] = [];
  private recent: Frame[] = [];
  private reachRestCalibration = new ReachRestCalibration();
  private reachCalibrationProgress = 0;
  private learnedLap: LapRest | null = null;
  private mouthCalibration = new MouthCalibration();
  private learnedMouth: MouthPoint | null = null;
  private reachTargetCalibration = new ReachTargetCalibration();
  private learnedReach: Record<string, number> | null = null;
  private visibleSince: number | null = null;
  private setupStart: number | null = null;
  private lastPromptAt = -1e9;
  private lastT = 0;
  private lostSince: number | null = null;
  private prompt = "";
  private demoStepIndex = -1;
  private demoStepStart = 0;
  private demoMotionStarted = false;
  private demoDone = false;
  // rep machine
  private run: RepRun = freshRep();
  private stepIdx = 0;
  private stepStart = 0;
  private armed = false;
  private touched = false;
  private lastContactT = -Infinity;
  private holdAcc = 0;
  private inZone = false;
  private liveA = 0;
  private restAcc = 0;
  private pauseUntil = 0;
  private started = false;
  /** Hand opening: since when the hand has been ready to start the step, and since when it has been away from the shaded area. */
  private readySince: number | null = null;
  private awaySince: number | null = null;
  /** The last short cue said, so a step that restarts within a few seconds does not say it again. */
  private lastCue: { key: string; t: number } | null = null;
  /** The ready-gated step whose full instruction was given (a restart after the hand left says only the cue). */
  private instructedKey: string | null = null;
  /** The step whose "slowly" reminder was said (once per step). */
  private speedKey: string | null = null;
  /** The table slide: the shoulder's progress as this slide started (its other-hand baseline is taken from there). */
  private slideStart: number | null = null;
  /** Since when the hand has been ready but for the fingers, wrist or palm turn (waived after READY_WAIVE_MS). */
  private almostSince: number | null = null;
  /** Since when the current step's ready gate has been waiting. */
  private gateSince: number | null = null;
  private lastMoveT = 0;
  private idleAsked = false;
  private repNumber = 0;
  private reps: RepResult[] = [];
  private missStreak = 0;
  private rescued = false;
  private review: "complete" | "countdown" | null = null;
  private reviewStarted = 0;
  /** The first scored repetition's countdown is shown, but its ring and line wait for "Good. Now N repetitions." to finish. */
  private countdownQueued = false;
  private reviewAdvice: string[] = [];
  private lastCorrection: string | null = null;
  private arrow: string | null = null;
  private feedback = "";
  private record: SessionRecord | null = null;
  private introSpokenAt = 0;
  private cycleCache: CycleStep[];
  private demoProgress = 0;
  private readonly tuned: ExerciseTuning;
  // The movement check (assessment mode): the task, its levels ladder, the attempts and the try-out so far.
  private readonly assess: SessionAssessment | null;
  private readonly ladder: Ladder | null;
  private attempts: AttemptRecord[] = [];
  private tryOut: { completed: boolean; peakProgress: number } | null = null;
  /** This attempt's peak progress toward its target, and its measures' peaks (for the results' insights). */
  private attemptPeak = 0;
  private attemptValues: Record<string, number> = {};
  /** The measures' peaks of the try-out and each unassisted attempt. */
  private insightPeaks: Record<string, number>[] = [];
  /** When the movement step's target first armed (re-arming after speech keeps it), and how long the movement took. */
  private assessArmedAt: number | null = null;
  private attemptMs = 0;
  private encouraged = false;
  private offer: "help" | null = null;

  constructor(opts: SessionOptions, voice: Voice) {
    this.opts = opts;
    this.voice = voice;
    this.cfg = withAssessment(resolveExercise(opts.exerciseId, Boolean(opts.chairBack), Boolean(opts.armrest)), opts.assessment);
    this.reachRestCalibration = restCalibrationFor(this.cfg.id);
    this.reachTargetCalibration = targetCalibrationFor(this.cfg.id);
    // A frozen copy taken once: nothing changes mid-repetition, and later edits to the caller's object do not reach it.
    const everyday = this.cfg.id === EVERYDAY_EXERCISE_ID;
    // The movement check always holds its targets for the standard time: its levels are not Alira's to adjust.
    const tuning = everyday || opts.assessment ? DEFAULT_EXERCISE_TUNING : opts.tuning ?? DEFAULT_EXERCISE_TUNING;
    this.tuned = Object.freeze({ ...tuning, changed: Object.freeze({ ...tuning.changed }) });
    this.rung = this.rungStart = everyday ? 1 : opts.rung;
    // The planned count is fixed here; a rescue lowers the rung but never the number of repetitions.
    this.plannedReps = opts.repsOverride ?? tunedReps(REPS_BY_RUNG[this.rung], this.tuned);
    this.cycleCache = cycleFor(opts.exerciseId, this.rung);
    this.assess = opts.assessment ?? null;
    this.ladder = opts.assessment ? new Ladder(opts.assessment.levels.length, opts.assessment.startLevel) : null;
  }

  // ---------- public surface ----------

  /** The settings from Alira's learning that this session runs with (fixed for the whole session). */
  get tuning(): ExerciseTuning {
    return this.tuned;
  }

  get currentStep(): CycleStep | null {
    return this.phase === "warm" || this.phase === "reps" ? this.cycle()[this.stepIdx] ?? null : null;
  }

  /** Forward reach uses the measured practice hold directly, with no angle increment. */
  targets(): Record<string, number> {
    const level = LEVEL_BY_RUNG[this.phase === "warm" ? 1 : this.rung];
    // The movement check's pinch closes to its level's goal (assessment-engine/tasks.ts), once set-up knows the resting thumb.
    const pinchGoal = this.assess && this.cfg.id === PINCH_ID && Number.isFinite(this.rest.pinch_index) ? pinchLevelGoal(this.assessmentLevelId ?? "", this.rest.pinch_index) : undefined;
    return Object.fromEntries(this.cfg.romSteps.map(rom => {
      if (pinchGoal !== undefined && rom.id === "pinch_index") return [rom.id, pinchGoal];
      return [rom.id, usesTargetFlow(this.cfg.id) ? this.learnedReach?.[rom.id] ?? rom.targets.easy : rom.targets[level]];
    }));
  }

  /** Forward-reach baselines come only from seated lap setup, never a raised-arm practice frame. */
  startingAngles(): Record<string, number> {
    return this.calibratedStart ?? Object.fromEntries(this.cfg.romSteps.filter(rom => Number.isFinite(this.rest[rom.metric])).map(rom => [rom.id, this.rest[rom.metric]]));
  }

  restValues(): Record<string, number> {
    return this.rest;
  }

  /** Forward reach keeps its seated setup reference; other exercises may refresh after practice. */
  get reference(): Geo | null {
    return this.ref;
  }

  get lapPoint(): LapRest | null { return this.learnedLap ? { ...this.learnedLap } : null; }
  get mouthPoint(): MouthPoint | null { return this.learnedMouth ? { ...this.learnedMouth } : null; }
  /** A measure learned at the practice hold (hand opening: how open the hand was, for its ring), once learned. */
  learnedValue(metric: string): number | undefined { return this.learnedReach?.[metric]; }

  /** The movement check: whether this session runs a task's levels (assessment mode). */
  get assessing(): boolean { return this.assess !== null; }
  /** The movement check: the id of the level whose target is live, or the try-out's (the easiest) between attempts. */
  get assessmentLevelId(): string | null { return this.assess ? this.assess.levels[Math.max(0, this.levelNow())]?.id ?? null : null; }

  /**
   * The movement check: the patient's answer to the offer of one more try with someone helping (after the easiest
   * level was not reached). Yes: one assisted attempt at the easiest level, after the countdown. No: the task ends.
   */
  answerHelp(yes: boolean, t: number) {
    if (!this.ladder || this.offer !== "help") return;
    this.offer = null;
    this.voice.stop();
    const next = this.ladder.answerHelp(yes);
    if (next.type !== "attempt") return this.finish(t, false);
    this.voice.say(ASSESSMENT_LINES.withHelp);
    // The countdown's ring and line wait for the helper line, as the first attempt's wait for the levels line.
    this.review = "countdown";
    this.reviewStarted = t;
    this.countdownQueued = true;
  }

  /** Begin: speak the setup voice, then the calibration line. */
  start(t: number) {
    this.setupStart = t;
    this.lastT = t;
    this.voice.say(this.cfg.setupVoice);
    this.voice.say(this.cfg.calibrationInstruction);
    this.introSpokenAt = t;
    this.prompt = "Sit so every part the camera needs is in view, then hold still.";
  }

  /** Jump past the intro speech and demo (for testing). */
  skipAhead(t: number) {
    if (this.phase === "setup") this.captureRest(t, true);
    else if (this.phase === "demo") this.beginWarm(t);
  }

  /** Replay an earlier instruction step, preserving completed scored repetitions. */
  goBack(beat: number, t: number): boolean {
    if (this.phase === "done" || beat < 1 || beat > 3 || beat >= this.snapshot().beat) return false;
    this.voice.stop();
    this.review = null;
    this.countdownQueued = false;
    this.lostSince = null;
    this.idleAsked = false;
    this.arrow = null;
    this.feedback = "";
    this.run = freshRep();
    if (beat === 1) {
      this.phase = "setup";
      this.targetsReady = false;
      this.calibratedStart = null;
      this.rest = {};
      this.ref = null;
      this.visibleSince = null;
      this.restSamples = [];
      this.geoSamples = [];
      this.recent = [];
      this.reachRestCalibration = restCalibrationFor(this.cfg.id);
      this.mouthCalibration = new MouthCalibration();
      this.learnedMouth = null;
      this.reachCalibrationProgress = 0;
      this.learnedLap = null;
      this.learnedReach = null;
      this.reachTargetCalibration.reset();
      this.start(t);
    } else if (beat === 2) this.beginDemo(t);
    else this.beginWarm(t);
    return true;
  }

  /** Patient (or tester) ends the exercise. Nothing scored yet stores not_attempted. */
  skip(t: number) {
    if (this.phase === "done") return;
    this.voice.stop();
    this.finish(t, true);
  }

  snapshot(): Snapshot {
    const step = this.currentStep;
    const cycleLen = this.cycle().length;
    const beat = this.phase === "setup" ? 1 : this.phase === "demo" ? 2 : this.phase === "warm" ? 3 : this.phase === "reps" ? 4 : 6;
    const calibrationProgress = this.phase !== "setup" ? 1 : usesTargetFlow(this.cfg.id) ? this.reachCalibrationProgress : this.visibleSince === null ? 0 : Math.min(1, (this.lastT - this.visibleSince) / TIMING.stableMs);
    return {
      phase: this.phase,
      beat,
      rung: this.rung,
      rungStart: this.rungStart,
      repIndex: this.phase === "warm" ? 0 : this.repNumber,
      repsPlanned: this.plannedReps,
      stepIndex: this.stepIdx,
      stepCount: cycleLen,
      caption: this.phase === "demo" && this.demoStepIndex >= 0 ? this.cycle()[this.demoStepIndex]?.caption ?? "" : step ? this.chestStep(step) ? CHEST_STEP.caption : step.caption : "",
      kind: step?.kind ?? null,
      liveAttainment: this.liveA,
      inZone: this.inZone,
      targetArmed: !this.review && !this.voice.busy(this.lastT) && (this.phase === "demo" ? this.demoMotionStarted : (this.phase === "warm" || this.phase === "reps") && this.armed),
      holdProgress: step && step.holdMs ? Math.min(1, this.holdAcc / this.holdMsFor(step, usesTargetFlow(this.cfg.id) && this.recent[this.recent.length - 1]?.targetContact !== undefined)) : 0,
      prompt: this.prompt,
      idlePrompt: this.idleAsked,
      rescued: this.rescued,
      arrow: this.arrow,
      feedback: this.feedback,
      reps: this.reps,
      demoProgress: this.demoProgress,
      demoReady: this.phase === "demo" && this.demoStepIndex >= 0,
      demoStepIndex: this.demoStepIndex,
      demoStepElapsedMs: this.phase === "demo" && this.demoMotionStarted ? Math.max(0, this.lastT - this.demoStepStart) : 0,
      calibrationProgress,
      targetsReady: this.targetsReady,
      startingAngles: { ...this.startingAngles() },
      record: this.record,
      paused: this.lostSince !== null,
      review: this.review,
      reviewAdvice: this.reviewAdvice,
      countdownProgress: this.review === "countdown" && !this.countdownQueued ? Math.min(1, (this.lastT - this.reviewStarted) / 3000) : 0,
      // Only when the camera reports readiness (the no-camera simulator has no shaded area to wait for).
      awaitingReady: (this.phase === "warm" || this.phase === "reps") && !this.review && Boolean(step?.readyGate) && !this.started && this.recent[this.recent.length - 1]?.ready !== undefined,
      ...(this.assess ? { assessmentLevel: this.levelNow(), assessmentAttempts: [...this.attempts], assessmentOffer: this.offer, assessmentLevelIds: this.assess.levels.map(level => level.id) } : {}),
    };
  }

  // ---------- frame loop ----------

  push(frame: Frame) {
    const t = frame.t;
    const dt = Math.min(100, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (this.review) {
      if (this.review === "complete" && t - this.reviewStarted >= 1200 && !this.voice.busy(t)) {
        if (this.assess) return this.afterAttemptReview(t);
        if (this.reps.length >= this.plannedReps) {
          this.review = null;
          return this.finish(t, false);
        }
        this.startCountdown(t);
      } else if (this.review === "countdown" && this.countdownQueued) {
        if (!this.voice.busy(t)) this.startCountdown(t);
      } else if (this.review === "countdown" && t - this.reviewStarted >= 3000 && !this.voice.busy(t)) {
        this.review = null;
        this.voice.stop();
        this.prepareNextRep(t, 0);
      }
      return;
    }
    this.recent.push(frame);
    if (this.recent.length > 30) this.recent.shift();
    if (this.phase === "setup") return this.setupFrame(frame);
    if (this.phase === "demo") return this.demoFrame(t);
    if (this.phase === "done") return;
    // warm + reps. Hand opening: once the opening step has started, a hand that has left the shaded area, turned its
    // palm away or gone out of view for 0.7 s goes back to waiting for the palm if the ring was not touched yet: no
    // miss, and the abandoned attempt leaves no posture or peak evidence (the open step is step 0, so no hold is lost).
    // After a touch it pauses the step as a hand out of view does. A hand resting on the lap cannot trigger a target.
    const gated = Boolean(this.cycle()[this.stepIdx]?.readyGate);
    const placedOff = gated && this.started && frame.ready !== undefined && (!frame.visible || frame.placed === false);
    this.awaySince = placedOff ? this.awaySince ?? t : null;
    const away = placedOff && t - this.awaySince! >= READY_AWAY_MS;
    if (away && !this.touched) {
      this.run = freshRep();
      this.startStep(t, 0);
      this.awaySince = null;
      if (this.lostSince !== null) this.lostSince = null;
      return this.stepFrame(frame, dt);
    }
    // A step still waiting for the hand handles a hand out of view itself, with its own quieter hint.
    if (gated && !this.started && frame.ready !== undefined) {
      if (this.lostSince !== null) this.lostSince = null;
      return this.stepFrame(frame, dt);
    }
    if (!frame.visible || away) {
      this.run.consec = {};
      this.run.consecMs = {};
      if (usesTargetFlow(this.cfg.id)) { this.holdAcc = 0; this.restAcc = 0; this.inZone = false; if (this.phase === "warm") this.reachTargetCalibration.reset(); }
      if (this.lostSince === null) this.lostSince = t;
      // Seated targets only need the affected hand once set up, so both ask for the same thing.
      if (t - this.lostSince > TIMING.lostMs) this.nag(t, away ? frame.readyHint ?? READY_HINT : this.cfg.id === KNEE_ID || this.cfg.id === TOE_ID ? frame.missing ?? "Keep your knees and feet in view of the camera." : this.cfg.id === SLIDE_ID ? frame.missing ?? "Keep your shoulder, elbow and hand in view of the camera." : usesTargetFlow(this.cfg.id) ? "Bring your affected hand back into view." : frame.missing ?? "I can't see you. Move back into view of the camera.");
      return;
    }
    if (this.lostSince !== null) {
      this.lostSince = null;
      this.prompt = "";
    }
    this.stepFrame(frame, dt);
  }

  // ---------- beat 1: set up ----------

  private nag(t: number, text: string) {
    this.prompt = text;
    if (t - this.lastPromptAt >= TIMING.promptEveryMs) {
      this.lastPromptAt = t;
      this.voice.say(text);
    }
  }

  private setupFrame(frame: Frame) {
    const t = frame.t;
    if (usesTargetFlow(this.cfg.id)) {
      const learned = this.reachRestCalibration.observe(frame, TIMING.stableMs);
      const mouth = this.cfg.id === "ex_h2m" ? this.mouthCalibration.observe(frame) : null;
      this.reachCalibrationProgress = learned.progress;
      if (!frame.visible || !frame.lapRest) {
        const missing = frame.missing ?? frame.lapMissing ?? (this.cfg.id === "ex_handopen" || this.cfg.id === PINCH_ID ? `Hold your ${this.opts.side} hand up in the shaded area with your palm facing the camera.`
          : this.cfg.id === TOE_ID ? "Sit tall with both feet flat on the floor and your toes in view, from your head to your feet." : this.cfg.id === KNEE_ID ? "Sit tall with both feet flat on the floor, from your head to your feet in view."
          : this.cfg.id === SLIDE_ID ? slideRestPrompt(this.opts.side, this.opts.armrest ? "armrest" : "table")
          : `Rest your ${this.opts.side} hand on the visible top of your ${this.opts.side} thigh.`);
        if (!this.voice.busy(t)) this.nag(t, missing); else this.prompt = missing;
      } else this.prompt = this.cfg.id === "ex_h2m" && !mouth ? "Keep your face in view and your hand on your lap while I learn the mouth target."
        : this.cfg.id === "ex_handopen" ? "Keep your fingers relaxed and gently curled, palm to the camera, while I learn your starting position."
        : this.cfg.id === PINCH_ID ? "Keep your hand relaxed, palm to the camera, with your thumb a little away from your first finger, while I learn your starting position."
        : this.cfg.id === KNEE_ID || this.cfg.id === TOE_ID ? "Keep sitting tall with both feet flat on the floor while I learn your starting position."
        : this.cfg.id === SLIDE_ID ? "Keep sitting tall with your forearm resting beside you while I learn your starting position."
        : "Keep your arm relaxed with your hand on your lap while I learn your starting position.";
      // Once the posture is learned, a long introduction may be cut after 12 s, as for every seated target.
      if (learned.ready && (this.cfg.id !== "ex_h2m" || mouth) && (!this.voice.busy(t) || t - this.introSpokenAt > 12000)) {
        this.restSamples = learned.samples.map(sample => sample.values);
        this.geoSamples = learned.samples.map(sample => sample.geo).filter(Boolean) as Geo[];
        this.learnedLap = learned.lapRest!;
        this.learnedMouth = mouth;
        this.captureRest(t, false);
      }
      return;
    }
    if (!frame.visible) {
      this.visibleSince = null;
      this.restSamples = [];
      this.geoSamples = [];
      // Stay quiet while the intro is being read out.
      if (!this.voice.busy(t) || t - this.introSpokenAt > TIMING.speechCapMs) this.nag(t, frame.missing ?? "Sit in front of the camera so I can see you.");
      else this.prompt = frame.missing ?? this.prompt;
      return;
    }
    if (this.visibleSince === null) {
      this.visibleSince = t;
      this.prompt = "Hold still for a moment while I check you are in view.";
    }
    this.restSamples.push(frame.values);
    if (frame.geo) this.geoSamples.push(frame.geo);
    if (t - this.visibleSince >= TIMING.stableMs && (!this.voice.busy(t) || t - this.introSpokenAt > 12000)) this.captureRest(t, false);
  }

  private captureRest(t: number, forced: boolean) {
    const samples = this.restSamples.length ? this.restSamples : this.recent.map(f => f.values);
    const keys = new Set<string>();
    samples.forEach(s => Object.keys(s).forEach(k => keys.add(k)));
    keys.forEach(key => {
      const vals = samples.map(s => s[key]).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
      if (vals.length) this.rest[key] = vals[Math.floor(vals.length / 2)];
    });
    this.ref = medianGeo(this.geoSamples.length ? this.geoSamples : (this.recent.map(f => f.geo).filter(Boolean) as Geo[]));
    this.prompt = forced ? "Skipped the camera check." : "";
    this.beginDemo(t);
  }

  // ---------- beat 2: show me once ----------

  private beginDemo(t: number) {
    // Retire queued setup/camera-check prompts before introducing the demonstration.
    this.voice.stop();
    this.phase = "demo";
    this.demoStepIndex = -1;
    this.demoStepStart = t;
    this.demoMotionStarted = false;
    this.demoDone = false;
    this.demoProgress = 0;
    this.voice.say("Now watch the demonstration on the right. I will show you how to do the movement. Just watch; nothing is scored.");
    this.prompt = "Watch me first. Nothing is scored.";
  }

  private demoFrame(t: number) {
    // Every step of a repetition, as the patient will do it (Pinch and Peg: both fingers, each pinched and let go).
    const list = this.cycle();
    if (this.demoStepIndex === -1) {
      if (this.voice.busy(t)) return;
      this.demoStepIndex = 0;
      this.demoStepStart = t;
      this.voice.say(list[0].caption + ".");
      return;
    }
    if (!this.demoMotionStarted) {
      if (this.voice.busy(t)) return;
      this.demoMotionStarted = true;
      this.demoStepStart = t;
    }
    const elapsed = t - this.demoStepStart;
    const duration = this.cfg.id === "ex_reach" ? reachDemoDuration(list[this.demoStepIndex].kind === "return") : this.cfg.id === "ex_h2m" ? mouthDemoDuration(list[this.demoStepIndex].kind === "return") : this.cfg.id === "ex_handopen" ? handDemoDuration(list[this.demoStepIndex].kind === "return") : this.cfg.id === "ex_grasp" ? graspDemoDuration(this.demoStepIndex) : this.cfg.id === TOE_ID ? toeDemoDuration(list[this.demoStepIndex].kind === "return") : this.cfg.id === KNEE_ID ? kneeDemoDuration(list[this.demoStepIndex].kind === "return") : this.cfg.id === SLIDE_ID ? slideDemoDuration(list[this.demoStepIndex].kind === "return", Boolean(this.opts.armrest)) : this.cfg.id === PINCH_ID ? pinchDemoDuration(list[this.demoStepIndex].kind === "return") : TIMING.demoStepMs;
    this.demoProgress = (this.demoStepIndex + Math.min(1, elapsed / duration)) / list.length;
    if (elapsed >= duration && (!this.voice.busy(t) || elapsed > duration + TIMING.speechCapMs)) {
      if (this.demoStepIndex + 1 < list.length) {
        this.demoStepIndex += 1;
        this.demoStepStart = t;
        this.demoMotionStarted = false;
        this.voice.say(list[this.demoStepIndex].caption + ".");
      } else if (!this.demoDone) {
        this.demoDone = true;
        this.beginWarm(t);
      }
    }
  }

  // ---------- beat 3: warm rep, beat 4: scored reps ----------

  private cycle(): CycleStep[] {
    // The movement check's steps are its task's (withAssessment) in the demonstration, the try-out and every attempt.
    if (this.assess) return this.cfg.cycle;
    // Supported Arm Elevation's steps are the same at every rung, worded for the table or the armrest (resolveExercise).
    if (this.cfg.id === SLIDE_ID) return this.cfg.cycle;
    if (this.phase === "warm") return cycleFor(this.opts.exerciseId, 1);
    return this.cycleCache;
  }

  private holdScale() {
    return DOSE_PRESETS[LEVEL_BY_RUNG[this.phase === "warm" ? 1 : this.rung]].holdScale;
  }

  /**
   * How long a step must be held, in ms: the one place hold time is decided, so the hold gauge, the
   * movement steps (practice and scored) and the lap circle cannot drift apart. Contact targets (the
   * on-screen circles) use the standard target hold; angle-scored steps use the step's own hold at this
   * rung's dose. Alira's hold factor scales both (1 by default, which leaves both exactly as before).
   */
  private holdMsFor(step: CycleStep, contact: boolean): number {
    return contact ? Math.round(TIMING.targetHoldMs * this.tuned.holdFactor) : step.holdMs * this.holdScale() * this.tuned.holdFactor;
  }

  private beginWarm(t: number) {
    this.phase = "warm";
    this.targetsReady = false;
    this.calibratedStart = null;
    this.learnedReach = null;
    this.reachTargetCalibration.reset();
    this.prompt = "";
    // The movement check's try-out is one unscored try at the easiest level: it learns no goal, so it is never repeated.
    this.voice.say(this.assess ? this.tryOutLine() : this.cfg.id === "ex_reach" ? "Now one practice repetition. It is not scored. Reach to the circle and hold while I learn your movement, then return to your lap."
      : this.cfg.id === "ex_h2m" ? "Now one practice repetition. It is not scored. Bring your hand to the mouth circle and hold while I learn your movement, then return to your lap."
      : this.cfg.id === "ex_handopen" ? "Now one practice repetition. It is not scored. Show me your palm in the shaded area. Then open your fingers out to the ring and hold while I learn your movement, and then close your hand gently."
      : this.cfg.id === "ex_grasp" ? "Now one practice repetition. It is not scored. Reach for the cup and open your hand, close it around the cup, carry it across, let it go, then return to your lap. I will learn your movement as you go."
      : this.cfg.id === TOE_ID ? "Now one practice repetition. It is not scored. Look at the ankle dial beside your shoulder: it moves with your foot, so as you lift your toes, its toes turn up toward the circle. Keeping your heel down, lift your toes until the dial reaches its circle, and hold while I learn your movement. Then lower your toes." : this.cfg.id === KNEE_ID ? "Now one practice repetition. It is not scored. Look at the knee dial beside your shoulder: it moves with your knee, so as you straighten your knee, its foot moves toward the circle. Straighten your knee, swinging your foot out along the arrow, until the dial reaches its circle, and hold while I learn your movement. Then lower your foot to the floor."
      : this.cfg.id === SLIDE_ID ? "Now one practice repetition. It is not scored. Follow the arrow and move your hand out to the cup, and hold while I learn your movement, then bring it back to rest."
      : this.cfg.id === PINCH_ID ? "Now one practice repetition. It is not scored. Show me your palm in the shaded area. Then bring your thumb toward your first finger as far as is comfortable, tip to tip if you can, and hold while I learn your movement. Then let go, and do the same with your middle finger."
      : "Now one practice repetition. It is not scored, and it helps me learn your starting position.");
    this.resetRep(t);
  }

  private beginReps(t: number) {
    this.phase = "reps";
    this.calibratedStart = { ...this.startingAngles() };
    const targets = this.targets();
    this.targetsReady = this.cfg.romSteps.every(rom => Number.isFinite(this.calibratedStart![rom.id]) && (!usesTargetFlow(this.cfg.id) || (this.learnedReach !== null && Number.isFinite(targets[rom.id]))));
    // The movement check's targets are its levels' (drawn by the page from set-up), with nothing to learn first.
    if (this.assess) this.targetsReady = true;
    this.repNumber = this.reps.length;
    this.prompt = "";
    this.voice.say(this.assess ? ASSESSMENT_LINES.levels : repsAheadLine(this.plannedReps));
    this.resetRep(t);
    if (this.countdownReps()) {
      // The first scored repetition gets the same 3-2-1 countdown as the others; its end numbers the repetition.
      this.review = "countdown";
      this.reviewStarted = t;
      this.countdownQueued = true;
      return;
    }
    this.nextRepNumber();
  }

  /**
   * Seated targets with the between-repetition review: every scored repetition starts after the 3-2-1
   * countdown and is not instructed again. The demonstration and the practice repetition say each step.
   */
  private countdownReps(): boolean {
    // The movement check always reviews each attempt and counts down to the next.
    return usesTargetFlow(this.cfg.id) && (Boolean(this.opts.reviewBetweenReps) || Boolean(this.assess));
  }

  private startCountdown(t: number) {
    this.review = "countdown";
    this.reviewStarted = t;
    this.countdownQueued = false;
    // The movement check names the level coming up instead ("Next, reach to the circle overhead.").
    this.voice.say(this.assess ? this.levelLine() : NEXT_REP_COUNTDOWN_LINE);
  }

  private nextRepNumber() {
    this.repNumber += 1;
  }

  private resetRep(t: number) {
    this.run = freshRep();
    this.instructedKey = null;
    this.stepIdx = 0;
    this.startStep(t, 1200);
    this.cycleCache = cycleFor(this.opts.exerciseId, this.rung);
  }

  private startStep(t: number, pause = 0) {
    this.stepStart = t;
    this.armed = false;
    this.started = false;
    this.readySince = null;
    this.awaySince = null;
    this.almostSince = null;
    this.gateSince = null;
    this.touched = false;
    this.lastContactT = -Infinity;
    this.slideStart = null;
    this.holdAcc = 0;
    this.restAcc = 0;
    this.inZone = false;
    this.liveA = 0;
    this.pauseUntil = t + pause;
    this.lastMoveT = t;
    this.idleAsked = false;
    // The movement check: each step's target arms afresh; an attempt's first step (or one restarted) starts its peaks afresh.
    if (this.assess) {
      this.assessArmedAt = null;
      this.encouraged = false;
      if (this.stepIdx === 0) { this.attemptPeak = 0; this.attemptValues = {}; }
    }
    // A scored seated step that starts at once is not instructed: its target is live in this very frame, so
    // the inactive circle and "Listen to the instruction" never flash between the countdown and the movement.
    const step = this.cycle()[this.stepIdx];
    // A practice step that learns its own measures (grasp: the reach, then the carry) learns them afresh.
    if (this.phase === "warm" && step?.learn) this.reachTargetCalibration = new ReachTargetCalibration(step.learn);
    if (this.phase === "reps" && this.countdownReps() && pause === 0 && !this.review && !this.voice.busy(t) && !step?.cue && !step?.readyGate) {
      this.started = true;
      this.armed = true;
    }
  }

  private romById(id: string) {
    return this.cfg.romSteps.find(rom => rom.id === id)!;
  }

  /**
   * Goals learned at the practice hold, each moved to its share of the way from rest (RomStep.learnedShare) and kept
   * at most its cap (RomStep.learnedCap).
   */
  private sharedGoals(learned: Record<string, number>): Record<string, number> {
    const out = { ...learned };
    for (const rom of this.cfg.romSteps) {
      const value = out[rom.metric], rest = this.rest[rom.metric];
      if (rom.learnedShare !== undefined && value !== undefined && Number.isFinite(rest)) out[rom.metric] = rest + rom.learnedShare * (value - rest);
      if (rom.learnedCap !== undefined && out[rom.metric] !== undefined) out[rom.metric] = Math.min(rom.learnedCap, out[rom.metric]);
      if (rom.learnedFloor !== undefined && out[rom.metric] !== undefined && Number.isFinite(rest)) out[rom.metric] = Math.max(rest + rom.learnedFloor, out[rom.metric]);
    }
    return out;
  }

  /** A repetition's best for the wrap: the measure itself, or (RomStep.bestFromStart) its movement from the start, in degrees. */
  private bestOf(rep: RepResult): number | undefined {
    const rom = this.romById(this.cfg.bestRomId), value = rep.peaks[this.cfg.bestRomId];
    if (value === undefined || rom?.bestFromStart === undefined) return value;
    const start = rep.startingAngles?.[this.cfg.bestRomId];
    return start === undefined || !Number.isFinite(start) ? undefined : Math.max(0, (value - start) * rom.bestFromStart);
  }

  /** Moving too fast (kicking the foot up, dropping it): a spoken reminder at most once per step, never scored. */
  private watchSpeed(step: CycleStep, t: number) {
    const cue = this.cfg.speedCue;
    if (!cue || (step.kind !== "reach" && step.kind !== "return")) return;
    const key = `${this.phase}:${this.repNumber}:${this.stepIdx}`;
    if (this.speedKey === key) return;
    // The measure's median, and its frames' mean time, in a window of recent frames (from, to] ms before now.
    const at = (from: number, to: number) => {
      const frames = this.recent.filter(frame => frame.t > t - from && frame.t <= t - to && Number.isFinite(frame.values[cue.metric]));
      if (!frames.length) return undefined;
      const values = frames.map(frame => frame.values[cue.metric]!).sort((a, b) => a - b);
      return { value: values[Math.floor(values.length / 2)], t: frames.reduce((sum, frame) => sum + frame.t, 0) / frames.length };
    };
    // Now against 150-300 ms ago: just after a countdown there may be only a few frames of history.
    const now = at(100, 0), before = at(SPEED_WINDOW_MS + 100, SPEED_WINDOW_MS - 50);
    if (!now || !before || now.t - before.t < 50) return;
    const rate = (now.value - before.value) / ((now.t - before.t) / 1000);
    const lowering = step.kind === "return";
    // A reminder said once the target is touched would pause (and so cut short) the hold already under way.
    if (!lowering && (this.touched || this.holdAcc > 0)) return;
    if (lowering ? rate <= -cue.degPerS : rate >= cue.degPerS) {
      this.speedKey = key;
      this.voice.say(lowering ? cue.lower : cue.lift);
    }
  }

  private excursion(metric: string, value: number | undefined): number {
    return value === undefined ? 0 : value - (this.rest[metric] ?? 0);
  }

  private waitForSpeech(t: number): boolean {
    if (!this.voice.busy(t)) return false;
    this.armed = false;
    this.holdAcc = this.restAcc = this.liveA = 0;
    if (this.phase === "warm" && usesTargetFlow(this.cfg.id)) this.reachTargetCalibration.reset();
    this.inZone = false;
    return true;
  }

  private stepFrame(frame: Frame, dt: number) {
    const t = frame.t;
    const steps = this.cycle();
    const step = steps[this.stepIdx];
    if (!step) return;
    const targets = this.targets();

    // Physical contact never bypasses an instruction. Drawing and holding share targetArmed.
    if (!this.started) {
      if (t < this.pauseUntil) return;
      if (this.voice.busy(t)) return;
      // Hand opening: each step starts once the hand has been ready for 0.5 s (palm to the camera in the shaded
      // area, fingers relaxed). The hint shows at once and is spoken only after 5 s, then every few seconds. A hand
      // ready but for fingers that will not relax further starts anyway after 8 s.
      if (step.readyGate && frame.ready !== undefined) {
        // Timed from when the gate starts waiting, not from the step's start (which includes any instruction).
        this.gateSince ??= t;
        this.almostSince = frame.readyAlmost ? this.almostSince ?? t : null;
        const ready = frame.ready || (this.almostSince !== null && t - this.almostSince >= READY_WAIVE_MS);
        if (!ready) {
          this.readySince = null;
          if (t - this.gateSince > READY_SPEAK_MS) this.nag(t, frame.readyHint ?? READY_HINT);
          else this.prompt = frame.readyHint ?? READY_HINT;
          if (!this.idleAsked && t - this.gateSince > TIMING.idleMs) {
            this.idleAsked = true;
            this.voice.say("Do you want to skip this one for today?");
          }
          return;
        }
        this.readySince ??= t;
        this.prompt = "";
        if (t - this.readySince < READY_HOLD_MS) return;
        this.readySince = null;
      }
      this.started = true;
      this.stepStart = t;
      this.lastMoveT = t;
      // A scored seated repetition is not instructed again (the countdown was its cue): its target arms now,
      // after at most a short cue ("Open your hand."). A hand-opening step restarted after the hand left is not
      // instructed again either: at most its short cue.
      const stepKey = `${this.phase}:${this.repNumber}:${this.stepIdx}`;
      if ((this.phase !== "reps" || !this.countdownReps()) && !(step.readyGate && this.instructedKey === stepKey)) {
        if (step.readyGate) this.instructedKey = stepKey;
        this.voice.say(this.chestStep(step) ? CHEST_STEP.voice : step.voice);
        return;
      }
      // The short cue, unless this same step said it moments ago (the hand dipped out of place and came back).
      const cueKey = stepKey;
      if (step.cue && !(this.lastCue?.key === cueKey && t - this.lastCue.t < CUE_REPEAT_MS)) {
        this.lastCue = { key: cueKey, t };
        this.voice.say(step.cue);
        return;
      }
    }
    if (this.waitForSpeech(t)) return;
    if (!this.armed) {
      this.armed = true;
      this.stepStart = t;
      this.lastMoveT = t;
    }
    // The movement check times each attempt from its target first arming (speech pausing it does not restart the time).
    if (this.assess) this.assessArmedAt ??= t;
    this.watchSpeed(step, t);

    // A close step the camera decides (the grasp around the drawn cup) is held like a movement step.
    if (step.kind === "return" || (step.kind === "close" && !step.contactStep)) return this.restFrame(frame, step, t, dt);

    // live attainment over this step's gate
    const gate = step.kind === "pinch" ? ["pinch_flexion"] : step.gate;
    let sumW = 0;
    let sum = 0;
    let moved = true;
    let progress = 0;
    for (const id of gate) {
      const rom = this.romById(id);
      const v = frame.values[rom.metric];
      const target = targets[id];
      const unit = metricUnit(rom.metric);
      sumW += rom.weight;
      sum += rom.weight * (usesTargetFlow(this.cfg.id) ? Math.min(1, reachAngleProgress(v, target, this.startingAngles()[rom.id] ?? (this.phase === "warm" ? 0 : NaN), unit)) : romAttainment(v, target));
      const need = Math.min(MIN_EXCURSION[rom.metric] ?? 0, 0.6 * Math.max(target - (this.rest[rom.metric] ?? 0), 3 * unit));
      const exc = this.excursion(rom.metric, v);
      if (need > 0 && exc < need) moved = false;
      progress = Math.max(progress, Math.max(0, exc) / Math.max(target - (this.rest[rom.metric] ?? 0), 3 * unit));
    }
    const a = sumW ? sum / sumW : 0;
    this.liveA = frame.targetProgress ?? a;
    if (this.assess) this.trackAttempt(frame, a);
    // A hand out of its shaded area (hand opening) is never on target, however open it is: it cannot hold the ring.
    // With no camera target and nothing to measure (the grasp and let-go in the no-camera simulator), a step passes.
    const zone = frame.placed === false ? false : frame.targetContact === undefined ? (gate.length ? a >= this.tuned.targetZone && moved : true) : frame.targetContact;
    const unsure = !zone && frame.targetUnsure === true;
    this.inZone = zone || unsure;
    if (progress > 0.15) this.lastMoveT = t;
    // Seated Knee Extension judges the other leg within each repetition, from where it rests as the knee starts to
    // straighten: a foot moved between repetitions is not the other leg helping. The toe lift likewise judges its own
    // knee's straightening (a kick) from where it rests as the toes start to lift.
    if ((this.cfg.id === KNEE_ID || this.cfg.id === TOE_ID) && this.stepIdx === 0 && this.ref && !this.touched && progress < 0.1) {
      const base = medianGeo(this.recent.slice(-5).map(recent => recent.geo).filter(Boolean) as Geo[]);
      if (base) this.ref = { ...this.ref, otherAnkleImgX: base.otherAnkleImgX ?? this.ref.otherAnkleImgX, otherAnkleImgY: base.otherAnkleImgY ?? this.ref.otherAnkleImgY, otherKnee: base.otherKnee ?? this.ref.otherKnee, otherToeImgY: base.otherToeImgY ?? this.ref.otherToeImgY, toeKnee: base.toeKnee ?? this.ref.toeKnee };
    }
    // The table slide likewise judges the other hand from where it rests as the slide starts (wherever the shoulder
    // settled after the last slide back).
    if (this.cfg.id === SLIDE_ID && this.stepIdx === 0) this.slideStart ??= progress;
    if (this.cfg.id === SLIDE_ID && this.stepIdx === 0 && this.ref && !this.touched && progress < Math.max(0.1, (this.slideStart ?? 0) + 0.1)) {
      const base = medianGeo(this.recent.slice(-5).map(recent => recent.geo).filter(Boolean) as Geo[]) as SlideGeo | null;
      const ref = this.ref as SlideGeo;
      if (base) this.ref = { ...ref, slideOtherX: base.slideOtherX ?? ref.slideOtherX, slideOtherY: base.slideOtherY ?? ref.slideOtherY } as Geo;
    }

    // rep-level peaks + compensation frames (movement frames only). Hand opening judges posture through the
    // whole opening step: the hand is held up from its start, and a hand that barely opens still has a posture.
    // A hand leaving the shaded area is not posture evidence, and it breaks a running stretch.
    if (frame.placed === false) { this.run.consec = {}; this.run.consecMs = {}; }
    else if (progress > 0.25 || frame.targetContact === true || this.cfg.id === "ex_handopen") this.recordFrame(frame, step, dt);

    // idle prompt: 20 s without movement (the movement check's attempts end on their own time instead)
    if (!this.assess && !this.idleAsked && t - this.lastMoveT > TIMING.idleMs) {
      this.idleAsked = true;
      this.voice.say("Do you want to skip this one for today?");
    } else if (this.idleAsked && t - this.lastMoveT < 1000) {
      this.idleAsked = false;
    }
    if (this.assess) this.encourage(t, zone || unsure);
    // A prompt can start in this very frame; it also disarms before any hold is counted.
    if (this.waitForSpeech(t)) return;

    const holdMs = this.holdMsFor(step, frame.targetContact !== undefined);
    const learningReach = this.phase === "warm" && usesTargetFlow(this.cfg.id) && !this.assess;
    if (learningReach && !unsure) {
      if (zone) this.reachTargetCalibration.observe(frame);
      else this.reachTargetCalibration.reset();
    }
    if (zone) {
      this.touched = true;
      this.lastContactT = t;
      this.holdAcc += dt;
      if (this.holdAcc >= holdMs) {
        if (learningReach) {
          const learned = this.reachTargetCalibration.capture();
          if (!learned) {
            this.holdAcc = 0;
            this.reachTargetCalibration.reset();
            this.nag(t, this.cfg.id === "ex_handopen" ? "Keep your fingers open at the ring and your whole hand in view while I learn your movement."
              : this.cfg.id === PINCH_ID ? "Keep your thumb and finger together in the circle and your whole hand in view while I learn your movement."
              : this.cfg.id === TOE_ID ? "Keep your toes up at the circle and your feet in view while I learn your movement." : this.cfg.id === KNEE_ID ? "Keep your knee straight at the circle and your feet in view while I learn your movement."
              : this.cfg.id === SLIDE_ID ? "Keep your hand at the cup and your arm in view while I learn your movement."
              : "Keep your hand in the circle and your whole arm in view while I learn your movement.");
            return;
          }
          // Steps that learn their own measures add them to what earlier steps of the practice learned.
          this.learnedReach = step.learn ? { ...(this.learnedReach ?? {}), ...this.sharedGoals(learned) } : this.sharedGoals(learned);
        }
        return this.completeMovement(t, "full");
      }
    } else if (unsure) {
      // Paused: neither counted nor reset until the hand is seen again or has left.
    } else if (step.contactStep) {
      // The grasp and the let-go have no arm angle to come back on: a lapse only restarts the hold, after a
      // short grace for a closed hand the tracker loses for a moment.
      if (t - this.lastContactT > CONTACT_GRACE_MS) this.holdAcc = 0;
    } else if (frame.targetContact !== undefined || a < TIMING.zoneExit || !moved) {
      // Touched, then the arm came most of the way back: the movement ends as touched (not held). The movement check
      // judges "back" against its level's target (the circle, ring or pinch drawn), not the exercise's angle goals.
      if (!learningReach && this.touched && this.holdAcc < holdMs && (this.assess ? frame.targetProgress ?? a : a) < 0.55) return this.completeMovement(t, "touched");
      this.holdAcc = 0;
    }
    // A step with its own time limit (the grasp and the let-go) moves on with partial credit instead of a miss,
    // touched or not, unless a hold is under way.
    if (step.timeoutMs !== undefined && t - this.stepStart > step.timeoutMs && this.holdAcc === 0) return this.completeMovement(t, "touched");
    // The movement check: not on target 20 s after the target armed, the attempt moves on to the return as a failure;
    // a hold under way (or paused while tracking catches up) is never cut.
    if (this.assess && this.assessArmedAt !== null && t - this.assessArmedAt >= ATTEMPT_TIMEOUT_MS && this.holdAcc === 0 && !zone && !unsure) return this.completeMovement(t, this.touched ? "touched" : "none");
    if (!this.touched && t - this.stepStart > TIMING.maxWaitMs) this.completeMovement(t, "none");
  }

  private recordFrame(frame: Frame, step: CycleStep, dt: number) {
    const run = this.run;
    for (const rom of this.cfg.romSteps) {
      const applies = rom.steps ? rom.steps.includes(this.stepIdx) : step.kind !== "return";
      if (!applies) continue;
      const v = frame.values[rom.metric];
      if (v === undefined) continue;
      if (usesTargetFlow(this.cfg.id) && this.learnedReach) {
        const start = this.rest[rom.metric];
        const goal = this.learnedReach[rom.id];
        const unit = metricUnit(rom.metric);
        if (run.peaks[rom.id] === undefined || reachAngleProgress(v, goal, start, unit) > reachAngleProgress(run.peaks[rom.id], goal, start, unit)) run.peaks[rom.id] = v;
      } else run.peaks[rom.id] = Math.max(run.peaks[rom.id] ?? -Infinity, v);
      run.peakExc[rom.id] = Math.max(run.peakExc[rom.id] ?? 0, this.excursion(rom.metric, v));
    }
    // Posture while the hand is still far from the mouth (settling back after the review, leaning in to the
    // screen) is not a compensation; once the hand has stayed away, it also breaks a running stretch.
    const postureCounts = this.cfg.id !== "ex_h2m" || frame.targetContact === true || frame.targetUnsure === true || (frame.targetProgress ?? 1) >= MOUTH_POSTURE_PROGRESS;
    if (postureCounts) { run.postureFrames += 1; run.postureGapMs = 0; } else run.postureGapMs += dt;
    const breakStretch = !postureCounts && run.postureGapMs >= MOUTH_POSTURE_GAP_MS;
    for (const comp of this.cfg.compensations) {
      if (comp.steps && !comp.steps.includes(this.stepIdx)) continue;
      if (!postureCounts) {
        if (breakStretch) { run.consec[comp.id] = 0; run.consecMs[comp.id] = 0; run.strongMs[comp.id] = 0; }
        continue;
      }
      const status = compensationStatus(frame.comps, comp);
      if (status.ratio === undefined) { run.consec[comp.id] = 0; run.consecMs[comp.id] = 0; run.strongMs[comp.id] = 0; continue; }
      if (comp.yieldsTo) {
        run.strongMs[comp.id] = status.ratio >= comp.yieldsTo.minRatio ? (run.strongMs[comp.id] ?? 0) + dt : 0;
        run.maxStrongMs[comp.id] = Math.max(run.maxStrongMs[comp.id] ?? 0, run.strongMs[comp.id]);
      }
      run.eligible[comp.id] = (run.eligible[comp.id] ?? 0) + 1;
      if (status.over) {
        run.over[comp.id] = (run.over[comp.id] ?? 0) + 1;
        run.consec[comp.id] = (run.consec[comp.id] ?? 0) + 1;
        run.maxConsec[comp.id] = Math.max(run.maxConsec[comp.id] ?? 0, run.consec[comp.id]);
        run.consecMs[comp.id] = (run.consecMs[comp.id] ?? 0) + dt;
        run.maxConsecMs[comp.id] = Math.max(run.maxConsecMs[comp.id] ?? 0, run.consecMs[comp.id]);
      } else { run.consec[comp.id] = 0; run.consecMs[comp.id] = 0; }
    }
  }

  private completeMovement(t: number, outcome: HoldOutcome) {
    this.run.holds.push(outcome);
    // The movement check: how long the movement took from its target arming. A missed attempt still goes back to
    // rest (the lap, the relax circle, letting go), so the next level never starts from a raised hand.
    if (this.assess) this.attemptMs = t - (this.assessArmedAt ?? t);
    if (outcome === "none" && !this.assess) {
      // Never reached: the rep ends here as a miss.
      this.run.ended = true;
      return this.finishRep(t);
    }
    this.advanceStep(t);
  }

  private advanceStep(t: number) {
    const steps = this.cycle();
    if (this.stepIdx + 1 >= steps.length) return this.finishRep(t);
    this.stepIdx += 1;
    this.startStep(t, steps[this.stepIdx].kind === "return" || (steps[this.stepIdx].kind === "close" && !steps[this.stepIdx].contactStep) ? 0 : 150);
  }

  /** Return and close steps: wait until the movement has been let go of, relative to this rep's own peak. */
  private restFrame(frame: Frame, step: CycleStep, t: number, dt: number) {
    const ids = step.kind === "close" ? ["hand_opening"] : Object.keys(this.run.peakExc);
    let relaxed = true;
    for (const id of ids) {
      const rom = this.romById(id);
      const peak = this.run.peakExc[id] ?? 0;
      const exc = this.excursion(rom.metric, frame.values[rom.metric]);
      if (peak > 0 && exc > TIMING.restFraction * peak) relaxed = false;
    }
    if (frame.targetContact !== undefined) relaxed = frame.targetContact;
    this.inZone = relaxed;
    if (relaxed) {
      this.restAcc += dt;
      this.holdAcc = this.restAcc;
    } else {
      this.restAcc = 0;
      this.holdAcc = 0;
    }
    // The lap circle holds exactly as long as the movement target; on angles a short relaxed pause is
    // enough, scaled by the same hold factor.
    const needed = frame.targetContact !== undefined ? this.holdMsFor(step, true) : Math.min(step.holdMs, 500) * this.tuned.holdFactor;
    if (this.restAcc >= needed || (frame.targetContact === undefined && t - this.stepStart > TIMING.returnMaxMs)) this.advanceStep(t);
  }

  // ---------- reps ----------

  private finishRep(t: number) {
    const run = this.run;
    const confirmed: string[] = [];
    for (const comp of this.cfg.compensations) {
      const eligible = run.eligible[comp.id] ?? 0;
      const over = run.over[comp.id] ?? 0;
      if (!eligible) continue;
      const ratioOk = over / eligible >= comp.minRatio;
      const sustained = over >= 24;
      const consecOk = (!comp.minConsecutive || (run.maxConsec[comp.id] ?? 0) >= comp.minConsecutive)
        && (!comp.minConsecutiveMs || (run.maxConsecMs[comp.id] ?? 0) >= comp.minConsecutiveMs);
      if (over >= comp.minFrames && consecOk && (ratioOk || sustained)) confirmed.push(comp.id);
    }
    // No double counting: a check that yields to another confirmed one (the head during a trunk lean) also
    // counts only when it stayed well beyond its threshold for its own sustained window.
    const compsHit = confirmed.filter(id => {
      const rule = this.cfg.compensations.find(comp => comp.id === id)!;
      return !rule.yieldsTo || !confirmed.includes(rule.yieldsTo.id) || (run.maxStrongMs[id] ?? 0) >= Math.max(rule.minConsecutiveMs ?? 0, 1);
    });
    const targets = this.targets();
    const starts = this.startingAngles();
    const roms = this.cfg.romSteps.map(rom => ({ id: rom.id, weight: rom.weight, target: targets[rom.id], start: usesTargetFlow(this.cfg.id) ? starts[rom.id] ?? NaN : undefined, unit: metricUnit(rom.metric) }));
    const att = usesTargetFlow(this.cfg.id)
      ? roms.reduce((sum, rom) => sum + rom.weight * Math.min(1, reachAngleProgress(run.peaks[rom.id], rom.target, rom.start!, rom.unit)), 0) / roms.reduce((sum, rom) => sum + rom.weight, 0)
      : attainment(roms, run.peaks);
    const hold: HoldOutcome = run.holds.length ? worst(run.holds) : "none";
    const score = repScore(att, hold, compsHit.length, this.tuned.oneCompensationPoints);

    if (this.phase === "warm") {
      if (this.assess) return this.endTryOut(t);
      if (usesTargetFlow(this.cfg.id) && !this.learnedReach) return this.beginWarm(t);
      // Pinch and Peg learns a goal for each finger: practice again until both are learned, rather than scoring a
      // finger on a goal it never showed (the practice pinch eases closer each time it is not reached).
      if (this.cfg.id === PINCH_ID && this.cycle().some(step => step.learn?.some(metric => !Number.isFinite(this.learnedReach![metric])))) return this.beginWarm(t);
      if (!usesTargetFlow(this.cfg.id)) this.relearnRest();
      return this.beginReps(t);
    }

    // A posture check is unmeasured when it could have counted but the camera could not see it; a hand that never
    // came near the mouth leaves hand-to-mouth posture with nothing to judge, not unmeasured.
    // A cup never held (the grasp ran out of time) has no tipping to judge either, and a knee that hardly
    // straightened (or a hand that hardly slid) leaves its posture checks with nothing to judge, not unmeasured.
    const unmeasured = this.cfg.compensations.filter(comp => (run.eligible[comp.id] ?? 0) < comp.minFrames && ((this.cfg.id !== "ex_h2m" && this.cfg.id !== KNEE_ID && this.cfg.id !== TOE_ID && this.cfg.id !== SLIDE_ID && this.cfg.id !== PINCH_ID) || run.postureFrames >= comp.minFrames)
      && !(this.cfg.id === "ex_grasp" && comp.id === "cup_tipping" && run.holds[GRASP_STEP.grasp] !== "full")
      // Fingers that rested already curled at set-up cannot show curling in: skipped, not a tracking gap.
      && !(this.cfg.id === PINCH_ID && comp.id === "mass_flexion" && !curlJudged(this.ref))).map(comp => comp.id);
    if (usesTargetFlow(this.cfg.id)) unmeasured.push(...roms.filter(rom => !Number.isFinite(rom.start) || !Number.isFinite(rom.target)).map(rom => rom.id));
    if (this.assess) return this.endAttempt(t, compsHit, unmeasured);
    const result: RepResult = { index: this.repNumber, rung: this.rung, attainment: att, hold, compensations: compsHit, score, good: !unmeasured.length && isGoodRep(att, hold, compsHit.length, this.tuned.goodRepShare), peaks: { ...run.peaks }, unmeasured, startingAngles: { ...starts }, targets: { ...targets } };
    this.reps = [...this.reps, result];
    if (!this.opts.reviewBetweenReps) this.sayFeedback(result);

    // rescue: two misses in a row drop one rung for the remaining reps
    this.missStreak = isMiss(att, this.tuned.targetZone) ? this.missStreak + 1 : 0;
    if (this.missStreak >= 2 && this.rung > 1 && this.reps.length < this.plannedReps) {
      this.rung = (this.rung - 1) as Rung;
      this.rescued = true;
      this.missStreak = 0;
      this.arrow = null;
      this.voice.say("Let's bring the target a little closer.");
    }

    if (this.opts.reviewBetweenReps) {
      const finalRep = this.reps.length >= this.plannedReps;
      this.review = "complete";
      this.reviewStarted = t;
      this.voice.stop();
      this.reviewAdvice = this.cfg.romSteps.filter(rom => usesTargetFlow(this.cfg.id) ? reachAngleProgress(run.peaks[rom.id], targets[rom.id], starts[rom.id], metricUnit(rom.metric)) < 1 : (run.peaks[rom.id] ?? 0) < targets[rom.id]).map(rom => ANGLE_ADVICE[this.cfg.id]?.[rom.id]?.review
        ?? (rom.id === "elbow_extension" ? ELBOW_ADVICE
        : rom.id === "shoulder_flexion" ? SHOULDER_ADVICE
        : moveFurtherLine(rom.label, finalRep)));
      for (const comp of compsHit) {
        const rule = this.cfg.feedback.find(rule => rule.comp === comp);
        if (rule) this.reviewAdvice.push(finalRep ? finalRepAdvice(rule.say) : rule.say);
      }
      if (unmeasured.length) this.reviewAdvice.push(this.cfg.id === "ex_handopen" || this.cfg.id === PINCH_ID ? handInViewLine(finalRep)
        : this.cfg.id === "ex_grasp" && unmeasured.every(id => GRASP_HAND_CHECKS.includes(id)) ? graspHandInViewLine(finalRep)
        : this.cfg.id === KNEE_ID || this.cfg.id === TOE_ID ? bodyInViewLine(finalRep)
        : this.cfg.id === SLIDE_ID && unmeasured.every(id => SLIDE_HAND_CHECKS.includes(id)) ? slideHandsInViewLine(finalRep)
        : keepInViewLine(finalRep));
      if (!this.reviewAdvice.length) this.reviewAdvice = [reachedTargetsLine(finalRep)];
      if (result.rung !== this.rung) this.reviewAdvice.push(CLOSER_TARGET_LINE);
      this.feedback = this.reviewAdvice.join(" ");
      // Spoken as separate short lines, each recorded once in Alira's voice.
      this.voice.say(repCompleteLine(this.repNumber));
      this.voice.say(repScoreLine(score));
      for (const advice of this.reviewAdvice) this.voice.say(advice);
      return;
    }
    if (this.reps.length >= this.plannedReps) return this.finish(t, false);
    this.prepareNextRep(t);
  }

  private prepareNextRep(t: number, pause: number = TIMING.pauseBetweenRepsMs) {
    this.nextRepNumber();
    this.cycleCache = cycleFor(this.opts.exerciseId, this.rung);
    this.run = freshRep();
    this.stepIdx = 0;
    this.startStep(t, pause);
  }

  /** After the warm rep: take today's resting positions from the last second of frames. */
  private relearnRest() {
    const tail = this.recent.slice(-15);
    if (tail.length < 8) return;
    const keys = new Set<string>();
    tail.forEach(f => Object.keys(f.values).forEach(k => keys.add(k)));
    keys.forEach(key => {
      const vals = tail.map(f => f.values[key]).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
      if (vals.length) this.rest[key] = vals[Math.floor(vals.length / 2)];
    });
    const geos = tail.map(f => f.geo).filter(Boolean) as Geo[];
    const ref = medianGeo(geos);
    if (ref) {
      this.ref = ref;
    }
  }

  /** One sentence after a rep: the first matching correction, else praise on every third rep, else nothing. */
  private sayFeedback(rep: RepResult) {
    this.arrow = null;
    let key: string | null = null;
    let text = "";
    // Seated movements name the angle that fell shortest (the reach and hand-to-mouth word it for their movement).
    const angleAdvice = ANGLE_ADVICE[this.cfg.id];
    if (angleAdvice) {
      const targets = this.targets();
      const short = this.cfg.romSteps.filter(rom => (rep.peaks[rom.id] ?? 0) < targets[rom.id] * 0.95)
        .sort((a, b) => (rep.peaks[a.id] ?? 0) / targets[a.id] - (rep.peaks[b.id] ?? 0) / targets[b.id]);
      const weakest = short[0];
      if (weakest && angleAdvice[weakest.id]) {
        key = weakest.id;
        text = angleAdvice[weakest.id].next;
      }
    }
    for (const rule of this.cfg.feedback) {
      if (key) break;
      if (rule.comp && rep.compensations.includes(rule.comp)) { key = rule.comp; text = rule.say; break; }
      if (rule.attainmentBelow !== undefined && rep.attainment < rule.attainmentBelow) { key = "short"; text = rule.say; break; }
    }
    if (key) {
      if (key === this.lastCorrection && !angleAdvice?.[key]) this.arrow = key; // second time: show the arrow, stay quiet
      else this.voice.say(text);
      this.lastCorrection = key;
      this.feedback = text;
      return;
    }
    this.lastCorrection = null;
    this.feedback = "";
    if (rep.index % 3 === 0) {
      this.voice.say(this.cfg.praise);
      this.feedback = this.cfg.praise;
    }
  }

  // ---------- beat 6: wrap ----------

  private finish(t: number, early: boolean) {
    if (this.assess) return this.finishAssessment(early);
    this.review = null;
    const scores = this.reps.map(r => r.score);
    const notAttempted = this.reps.length === 0;
    const counts: Record<string, number> = {};
    this.reps.forEach(r => r.compensations.forEach(id => (counts[id] = (counts[id] ?? 0) + 1)));
    const best = this.reps.reduce<number | null>((acc, r) => {
      const v = this.bestOf(r);
      return v === undefined ? acc : acc === null ? v : Math.max(acc, v);
    }, null);
    const good = this.reps.filter(r => r.good).length;
    const score = notAttempted ? null : sessionScore(scores, this.plannedReps, Boolean(this.opts.assisted));
    const bestUnits = this.romById(this.cfg.bestRomId)?.bestFromStart !== undefined ? "degrees" : metricUnitName(this.romById(this.cfg.bestRomId)?.metric ?? this.cfg.bestRomId);
    const wrap = notAttempted
      ? "No problem, we will skip this one for today."
      : `${cap(word(good))} of ${word(this.plannedReps)} good reps${best !== null ? `, your best ${this.cfg.bestLabel} was ${Math.round(best)} ${bestUnits}` : ""}, and you finished at level ${this.rung} of 3.`;
    this.record = {
      engine: EXERCISE_SCORE_VERSION,
      exercise_id: this.cfg.id,
      rung_start: this.rungStart,
      rung_end: this.rung,
      reps_planned: this.plannedReps,
      repetition_scores: scores,
      quality_reps: good,
      best_attainment: this.reps.reduce((m, r) => Math.max(m, r.attainment), 0),
      best_value: best,
      best_label: this.cfg.bestLabel,
      compensation_counts: counts,
      hold_pass_count: this.reps.filter(r => r.hold === "full").length,
      not_attempted: notAttempted,
      assisted: Boolean(this.opts.assisted),
      chair_back: Boolean(this.opts.chairBack),
      score,
      wrap,
      finished_at: new Date().toISOString(),
      adaptation: { version: ADAPTATION_VERSION, adapted: this.tuned.adapted, changed: { ...this.tuned.changed } },
    };
    this.phase = "done";
    this.prompt = "";
    this.idleAsked = false;
    // The summary is spoken as short lines; only "your best ... degrees" is generated live.
    if (!early || !notAttempted) {
      const spokenWrap = notAttempted ? [wrap] : [goodRepsLine(good, this.plannedReps), ...(best !== null ? [bestLine(this.cfg.bestLabel, best, bestUnits)] : []), finishedLevelLine(this.rung)];
      for (const line of spokenWrap) this.voice.say(line);
    }
    void t;
  }

  // ---------- the movement check (assessment mode) ----------

  /** The level being tried: the try-out's (the easiest) in the warm, the ladder's attempt in the levels, else -1. */
  private levelNow(): number {
    if (!this.ladder) return -1;
    if (this.phase === "warm") return 0;
    const step = this.ladder.step;
    return this.phase === "reps" && step.type === "attempt" ? step.level : -1;
  }

  /** Hand to mouth's chest level: its movement step is worded for the chest, not the cup at the mouth. */
  private chestStep(step: CycleStep): boolean {
    return this.assess !== null && this.cfg.id === "ex_h2m" && step.kind !== "return" && this.assessmentLevelId === "chest";
  }

  /** "Now try it once. It is not scored. Reach to the circle at chest height and hold, then return your hand to your lap." */
  private tryOutLine(): string {
    const ask = LEVEL_ASK[this.cfg.id] ?? "move to", say = this.assess?.levels[0]?.say ?? "the target";
    const palm = this.cfg.id === "ex_handopen" || this.cfg.id === PINCH_ID;
    return `${ASSESSMENT_LINES.tryOut} ${palm ? `Show me your palm in the shaded area. Then ${ask}` : cap(ask)} ${say} ${TRY_OUT_THEN[this.cfg.id] ?? "and hold."}`;
  }

  /** The countdown's line, naming the level coming up: "Next, reach to the circle overhead." */
  private levelLine(): string {
    const level = this.assess?.levels[Math.max(0, this.levelNow())];
    return `Next, ${LEVEL_ASK[this.cfg.id] ?? "move to"} ${level?.say ?? "the target"}.`;
  }

  /** The attempt's peak progress toward its target, and its measures' peaks, from the armed movement step's frames. */
  private trackAttempt(frame: Frame, a: number) {
    const progress = frame.targetProgress ?? a;
    if (Number.isFinite(progress)) this.attemptPeak = Math.max(this.attemptPeak, Math.max(0, Math.min(1, progress)));
    const measures = this.cfg.romSteps.filter(rom => !rom.steps || rom.steps.includes(this.stepIdx)).map(rom => [rom.id, rom.metric]);
    // Hand opening's rings are drawn in its openness (palm lengths), so that is its insight too.
    if (this.cfg.id === "ex_handopen") measures.push(["hand_openness", "hand_openness"]);
    for (const [id, metric] of measures) {
      const value = frame.values[metric];
      if (typeof value === "number" && Number.isFinite(value)) this.attemptValues[id] = Math.max(this.attemptValues[id] ?? -Infinity, value);
    }
  }

  /** Halfway through an attempt's time, one encouraging line: never over a hold under way (speech pauses the target). */
  private encourage(t: number, onTarget: boolean) {
    if (this.encouraged || this.assessArmedAt === null || t - this.assessArmedAt < ATTEMPT_ENCOURAGE_MS || this.holdAcc > 0 || onTarget) return;
    this.encouraged = true;
    this.voice.say(ASSESSMENT_LINES.encourage);
  }

  /** The try-out at the easiest level has ended, held or not: it learns no goal, so the levels follow at once. */
  private endTryOut(t: number) {
    this.tryOut = { completed: (this.run.holds.length ? worst(this.run.holds) : "none") === "full", peakProgress: this.attemptPeak };
    this.insightPeaks.push({ ...this.attemptValues });
    this.beginReps(t);
  }

  /**
   * One attempt at a level has ended. It is recorded with each posture check's status (detected as a repetition
   * confirms it, not measured where the camera could not judge it), the ladder decides what comes next, and the
   * review card says whether the level was reached, with the posture notes: never a score.
   */
  private endAttempt(t: number, compsHit: string[], unmeasured: string[]) {
    const now = this.ladder!.step;
    if (now.type !== "attempt") return;
    const hold: HoldOutcome = this.run.holds.length ? worst(this.run.holds) : "none";
    const level = this.assess!.levels[now.level];
    // A helper's supporting hand is a second hand at the arm or palm: on a helped attempt the other-hand check cannot tell
    // it from the patient's own, so there it is not measured and says nothing.
    const helperHand = (id: string) => now.assisted && id === OTHER_HAND_ARM.id;
    const hit = compsHit.filter(id => !helperHand(id));
    const compensations: Record<string, CompStatus> = Object.fromEntries(this.cfg.compensations.map(comp => [comp.id, helperHand(comp.id) ? "not_measured" : hit.includes(comp.id) ? "detected" : unmeasured.includes(comp.id) ? "not_measured" : "not_detected"]));
    const attempt: AttemptRecord = { level: now.level, levelId: level?.id ?? String(now.level), assist: now.assisted ? "helper" : null, completed: hold === "full", touched: hold === "touched", peakProgress: this.attemptPeak, compensations, durationMs: this.attemptMs };
    this.attempts = [...this.attempts, attempt];
    // The results' insights are the patient's own movement: a helped attempt's peaks are not theirs alone.
    if (!now.assisted) this.insightPeaks.push({ ...this.attemptValues });
    const next = this.ladder!.record(attempt.completed);
    const last = next.type === "done";
    // Each confirmed check's note in the exercise's words; a task's own check (the other hand) says its correction.
    const notes = hit.map(id => {
      const rule = this.cfg.compensations.find(comp => comp.id === id);
      const say = this.cfg.feedback.find(feedback => feedback.comp === id)?.say ?? `I noticed your ${rule?.label ?? "posture change"}. ${rule?.correction ?? ""}`.trim();
      return last ? finalRepAdvice(say) : say;
    });
    // Posture the camera could not judge during a real movement: how to stay in view (a hand that hardly moved has none).
    // The seated arm tasks' other-hand check needs the other hand and thigh, not the face and shoulders: its own line.
    const unseen = this.cfg.compensations.filter(comp => compensations[comp.id] === "not_measured" && !helperHand(comp.id));
    const otherArmUnseen = unseen.some(comp => comp.metric === OTHER_HAND_ARM.metric);
    if (attempt.peakProgress >= MOVEMENT_SEEN_PROGRESS && unseen.length > (otherArmUnseen ? 1 : 0)) notes.push(this.cfg.id === "ex_handopen" || this.cfg.id === PINCH_ID ? handInViewLine(last) : keepInViewLine(last));
    if (attempt.peakProgress >= MOVEMENT_SEEN_PROGRESS && otherArmUnseen) notes.push(OTHER_HAND_IN_VIEW);
    this.review = "complete";
    this.reviewStarted = t;
    this.voice.stop();
    this.reviewAdvice = [attempt.completed ? `${level?.label ?? "Level"} reached` : "Not this time", ...notes];
    this.feedback = notes.join(" ");
    this.voice.say(attempt.completed ? ASSESSMENT_LINES.reached : next.type === "attempt" ? ASSESSMENT_LINES.another : ASSESSMENT_LINES.hard);
    for (const note of notes) this.voice.say(note);
  }

  /** After an attempt's review: the next level's countdown, the offer of help (once), or the end of the task. */
  private afterAttemptReview(t: number) {
    const next = this.ladder!.step;
    if (next.type === "attempt") return this.startCountdown(t);
    if (next.type === "offer_help") {
      if (this.offer !== "help") { this.offer = "help"; this.voice.say(ASSESSMENT_LINES.offerHelp); }
      return;
    }
    this.finish(t, false);
  }

  /** The task's result for the movement check's scoring and results dashboard (assessment-engine/types.ts). */
  private assessmentResult(early: boolean): AssessmentTaskResult {
    const task = this.assess!, step = this.ladder!.step;
    const tryOut = this.tryOut ?? { completed: false, peakProgress: 0 };
    const insights: Record<string, number> = {};
    for (const peaks of this.insightPeaks) for (const [id, value] of Object.entries(peaks)) insights[id] = Math.max(insights[id] ?? -Infinity, value);
    return {
      taskId: task.taskId,
      exerciseId: this.cfg.id,
      levelIds: task.levels.map(level => level.id),
      startLevel: Math.max(0, Math.min(task.levels.length - 1, Math.round(task.startLevel))),
      tryOut: { ...tryOut },
      attempts: this.attempts.map(attempt => ({ ...attempt, compensations: { ...attempt.compensations } })),
      movementSeen: [tryOut.peakProgress, ...this.attempts.map(attempt => attempt.peakProgress)].some(peak => peak >= MOVEMENT_SEEN_PROGRESS),
      // Ended early (the patient chose to skip) with the ladder still going.
      stoppedBy: step.type === "done" ? step.stoppedBy : early ? "skipped" : "not_measured",
      measured: this.attempts.length > 0,
      side: this.opts.side,
      insights,
    };
  }

  /** The task's end: its result in the record (no score, no repetitions) and the closing line. */
  private finishAssessment(early: boolean) {
    this.review = null;
    this.offer = null;
    const result = this.assessmentResult(early);
    const counts: Record<string, number> = {};
    this.attempts.forEach(attempt => Object.entries(attempt.compensations).forEach(([id, status]) => { if (status === "detected") counts[id] = (counts[id] ?? 0) + 1; }));
    const skipped = early && !result.measured;
    this.record = {
      engine: EXERCISE_SCORE_VERSION,
      exercise_id: this.cfg.id,
      rung_start: this.rungStart,
      rung_end: this.rung,
      reps_planned: this.attempts.length,
      repetition_scores: [],
      quality_reps: 0,
      best_attainment: this.attempts.reduce((best, attempt) => Math.max(best, attempt.peakProgress), 0),
      best_value: null,
      best_label: this.cfg.bestLabel,
      compensation_counts: counts,
      hold_pass_count: this.attempts.filter(attempt => attempt.completed).length,
      not_attempted: !result.measured,
      assisted: this.attempts.some(attempt => attempt.assist !== null),
      chair_back: Boolean(this.opts.chairBack),
      score: null,
      wrap: skipped ? ASSESSMENT_LINES.skipped : ASSESSMENT_LINES.done,
      finished_at: new Date().toISOString(),
      assessment: result,
    };
    this.phase = "done";
    this.prompt = "";
    this.idleAsked = false;
    // Skipped before any attempt, nothing is said (as an exercise skipped before its first repetition).
    if (!skipped) this.voice.say(ASSESSMENT_LINES.done);
  }
}

// ---------- simulated patient (for testing without a camera) ----------

/** Resting values a simulated patient starts from. */
const SIM_REST: Record<string, number> = { shoulder_flexion: 8, elbow_extension: 100, elbow_flexion: 10, finger_extension: 105, pinch_flexion: 0, pinch_index: 30, pinch_middle: 30, knee_extension: 95, ankle_dorsiflexion: 0, toe_lift: -20, shoulder_abduction: 5 };

export type SimInput = {
  /** 0 = at rest, 1 = exactly on this rung's target. */
  level: number;
  /** Compensation metrics to push over their threshold. */
  compensations: string[];
  visible?: boolean;
};

export function simFrame(t: number, cfg: ExerciseConfig, targets: Record<string, number>, input: SimInput): Frame {
  const values: Frame["values"] = {};
  cfg.romSteps.forEach(rom => {
    const rest = SIM_REST[rom.metric] ?? 0;
    values[rom.metric] = rest + input.level * (targets[rom.id] - rest);
  });
  // Hand opening's ring follows how open the hand is (palm lengths, hand-target.ts): relaxed 0.6, open 1.15.
  if (cfg.id === "ex_handopen" || cfg.id === "ex_grasp") values.hand_openness = 0.6 + 0.55 * input.level;
  // Hand-to-mouth measures a simulated seated body with the camera code, so a simulated head lean is the
  // real head-forward signal (and not also a trunk lean). Other exercises set each measure directly.
  const comps: Frame["comps"] = cfg.id === "ex_h2m" ? simulatedMouthComps(input.level, input.compensations) : {};
  // A clean measure sits well under its limit (a limit under 4, such as the pinch's other hand at 1, gets a quarter of it).
  if (cfg.id !== "ex_h2m") cfg.compensations.forEach(comp => {
    comps[comp.metric] = input.compensations.includes(comp.id) ? comp.thresholdDeg + 6 : Math.min(1, comp.thresholdDeg / 4);
  });
  return { t, values, comps, visible: input.visible !== false, missing: input.visible === false ? "Sit in front of the camera so I can see you." : undefined,
    ...(usesTargetFlow(cfg.id) ? { lapRest: input.level <= 0.05 ? { x: 0.6, y: 0.8, bodyScale: 0.4 } : undefined, lapMissing: cfg.id === "ex_handopen" ? "Let your fingers relax, with your palm facing the camera." : cfg.id === PINCH_ID ? "Let your thumb rest a little away from your first finger." : cfg.id === TOE_ID ? "Rest your foot flat on the floor, heel down." : cfg.id === KNEE_ID ? "Rest your foot flat on the floor." : cfg.id === SLIDE_ID ? "Rest your forearm beside you." : "Lower your affected hand and rest it on your lap." } : {}),
    ...(cfg.id === "ex_h2m" ? { mouthPoint: { x: 0.5, y: 0.3 } } : {}) };
}

/** Sim: value a finger_extension-style metric takes at rest, for tests. */
export const simRest = (metric: string) => SIM_REST[metric] ?? 0;




