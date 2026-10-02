// The six-beat session script (section 2): set up, show me once, warm rep, scored reps, rescue, wrap.
// Frame-driven and free of DOM and speech APIs so it can run against camera frames, simulated frames
// or a test harness. Timing comes from frame.t.

import { bestLine, CLOSER_TARGET_LINE, ELBOW_ADVICE, finalRepAdvice, finishedLevelLine, goodRepsLine, keepInViewLine, moveFurtherLine, reachedTargetsLine, repCompleteLine, repsAheadLine, repScoreLine, SHOULDER_ADVICE, word, cap } from "./spoken";
import { cycleFor, REPS_BY_RUNG, resolveExercise, DOSE_PRESETS, LEVEL_BY_RUNG, usesSeatedTargets, type CycleStep, type ExerciseConfig, type Rung, type Side } from "./config";
import { compensationStatus, medianGeo, type Frame, type Geo, type LapRest } from "./metrics";
import { attainment, romAttainment, EXERCISE_SCORE_VERSION, isGoodRep, isMiss, repScore, sessionScore, type HoldOutcome } from "./scoring";
import { reachAngleProgress, ReachRestCalibration, ReachTargetCalibration } from "./calibration";
import { TARGET_HOLD_MS } from "./target-timing";
import { reachDemoDuration } from "./reach-demo";
import { mouthDemoDuration } from "./mouth-demo";
import { MouthCalibration, type MouthPoint } from "./mouth-target";
// Relative on purpose: engine files must also build where the @shared alias is not available.
import { ADAPTATION_VERSION, DEFAULT_EXERCISE_TUNING, tunedReps, type ExerciseTuning } from "../../../../shared/alira-adaptation";

export type Voice = { say(text: string): void; busy(t: number): boolean; stop(): void };
export type Phase = "setup" | "demo" | "warm" | "reps" | "done";

export type SessionOptions = {
  exerciseId: string;
  rung: Rung;
  side: Side;
  chairBack?: boolean;
  /** Quick test: fewer reps than the rung's 6 / 8 / 10. Wins over the tuned repetition count. */
  repsOverride?: number;
  assisted?: boolean;
  reviewBetweenReps?: boolean;
  /** Settings from Alira's learning, read once when the session starts. Omitted = the defaults. */
  tuning?: ExerciseTuning;
};

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
const MIN_EXCURSION: Record<string, number> = { shoulder_flexion: 15, elbow_extension: 20, elbow_flexion: 20, finger_extension: 20, knee_extension: 20, shoulder_abduction: 10, ankle_dorsiflexion: 3, pinch_flexion: 0 };


type RepRun = {
  peaks: Record<string, number>;
  peakExc: Record<string, number>;
  eligible: Record<string, number>;
  over: Record<string, number>;
  consec: Record<string, number>;
  maxConsec: Record<string, number>;
  consecMs: Record<string, number>;
  maxConsecMs: Record<string, number>;
  holds: HoldOutcome[];
  ended: boolean;
};

const freshRep = (): RepRun => ({ peaks: {}, peakExc: {}, eligible: {}, over: {}, consec: {}, maxConsec: {}, consecMs: {}, maxConsecMs: {}, holds: [], ended: false });
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
  private holdAcc = 0;
  private inZone = false;
  private liveA = 0;
  private restAcc = 0;
  private pauseUntil = 0;
  private started = false;
  private lastMoveT = 0;
  private idleAsked = false;
  private repNumber = 0;
  private reps: RepResult[] = [];
  private missStreak = 0;
  private rescued = false;
  private review: "complete" | "countdown" | null = null;
  private reviewStarted = 0;
  private reviewAdvice: string[] = [];
  private lastCorrection: string | null = null;
  private arrow: string | null = null;
  private feedback = "";
  private record: SessionRecord | null = null;
  private introSpokenAt = 0;
  private cycleCache: CycleStep[];
  private demoProgress = 0;
  private readonly tuned: ExerciseTuning;

  constructor(opts: SessionOptions, voice: Voice) {
    this.opts = opts;
    this.voice = voice;
    this.cfg = resolveExercise(opts.exerciseId, Boolean(opts.chairBack));
    if (this.cfg.id === "ex_h2m") {
      this.reachRestCalibration = new ReachRestCalibration(["shoulder_flexion", "elbow_flexion"]);
      this.reachTargetCalibration = new ReachTargetCalibration(["elbow_flexion", "shoulder_flexion"]);
    }
    // A frozen copy taken once: nothing changes mid-repetition, and later edits to the caller's object do not reach it.
    const tuning = opts.tuning ?? DEFAULT_EXERCISE_TUNING;
    this.tuned = Object.freeze({ ...tuning, changed: Object.freeze({ ...tuning.changed }) });
    this.rung = this.rungStart = opts.rung;
    // The planned count is fixed here; a rescue lowers the rung but never the number of repetitions.
    this.plannedReps = opts.repsOverride ?? tunedReps(REPS_BY_RUNG[opts.rung], this.tuned);
    this.cycleCache = cycleFor(opts.exerciseId, opts.rung);
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
    return Object.fromEntries(this.cfg.romSteps.map(rom => {
      return [rom.id, usesSeatedTargets(this.cfg.id) ? this.learnedReach?.[rom.id] ?? rom.targets.easy : rom.targets[level]];
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
      this.reachRestCalibration = new ReachRestCalibration(this.cfg.id === "ex_h2m" ? ["shoulder_flexion", "elbow_flexion"] : undefined);
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
    const calibrationProgress = this.phase !== "setup" ? 1 : usesSeatedTargets(this.cfg.id) ? this.reachCalibrationProgress : this.visibleSince === null ? 0 : Math.min(1, (this.lastT - this.visibleSince) / TIMING.stableMs);
    return {
      phase: this.phase,
      beat,
      rung: this.rung,
      rungStart: this.rungStart,
      repIndex: this.phase === "warm" ? 0 : this.repNumber,
      repsPlanned: this.plannedReps,
      stepIndex: this.stepIdx,
      stepCount: cycleLen,
      caption: this.phase === "demo" && this.demoStepIndex >= 0 ? this.cycle()[this.demoStepIndex]?.caption ?? "" : step?.caption ?? "",
      kind: step?.kind ?? null,
      liveAttainment: this.liveA,
      inZone: this.inZone,
      targetArmed: !this.review && !this.voice.busy(this.lastT) && (this.phase === "demo" ? this.demoMotionStarted : (this.phase === "warm" || this.phase === "reps") && this.armed),
      holdProgress: step && step.holdMs ? Math.min(1, this.holdAcc / this.holdMsFor(step, usesSeatedTargets(this.cfg.id) && this.recent[this.recent.length - 1]?.targetContact !== undefined)) : 0,
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
      countdownProgress: this.review === "countdown" ? Math.min(1, (this.lastT - this.reviewStarted) / 3000) : 0,
    };
  }

  // ---------- frame loop ----------

  push(frame: Frame) {
    const t = frame.t;
    const dt = Math.min(100, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (this.review) {
      if (this.review === "complete" && t - this.reviewStarted >= 1200 && !this.voice.busy(t)) {
        if (this.reps.length >= this.plannedReps) {
          this.review = null;
          return this.finish(t, false);
        }
        this.review = "countdown";
        this.reviewStarted = t;
        this.voice.say("The next repetition starts in three seconds.");
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
    // warm + reps
    if (!frame.visible) {
      this.run.consec = {};
      this.run.consecMs = {};
      if (usesSeatedTargets(this.cfg.id)) { this.holdAcc = 0; this.restAcc = 0; this.inZone = false; if (this.phase === "warm") this.reachTargetCalibration.reset(); }
      if (this.lostSince === null) this.lostSince = t;
      if (t - this.lostSince > TIMING.lostMs) this.nag(t, this.cfg.id === "ex_reach" ? "Bring your affected hand back into view." : frame.missing ?? "I can't see you. Move back into view of the camera.");
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
    if (usesSeatedTargets(this.cfg.id)) {
      const learned = this.reachRestCalibration.observe(frame, TIMING.stableMs);
      const mouth = this.cfg.id === "ex_h2m" ? this.mouthCalibration.observe(frame) : null;
      this.reachCalibrationProgress = learned.progress;
      if (!frame.visible || !frame.lapRest) {
        const missing = frame.missing ?? frame.lapMissing ?? `Rest your ${this.opts.side} hand on the visible top of your ${this.opts.side} thigh.`;
        if (!this.voice.busy(t)) this.nag(t, missing); else this.prompt = missing;
      } else this.prompt = this.cfg.id === "ex_h2m" && !mouth ? "Keep your face in view and your hand on your lap while I learn the mouth target." : "Keep your arm relaxed with your hand on your lap while I learn your starting position.";
      if (learned.ready && (this.cfg.id !== "ex_h2m" || mouth) && (!this.voice.busy(t) || (this.cfg.id !== "ex_h2m" && t - this.introSpokenAt > 12000))) {
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
    const steps = this.cycle();
    // Pinch demos show a single opposition so the demo stays short.
    const list = this.cfg.id === "ex_pinch" ? steps.slice(0, 2) : steps;
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
    const duration = this.cfg.id === "ex_reach" ? reachDemoDuration(list[this.demoStepIndex].kind === "return") : this.cfg.id === "ex_h2m" ? mouthDemoDuration(list[this.demoStepIndex].kind === "return") : TIMING.demoStepMs;
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
    this.voice.say(this.cfg.id === "ex_reach" ? "Now one practice repetition. It is not scored. Reach to the circle and hold while I learn your movement, then return to your lap." : this.cfg.id === "ex_h2m" ? "Now one practice repetition. It is not scored. Bring your hand to the mouth circle and hold while I learn your movement, then return to your lap." : "Now one practice repetition. It is not scored, and it helps me learn your starting position.");
    this.resetRep(t);
  }

  private beginReps(t: number) {
    this.phase = "reps";
    this.calibratedStart = { ...this.startingAngles() };
    const targets = this.targets();
    this.targetsReady = this.cfg.romSteps.every(rom => Number.isFinite(this.calibratedStart![rom.id]) && (!usesSeatedTargets(this.cfg.id) || (this.learnedReach !== null && Number.isFinite(targets[rom.id]))));
    this.repNumber = this.reps.length;
    this.prompt = "";
    this.voice.say(repsAheadLine(this.plannedReps));
    this.resetRep(t);
    this.nextRepNumber();
  }

  private nextRepNumber() {
    this.repNumber += 1;
  }

  private resetRep(t: number) {
    this.run = freshRep();
    this.stepIdx = 0;
    this.startStep(t, 1200);
    this.cycleCache = cycleFor(this.opts.exerciseId, this.rung);
  }

  private startStep(t: number, pause = 0) {
    this.stepStart = t;
    this.armed = false;
    this.started = false;
    this.touched = false;
    this.holdAcc = 0;
    this.restAcc = 0;
    this.inZone = false;
    this.liveA = 0;
    this.pauseUntil = t + pause;
    this.lastMoveT = t;
    this.idleAsked = false;
  }

  private romById(id: string) {
    return this.cfg.romSteps.find(rom => rom.id === id)!;
  }

  private excursion(metric: string, value: number | undefined): number {
    return value === undefined ? 0 : value - (this.rest[metric] ?? 0);
  }

  private waitForSpeech(t: number): boolean {
    if (!this.voice.busy(t)) return false;
    this.armed = false;
    this.holdAcc = this.restAcc = this.liveA = 0;
    if (this.phase === "warm" && usesSeatedTargets(this.cfg.id)) this.reachTargetCalibration.reset();
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
      this.started = true;
      this.stepStart = t;
      this.lastMoveT = t;
      this.voice.say(step.voice);
      return;
    }
    if (this.waitForSpeech(t)) return;
    if (!this.armed) {
      this.armed = true;
      this.stepStart = t;
      this.lastMoveT = t;
    }

    if (step.kind === "return" || step.kind === "close") return this.restFrame(frame, step, t, dt);

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
      sumW += rom.weight;
      sum += rom.weight * (usesSeatedTargets(this.cfg.id) ? Math.min(1, reachAngleProgress(v, target, this.startingAngles()[rom.id] ?? (this.phase === "warm" ? 0 : NaN))) : romAttainment(v, target));
      const need = Math.min(MIN_EXCURSION[rom.metric] ?? 0, 0.6 * Math.max(target - (this.rest[rom.metric] ?? 0), 3));
      const exc = this.excursion(rom.metric, v);
      if (need > 0 && exc < need) moved = false;
      progress = Math.max(progress, Math.max(0, exc) / Math.max(target - (this.rest[rom.metric] ?? 0), 3));
    }
    const a = sumW ? sum / sumW : 0;
    this.liveA = frame.targetProgress ?? a;
    const zone = frame.targetContact === undefined ? a >= this.tuned.targetZone && moved : frame.targetContact;
    this.inZone = zone;
    if (progress > 0.15) this.lastMoveT = t;

    // rep-level peaks + compensation frames (movement frames only)
    if (progress > 0.25 || frame.targetContact === true) this.recordFrame(frame, step, dt);

    // idle prompt: 20 s without movement
    if (!this.idleAsked && t - this.lastMoveT > TIMING.idleMs) {
      this.idleAsked = true;
      this.voice.say("Do you want to skip this one for today?");
    } else if (this.idleAsked && t - this.lastMoveT < 1000) {
      this.idleAsked = false;
    }
    // A prompt can start in this very frame; it also disarms before any hold is counted.
    if (this.waitForSpeech(t)) return;

    const holdMs = this.holdMsFor(step, frame.targetContact !== undefined);
    const learningReach = this.phase === "warm" && usesSeatedTargets(this.cfg.id);
    if (learningReach) {
      if (zone) this.reachTargetCalibration.observe(frame);
      else this.reachTargetCalibration.reset();
    }
    if (zone) {
      this.touched = true;
      this.holdAcc += dt;
      if (this.holdAcc >= holdMs) {
        if (learningReach) {
          const learned = this.reachTargetCalibration.capture();
          if (!learned) {
            this.holdAcc = 0;
            this.reachTargetCalibration.reset();
            this.nag(t, "Keep your hand in the circle and your whole arm in view while I learn your movement.");
            return;
          }
          this.learnedReach = learned;
        }
        return this.completeMovement(t, "full");
      }
    } else if (frame.targetContact !== undefined || a < TIMING.zoneExit || !moved) {
      if (this.cfg.id !== "ex_h2m" && !learningReach && this.touched && this.holdAcc < holdMs && a < 0.55) return this.completeMovement(t, "touched");
      this.holdAcc = 0;
    }
    if (!this.touched && t - this.stepStart > TIMING.maxWaitMs) this.completeMovement(t, "none");
  }

  private recordFrame(frame: Frame, step: CycleStep, dt: number) {
    const run = this.run;
    for (const rom of this.cfg.romSteps) {
      const applies = rom.steps ? rom.steps.includes(this.stepIdx) : step.kind !== "return";
      if (!applies) continue;
      const v = frame.values[rom.metric];
      if (v === undefined) continue;
      if (usesSeatedTargets(this.cfg.id) && this.learnedReach) {
        const start = this.rest[rom.metric];
        const goal = this.learnedReach[rom.id];
        if (run.peaks[rom.id] === undefined || reachAngleProgress(v, goal, start) > reachAngleProgress(run.peaks[rom.id], goal, start)) run.peaks[rom.id] = v;
      } else run.peaks[rom.id] = Math.max(run.peaks[rom.id] ?? -Infinity, v);
      run.peakExc[rom.id] = Math.max(run.peakExc[rom.id] ?? 0, this.excursion(rom.metric, v));
    }
    for (const comp of this.cfg.compensations) {
      if (comp.steps && !comp.steps.includes(this.stepIdx)) continue;
      const status = compensationStatus(frame.comps, comp);
      if (status.ratio === undefined) { run.consec[comp.id] = 0; run.consecMs[comp.id] = 0; continue; }
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
    if (outcome === "none") {
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
    this.startStep(t, steps[this.stepIdx].kind === "return" || steps[this.stepIdx].kind === "close" ? 0 : 150);
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
    const compsHit: string[] = [];
    for (const comp of this.cfg.compensations) {
      const eligible = run.eligible[comp.id] ?? 0;
      const over = run.over[comp.id] ?? 0;
      if (!eligible) continue;
      const ratioOk = over / eligible >= comp.minRatio;
      const sustained = over >= 24;
      const consecOk = (!comp.minConsecutive || (run.maxConsec[comp.id] ?? 0) >= comp.minConsecutive)
        && (!comp.minConsecutiveMs || (run.maxConsecMs[comp.id] ?? 0) >= comp.minConsecutiveMs);
      if (over >= comp.minFrames && consecOk && (ratioOk || sustained)) compsHit.push(comp.id);
    }
    const targets = this.targets();
    const starts = this.startingAngles();
    const roms = this.cfg.romSteps.map(rom => ({ id: rom.id, weight: rom.weight, target: targets[rom.id], start: usesSeatedTargets(this.cfg.id) ? starts[rom.id] ?? NaN : undefined }));
    const att = usesSeatedTargets(this.cfg.id)
      ? roms.reduce((sum, rom) => sum + rom.weight * Math.min(1, reachAngleProgress(run.peaks[rom.id], rom.target, rom.start!)), 0) / roms.reduce((sum, rom) => sum + rom.weight, 0)
      : attainment(roms, run.peaks);
    const hold: HoldOutcome = run.holds.length ? worst(run.holds) : "none";
    const score = repScore(att, hold, compsHit.length, this.tuned.oneCompensationPoints);

    if (this.phase === "warm") {
      if (usesSeatedTargets(this.cfg.id) && !this.learnedReach) return this.beginWarm(t);
      if (!usesSeatedTargets(this.cfg.id)) this.relearnRest();
      return this.beginReps(t);
    }

    const unmeasured = this.cfg.compensations.filter(comp => (run.eligible[comp.id] ?? 0) < comp.minFrames).map(comp => comp.id);
    if (usesSeatedTargets(this.cfg.id)) unmeasured.push(...roms.filter(rom => !Number.isFinite(rom.start) || !Number.isFinite(rom.target)).map(rom => rom.id));
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
      this.reviewAdvice = this.cfg.romSteps.filter(rom => usesSeatedTargets(this.cfg.id) ? reachAngleProgress(run.peaks[rom.id], targets[rom.id], starts[rom.id]) < 1 : (run.peaks[rom.id] ?? 0) < targets[rom.id]).map(rom => rom.id === "elbow_extension"
        ? ELBOW_ADVICE
        : rom.id === "shoulder_flexion" ? SHOULDER_ADVICE
        : moveFurtherLine(rom.label, finalRep));
      for (const comp of compsHit) {
        const rule = this.cfg.feedback.find(rule => rule.comp === comp);
        if (rule) this.reviewAdvice.push(finalRep ? finalRepAdvice(rule.say) : rule.say);
      }
      if (unmeasured.length) this.reviewAdvice.push(keepInViewLine(finalRep));
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
    if (this.cfg.id === "ex_reach") {
      const targets = this.targets();
      const short = this.cfg.romSteps.filter(rom => (rep.peaks[rom.id] ?? 0) < targets[rom.id] * 0.95)
        .sort((a, b) => (rep.peaks[a.id] ?? 0) / targets[a.id] - (rep.peaks[b.id] ?? 0) / targets[b.id]);
      const weakest = short[0];
      if (weakest?.id === "elbow_extension") {
        key = "elbow_extension";
        text = "On the next repetition, straighten your elbow a little more as you reach toward the circle.";
      } else if (weakest?.id === "shoulder_flexion") {
        key = "shoulder_flexion";
        text = "On the next repetition, lift your arm a little more from your shoulder while keeping your chest upright.";
      }
    }
    for (const rule of this.cfg.feedback) {
      if (key) break;
      if (rule.comp && rep.compensations.includes(rule.comp)) { key = rule.comp; text = rule.say; break; }
      if (rule.attainmentBelow !== undefined && rep.attainment < rule.attainmentBelow) { key = "short"; text = rule.say; break; }
    }
    if (key) {
      if (key === this.lastCorrection && key !== "elbow_extension" && key !== "shoulder_flexion") this.arrow = key; // second time: show the arrow, stay quiet
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
    this.review = null;
    const scores = this.reps.map(r => r.score);
    const notAttempted = this.reps.length === 0;
    const counts: Record<string, number> = {};
    this.reps.forEach(r => r.compensations.forEach(id => (counts[id] = (counts[id] ?? 0) + 1)));
    const best = this.reps.reduce<number | null>((acc, r) => {
      const v = r.peaks[this.cfg.bestRomId];
      return v === undefined ? acc : acc === null ? v : Math.max(acc, v);
    }, null);
    const good = this.reps.filter(r => r.good).length;
    const score = notAttempted ? null : sessionScore(scores, this.plannedReps, Boolean(this.opts.assisted));
    const wrap = notAttempted
      ? "No problem, we will skip this one for today."
      : `${cap(word(good))} of ${word(this.plannedReps)} good reps${best !== null ? `, your best ${this.cfg.bestLabel} was ${Math.round(best)} degrees` : ""}, and you finished at level ${this.rung} of 3.`;
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
      const spokenWrap = notAttempted ? [wrap] : [goodRepsLine(good, this.plannedReps), ...(best !== null ? [bestLine(this.cfg.bestLabel, best)] : []), finishedLevelLine(this.rung)];
      for (const line of spokenWrap) this.voice.say(line);
    }
    void t;
  }
}

// ---------- simulated patient (for testing without a camera) ----------

/** Resting values a simulated patient starts from. */
const SIM_REST: Record<string, number> = { shoulder_flexion: 8, elbow_extension: 100, elbow_flexion: 10, finger_extension: 105, pinch_flexion: 0, knee_extension: 95, ankle_dorsiflexion: 0, shoulder_abduction: 5 };

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
  const comps: Frame["comps"] = {};
  cfg.compensations.forEach(comp => {
    comps[comp.metric] = input.compensations.includes(comp.id) ? comp.thresholdDeg + 6 : 1;
  });
  return { t, values, comps, visible: input.visible !== false, missing: input.visible === false ? "Sit in front of the camera so I can see you." : undefined,
    ...(usesSeatedTargets(cfg.id) ? { lapRest: input.level <= 0.05 ? { x: 0.6, y: 0.8, bodyScale: 0.4 } : undefined, lapMissing: "Lower your affected hand and rest it on your lap." } : {}),
    ...(cfg.id === "ex_h2m" ? { mouthPoint: { x: 0.5, y: 0.3 } } : {}) };
}

/** Sim: value a finger_extension-style metric takes at rest, for tests. */
export const simRest = (metric: string) => SIM_REST[metric] ?? 0;




