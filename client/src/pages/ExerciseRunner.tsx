import { drawTestingTarget, drawTargetCompletion } from "@/lib/exercise-engine/target-visual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useRoute, useSearch } from "wouter";
import { ArrowLeft, Camera, Check, Eye, Footprints, Hand, LoaderCircle, Mic, MicOff, Play, RotateCcw, SkipForward, Sparkles } from "lucide-react";
import { useSettings } from "@/components/AccountSettings";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { buildRung, EVERYDAY_EXERCISE_ID, EXERCISES, DOMAIN_LABEL, LEVEL_BY_RUNG, resolveExercise, usesSeatedTargets, usesTargetFlow, type Rung, type Side } from "@/lib/exercise-engine/config";
import { metricUnit, metricUnitName, reachAngleProgress } from "@/lib/exercise-engine/calibration";
import { EXERCISE_PREVIEW_SCREENS, exercisePreviewScreen, exerciseScreenPreview, type ExercisePreviewScreen } from "@/lib/exercise-engine/screen-preview";
import { TARGET_HOLD_MS } from "@/lib/exercise-engine/target-timing";
import { drawGhost, reachGhostPose, mouthGhostPose } from "@/lib/exercise-engine/ghost";
import { drawReachDemo, reachDemoState, reachGhostTarget } from "@/lib/exercise-engine/reach-demo";
import { drawMouthDemo, mouthDemoState, mouthGhostTarget } from "@/lib/exercise-engine/mouth-demo";
import { mouthContact, mouthContactPoints, observedMouth, mouthCompensations } from "@/lib/exercise-engine/mouth-target";
import { MouthHold, type MouthHoldResult } from "@/lib/exercise-engine/mouth-hold";
import { CupTrack } from "@/lib/exercise-engine/cup-track";
import { affectedHand, drawHandDemo, drawHandZone, drawRingLabel, followZone, handCovers, handDemoState, handGhostContact, handGhostTarget, handOpenFrame, handOpenness, handRingTarget, handZone, inHandZone, palmFacing, palmRing, REST_OPEN_MAX, startLimit, waiveLimit, type HandZone } from "@/lib/exercise-engine/hand-target";
import { CupCarry, drawCup, drawGraspDemo, drawGraspGhost, followLayout, graspDemoState, GRASP_STEP, graspFrame, graspGhostContact, graspGhostTarget, graspHand, graspLapRadius, graspLayout, graspPoint, graspRings, graspTarget, type GraspLayout } from "@/lib/exercise-engine/grasp-target";
import { dialCircle, drawKneeDemo, drawKneeDial, drawKneeGuide, drawKneeScene, followDial, KNEE_STEP, kneeDemoState, kneeDial, kneeFrame, kneeGhostContact, kneeGhostTarget, kneeGuide, kneePracticeGoal, kneeRestCheck, KneeTarget, type KneeDial } from "@/lib/exercise-engine/knee-target";
import { drawToeDemo, drawToeDial, drawToeGuide, drawToeScene, TOE_STEP, toeDemoState, toeDialCircle, toeFrame, toeGhostContact, toeGhostTarget, toeGuide, ToeLiftFilter, toePracticeGoal, toeRestCheck, ToeTarget } from "@/lib/exercise-engine/toe-target";
import { drawSlideDemo, drawSlideGhost, drawSlideTargets, restCircle, SLIDE_PRACTICE_SPANS, SLIDE_RISE, SLIDE_STEP, slideCanvasCircle, slideDemoState, slideFrame, slideGhostContact, slideGhostTarget, slideOutward, slideRestCheck, slideRestOn, slideRestPrompt, SlideTarget, type SlideSupport } from "@/lib/exercise-engine/slide-target";
import { drawPeg, drawPegTray, drawPinchDemo, drawPinchGhost, gapOf, imageGap, pegsDropped, pinchCircle, pinchDemoState, PINCH_FINGERS, pinchFinger, pinchFrame, pinchGap, pinchGhostContact, pinchGhostTarget, pinchHand, pinchPracticeGoal, PinchTarget, startGap, tipAlong, TOUCH_CLOSURE, trayPoint, type PinchStep } from "@/lib/exercise-engine/pinch-target";
import { LightingProbe, type Lighting } from "@/lib/exercise-engine/lighting";
import { TARGET_COMPLETION_MS } from "@/lib/exercise-engine/target-timing";
import { NEXT_REP_COUNTDOWN_LINE } from "@/lib/exercise-engine/spoken";
import { compensationStatus, HAND_LINES, POSE_LINES, handFrameValues, handVisible, inView, POSE_NEEDS, poseFrameValues, poseJoints, poseVisibility, reachLapRest, type Frame } from "@/lib/exercise-engine/metrics";
import { ExerciseSession, simFrame, type Snapshot } from "@/lib/exercise-engine/session";
import { chooseHand, createTracker, openCamera, type Detection, type Tracker } from "@/lib/exercise-engine/tracker";
import { createVoice, type RunnerVoice } from "@/lib/exercise-engine/voice";
import { readLabOptions, saveLabSession, writeLabOptions, type LabOptions } from "@/lib/exercise-engine/lab-storage";
import { recordExerciseResult } from "@/lib/journey";
import { administrativeControlsEnabled } from "@/lib/administrative-controls";
import { loadRememberedAssessment } from "@/lib/assessment";
import { exerciseCompletionPath, loadExerciseCompletion } from "@/lib/exercise-completion";
import { beginDebugVideos, DebugVideoRecorder, type DebugClip, type DebugVideoSession } from "@/lib/exercise-engine/debug-video";
import { loadExerciseTuning, saveReport } from "@/lib/alira-learning-store";
import { startLearning } from "@/lib/alira-learning-client";
import { tunedReps, type ExerciseTuning, type FeltReport, type PainReport } from "@shared/alira-adaptation";
import "./exercise-engine.css";

const BEATS = ["Set up", "Show me", "Warm rep", "Scored reps", "Rescue", "Wrap"];
const LEVEL_LABEL: Record<Rung, string> = { 1: "Easy", 2: "Medium", 3: "Difficult" };
type Stage = "intro" | "loading" | "run" | "error";
type AutoMode = "off" | "good" | "short" | "leaning" | "weak";
const AUTO_LEVEL: Record<Exclude<AutoMode, "off">, number> = { good: 1, short: 0.82, leaning: 1, weak: 0.45 };

type BodyCheck = { id: string; label: string; visible: boolean; progress: number; hint: string };

type Live = { label: string; value: number | undefined; target: number; start: number; unit: string; scale?: number; units?: string }[];
type CompLive = { label: string; value: number | undefined; limit: number }[];

// The target flow's demonstration, its states and the simulator's target, for each exercise that uses it.
// (Supported Arm Elevation draws its own, for the patient's side and support: see its SLIDE_ID branches.)
const ghostTargetFor = (id: string) => (id === "ex_h2m" ? mouthGhostTarget : id === "ex_handopen" ? handGhostTarget : id === KNEE_ID ? kneeGhostTarget : id === TOE_ID ? toeGhostTarget : reachGhostTarget);
const drawDemoFor = (id: string) => (id === "ex_h2m" ? drawMouthDemo : id === "ex_handopen" ? drawHandDemo : id === KNEE_ID ? drawKneeDemo : id === TOE_ID ? drawToeDemo : drawReachDemo);
const demoStateFor = (id: string) => (id === "ex_h2m" ? mouthDemoState : id === "ex_handopen" ? handDemoState : id === KNEE_ID ? kneeDemoState : id === TOE_ID ? toeDemoState : reachDemoState);
/** Hand opening's rings follow the palm, steadied so landmark jitter does not shake them. */
const RING_FOLLOW = 0.35;
/** Grasp and transport: each step's label beside its circle, and the step names in the coach card. */
const GRASP_LABELS = ["Cup", "Grasp", "Across", "Let go", "Lap"];
const GRASP_STEPS = ["Reach & open", "Grasp", "Carry", "Let go", "Back"];
const GRASP_HINTS = ["Reach to the cup, opening your hand", "Close your hand around the cup and hold", "Carry the cup across to the other circle", "Open your hand to let go of the cup", "Bring your hand back to the lap circle and pause"];
const GRASP_HAND_HINT = "Rest your hand on your thigh where the camera can see your whole hand.";
/** Seated Knee Extension: the knee dial's circle labels and the step names in the coach card. */
const KNEE_ID = "ex_lower_selective";
const KNEE_LABELS = ["Straighten", "Foot down"];
const KNEE_STEPS = ["Straighten", "Lower"];
/** Seated Toe Lift: the ankle dial's circle labels and the step names in the coach card (toe-target.ts). */
const TOE_ID = "ex_ankle_dorsiflexion";
const TOE_LABELS = ["Lift", "Toes down"];
const TOE_STEPS = ["Lift toes", "Lower"];
/** The knee dial sits beside the affected shoulder: set-up waits for room for it there. */
const KNEE_DIAL_HINT = "Move the camera back a little, or sit nearer the middle of the picture, so there is space beside your shoulder.";
/** Supported Arm Elevation (a table slide): the slide dial's circle labels and the step names in the coach card. */
const SLIDE_ID = "ex_wallslide";
const SLIDE_LABELS = ["Cup", "Rest"];
const SLIDE_STEPS = ["Out to the cup", "Back to rest"];
type SlideCircle = { x: number; y: number; radius: number };
/** Pinch and Peg: the steps in the coach card (the palm first, then each finger's pinch and let-go). */
const PINCH_ID = "ex_pinch";
const PINCH_STEPS = ["Palm ready", "First finger", "Let go", "Middle finger", "Let go"];
/** A cycle step as the pinch's demonstration and drawing see it: its finger, whether it lets go, and its place. */
const pinchStepOf = (cycle: { kind: string; finger?: number }[], index: number): PinchStep => {
  const at = Math.max(0, index), step = cycle[at];
  // A let-go step lets go of the finger the step before it pinched.
  const finger = step?.kind === "return" ? cycle[at - 1]?.finger : step?.finger;
  return { finger: pinchFinger(finger), letGo: step?.kind === "return", index: at };
};

export default function ExerciseRunner() {
  const [, params] = useRoute("/exercise/:id");
  const search = useSearch();
  const [, navigate] = useLocation();
  const openSettings = useSettings();
  const exerciseId = params?.id ?? "";
  const base = EXERCISES[exerciseId];
  // Opened from the Journey's "Start today's session": the score goes to the Journey and so does the way back.
  const fromJourney = new URLSearchParams(search).get("from") === "journey";

  const initial = useMemo(() => {
    const q = new URLSearchParams(search);
    const saved = readLabOptions();
    const rung = Number(q.get("rung"));
    return {
      ...saved,
      rung: (usesTargetFlow(exerciseId) ? 1 : [1, 2, 3].includes(rung) ? rung : 2) as Rung,
      side: (q.get("side") === "left" ? "left" : q.get("side") === "right" ? "right" : saved.side) as Side,
      quick: q.has("quick") ? q.get("quick") === "1" : saved.quick,
      sim: q.has("sim") ? q.get("sim") === "1" : saved.sim,
      chairBack: q.has("chair") ? q.get("chair") === "1" : saved.chairBack,
      // Normal forward reach no longer exposes test/dose modifiers. Explicit simulation URLs
      // remain available to the test bench; screen previews use display fixtures instead.
      ...(usesTargetFlow(exerciseId) && q.get("sim") !== "1" ? { quick: false, sim: false, chairBack: false, assisted: false } : {}),
    };
  }, [search, exerciseId]);

  const [opts, setOpts] = useState<LabOptions & { rung: Rung }>(initial);
  const [stage, setStage] = useState<Stage>("intro");
  useEffect(() => {
    if (usesTargetFlow(exerciseId) && stage === "intro" && opts.rung !== 1) {
      setOpts(options => ({ ...options, rung: 1 }));
    }
  }, [exerciseId, stage, opts.rung]);
  const [error, setError] = useState("");
  const [runSnapshot, setSnap] = useState<Snapshot | null>(null);
  const [bodyChecks, setBodyChecks] = useState<BodyCheck[]>([]);
  const bodyProgress = useRef<Record<string, number>>({});
  const bodyLastT = useRef(0);
  const targetCompletion = useRef<{ key: string; startedAt: number } | null>(null);
  // lapRadius: the lap circle's own size where it differs from the movement circle (the small mouth circle).
  const reachTarget = useRef<{ key: string; x: number; y: number; radius: number; lapRadius?: number; startX: number; startY: number; baseY: number; torso: number; lapX: number; lapY: number } | null>(null);
  const mouthHold = useRef(new MouthHold());
  const mouthHoldKey = useRef("");
  const cupTrack = useRef(new CupTrack());
  const handZoneRef = useRef<HandZone | null>(null);
  // Grasp and transport: the cup's pick-up and put-down circles (learned at set-up), the cup through a repetition,
  // the circle that just completed (for its animation), and the lighting check at set-up.
  const graspLayoutRef = useRef<GraspLayout | null>(null);
  const cupCarry = useRef(new CupCarry());
  const graspCup = useRef<{ at: { x: number; y: number }; tilt: number; inHand: boolean } | null>(null);
  const graspDone = useRef<{ key: string; step: number; at: { x: number; y: number }; startedAt: number } | null>(null);
  const graspLast = useRef<{ key: string; step: number } | null>(null);
  const lightingProbe = useRef(new LightingProbe());
  const lighting = useRef<Lighting | null>(null);
  // Pinch and Peg: the thumb's target, the circle round the thumb and fingertip (steadied, as the hand opening's
  // ring), and the circle that just completed (for its animation).
  const pinchTarget = useRef(new PinchTarget());
  const pinchShown = useRef<{ key: string; x: number; y: number; radius: number; contact: boolean } | null>(null);
  const pinchDone = useRef<{ key: string; x: number; y: number; radius: number; startedAt: number } | null>(null);
  const pinchLast = useRef<{ key: string; step: number; x: number; y: number; radius: number } | null>(null);
  // Seated Knee Extension: the knee dial beside the leg (placed at set-up), the knee's target, and the circle that
  // just completed (for its animation).
  const kneeDialRef = useRef<KneeDial | null>(null);
  const kneeTarget = useRef(new KneeTarget());
  // Seated Toe Lift reuses the knee's dial placement, shown progress and completion refs, with its own target and filter.
  const toeTarget = useRef(new ToeTarget());
  const toeFilter = useRef(new ToeLiftFilter());
  const kneeShown = useRef<{ progress: number; contact: boolean } | null>(null);
  const kneeDone = useRef<{ key: string; step: number; startedAt: number } | null>(null);
  const kneeLast = useRef<{ key: string; step: number } | null>(null);
  // Supported Arm Elevation: which way is out from the body (learned at set-up), the target, the cup's circle (kept
  // while the hand comes back), what is drawn, and the circle that just completed (for its animation).
  const slideOutRef = useRef<number | null>(null);
  const slideTarget = useRef(new SlideTarget());
  const slideCup = useRef<SlideCircle | null>(null);
  const slidePractice = useRef<number | null>(null);
  const slideView = useRef<{ cup: SlideCircle; rest: SlideCircle; hand: { x: number; y: number } | null } | null>(null);
  const slideDone = useRef<{ key: string; circle: SlideCircle; startedAt: number } | null>(null);
  const slideLast = useRef<{ key: string; step: number } | null>(null);
  const [said, setSaid] = useState("");
  const [muted, setMuted] = useState(false);
  const [englishAvailable, setEnglishAvailable] = useState(true);
  const [debugClips, setDebugClips] = useState<DebugClip[]>([]);
  const [debugDirectory, setDebugDirectory] = useState("");
  const [debugError, setDebugError] = useState("");
  const [redoOpen, setRedoOpen] = useState(false);
  const [live, setLive] = useState<{ roms: Live; comps: CompLive }>({ roms: [], comps: [] });
  const [simLevel, setSimLevel] = useState(0);
  const [simComps, setSimComps] = useState<string[]>([]);
  const [auto, setAuto] = useState<AutoMode>("good");

  const sessionRef = useRef<ExerciseSession | null>(null);
  const voiceRef = useRef<RunnerVoice | null>(null);
  const trackerRef = useRef<Tracker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const ghostRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const lastVideoTime = useRef(-1);
  const lastUi = useRef(0);
  const simRef = useRef({ level: 0, manual: false, sliderLevel: 0, comps: [] as string[], auto: "good" as AutoMode, lastT: 0, stepKey: "" });
  const savedRecord = useRef<string | null>(null);
  const debugSessionRef = useRef<DebugVideoSession | null>(null);
  const debugRecorderRef = useRef<DebugVideoRecorder | null>(null);
  const beginningRef = useRef(false);
  // Alira's learning: the record (by finished_at) it was last started for, and whether the running session is simulated.
  const learnedFrom = useRef<string | null>(null);
  const sessionSim = useRef(false);

  simRef.current.comps = simComps;
  simRef.current.auto = auto;

  const cfg = useMemo(() => (base ? resolveExercise(base.id, opts.chairBack, opts.armrest) : null), [base, opts.chairBack, opts.armrest]);
  const rungSpec = useMemo(() => (base ? buildRung(base.id, opts.rung) : null), [base, opts.rung]);
  const previewScreen = usesTargetFlow(exerciseId) ? exercisePreviewScreen(new URLSearchParams(search).get("preview")) : null;
  const preview = useMemo(() => previewScreen ? exerciseScreenPreview(previewScreen, opts.rung, opts.side, exerciseId, opts.armrest) : null, [previewScreen, opts.rung, opts.side, exerciseId, opts.armrest]);
  const snap = preview?.snapshot ?? runSnapshot;
  const viewSaid = preview?.said ?? said;
  const viewChecks = preview?.bodyChecks ?? bodyChecks;
  const viewLive = preview?.live ?? live;
  const selectPreview = useCallback((screen: ExercisePreviewScreen | null) => {
    const q = new URLSearchParams(search);
    q.set("rung", String(opts.rung));
    q.set("side", opts.side);
    if (screen) q.set("preview", screen); else q.delete("preview");
    navigate(`/exercise/${exerciseId}${q.size ? `?${q}` : ""}`);
  }, [exerciseId, navigate, search, opts.rung, opts.side]);

  const stopAll = useCallback(() => {
    clearTimeout(rafRef.current);
    void debugRecorderRef.current?.finish();
    voiceRef.current?.stop();
    trackerRef.current?.close();
    trackerRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stopAll, [stopAll]);

  // Alira learns from each finished, attempted, real session once: when "How did that feel?" is saved,
  // or when the patient leaves the results without answering (Back, Run again or leaving the page).
  // Fire-and-forget; without consent it does nothing.
  const learnFromSession = useCallback(() => {
    const record = sessionRef.current?.snapshot().record;
    if (!record || record.not_attempted || sessionSim.current || learnedFrom.current === record.finished_at) return;
    learnedFrom.current = record.finished_at;
    try {
      void startLearning("exercise_session").catch(() => undefined);
    } catch { /* learning is optional; the results stay usable */ }
  }, []);
  useEffect(() => learnFromSession, [learnFromSession]);

  useEffect(() => {
    if (!preview || !cfg) return;
    const canvas = previewCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    const state = preview.snapshot;
    const grasp = cfg.id === "ex_grasp", pinch = cfg.id === PINCH_ID;
    if (canvas && ctx) {
      const pose = state.phase === "setup" || state.phase === "demo" || !state.targetArmed || state.kind === "return" ? 0 : 1;
      if (grasp) { ctx.clearRect(0, 0, canvas.width, canvas.height); drawGraspGhost(ctx, state.stepIndex, pose, canvas.width, canvas.height); }
      else if (pinch) { ctx.clearRect(0, 0, canvas.width, canvas.height); drawPinchGhost(ctx, pinchStepOf(cfg.cycle, state.stepIndex), pose, canvas.width, canvas.height); }
      else if (cfg.id === SLIDE_ID) drawSlideGhost(ctx, pose, canvas.width, canvas.height, { side: opts.side, armrest: opts.armrest });
      // Seated Knee Extension: the front view, its arrow and its knee dial (the circle is the dial's).
      else if (cfg.id === TOE_ID) drawToeScene(ctx, canvas.width, canvas.height, { progress: pose, lowering: state.kind === "return", side: opts.side, arrow: (state.phase === "warm" || state.phase === "reps") && !state.review, armed: state.targetArmed, now: performance.now(), reducedMotion: true });
      else if (cfg.id === KNEE_ID) drawKneeScene(ctx, canvas.width, canvas.height, { progress: pose, lowering: state.kind === "return", side: opts.side, arrow: (state.phase === "warm" || state.phase === "reps") && !state.review, armed: state.targetArmed, now: performance.now(), reducedMotion: true });
      else drawGhost(ctx, cfg.ghost, pose, canvas.width, canvas.height);
      const target = grasp ? graspGhostTarget(canvas.width, canvas.height, state.stepIndex) : pinch ? pinchGhostTarget(canvas.width, canvas.height, pinchStepOf(cfg.cycle, state.stepIndex)) : cfg.id === KNEE_ID ? kneeGhostTarget(canvas.width, canvas.height, state.kind === "return", opts.side) : cfg.id === TOE_ID ? toeGhostTarget(canvas.width, canvas.height, state.kind === "return", opts.side) : cfg.id === SLIDE_ID ? slideGhostTarget(canvas.width, canvas.height, state.kind === "return", { side: opts.side, armrest: opts.armrest }) : ghostTargetFor(cfg.id)(canvas.width, canvas.height, state.kind === "return");
      if ((state.phase === "warm" || state.phase === "reps") && !state.review && !state.awaitingReady) drawTestingTarget(ctx, { ...target, armed: state.targetArmed, contact: state.inZone && state.targetArmed, progress: state.holdProgress, now: performance.now(), reducedMotion: true });
    }
    const demo = ghostRef.current;
    const demoContext = demo?.getContext("2d");
    if (state.phase === "demo" && demo && demoContext) {
      if (grasp) drawGraspDemo(demoContext, state.demoStepElapsedMs, Math.max(0, state.demoStepIndex), demo.width, demo.height, performance.now(), true, state.targetArmed);
      else if (pinch) drawPinchDemo(demoContext, state.demoStepElapsedMs, pinchStepOf(cfg.cycle, state.demoStepIndex), demo.width, demo.height, performance.now(), true, state.targetArmed);
      else if (cfg.id === TOE_ID) drawToeDemo(demoContext, state.demoStepElapsedMs, state.kind === "return", demo.width, demo.height, performance.now(), true, state.targetArmed, opts.side);
      else if (cfg.id === KNEE_ID) drawKneeDemo(demoContext, state.demoStepElapsedMs, state.kind === "return", demo.width, demo.height, performance.now(), true, state.targetArmed, opts.side);
      else if (cfg.id === SLIDE_ID) drawSlideDemo(demoContext, state.demoStepElapsedMs, state.kind === "return", demo.width, demo.height, performance.now(), true, state.targetArmed, { side: opts.side, armrest: opts.armrest });
      else drawDemoFor(cfg.id)(demoContext, state.demoStepElapsedMs, state.kind === "return", demo.width, demo.height, performance.now(), true, state.targetArmed);
    }
  }, [preview, cfg, opts.side, opts.armrest]);

  // ---------- the frame loop ----------

  const loop = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    const t = performance.now();
    let frame: Frame | null = null;
    const step = session.currentStep;

    if (opts.sim) {
      const s = simRef.current;
      const dt = Math.min(0.1, (t - (s.lastT || t)) / 1000);
      s.lastT = t;
      const snapNow = session.snapshot();
      // Grasp and transport: every step is a movement from where the last one ended, so each starts from 0.
      const grasp = session.cfg.id === "ex_grasp";
      if (grasp) {
        const key = `${snapNow.phase}:${snapNow.repIndex}:${snapNow.stepIndex}`;
        if (s.stepKey !== key) { s.stepKey = key; s.level = 0; }
      }
      if (s.auto !== "off" && !s.manual) {
        const moving = (snapNow.phase === "warm" || snapNow.phase === "reps") && step && (grasp || step.kind === "reach" || step.kind === "open" || step.kind === "pinch");
        const want = !snapNow.targetArmed && (snapNow.phase === "warm" || snapNow.phase === "reps") ? s.level : moving && snapNow.holdProgress < 1 ? (snapNow.phase === "warm" ? 1 : AUTO_LEVEL[s.auto]) : 0;
        // The table slide's simulated patient slides at a controlled pace, under its "slowly" reminder.
        s.level += Math.sign(want - s.level) * Math.min(Math.abs(want - s.level), dt * (session.cfg.id === SLIDE_ID ? 0.8 : 1.6));
      } else s.level = s.sliderLevel;
      const comps = s.auto === "leaning" && !s.manual ? (session.cfg.compensations[0] ? [session.cfg.compensations[0].id] : []) : s.comps;
      frame = simFrame(t, session.cfg, session.targets(), { level: s.level, compensations: comps });
      if (usesTargetFlow(session.cfg.id) && (session.snapshot().phase === "warm" || session.snapshot().phase === "reps")) {
        const level = Math.min(1, Math.max(0, s.level));
        if (session.cfg.id === "ex_handopen") frame.targetContact = handGhostContact(level, step?.kind === "return");
        else if (session.cfg.id === KNEE_ID) frame.targetContact = kneeGhostContact(level, step?.kind === "return");
        else if (session.cfg.id === TOE_ID) frame.targetContact = toeGhostContact(level, step?.kind === "return");
        else if (session.cfg.id === PINCH_ID) frame.targetContact = pinchGhostContact(level, step?.kind === "return");
        else if (session.cfg.id === SLIDE_ID) frame.targetContact = slideGhostContact(level, step?.kind === "return");
        else if (grasp) frame.targetContact = graspGhostContact(level, snapNow.stepIndex);
        else {
          const hand = (session.cfg.id === "ex_h2m" ? mouthGhostPose : reachGhostPose)(level).wrist;
          const target = ghostTargetFor(session.cfg.id)(300, 270, step?.kind === "return");
          frame.targetContact = Math.hypot(hand[0] - target.x, hand[1] - target.y) <= target.radius;
        }
        frame.targetProgress = frame.targetContact ? 1 : s.level;
      }
    } else {
      const video = videoRef.current;
      const tracker = trackerRef.current;
      if (video && tracker && video.readyState >= 2 && video.currentTime !== lastVideoTime.current) {
        lastVideoTime.current = video.currentTime;
        try {
          const tracked = tracker.detect(video, t);
          const now = session.snapshot();
          // Hand-to-mouth: once the hand reaches the mouth, a forearm the tracker loses in front of the face
          // does not move it (mouth-hold.ts); the arm is measured and drawn where it was last seen there.
          const lap = session.lapPoint, mouth = session.mouthPoint;
          // Alira's target size scales the mouth circle and its limits (1 leaves them as before).
          const size = session.tuning.targetSizeScale;
          const mouthRadius = lap ? Math.max(0.045 * size, Math.min(0.08 * size, lap.bodyScale * 0.18 * size)) : 0;
          let hold: MouthHoldResult | null = null;
          if (session.cfg.id === "ex_h2m" && (now.phase === "warm" || now.phase === "reps") && !now.review && lap && mouth) {
            const key = `${now.phase}:${now.repIndex}:${now.rung}`;
            if (mouthHoldKey.current !== key) { mouthHold.current.reset(); mouthHoldKey.current = key; }
            hold = mouthHold.current.update(t, tracked.pose, opts.side, { mouth, radius: mouthRadius, aspect: video.videoWidth / video.videoHeight, torso: lap.bodyScale });
          }
          const detection = hold?.held ? { ...tracked, pose: hold.pose } : tracked;
          // Hand opening's shaded area follows the body during set-up and stays where it was learned afterwards.
          // While a repetition waits for the palm it slowly re-centres on the shoulders, unless the hand hides one.
          // Pinch and Peg is held in the same shaded area.
          if ((session.cfg.id === "ex_handopen" || session.cfg.id === PINCH_ID) && (now.phase === "setup" || (now.awaitingReady && !handCovers(affectedHand(tracked, opts.side), tracked.pose, opts.side, video.videoWidth / video.videoHeight)))) {
            handZoneRef.current = followZone(handZoneRef.current, handZone(tracked.pose, opts.side, video.videoWidth / video.videoHeight), now.phase === "setup" ? 0.2 : 0.05);
          }
          // Grasp and transport: the cup's circles follow the body during set-up and stay where they were learned;
          // the lighting is checked there too, and set-up waits for good light (or, after a long wait, carries on).
          const graspNow = session.cfg.id === "ex_grasp", kneeNow = session.cfg.id === KNEE_ID, toeNow = session.cfg.id === TOE_ID;
          // Seated Toe Lift places the same dial (as an ankle dial) and checks the lighting the same way.
          const dialEx = kneeNow || toeNow;
          // Seated Knee Extension: the knee dial follows the leg during set-up and stays where it was learned; the
          // lighting is checked there too, as for grasp and transport.
          // The dial as this frame places it: set-up waits until it fits beside the shoulder now, not only once before.
          const dialNow = dialEx && now.phase === "setup" ? kneeDial(tracked.pose, opts.side, video.videoWidth / video.videoHeight) : null;
          // Supported Arm Elevation: which way is out from the body (for the cup and its arrow) is learned at set-up,
          // with the lighting; set-up itself checks the room beside the arm for the cup (slideRestCheck).
          const slideNow = session.cfg.id === SLIDE_ID;
          // Pinch and Peg checks the lighting at set-up too: fingertips are the first landmarks poor light loses.
          const pinchNow = session.cfg.id === PINCH_ID;
          if ((graspNow || dialEx || slideNow || pinchNow) && now.phase === "setup") {
            if (graspNow) graspLayoutRef.current = followLayout(graspLayoutRef.current, graspLayout(tracked.pose, opts.side, video.videoWidth / video.videoHeight, now.rung));
            else if (dialEx) kneeDialRef.current = followDial(kneeDialRef.current, dialNow);
            else if (slideNow) slideOutRef.current = slideOutward(tracked.pose, opts.side) ?? slideOutRef.current;
            lighting.current = lightingProbe.current.sample(video, tracked.pose, t);
          }
          // The toe lift's measure is steadied over a few frames (toe-target.ts).
          frame = toeNow ? toeFrame(detection, opts.side, t, video.videoWidth / video.videoHeight, session.reference, toeFilter.current)
            : buildFrame(session, detection, opts.side, t, video.videoWidth / video.videoHeight, { zone: handZoneRef.current, gripAxis: cupCarry.current.grip, support: opts.armrest ? "armrest" : "table" });
          if ((graspNow || dialEx || slideNow || pinchNow) && now.phase === "setup") {
            const light = lighting.current;
            if (graspNow && !graspLayoutRef.current) { frame.lapRest = undefined; frame.lapMissing = "Sit back so your shoulders and both hips are in view."; }
            else if (graspNow && handOpenness(graspHand(detection, opts.side)) === undefined) { frame.lapRest = undefined; frame.lapMissing = GRASP_HAND_HINT; }
            else if (dialEx && frame.lapRest && (!dialNow || !kneeDialRef.current)) { frame.lapRest = undefined; frame.lapMissing = KNEE_DIAL_HINT; }
            // The knee and the slide name a body position to fix first; the light comes once the body is in place.
            else if ((graspNow || frame.lapRest) && light && !light.ok && !lightingProbe.current.waived()) { frame.lapRest = undefined; frame.lapMissing = light.hint; }
          }
          if (now.phase === "setup") {
            const dt = Math.min(100, Math.max(0, t - (bodyLastT.current || t)));
            bodyLastT.current = t;
            setBodyChecks(cameraBodyChecks(session, detection, opts.side, handZoneRef.current, video.videoWidth / video.videoHeight, graspNow || dialEx || slideNow || pinchNow ? { lighting: lighting.current, waived: lightingProbe.current.waived(), dialFits: dialEx ? dialNow !== null : undefined, support: opts.armrest ? "armrest" : "table" } : undefined).map(check => {
              const progress = Math.max(0, Math.min(1, (bodyProgress.current[check.id] ?? 0) + dt / (check.visible ? 1400 : -550)));
              bodyProgress.current[check.id] = progress;
              return { ...check, progress };
            }));
          }
          if (session.cfg.id === "ex_reach" && (now.phase === "warm" || now.phase === "reps") && !now.review && now.kind === "reach" && detection.pose) {
            const j = poseJoints(opts.side);
            const shoulder = detection.pose.landmarks[j.shoulder];
            const hip = detection.pose.landmarks[j.hip];
            const wrist = detection.pose.landmarks[j.wrist];
            const key = `${now.phase}:${now.repIndex}:${now.rung}`;
            if (frame.visible && shoulder && hip && wrist && lap && reachTarget.current?.key !== key) {
              const torso = Math.max(0.18, Math.abs(hip.y - shoulder.y));
              // Circle geometry is independent of camera angle estimates learned during practice.
              const scale = session.cfg.romSteps[0].targets[LEVEL_BY_RUNG[now.phase === "warm" ? 1 : now.rung]] / 45;
              // Alira's settings, fixed for the session (1 leaves every number as before). The circle sits
              // below the shoulder by an offset that shrinks as the demand grows, so the height scale joins
              // that demand scale: lower places the circle lower, and it also rises less (cap included).
              // The size scale resizes the circle with its limits.
              const { reachHeightScale: height, targetSizeScale: size } = session.tuning;
              const baseY = reachTarget.current?.baseY ?? Math.max(0.15, Math.min(0.75, shoulder.y + torso * (0.35 / (scale * height))));
              const targetTorso = reachTarget.current?.torso ?? torso;
              const rise = now.phase === "reps" ? Math.min(0.32 * height, Math.max(0, now.repIndex - 1) * 0.10 * height) : 0;
              reachTarget.current = { key, baseY, lapX: lap.x, lapY: lap.y, torso: targetTorso, x: Math.max(0.12, Math.min(0.88, shoulder.x + (opts.side === "right" ? -1 : 1) * torso * 0.22)), y: Math.max(0.12, baseY - rise), radius: Math.min(Math.max(0.11 * size, Math.abs(shoulder.x - detection.pose.landmarks[j.shoulderOther].x) * 0.55 * size), 0.18 * size) * Math.min(video.videoWidth, video.videoHeight) / video.videoHeight, startX: lap.x, startY: lap.y };
            }
            const target = reachTarget.current;
            if (target?.key === key && wrist) {
              const distance = Math.hypot((wrist.x - target.x) * video.videoWidth / video.videoHeight, wrist.y - target.y);
              const startDistance = Math.hypot((target.startX - target.x) * video.videoWidth / video.videoHeight, target.startY - target.y);
              const wristVisible = (wrist.visibility ?? 1) >= 0.5 && wrist.x > 0.01 && wrist.x < 0.99 && wrist.y > 0.01 && wrist.y < 0.99;
              frame.visible = wristVisible;
              frame.missing = wristVisible ? undefined : "Bring your affected hand back into view.";
              frame.targetContact = wristVisible && distance <= target.radius;
              frame.targetProgress = frame.targetContact ? 1 : Math.max(0, Math.min(0.98, 1 - (distance - target.radius) / Math.max(0.05, startDistance - target.radius)));
            }
          } else if (!usesTargetFlow(session.cfg.id) || now.phase === "setup" || now.phase === "demo") reachTarget.current = null;
          if (session.cfg.id === "ex_h2m" && (now.phase === "warm" || now.phase === "reps") && !now.review) {
            if (lap && mouth) {
              const radius = mouthRadius;
              const key = `${now.phase}:${now.repIndex}:${now.rung}`;
              // The lap circle is the forward reach's lap circle: the same size rule, fixed for each repetition.
              const j = poseJoints(opts.side);
              const shoulderSpan = detection.pose ? Math.abs(detection.pose.landmarks[j.shoulder].x - detection.pose.landmarks[j.shoulderOther].x) : 0;
              const lapRadius = reachTarget.current?.key === key && reachTarget.current.lapRadius !== undefined ? reachTarget.current.lapRadius
                : Math.min(Math.max(0.11 * size, shoulderSpan * 0.55 * size), 0.18 * size) * Math.min(video.videoWidth, video.videoHeight) / video.videoHeight;
              reachTarget.current = { key, x: mouth.x, y: mouth.y, radius, lapRadius, baseY: mouth.y, torso: lap.bodyScale, startX: lap.x, startY: lap.y, lapX: lap.x, lapY: lap.y };
              if (now.kind === "reach") {
                const points = mouthContactPoints(detection.pose, opts.side);
                // As for the reach, once set up only the affected hand has to stay in view.
                frame.visible = hold ? hold.seen : points.length > 0;
                frame.missing = frame.visible ? undefined : "Bring your affected hand back into view.";
                frame.targetContact = hold ? hold.contact : frame.visible && mouthContact(detection.pose, opts.side, mouth, radius, video.videoWidth / video.videoHeight);
                frame.targetUnsure = hold?.unsure;
                const distance = Math.min(...points.map(point => Math.hypot((point.x - mouth.x) * video.videoWidth / video.videoHeight, point.y - mouth.y)));
                const startDistance = Math.hypot((lap.x - mouth.x) * video.videoWidth / video.videoHeight, lap.y - mouth.y);
                frame.targetProgress = frame.targetContact || hold?.atMouth ? 1 : Math.max(0, Math.min(0.98, 1 - (distance - radius) / Math.max(0.05, startDistance - radius)));
              }
            } else { frame.visible = false; frame.missing = "Go back to Set up so I can learn your lap and mouth targets."; }
          }
          if (session.cfg.id === "ex_handopen" && (now.phase === "warm" || now.phase === "reps") && !now.review) {
            // Active Hand Opening: a ring around the palm that the fingertips open out to, then a small circle
            // they relax back into. The practice ring sits a little beyond the relaxed hand; scored rings at the
            // opening held there (hand-target.ts). Both follow the palm, sized by its length.
            const aspect = video.videoWidth / video.videoHeight;
            const hand = affectedHand(detection, opts.side);
            const palm = palmRing(hand, aspect);
            const openness = handOpenness(hand);
            const rest = session.restValues().hand_openness;
            const key = `${now.phase}:${now.repIndex}:${now.rung}`;
            if (palm && openness !== undefined && Number.isFinite(rest)) {
              const last = reachTarget.current?.key === key ? reachTarget.current : null;
              const follow = (from: number | undefined, to: number) => (from === undefined ? to : from + (to - from) * RING_FOLLOW);
              const x = follow(last?.x, palm.x), y = follow(last?.y, palm.y), scale = follow(last?.torso, palm.scale);
              const target = handRingTarget(openness, rest, now.phase === "reps" ? session.learnedValue("hand_openness") : undefined, now.kind === "return");
              reachTarget.current = { key, x, y, radius: target.ring * scale, lapRadius: target.relax * scale, startX: x, startY: y, baseY: y, torso: scale, lapX: x, lapY: y };
              // Opening counts only with the hand in its area (an open hand laid on the lap is not on the ring);
              // closing counts anywhere, the lap included.
              frame.targetContact = frame.visible && target.contact && (now.kind === "return" || frame.placed !== false);
              frame.targetProgress = frame.targetContact ? 1 : Math.min(0.98, target.progress);
            } else {
              frame.visible = false;
              frame.missing = frame.missing ?? "Bring your affected hand back into view.";
            }
          }
          if (graspNow && (now.phase === "warm" || now.phase === "reps") && !now.review) {
            // Grasp and transport: the pick-up circle (reach with the hand opening, then close around the cup), the
            // put-down circle across the midline (carry the cup there, then open to let go), then the lap circle.
            const aspect = video.videoWidth / video.videoHeight;
            const layout = graspLayoutRef.current, lapPoint = session.lapPoint;
            const hand = graspHand(detection, opts.side);
            const point = graspPoint(hand, detection.pose, opts.side, aspect);
            const key = `${now.phase}:${now.repIndex}:${now.rung}`;
            if (layout && lapPoint) {
              if (now.stepIndex === GRASP_STEP.back) {
                const wrist = detection.pose?.landmarks[poseJoints(opts.side).wrist];
                const lapRadius = graspLapRadius(layout, aspect, session.tuning.targetSizeScale);
                const at = wrist && (wrist.visibility ?? 1) >= 0.5 ? wrist : point;
                frame.targetContact = frame.visible && !!at && Math.hypot((at.x - lapPoint.x) * aspect, at.y - lapPoint.y) <= lapRadius;
                frame.targetProgress = frame.targetContact ? 1 : 0;
              } else {
                const rings = graspRings(session.restValues().hand_openness, now.phase === "reps" ? session.learnedValue("hand_openness") : undefined);
                const start = now.stepIndex === GRASP_STEP.reach ? lapPoint : now.stepIndex === GRASP_STEP.carry ? layout.pick : undefined;
                const target = graspTarget(now.stepIndex, point, handOpenness(hand), layout, rings, aspect, start);
                frame.targetContact = frame.visible && target.contact;
                frame.targetProgress = target.progress;
              }
              graspCup.current = cupCarry.current.update(key, now.stepIndex, frame.targetContact === true, hand, point, layout);
            } else { frame.visible = false; frame.missing = "Go back to Set up so I can place the cup."; }
          } else if (graspNow && (now.phase === "setup" || now.phase === "demo")) {
            // Back to the demonstration or set-up: the practice starts again with the cup at the pick-up circle.
            cupCarry.current.reset();
            graspCup.current = graspDone.current = graspLast.current = null;
          }
          if (kneeNow && (now.phase === "warm" || now.phase === "reps") && !now.review) {
            // Seated Knee Extension: the knee dial's circle sits at the goal while straightening (the knee's 3D angle at
            // the goal learned in practice) and at the resting foot while lowering (the foot back down where it rested).
            const rest = session.restValues().knee_extension, foot = session.lapPoint, dial = kneeDialRef.current;
            if (Number.isFinite(rest) && foot && dial) {
              const ankle = detection.pose?.landmarks[poseJoints(opts.side).ankle];
              const lowering = now.kind === "return";
              // Practice lowers from the goal it learned (it may have eased), so the dial's foot does not jump.
              const learned = session.learnedValue("knee_extension");
              const goal = now.phase === "reps" ? session.targets().knee_extension : lowering && learned !== undefined ? learned : kneePracticeGoal(rest);
              const target = kneeTarget.current.update(`${now.phase}:${now.repIndex}:${now.stepIndex}`, {
                value: frame.values.knee_extension, rest, goal, lowering, ankle: ankle && inView(ankle) ? ankle : null, restFoot: foot,
                aspect: video.videoWidth / video.videoHeight, armed: now.targetArmed, practice: now.phase === "warm", t,
              });
              frame.targetContact = frame.visible && target.contact;
              frame.targetProgress = frame.targetContact ? 1 : Math.max(0, Math.min(0.98, lowering ? 1 - target.progress : target.progress));
              // The dial's foot stays where it was while the knee is briefly unmeasured.
              const measured = Number.isFinite(frame.values.knee_extension);
              kneeShown.current = { progress: measured ? target.progress : kneeShown.current?.progress ?? 0, contact: frame.targetContact };
            } else { frame.visible = false; frame.missing = "Go back to Set up so I can place the knee dial."; }
          } else if (kneeNow && (now.phase === "setup" || now.phase === "demo")) {
            // Back to the demonstration or set-up: the practice starts again from a resting knee.
            kneeTarget.current.reset();
            kneeShown.current = null;
            kneeDone.current = kneeLast.current = null;
          }
          if (toeNow && (now.phase === "warm" || now.phase === "reps") && !now.review) {
            // Seated Toe Lift: the ankle dial's circle sits at the goal while lifting (the toes' rise above the ankle at the
            // goal learned in practice) and with the toes down while lowering.
            const rest = session.restValues().toe_lift, dial = kneeDialRef.current;
            if (Number.isFinite(rest) && dial) {
              const lowering = now.kind === "return";
              // Practice lowers from the goal it learned (it may have eased), so the dial's toes do not jump.
              const learned = session.learnedValue("toe_lift");
              const goal = now.phase === "reps" ? session.targets().toe_lift : lowering && learned !== undefined ? learned : toePracticeGoal(rest);
              const target = toeTarget.current.update(`${now.phase}:${now.repIndex}:${now.stepIndex}`, { value: frame.values.toe_lift, rest, goal, lowering, armed: now.targetArmed, practice: now.phase === "warm", t });
              frame.targetContact = frame.visible && target.contact;
              frame.targetProgress = frame.targetContact ? 1 : Math.max(0, Math.min(0.98, lowering ? 1 - target.progress : target.progress));
              const measured = Number.isFinite(frame.values.toe_lift);
              kneeShown.current = { progress: measured ? target.progress : kneeShown.current?.progress ?? 0, contact: frame.targetContact };
            } else { frame.visible = false; frame.missing = "Go back to Set up so I can place the ankle dial."; }
          } else if (toeNow && (now.phase === "setup" || now.phase === "demo")) {
            // Back to the demonstration or set-up: the practice starts again from resting toes.
            toeTarget.current.reset();
            kneeShown.current = null;
            kneeDone.current = kneeLast.current = null;
          }
          if (slideNow && (now.phase === "warm" || now.phase === "reps") && !now.review) {
            // Supported Arm Elevation: the cup's circle sits out from the resting hand (the practice distance, or the one
            // learned in practice) while the hand moves out, and the resting circle while it comes back. The hand's
            // place in the picture decides both, as for Graded Forward Reach.
            const restHand = session.lapPoint, out = slideOutRef.current;
            if (restHand && out !== null) {
              const wrist = detection.pose?.landmarks[poseJoints(opts.side).wrist];
              const hand = wrist && inView(wrist) ? { x: wrist.x, y: wrist.y } : null;
              const returning = now.kind === "return";
              // Scored cups stay where the practice cup was (eased, if it had to come closer): the hand stops as it reaches
              // a cup, so a cup placed where it stopped would creep closer each time. The learned values grade the movement.
              const spans = now.phase === "reps" ? slidePractice.current ?? SLIDE_PRACTICE_SPANS : SLIDE_PRACTICE_SPANS;
              const target = slideTarget.current.update(`${now.phase}:${now.repIndex}:${now.stepIndex}`, {
                hand, rest: restHand, out, aspect: video.videoWidth / video.videoHeight, spans, rise: opts.armrest ? SLIDE_RISE.armrest : SLIDE_RISE.table,
                returning, armed: now.targetArmed, practice: now.phase === "warm", t,
              });
              if (now.phase === "warm" && !returning) slidePractice.current = target.spans;
              frame.targetContact = frame.visible && target.contact;
              frame.targetProgress = frame.targetContact ? 1 : Math.max(0, Math.min(0.98, target.progress));
              // The cup stays where it was reached while the hand comes back.
              if (!returning) slideCup.current = target.circle;
              slideView.current = { cup: slideCup.current ?? target.circle, rest: restCircle(restHand, spans, opts.armrest ? SLIDE_RISE.armrest : SLIDE_RISE.table), hand };
            } else { frame.visible = false; frame.missing = "Go back to Set up so I can place the cup."; }
          } else if (slideNow && (now.phase === "setup" || now.phase === "demo")) {
            // Back to the demonstration or set-up: the practice starts again from the resting arm.
            slideTarget.current.reset();
            slideCup.current = null;
            slidePractice.current = null;
            slideView.current = null;
            slideDone.current = slideLast.current = null;
          }
          if (pinchNow && (now.phase === "warm" || now.phase === "reps") && !now.review) {
            // Pinch and Peg: a circle round the thumb tip and the fingertip this step pinches, steadied as the hand
            // opening's ring. The pinch is on target with the thumb closed to the goal, tip to tip, on that finger; the
            // let-go once the thumb opens back most of the way (pinch-target.ts).
            const aspect = video.videoWidth / video.videoHeight;
            const pinchStep = pinchStepOf(session.cfg.cycle, now.stepIndex);
            const finger = pinchStep.finger, metric = PINCH_FINGERS[finger].metric;
            const rest = session.restValues()[metric];
            const hand = pinchHand(detection, opts.side);
            if (Number.isFinite(rest) && hand) {
              // Practice lets go from the closure just learned (the pinch may have eased), as the knee and slide do.
              const learned = session.learnedValue(metric);
              const goal = now.phase === "reps" ? Math.min(TOUCH_CLOSURE, session.targets()[metric]) : pinchStep.letGo && learned !== undefined ? learned : pinchPracticeGoal(rest);
              const key = `${now.phase}:${now.repIndex}:${now.stepIndex}`;
              const target = pinchTarget.current.update(key, {
                closure: frame.values[metric], imageGap: imageGap(hand, finger, aspect), along: tipAlong(hand, finger), rival: frame.values[PINCH_FINGERS[1 - finger].metric],
                rest, goal, letGo: pinchStep.letGo, armed: now.targetArmed, practice: now.phase === "warm", t,
              });
              // A pinch counts only with the hand in its area; letting go counts anywhere.
              frame.targetContact = frame.visible && target.contact && (pinchStep.letGo || frame.placed !== false);
              frame.targetProgress = frame.targetContact ? 1 : Math.min(0.98, target.progress);
              const circle = pinchCircle(hand, finger, aspect, pinchStep.letGo ? target.release : target.goal);
              if (circle) {
                const last = pinchShown.current?.key === key ? pinchShown.current : null;
                const follow = (from: number | undefined, to: number) => (from === undefined ? to : from + (to - from) * RING_FOLLOW);
                pinchShown.current = { key, x: follow(last?.x, circle.x), y: follow(last?.y, circle.y), radius: follow(last?.radius, circle.radius), contact: frame.targetContact };
              }
            }
          } else if (pinchNow && (now.phase === "setup" || now.phase === "demo")) {
            // Back to the demonstration or set-up: the practice starts again with the thumb apart.
            pinchTarget.current.reset();
            pinchShown.current = null;
            pinchDone.current = pinchLast.current = null;
          }
          if (!now.review && reachTarget.current && now.kind === "return" && hold?.atMouth) {
            // The cup has not left the mouth yet: a forearm flickering down is not the hand on the lap.
            frame.visible = true;
            frame.missing = undefined;
            frame.targetContact = false;
          } else if (usesSeatedTargets(session.cfg.id) && !now.review && reachTarget.current && now.kind === "return" && detection.pose) {
            const wrist = detection.pose.landmarks[poseJoints(opts.side).wrist];
            const target = reachTarget.current;
            const visible = !!wrist && (wrist.visibility ?? 1) >= 0.5 && wrist.x > 0.01 && wrist.x < 0.99 && wrist.y > 0.01 && wrist.y < 0.99;
            frame.visible = visible;
            frame.missing = visible ? undefined : "Bring your affected hand back into view.";
            frame.targetContact = visible && Math.hypot((wrist.x - target.lapX) * video.videoWidth / video.videoHeight, wrist.y - target.lapY) <= (target.lapRadius ?? target.radius);
          }
          if (session.cfg.id === "ex_h2m") {
            // Hand-to-mouth draws the cup and the affected arm from a steadied track (cup-track.ts): display only.
            // The track reads the tracker's own pose so it can time the forearm flips; while MouthHold holds, its held arm is drawn.
            const j = poseJoints(opts.side);
            const shoulder = tracked.pose?.landmarks[j.shoulder], hip = tracked.pose?.landmarks[j.hip];
            const torso = lap?.bodyScale ?? (shoulder && hip ? Math.max(0.18, Math.abs(hip.y - shoulder.y)) : 0.4);
            const shown = cupTrack.current.update(t, tracked.pose, opts.side, { torso, aspect: video.videoWidth / video.videoHeight }, { held: hold?.held ? hold.pose : null, lowering: now.kind === "return" });
            drawOverlay(overlayRef.current, video, { ...detection, pose: shown.pose }, session, opts.side, shown.cup);
          } else drawOverlay(overlayRef.current, video, detection, session, opts.side);
        } catch (err) {
          console.warn("Exercise tracking frame failed", err);
        }
      }
    }

    if (frame) {
      session.push(frame);
      const currentSnapshot = session.snapshot();
      const handOpening = session.cfg.id === "ex_handopen";
      // Pinch and Peg is held in the same shaded area.
      if (!opts.sim && (handOpening || session.cfg.id === PINCH_ID) && handZoneRef.current && !currentSnapshot.review && ["setup", "warm", "reps"].includes(currentSnapshot.phase)) {
        // The shaded area: emphasised at set-up and while a step waits for the palm, then a faint reminder.
        const canvas = overlayRef.current, ctx = canvas?.getContext("2d");
        const setup = currentSnapshot.phase === "setup";
        // Green only while waiting for the palm: during the movement the area is just a faint reminder.
        try {
          if (canvas && ctx) drawHandZone(ctx, handZoneRef.current, canvas.width, canvas.height, { emphasis: setup || currentSnapshot.awaitingReady, ready: setup ? Boolean(frame.lapRest) : currentSnapshot.awaitingReady && frame.ready === true, side: opts.side, now: t, reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches });
        } catch (err) {
          console.warn("Shaded area drawing failed", err);
        }
      }
      const pinchZone = handZoneRef.current, shown = pinchShown.current;
      if (!opts.sim && session.cfg.id === PINCH_ID && pinchZone && !currentSnapshot.review && !currentSnapshot.awaitingReady && (currentSnapshot.phase === "warm" || currentSnapshot.phase === "reps")) {
        // Pinch and Peg: the circle round the thumb and fingertip with its label, the peg to pick up (or held until let
        // go), the tray the pegs drop into, and the circle just completed.
        const canvas = overlayRef.current, ctx = canvas?.getContext("2d");
        if (canvas && ctx) {
          try {
            const W = canvas.width, H = canvas.height, step = currentSnapshot.stepIndex, reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            const repKey = `${currentSnapshot.phase}:${currentSnapshot.repIndex}`;
            const letGo = currentSnapshot.kind === "return";
            // Contact as measured for this step (the frame's contact can belong to the step that just completed).
            const here = shown?.key === `${currentSnapshot.phase}:${currentSnapshot.repIndex}:${step}`;
            const contact = here && frame.targetContact === true;
            const last = pinchLast.current;
            if (last?.key === repKey && last.step !== step) pinchDone.current = { key: repKey, x: last.x, y: last.y, radius: last.radius, startedAt: t };
            const tray = trayPoint(pinchZone);
            drawPegTray(ctx, (1 - tray.x) * W, tray.y * H, tray.size * H, pegsDropped(step) + (letGo && contact ? 1 : 0));
            if (shown && here) {
              const x = (1 - shown.x) * W, y = shown.y * H, radius = shown.radius * H;
              pinchLast.current = { key: repKey, step, x: shown.x, y: shown.y, radius: shown.radius };
              drawTestingTarget(ctx, { x, y, radius, armed: currentSnapshot.targetArmed, contact, progress: currentSnapshot.holdProgress, now: t, reducedMotion: reduced });
              drawRingLabel(ctx, x, y, radius, letGo ? "Let go" : "Pinch", H, currentSnapshot.targetArmed);
              // The peg sits in the circle to be picked up, is held while pinched, and drops once the fingers open.
              if (!(letGo && contact)) drawPeg(ctx, x, y, Math.max(14, radius * 0.75), contact || letGo);
            } else pinchLast.current = last?.key === repKey ? { ...last, step } : null;
            const done = pinchDone.current;
            if (done?.key === repKey && t - done.startedAt < TARGET_COMPLETION_MS) drawTargetCompletion(ctx, { x: (1 - done.x) * W, y: done.y * H, radius: done.radius * H, elapsed: t - done.startedAt, reducedMotion: reduced });
          } catch (err) {
            console.warn("Pinch drawing failed", err);
          }
        }
      }
      const layout = graspLayoutRef.current, lapPoint = session.lapPoint;
      if (!opts.sim && session.cfg.id === "ex_grasp" && layout && lapPoint && !currentSnapshot.review && (currentSnapshot.phase === "warm" || currentSnapshot.phase === "reps")) {
        // Grasp and transport: the active circle with its label, the circle just completed, and the cup.
        const canvas = overlayRef.current, ctx = canvas?.getContext("2d");
        if (canvas && ctx) {
          try {
            const aspect = canvas.width / canvas.height, step = currentSnapshot.stepIndex, reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            const circle = (index: number) => ({ at: index <= GRASP_STEP.grasp ? layout.pick : index <= GRASP_STEP.release ? layout.put : lapPoint, radius: index === GRASP_STEP.back ? graspLapRadius(layout, aspect, session.tuning.targetSizeScale) : layout.radius });
            const repKey = `${currentSnapshot.phase}:${currentSnapshot.repIndex}`;
            if (graspLast.current?.key === repKey && graspLast.current.step !== step) graspDone.current = { key: repKey, step: graspLast.current.step, at: circle(graspLast.current.step).at, startedAt: t };
            graspLast.current = { key: repKey, step };
            const active = circle(step);
            const x = (1 - active.at.x) * canvas.width, y = active.at.y * canvas.height, radius = active.radius * canvas.height;
            drawTestingTarget(ctx, { x, y, radius, armed: currentSnapshot.targetArmed, contact: frame.targetContact === true, progress: currentSnapshot.holdProgress, now: t, reducedMotion: reduced });
            drawRingLabel(ctx, x, y, radius, GRASP_LABELS[step] ?? "", canvas.height, currentSnapshot.targetArmed);
            const done = graspDone.current;
            if (done?.key === repKey && t - done.startedAt < TARGET_COMPLETION_MS) drawTargetCompletion(ctx, { x: (1 - done.at.x) * canvas.width, y: done.at.y * canvas.height, radius: circle(done.step).radius * canvas.height, elapsed: t - done.startedAt, reducedMotion: reduced });
            const cup = graspCup.current;
            if (cup) drawCup(ctx, (1 - cup.at.x) * canvas.width, cup.at.y * canvas.height, layout.radius * canvas.height * 0.9, -cup.tilt);
          } catch (err) {
            console.warn("Cup drawing failed", err);
          }
        }
      }
      const dial = kneeDialRef.current;
      if (!opts.sim && session.cfg.id === KNEE_ID && dial && !currentSnapshot.review && (currentSnapshot.phase === "warm" || currentSnapshot.phase === "reps")) {
        // Seated Knee Extension: the knee dial with its active circle, and the circle just completed.
        const canvas = overlayRef.current, ctx = canvas?.getContext("2d");
        if (canvas && ctx) {
          try {
            const step = currentSnapshot.stepIndex, reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            const repKey = `${currentSnapshot.phase}:${currentSnapshot.repIndex}`;
            if (kneeLast.current?.key === repKey && kneeLast.current.step !== step) kneeDone.current = { key: repKey, step: kneeLast.current.step, startedAt: t };
            kneeLast.current = { key: repKey, step };
            // The arrow at the foot: which way to straighten (out to the side, where the camera sees the knee move).
            const guide = kneeGuide(session.reference, dial, canvas.width / canvas.height);
            // It moves from the moment the movement is asked for (the instruction included) until the knee is there.
            if (guide) drawKneeGuide(ctx, guide, canvas.width, canvas.height, { lowering: currentSnapshot.kind === "return", emphasis: frame.targetContact !== true, now: t, reducedMotion: reduced });
            // In practice the dial says it moves with the knee (said once, in the practice instruction, too).
            const practiceHint = currentSnapshot.phase === "warm" && currentSnapshot.kind !== "return" ? "Moves with your knee" : undefined;
            drawKneeDial(ctx, dial, canvas.width, canvas.height, { progress: kneeShown.current?.progress ?? 0, lowering: currentSnapshot.kind === "return", armed: currentSnapshot.targetArmed, contact: frame.targetContact === true, hold: currentSnapshot.holdProgress, label: KNEE_LABELS[step] ?? "", now: t, reducedMotion: reduced, hint: practiceHint });
            const done = kneeDone.current;
            if (done?.key === repKey && t - done.startedAt < TARGET_COMPLETION_MS) drawTargetCompletion(ctx, { ...dialCircle(dial, done.step === KNEE_STEP.lower, canvas.width, canvas.height), elapsed: t - done.startedAt, reducedMotion: reduced });
          } catch (err) {
            console.warn("Knee dial drawing failed", err);
          }
        }
      }
      if (!opts.sim && session.cfg.id === TOE_ID && dial && !currentSnapshot.review && (currentSnapshot.phase === "warm" || currentSnapshot.phase === "reps")) {
        // Seated Toe Lift: the arrow at the toes, the ankle dial with its active circle, and the circle just completed.
        const canvas = overlayRef.current, ctx = canvas?.getContext("2d");
        if (canvas && ctx) {
          try {
            const step = currentSnapshot.stepIndex, reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            const repKey = `${currentSnapshot.phase}:${currentSnapshot.repIndex}`;
            if (kneeLast.current?.key === repKey && kneeLast.current.step !== step) kneeDone.current = { key: repKey, step: kneeLast.current.step, startedAt: t };
            kneeLast.current = { key: repKey, step };
            const guide = toeGuide(session.reference, dial, canvas.width / canvas.height);
            if (guide) drawToeGuide(ctx, guide, canvas.width, canvas.height, { lowering: currentSnapshot.kind === "return", emphasis: frame.targetContact !== true, now: t, reducedMotion: reduced });
            // In practice the dial says it moves with the foot (said once, in the practice instruction, too).
            const practiceHint = currentSnapshot.phase === "warm" && currentSnapshot.kind !== "return" ? "Moves with your foot" : undefined;
            drawToeDial(ctx, dial, canvas.width, canvas.height, { progress: kneeShown.current?.progress ?? 0, lowering: currentSnapshot.kind === "return", armed: currentSnapshot.targetArmed, contact: frame.targetContact === true, hold: currentSnapshot.holdProgress, label: TOE_LABELS[step] ?? "", now: t, reducedMotion: reduced, hint: practiceHint });
            const done = kneeDone.current;
            if (done?.key === repKey && t - done.startedAt < TARGET_COMPLETION_MS) drawTargetCompletion(ctx, { ...toeDialCircle(dial, done.step === TOE_STEP.lower, canvas.width, canvas.height), elapsed: t - done.startedAt, reducedMotion: reduced });
          } catch (err) {
            console.warn("Ankle dial drawing failed", err);
          }
        }
      }
      const slideScene = slideView.current;
      if (!opts.sim && session.cfg.id === SLIDE_ID && slideScene && !currentSnapshot.review && (currentSnapshot.phase === "warm" || currentSnapshot.phase === "reps")) {
        // Supported Arm Elevation: the active circle (the cup, or the resting place), the arrow showing the way, and the
        // circle just completed.
        const canvas = overlayRef.current, ctx = canvas?.getContext("2d");
        if (canvas && ctx) {
          try {
            const step = currentSnapshot.stepIndex, reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            const repKey = `${currentSnapshot.phase}:${currentSnapshot.repIndex}`;
            if (slideLast.current?.key === repKey && slideLast.current.step !== step) {
              slideDone.current = { key: repKey, circle: slideLast.current.step === SLIDE_STEP.back ? slideScene.rest : slideScene.cup, startedAt: t };
            }
            slideLast.current = { key: repKey, step };
            drawSlideTargets(ctx, canvas.width, canvas.height, { ...slideScene, returning: currentSnapshot.kind === "return", armed: currentSnapshot.targetArmed, contact: frame.targetContact === true, hold: currentSnapshot.holdProgress, label: SLIDE_LABELS[step] ?? "", now: t, reducedMotion: reduced });
            const done = slideDone.current;
            if (done?.key === repKey && t - done.startedAt < TARGET_COMPLETION_MS) drawTargetCompletion(ctx, { ...slideCanvasCircle(done.circle, canvas.width, canvas.height), elapsed: t - done.startedAt, reducedMotion: reduced });
          } catch (err) {
            console.warn("Cup target drawing failed", err);
          }
        }
      }
      if (!opts.sim && !currentSnapshot.review && reachTarget.current && !currentSnapshot.awaitingReady) {
        const label = (text: string, target: { x: number; y: number; radius: number }) => {
          const canvas = overlayRef.current, ctx = canvas?.getContext("2d");
          if (handOpening && canvas && ctx) drawRingLabel(ctx, (1 - target.x) * canvas.width, target.y * canvas.height, target.radius * canvas.height, text, canvas.height, currentSnapshot.targetArmed);
        };
        if (currentSnapshot.kind === "reach" || currentSnapshot.kind === "open") {
          targetCompletion.current = null;
          drawReachTarget(overlayRef.current, reachTarget.current, currentSnapshot.targetArmed, frame.targetContact === true || frame.targetUnsure === true, currentSnapshot.holdProgress);
          label("Open", reachTarget.current);
        } else if (currentSnapshot.kind === "return") {
          drawReachTarget(overlayRef.current, { x: reachTarget.current.lapX, y: reachTarget.current.lapY, radius: reachTarget.current.lapRadius ?? reachTarget.current.radius }, currentSnapshot.targetArmed, frame.targetContact === true, currentSnapshot.holdProgress);
          label("Close", { x: reachTarget.current.lapX, y: reachTarget.current.lapY, radius: reachTarget.current.radius });
          if (targetCompletion.current?.key !== reachTarget.current.key) targetCompletion.current = { key: reachTarget.current.key, startedAt: t };
          const canvas = overlayRef.current;
          const ctx = canvas?.getContext("2d");
          if (canvas && ctx) drawTargetCompletion(ctx, { x: (1 - reachTarget.current.x) * canvas.width, y: reachTarget.current.y * canvas.height, radius: reachTarget.current.radius * canvas.height, elapsed: t - targetCompletion.current.startedAt, reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches });
        }
      }
      debugRecorderRef.current?.capture(opts.sim ? ghostRef.current : videoRef.current, opts.sim ? null : overlayRef.current, currentSnapshot, frame);
      if (t - lastUi.current > 60) {
        lastUi.current = t;
        const snapshot = session.snapshot();
        setSnap(snapshot);
        const targets = session.targets();
        setLive({
          roms: session.cfg.romSteps.map(rom => ({ label: rom.label, value: frame!.values[rom.metric], target: targets[rom.id], start: usesTargetFlow(session.cfg.id) ? snapshot.startingAngles[rom.id] ?? NaN : 0, unit: "°", scale: metricUnit(rom.metric), units: metricUnitName(rom.metric) })),
          comps: session.cfg.compensations.map(comp => ({ label: comp.label, value: compensationStatus(frame!.comps, comp).ratio, limit: 1 })),
        });
        drawGhostFor(ghostRef.current, session, snapshot, opts.sim ? simRef.current.level : snapshot.liveAttainment, opts.side, opts.armrest);
        if (snapshot.phase === "done") {
          void debugRecorderRef.current?.finish();
          // Release the camera but let the wrap-up sentence finish speaking.
          trackerRef.current?.close();
          trackerRef.current = null;
          streamRef.current?.getTracks().forEach(track => track.stop());
          streamRef.current = null;
          return;
        }
      }
    }
    rafRef.current = window.setTimeout(loop, 16);
  }, [opts.side, opts.sim, opts.armrest, stopAll]);

  // ---------- start / stop ----------

  const begin = useCallback(async () => {
    if (previewScreen) { selectPreview("setup"); return; }
    if (!cfg || !base || beginningRef.current) return;
    beginningRef.current = true;
    setStage("loading");
    try {
    stopAll();
    await debugRecorderRef.current?.finish();
    if (!debugSessionRef.current) {
      setDebugClips([]);
      setDebugError("");
      setDebugDirectory("");
      try {
        debugSessionRef.current = await beginDebugVideos(base.id, opts.sim);
        setDebugDirectory(debugSessionRef.current.directory);
      } catch (error) { setDebugError(error instanceof Error ? error.message : "Local debug recordings could not start."); }
    }
    writeLabOptions({ side: opts.side, quick: opts.quick, sim: opts.sim, chairBack: opts.chairBack, assisted: opts.assisted, armrest: opts.armrest });
    savedRecord.current = null;
    reachTarget.current = null;
    cupTrack.current.reset();
    handZoneRef.current = null;
    graspLayoutRef.current = null;
    cupCarry.current = new CupCarry();
    graspCup.current = null;
    graspDone.current = null;
    graspLast.current = null;
    lightingProbe.current.reset();
    lighting.current = null;
    pinchTarget.current.reset();
    pinchShown.current = null;
    pinchDone.current = null;
    pinchLast.current = null;
    kneeDialRef.current = null;
    kneeTarget.current.reset();
    toeTarget.current.reset();
    toeFilter.current.reset();
    kneeShown.current = null;
    kneeDone.current = null;
    kneeLast.current = null;
    slideOutRef.current = null;
    slideTarget.current.reset();
    slideCup.current = null;
    slidePractice.current = null;
    slideView.current = null;
    slideDone.current = null;
    slideLast.current = null;
    mouthHold.current.reset();
    mouthHoldKey.current = "";
    bodyProgress.current = {};
    bodyLastT.current = 0;
    setBodyChecks(cameraBodyChecks({ cfg }, { pose: null, hands: [] } as unknown as Detection, opts.side).map(check => ({ ...check, progress: 0 })));
    // The everyday exercise speaks in Alira's voice; the others keep the device voice while in development.
    const voice = createVoice({ alira: base.id === EVERYDAY_EXERCISE_ID, aliraOnly: base.id === EVERYDAY_EXERCISE_ID });
    voice.stop();
    voice.setMuted(muted);
    voice.onSay = setSaid;
    setEnglishAvailable(true);
    voice.onAvailability = setEnglishAvailable;
    voiceRef.current = voice;
    lastVideoTime.current = -1;
    simRef.current = { ...simRef.current, level: 0, manual: false, sliderLevel: 0, lastT: 0, stepKey: "" };
    setSimLevel(0);
    // Alira's exercise settings are read once here, so nothing changes mid-session.
    const session = new ExerciseSession({ exerciseId: base.id, rung: opts.rung, side: opts.side, chairBack: opts.chairBack, armrest: opts.armrest, repsOverride: opts.quick ? 3 : undefined, assisted: opts.assisted, reviewBetweenReps: true, tuning: loadExerciseTuning(base.id) }, voice);
    sessionRef.current = session;
    sessionSim.current = opts.sim;
    debugRecorderRef.current = debugSessionRef.current ? new DebugVideoRecorder(debugSessionRef.current, session.cfg.compensations, () => session.reference, clip => setDebugClips(clips => [...clips.filter(item => item.name !== clip.name), clip]), setDebugError) : null;
    setError("");
    if (!opts.sim) {
      setStage("loading");
      try {
        // Hand opening tracks the hand every frame (on the graphics processor when it can) and the body every third.
        // Pinch and Peg tracks as hand opening does: the hand every frame, the body every third.
        const tracker = await createTracker(cfg.tracking, cfg.id === "ex_handopen" || cfg.id === PINCH_ID ? { poseEvery: 3, handGpu: true } : cfg.id === "ex_grasp" ? { poseEvery: 2, handGpu: true } : undefined);
        trackerRef.current = tracker;
        // The run view (and its <video>) only renders once there is a snapshot, so set both, then wait for the element.
        setSnap(session.snapshot());
        setStage("run");
        for (let i = 0; i < 50 && !videoRef.current; i++) await new Promise(resolve => setTimeout(resolve, 20));
        if (!videoRef.current) throw new Error("The camera view did not open.");
        streamRef.current = await openCamera(videoRef.current);
      } catch (err) {
        stopAll();
        const message = err instanceof Error ? err.message : String(err);
        setError(/denied|permission|NotAllowed/i.test(message) ? "Camera permission was blocked. Allow the camera for this site, then choose Try again, or use the no-camera simulation below." : `Could not start the camera or movement model: ${message}`);
        setStage("error");
        return;
      }
    } else {
      setSnap(session.snapshot());
      setStage("run");
    }
    session.start(performance.now());
    setSnap(session.snapshot());
    rafRef.current = window.setTimeout(loop, 16);
    } finally { beginningRef.current = false; }
  }, [base, cfg, loop, muted, opts, stopAll, previewScreen, selectPreview]);

  const reset = useCallback(() => {
    learnFromSession();
    stopAll();
    sessionRef.current = null;
    debugSessionRef.current = null;
    setSnap(null);
    setSaid("");
    setStage("intro");
  }, [stopAll, learnFromSession]);

  const changeRedoOpen = (open: boolean) => {
    setRedoOpen(open);
    voiceRef.current?.stop();
    if (open) voiceRef.current?.say("Only redo this exercise if you have enough energy and do not feel fatigued. If you feel tired, rest for now.");
  };

  useEffect(() => {
    if (runSnapshot?.record && runSnapshot.record.finished_at !== savedRecord.current) {
      savedRecord.current = runSnapshot.record.finished_at;
      saveLabSession(runSnapshot.record, { side: opts.side, sim: opts.sim });
      // Simulated attempts count in local and Render review testing.
      if (!runSnapshot.record.not_attempted && (!opts.sim || administrativeControlsEnabled())) recordExerciseResult(exerciseId, runSnapshot.record.score);
      if (!muted) return;
    }
  }, [runSnapshot?.record, opts.side, opts.sim, muted, exerciseId]);

  const backToSettings = () => {
    learnFromSession();
    stopAll();
    if (fromJourney) { navigate("/journey?tab=progress"); return; }
    navigate("/");
    setTimeout(() => openSettings(null, "exercise"), 50);
  };

  const completeExercise = () => {
    const record = sessionRef.current?.snapshot().record;
    if (!record || record.not_attempted || (opts.sim && !administrativeControlsEnabled())) { backToSettings(); return; }
    learnFromSession();
    stopAll();
    recordExerciseResult(exerciseId, record.score);
    const path = exerciseCompletionPath(exerciseId);
    if (loadExerciseCompletion(path.split("?")[1], loadRememberedAssessment())) navigate(path);
    else backToSettings();
  };

  if (!base || !cfg || !rungSpec) {
    return (
      <div className="xe-page"><div className="xe-card"><h1>That exercise is not in the launch set</h1><button className="xe-primary" onClick={backToSettings}>Back to settings</button></div></div>
    );
  }

  const done = snap?.phase === "done" && snap.record;
  const beatActive = snap ? (snap.idlePrompt ? 5 : snap.beat) : 0;
  const runView = preview ? !["intro", "loading", "error", "results", "redo"].includes(previewScreen!) : stage === "run";
  const previewIndex = EXERCISE_PREVIEW_SCREENS.findIndex(screen => screen.id === previewScreen);
  const reachDemo = snap?.phase === "demo" && usesTargetFlow(cfg.id)
    ? cfg.id === "ex_grasp" ? graspDemoState(snap.demoStepElapsedMs, Math.max(0, snap.demoStepIndex), snap.targetArmed)
    : cfg.id === PINCH_ID ? pinchDemoState(snap.demoStepElapsedMs, pinchStepOf(cfg.cycle, snap.demoStepIndex), snap.targetArmed)
    : cfg.id === SLIDE_ID ? slideDemoState(snap.demoStepElapsedMs, cfg.cycle[snap.demoStepIndex]?.kind === "return", snap.targetArmed, opts.armrest)
    : demoStateFor(cfg.id)(snap.demoStepElapsedMs, cfg.cycle[snap.demoStepIndex]?.kind === "return", snap.targetArmed) : null;
  // "How did that feel?": stored for Alira's safety rules and learning (never in the screen preview), then learning starts.
  const saveFelt = (answer: FeltAnswer) => {
    if (preview) return;
    saveReport({ source: "exercise", exerciseId: base.id, felt: answer.felt, pain: answer.pain, stopped: answer.stopped });
    learnFromSession();
  };

  return (
    <div className="xe-page">
      <header className="xe-top">
        <button className="xe-back" onClick={backToSettings}><ArrowLeft size={18} aria-hidden="true" /> {fromJourney ? "Journey" : "Settings"}</button>
        <div className="xe-title">
          <span className="xe-domain">{DOMAIN_LABEL[base.domain]}</span>
          <h1>{base.name}</h1>
        </div>
        <span className="xe-badge">{LEVEL_LABEL[snap?.rung ?? opts.rung]}</span>
        {stage === "run" && !preview && (
          <button className="xe-icon" onClick={() => { const next = !muted; setMuted(next); voiceRef.current?.setMuted(next); }} aria-label={muted ? "Turn voice on" : "Turn voice off"} title={muted ? "Voice off" : "Voice on"}>
            {muted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
        )}
      </header>
      {preview && <nav className="xe-preview-toolbar" aria-label="Exercise screen preview">
        <div><b>Screen preview</b><span>Camera off · sample content · screens stay still</span></div>
        <label><span className="sr-only">Preview screen</span><select aria-label="Preview screen" value={previewScreen!} onChange={event => selectPreview(event.target.value as ExercisePreviewScreen)}>{EXERCISE_PREVIEW_SCREENS.map(screen => <option key={screen.id} value={screen.id}>{screen.label}</option>)}</select></label>
        <div className="xe-preview-actions">
          <button className="xe-back" aria-label="Previous preview screen" disabled={previewIndex <= 0} onClick={() => selectPreview(EXERCISE_PREVIEW_SCREENS[previewIndex - 1].id)}>Previous</button>
          <button className="xe-back" aria-label="Next preview screen" disabled={previewIndex >= EXERCISE_PREVIEW_SCREENS.length - 1} onClick={() => selectPreview(EXERCISE_PREVIEW_SCREENS[previewIndex + 1].id)}>Next</button>
          <button className="xe-back" onClick={() => selectPreview(null)}>Exit preview</button>
        </div>
      </nav>}
      {!preview && !englishAvailable && !muted && <p className="xe-note" role="status">{base.id === EVERYDAY_EXERCISE_ID ? "Alira’s audio could not play. Follow the instructions below." : "An English voice is unavailable in this browser. Instructions are shown in English below."}</p>}

      {runView && snap && !done && (
        <ol className="xe-beats" aria-label="Session beats">
          {BEATS.map((label, i) => (
            <li key={label} className={i + 1 === beatActive ? "is-on" : i + 1 < beatActive || (i + 1 === 5 ? snap.rescued : false) ? "is-past" : ""}>
              {preview || (i < 3 && i + 1 < snap.beat) ? <button type="button" aria-label={preview ? `Preview ${label}` : `Go back to ${label}`} onClick={() => {
                if (preview) { selectPreview((["setup", "demo-reach", "warm-reach", "reps-reach", "rescue", "results"] as ExercisePreviewScreen[])[i]); return; }
                const session = sessionRef.current;
                if (session?.goBack(i + 1, performance.now())) {
                  if (i === 0) {
                    bodyProgress.current = {}; bodyLastT.current = 0; setBodyChecks(checks => checks.map(check => ({ ...check, progress: 0 })));
                    // A set-up done again places the knee dial (or the cup beside the arm) afresh.
                    kneeDialRef.current = null;
                    slideOutRef.current = null;
                  }
                  setSnap(session.snapshot());
                }
              }}><span>{i + 1}</span>{label}</button> : <><span>{i + 1}</span>{label}</>}
            </li>
          ))}
        </ol>
      )}

      {(previewScreen === "intro" || (!preview && stage === "intro")) && (
        <Intro base={base} cfg={cfg} opts={opts} setOpts={setOpts} muted={muted} setMuted={setMuted} onStart={begin} onPreview={usesTargetFlow(base.id) ? () => selectPreview("intro") : undefined} />
      )}

      {(previewScreen === "loading" || (!preview && stage === "loading")) && (
        <div className="xe-card xe-center" role="status"><LoaderCircle className="xe-spin" size={30} aria-hidden="true" /><p>Opening the camera and movement model...</p></div>
      )}

      {(previewScreen === "error" || (!preview && stage === "error")) && (
        <div className="xe-card" role="alert">
          <h2>Couldn't start</h2><p>{preview ? "Camera permission was blocked. Allow the camera for this site, then try again." : error}</p>
          <div className="xe-actions">
            <button className="xe-primary" onClick={begin}><RotateCcw size={16} aria-hidden="true" /> Try again</button>
            <button className="xe-secondary" onClick={() => { if (preview) { selectPreview("setup"); return; } setOpts(o => ({ ...o, sim: true })); reset(); }}>Use no-camera simulation</button>
            <button className="xe-secondary" onClick={() => preview ? selectPreview("intro") : reset()}>Back</button>
          </div>
        </div>
      )}

      {runView && snap && !done && (
        <div className="xe-run">
          <section className="xe-stage" aria-label={preview ? "Camera area preview" : opts.sim ? "Simulated patient" : "Camera view"}>
            {preview ? <div className="xe-simstage"><canvas ref={previewCanvasRef} width={640} height={480} aria-label="Exercise pose and target preview" /><span className="xe-simtag">Camera off · screen preview</span></div> : opts.sim ? (
              <div className="xe-simstage"><canvas ref={ghostRef} width={480} height={390} aria-label={reachDemo ? `Movement demonstration: ${reachDemo.instruction}` : usesTargetFlow(cfg.id) && (snap.phase === "warm" || snap.phase === "reps") ? `${cfg.id === "ex_grasp" ? GRASP_LABELS[snap.stepIndex] ?? "Cup" : cfg.id === KNEE_ID ? KNEE_LABELS[snap.stepIndex] ?? "Knee" : cfg.id === TOE_ID ? TOE_LABELS[snap.stepIndex] ?? "Toes" : cfg.id === SLIDE_ID ? SLIDE_LABELS[snap.stepIndex] ?? "Slide" : cfg.id === PINCH_ID ? snap.kind === "return" ? "Let go" : "Pinch" : cfg.id === "ex_handopen" ? snap.kind === "return" ? "Relax" : "Open" : snap.kind === "return" ? "Lap" : cfg.id === "ex_h2m" ? "Mouth" : "Reach"} target ${snap.targetArmed ? "active" : "inactive while the instruction plays"}` : "Movement ghost"} /><span className="xe-simtag">No camera · simulated patient</span></div>
            ) : (
              <div className="xe-video">
                <video ref={videoRef} playsInline muted />
                <canvas ref={overlayRef} aria-label={usesTargetFlow(cfg.id) && (snap.phase === "warm" || snap.phase === "reps") ? snap.targetArmed ? "Active movement target" : "Inactive movement target — listen to the instruction" : "Movement tracking overlay"} />
              </div>
            )}
            {snap.prompt && <div className="xe-prompt" role="status">{snap.prompt}</div>}
          </section>

          <aside className="xe-side">
            <div className="xe-card xe-coach">
              <h2>{snap.phase === "setup" ? (snap.calibrationProgress > 0 ? "Hold still..." : "Get in view") : snap.phase === "demo" && !snap.demoReady ? "Watch the demonstration on the right" : snap.caption || (snap.phase === "demo" ? "Watch the movement" : "Get ready")}</h2>
              {snap.phase === "demo" && (snap.demoReady || usesTargetFlow(cfg.id)) && (preview || !opts.sim) && <canvas ref={ghostRef} className="xe-ghost" width={300} height={240} aria-label={reachDemo ? `Movement demonstration: ${reachDemo.instruction}` : "Movement ghost"} />}
              {reachDemo && <p className="xe-hint">{reachDemo.instruction}</p>}
              <p className="xe-said" aria-live="polite">{viewSaid && !(viewSaid === NEXT_REP_COUNTDOWN_LINE && !snap.review) ? `"${viewSaid}"` : ""}</p>
              {snap.phase === "setup" && <div className="xe-meter"><i style={{ width: `${snap.calibrationProgress * 100}%` }} /></div>}
              {(snap.phase === "warm" || snap.phase === "reps") && (
                <>
                  {cfg.id === "ex_handopen" && !snap.review && <HandSteps current={snap.awaitingReady ? 0 : snap.kind === "return" ? 2 : 1} />}
                  {cfg.id === "ex_grasp" && !snap.review && <HandSteps steps={GRASP_STEPS} current={snap.stepIndex} label="Steps of this repetition" />}
                  {cfg.id === KNEE_ID && !snap.review && <HandSteps steps={KNEE_STEPS} current={snap.stepIndex} label="Steps of this repetition" />}
                  {cfg.id === TOE_ID && !snap.review && <HandSteps steps={TOE_STEPS} current={snap.stepIndex} label="Steps of this repetition" />}
                  {cfg.id === SLIDE_ID && !snap.review && <HandSteps steps={SLIDE_STEPS} current={snap.stepIndex} label="Steps of this repetition" />}
                  {cfg.id === PINCH_ID && !snap.review && <HandSteps steps={PINCH_STEPS} current={snap.awaitingReady ? 0 : snap.stepIndex + 1} label="Steps of this repetition" />}
                  <div className={`xe-gauge ${snap.inZone ? "is-zone" : ""}`} aria-label="Hold on target" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(snap.holdProgress * 100)}>
                    <i className="fill" style={{ width: `${snap.holdProgress * 100}%` }} />

                  </div>
                  <p className="xe-hint">{snap.awaitingReady ? "Show me your palm in the shaded area to begin" : !snap.targetArmed ? "Listen to the instruction. Wait for the circle to become active." : cfg.id === "ex_grasp" ? snap.inZone ? "Hold it there..." : GRASP_HINTS[snap.stepIndex] ?? ""
                    : cfg.id === TOE_ID ? snap.kind === "return" ? "Lower your toes slowly to the floor and pause" : snap.inZone ? "Hold it there..." : "Keeping your heel down, lift your toes until the ankle dial reaches its circle"
                    : cfg.id === KNEE_ID ? snap.kind === "return" ? "Lower your foot slowly to the floor and pause" : snap.inZone ? "Hold it there..." : "Straighten your knee, swinging your foot out along the arrow, until the knee dial reaches its circle"
                    : cfg.id === PINCH_ID ? snap.kind === "return" ? "Open your thumb and finger to let the peg drop into the tray" : snap.inZone ? "Hold the peg..." : `Bring your thumb to your ${PINCH_FINGERS[pinchStepOf(cfg.cycle, snap.stepIndex).finger].name}, tip to tip, in the circle`
                    : cfg.id === SLIDE_ID ? snap.kind === "return" ? "Bring your hand back to rest where it started and pause" : snap.inZone ? "Hold it there..." : "Follow the arrow: move your hand out to the cup"
                    : cfg.id === "ex_handopen" ? snap.kind === "return" ? "Close your hand into the small circle and pause" : snap.inZone ? "Hold it there..." : "Open your fingers out to the ring, keeping your wrist straight" : snap.kind === "return" || snap.kind === "close" ? "Return your hand to the lap circle and pause" : snap.inZone ? "Hold it there..." : cfg.id === "ex_h2m" ? "Bring your hand to the mouth circle, keeping your head up" : "Reach your hand into the target ring"}</p>
                </>
              )}
              {snap.feedback && <p className="xe-feedback" role="status">{snap.feedback}</p>}
              {snap.arrow && <p className="xe-arrow">Watch your form: {cfg.compensations.find(c => c.id === snap.arrow)?.label ?? "your form"}</p>}
              {snap.idlePrompt && (
                <div className="xe-idle" role="alert">
                  <b>Do you want to skip this one for today?</b>
                  <button className="xe-primary" onClick={() => preview ? selectPreview("results") : sessionRef.current?.skip(performance.now())}><SkipForward size={16} aria-hidden="true" /> Skip</button>
                </div>
              )}
            </div>

            {snap.phase === "reps" || snap.reps.length > 0 ? (
              <div className="xe-card">
                <p className="xe-eyebrow">Reps</p>
                <div className="xe-dots">
                  {Array.from({ length: snap.repsPlanned }, (_, i) => {
                    const rep = snap.reps[i];
                    return <span key={i} className={rep ? (rep.score >= 85 ? "good" : rep.score >= 55 ? "ok" : "low") : i + 1 === snap.repIndex ? "now" : ""} title={rep ? `Rep ${i + 1}: ${rep.score}` : `Rep ${i + 1}`}>{rep ? rep.score : i + 1}</span>;
                  })}
                </div>
                {snap.rescued && <p className="xe-note">Two misses in a row, so the target moved closer: now level {snap.rung} of 3.</p>}
              </div>
            ) : null}

            {snap.phase === "setup" ? (
              <div className="xe-card xe-body-checks">
                <h3>Bring each part into view</h3>
                {viewChecks.map(check => {
                  const progress = !preview && opts.sim ? snap.calibrationProgress : check.progress;
                  const visible = (!preview && opts.sim) || check.visible;
                  return <div className={`xe-body-check ${visible ? "is-visible" : "is-missing"}`} key={check.id}>
                    <div className="xe-body-label"><b>{check.label}</b><span>{visible ? progress >= 1 ? "In view ✓" : "Found · keep in view" : "Move into view"}</span></div>
                    <div className="xe-body-meter" role="progressbar" aria-label={`${check.label} visibility`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{ transform: `scaleX(${progress})` }} /></div>
                    {!visible && <p>{check.hint}</p>}
                  </div>;
                })}
              </div>
            ) : snap.phase !== "demo" ? <div className="xe-card xe-live">
              <h3>Movement</h3>
              {!snap.targetsReady && <p className="xe-note">{cfg.id === "ex_handopen" ? "Hold your hand open at the practice ring so I can learn your movement goals." : cfg.id === KNEE_ID ? "Straighten your knee out along the arrow until the knee dial reaches its practice circle, and hold so I can learn your movement goal." : cfg.id === TOE_ID ? "Keeping your heel down, lift your toes until the ankle dial reaches its practice circle, and hold so I can learn your movement goal." : cfg.id === SLIDE_ID ? "Move your hand out to the practice cup and hold so I can learn your movement goals." : cfg.id === PINCH_ID ? "Bring your thumb to the practice circle and hold so I can learn your pinch for each finger." : usesTargetFlow(cfg.id) ? "Hold at the practice circle so I can learn your movement goals." : "Learning your starting position. Your movement goals will appear after practice."}</p>}
              {viewLive.roms.map(r => <MetricBar key={r.label} label={r.label} value={r.value} threshold={r.target} start={r.start} scale={r.scale} units={r.units} ready={snap.targetsReady} personalized={usesTargetFlow(cfg.id)} pending={cfg.id === "ex_handopen" ? "Keep opening" : cfg.id === KNEE_ID ? "Keep straightening" : cfg.id === TOE_ID ? "Keep lifting" : cfg.id === SLIDE_ID ? "Keep moving out" :cfg.id === PINCH_ID ? "Keep closing" : undefined} />)}
              {viewLive.comps.map(c => <MetricBar key={c.label} label={c.label} value={c.value} threshold={c.limit} ready={snap.targetsReady} limit />)}
            </div> : null}

            {!preview && opts.sim && (
              <div className="xe-card xe-sim">
                <p className="xe-eyebrow">Simulated patient</p>
                <label>Auto patient
                  <select value={auto} onChange={e => { setAuto(e.target.value as AutoMode); simRef.current.manual = false; }}>
                    <option value="good">Does every rep well</option>
                    <option value="short">Reaches about 82% of the target</option>
                    <option value="leaning">Reaches but uses a compensation</option>
                    <option value="weak">Can only reach 45% (triggers the rescue)</option>
                    <option value="off">I'll move it myself (slider)</option>
                  </select>
                </label>
                <label>Movement: {Math.round(simLevel * 100)}% of target
                  <input type="range" min={0} max={110} value={Math.round(simLevel * 100)} onChange={e => { const v = Number(e.target.value) / 100; setSimLevel(v); simRef.current.sliderLevel = v; simRef.current.manual = true; setAuto("off"); }} />
                </label>
                {cfg.compensations.map(comp => (
                  <label key={comp.id} className="xe-check"><input type="checkbox" checked={simComps.includes(comp.id)} onChange={e => setSimComps(list => (e.target.checked ? [...list, comp.id] : list.filter(id => id !== comp.id)))} /> Use {comp.label}</label>
                ))}
              </div>
            )}

          </aside>
        </div>
      )}

      {snap?.review === "complete" && <div className="xe-review-backdrop" key="completion">
        <div className="xe-review-card" role="dialog" aria-modal={!preview} aria-labelledby="xe-review-title">
          <span className="xe-review-check" aria-hidden="true">✓</span>
          <h2 id="xe-review-title">Repetition {snap.reps.length} complete</h2>
          <p className="xe-review-score">{snap.reps.at(-1)?.score} / 100</p>
          <ul>{snap.reviewAdvice.map(advice => <li key={advice}>{advice}</li>)}</ul>
        </div>
      </div>}

      {snap?.review === "countdown" && <div className="xe-review-backdrop" key="countdown">
        <div className="xe-review-card xe-countdown-card" role="dialog" aria-modal={!preview} aria-labelledby="xe-countdown-title">
          <h2 id="xe-countdown-title">Get ready for repetition {snap.reps.length + 1}</h2>
          <div className="xe-countdown" role="timer" aria-label="Next repetition starts in three seconds">
            <svg viewBox="0 0 80 80" aria-hidden="true"><circle className="track" cx="40" cy="40" r="33" /><circle className="progress" cx="40" cy="40" r="33" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - snap.countdownProgress} /></svg>
            <b>{Math.max(1, Math.ceil(3 * (1 - snap.countdownProgress)))}</b>
            <p>Next repetition starts in {Math.max(1, Math.ceil(3 * (1 - snap.countdownProgress)))} {snap.countdownProgress >= 2 / 3 ? "second" : "seconds"}</p>
          </div>
          {cfg.id === "ex_handopen" && <p className="xe-countdown-note"><Hand size={16} aria-hidden="true" /> Hand up in the shaded area, fingers relaxed.</p>}
          {cfg.id === "ex_grasp" && <p className="xe-countdown-note"><Hand size={16} aria-hidden="true" /> Hand resting on your lap, ready to reach for the cup.</p>}
          {cfg.id === KNEE_ID && <p className="xe-countdown-note"><Footprints size={16} aria-hidden="true" /> Sit tall, both feet flat on the floor, ready to straighten your knee.</p>}
          {cfg.id === TOE_ID && <p className="xe-countdown-note"><Footprints size={16} aria-hidden="true" /> Sit tall, heel down, ready to lift your toes.</p>}
          {cfg.id === SLIDE_ID && <p className="xe-countdown-note"><Hand size={16} aria-hidden="true" /> Forearm resting beside you, ready to move your hand out to the cup.</p>}
          {cfg.id === PINCH_ID && <p className="xe-countdown-note"><Hand size={16} aria-hidden="true" /> Hand up in the shaded area, thumb apart from your finger.</p>}
        </div>
      </div>}

      {done && snap && snap.record && <Results snap={snap} base={base} cfg={cfg} clips={preview ? [] : debugClips} debugDirectory={preview ? "" : debugDirectory} onAgain={() => preview ? selectPreview("redo") : changeRedoOpen(true)} onBack={() => preview ? selectPreview("intro") : completeExercise()} onFelt={saveFelt} />}
      {previewScreen === "redo" && <div className="fixed inset-0 z-50 bg-black/50" aria-hidden="true" />}
      <Dialog open={preview ? previewScreen === "redo" : redoOpen} onOpenChange={open => preview ? !open && selectPreview("results") : changeRedoOpen(open)} modal={!preview}>
        <DialogContent className="xe-redo-dialog" showCloseButton={false} onInteractOutside={event => { if (preview) event.preventDefault(); }} onOpenAutoFocus={event => { if (preview) event.preventDefault(); }}>
          <DialogTitle>Ready to exercise again?</DialogTitle>
          <DialogDescription>Only redo this exercise if you have enough energy and do not feel fatigued. If you feel tired, rest for now.</DialogDescription>
          <div className="xe-actions">
            <button className="xe-secondary" onClick={() => preview ? selectPreview("results") : changeRedoOpen(false)}>Rest for now</button>
            <button className="xe-primary" onClick={() => { if (preview) { selectPreview("intro"); return; } changeRedoOpen(false); reset(); }}>I have enough energy</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- pieces ----------

/** Settings that only change some exercises (appliesTo in shared/alira-adaptation.ts); the others change every exercise. */
const ONLY_SOME_EXERCISES: Partial<Record<string, (exerciseId: string) => boolean>> = {
  "exercise.reach_height_scale": id => id === "ex_reach",
  "exercise.target_size_scale": id => usesSeatedTargets(id),
  "exercise.target_zone": id => !usesTargetFlow(id),
};
const adjustsExercise = (tuning: ExerciseTuning, exerciseId: string) => Object.keys(tuning.changed).some(key => ONLY_SOME_EXERCISES[key]?.(exerciseId) ?? true);

function Intro(props: { base: (typeof EXERCISES)[string]; cfg: ReturnType<typeof resolveExercise>; opts: LabOptions & { rung: Rung }; setOpts: (o: LabOptions & { rung: Rung }) => void; muted: boolean; setMuted: (m: boolean) => void; onStart: () => void; onPreview?: () => void }) {
  const { base, cfg, opts, setOpts, muted, setMuted, onStart, onPreview } = props;
  // Alira's settings as they stand now, so the numbers shown match the session (which reads them again when it starts).
  const tuning = loadExerciseTuning(base.id);
  const spec = buildRung(base.id, opts.rung);
  const reps = opts.quick ? 3 : tunedReps(spec.reps, tuning);
  const set = (patch: Partial<LabOptions & { rung: Rung }>) => setOpts({ ...opts, ...patch });
  return (
    <div className="xe-card xe-intro">
      {!usesTargetFlow(base.id) && <p className="xe-eyebrow">{base.chain}</p>}
      <h2>{base.name}</h2>
      {!usesTargetFlow(base.id) && <p>For: <b>{base.dailyTask}</b>. Camera: {base.framing}. Tracking: {cfg.tracking === "hand" ? "hand" : cfg.tracking === "pose" ? "body pose" : "body pose and hand"}.</p>}
      {tuning.adapted && adjustsExercise(tuning, base.id) && <p className="xe-note xe-adapted"><Sparkles size={14} aria-hidden="true" /> Alira has adjusted this exercise for you today.</p>}
      <div className="xe-rungs" role="radiogroup" aria-label="Level">
        {([1, 2, 3] as Rung[]).map(rung => {
          const r = buildRung(base.id, rung);
          const unavailable = usesTargetFlow(base.id) && rung !== 1;
          return (
            <button key={rung} role="radio" disabled={unavailable} aria-checked={!unavailable && opts.rung === rung} className={!unavailable && opts.rung === rung ? "is-on" : ""} onClick={() => set({ rung })}>
              <b>{LEVEL_LABEL[rung]}</b>
              {unavailable && <span>Not available now</span>}
              {!usesTargetFlow(base.id) && <span>{cfg.romSteps.map(rom => `${rom.label} ${r.targets[rom.id]}°`).join(" · ")}</span>}
              <em>{tunedReps(r.reps, tuning)} reps · {usesTargetFlow(base.id) ? `hold ${Math.round(TARGET_HOLD_MS * tuning.holdFactor) / 1000}s` : `hold ×${Math.round(r.holdScale * tuning.holdFactor * 100) / 100}`}{r.oppositions ? ` · ${r.oppositions} pinch${r.oppositions > 1 ? "es" : ""}` : ""}</em>
            </button>
          );
        })}
      </div>
      <div className="xe-options">
        <label><span>Affected side</span>
          <select value={opts.side} onChange={e => set({ side: e.target.value as Side })}><option value="right">Right</option><option value="left">Left</option></select>
        </label>
        {base.id === SLIDE_ID && <label><span>Arm support</span>
          <select value={opts.armrest ? "armrest" : "table"} onChange={e => set({ armrest: e.target.value === "armrest" })}><option value="table">Table beside me</option><option value="armrest">Chair armrest</option></select>
        </label>}
        {!usesTargetFlow(base.id) && <>
        <label className="xe-check"><input type="checkbox" checked={opts.quick} onChange={e => set({ quick: e.target.checked })} /> Quick test: 3 reps instead of {tunedReps(spec.reps, tuning)}</label>
        <label className="xe-check"><input type="checkbox" checked={opts.sim} onChange={e => set({ sim: e.target.checked })} /> No camera (simulate a patient)</label>
        <label className="xe-check"><input type="checkbox" checked={opts.assisted} onChange={e => set({ assisted: e.target.checked })} /> Someone helped (score × 0.5)</label>
        <label className="xe-check"><input type="checkbox" checked={muted} onChange={e => setMuted(e.target.checked)} /> Mute the voice (subtitles only)</label>
        </>}
      </div>
      {cfg.tracking !== "pose" && !opts.sim && <p className="xe-note"><Hand size={14} aria-hidden="true" /> {base.id === "ex_handopen" ? "Rest your elbow on an armrest or table and hold your hand up in the shaded area beside your body, at chest height, palm to the camera. That keeps your face and both shoulders in view." : base.id === "ex_grasp" ? "Sit without a table, with your head to mid-thigh in view and both hands resting on your thighs. The cup is drawn on screen. Have good light in front of you."
        : base.id === PINCH_ID ? "Rest your elbow on an armrest or table and hold your hand up in the shaded area beside your body, at chest height, palm to the camera. The peg and tray are drawn on screen. Have good light in front of you."
        : "Hold the hand close to the camera with every fingertip in view."}</p>}
      {base.id === SLIDE_ID && !opts.sim && <p className="xe-note"><Hand size={14} aria-hidden="true" /> {opts.armrest ? "Rest your forearm on the armrest of your chair and your other hand on your thigh." : "Sit with a table beside your affected side, forearm resting on it and your other hand on your thigh."} Place the camera in front of you at chest height so you are in view from your head to your thighs, with room beside your arm and good light in front of you. Follow the arrow out to the side and a little forward, not toward the camera.</p>}
      {base.id === KNEE_ID && !opts.sim && <p className="xe-note"><Footprints size={14} aria-hidden="true" /> Place the camera about 2 metres in front of you at knee to hip height, so you are in view from your head to your feet while you sit. Use a stable chair with a back, keep a carer nearby, and have good light in front of you. When you straighten your knee, swing your foot a little out to the side, as the arrow shows: straight toward the camera, it can hardly see your knee move.</p>}
      {base.id === TOE_ID && !opts.sim && <p className="xe-note"><Footprints size={14} aria-hidden="true" /> Place the camera about 2 metres in front of you at about knee height, so you are in view from your head to your feet while you sit. Use a stable chair with a back, keep a carer nearby, and have good light in front of you. Bare feet or thin flat shoes work best; your heel stays on the floor and your foot stays where it is.</p>}
      {base.domain === "lower_limb" && base.id !== KNEE_ID && base.id !== TOE_ID && !opts.sim && <p className="xe-note">Lower-limb tracking seated and front-on is unverified. If the angles look unstable, try the simulator or a side-on phone position.</p>}
      <div className="xe-actions">
        <button className="xe-primary" onClick={onStart}>{opts.sim ? <Play size={16} aria-hidden="true" /> : <Camera size={16} aria-hidden="true" />} Start · {reps} reps · {LEVEL_LABEL[opts.rung]}</button>
        {onPreview && <button className="xe-secondary" onClick={onPreview}><Eye size={16} aria-hidden="true" /> Preview exercise screens</button>}
      </div>
    </div>
  );
}

function Results({ snap, base, cfg, clips, debugDirectory, onAgain, onBack, onFelt }: { snap: Snapshot; base: (typeof EXERCISES)[string]; cfg: ReturnType<typeof resolveExercise>; clips: DebugClip[]; debugDirectory: string; onAgain: () => void; onBack: () => void; onFelt: (answer: FeltAnswer) => void }) {
  const record = snap.record!;
  return (
    <div className="xe-card xe-results" role="status">
      <span className="xe-tick"><Check size={34} aria-hidden="true" /></span>
      <h2>{record.not_attempted ? "Skipped for today" : `${base.name} done`}</h2>
      {!record.not_attempted && (
        <div className="xe-three">
          <div><b>{record.score}</b><span>score out of 100{record.assisted ? " (assisted × 0.5)" : ""}</span></div>
          <div><b>{record.quality_reps}/{record.reps_planned}</b><span>good reps</span></div>
          <div><b>{LEVEL_LABEL[record.rung_end]}</b><span>level{record.rung_end !== record.rung_start ? ` (started at ${LEVEL_LABEL[record.rung_start]})` : ""}</span></div>
        </div>
      )}
      {snap.reps.length > 0 && (
        <table className="xe-table">
          <thead><tr><th>Rep</th><th>Level</th><th>{cfg.id === "ex_h2m" || cfg.id === "ex_grasp" ? "Movement" : cfg.id === "ex_handopen" ? "Opening" : cfg.id === KNEE_ID ? "Knee" : cfg.id === TOE_ID ? "Toe lift" : cfg.id === SLIDE_ID ? "Out to the cup" : cfg.id === PINCH_ID ? "Pinch" : "Reach"}</th><th>Form</th><th>Score</th></tr></thead>
          <tbody>
            {snap.reps.map(rep => (
              <tr key={rep.index} className={rep.good ? "good" : ""}>
                <td>{rep.index}</td><td>{LEVEL_LABEL[rep.rung]}</td><td>{Math.round(rep.attainment * 100)}%</td>
                <td>{rep.compensations.length ? rep.compensations.map(id => cfg.compensations.find(c => c.id === id)?.label ?? id).join(", ") : rep.unmeasured?.length ? "Tracking incomplete" : "clean"}{rep.compensations.length > 0 && Boolean(rep.unmeasured?.length) ? " (tracking incomplete)" : ""}</td>
                <td><b>{rep.score}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <HowItFelt onSave={onFelt} />
      <div className="xe-actions">
        <button className="xe-primary" onClick={onAgain}><RotateCcw size={16} aria-hidden="true" /> Re-do the exercise</button>
        <button className="xe-secondary" onClick={onBack}>Complete the exercise</button>
      </div>
      {debugDirectory && <details className="xe-debug-clips">
        <summary>Debug videos · {clips.length} saved locally</summary>
        <p>Kept until you start a new exercise. Video and measurement files: <code>{debugDirectory}</code></p>
        {clips.map(clip => <div key={clip.name}>
          <h3>{clip.label}{clip.complete ? "" : " (partial)"}</h3>
          <video controls preload="metadata" src={clip.url} aria-label={`${clip.label} debug video`} />
          <a href={clip.url} download={clip.name}>Save a copy of {clip.label.toLowerCase()}</a>
        </div>)}
      </details>}
    </div>
  );
}

type FeltAnswer = { felt?: FeltReport; pain?: PainReport; stopped: boolean };
const FELT_CHOICES: { value: FeltReport; label: string }[] = [
  { value: "easier", label: "Easier than usual" },
  { value: "about_right", label: "About right" },
  { value: "harder", label: "A bit harder" },
  { value: "much_harder", label: "Much harder" },
];
const PAIN_CHOICES: { value: PainReport; label: string }[] = [
  { value: "none", label: "None" },
  { value: "a_little", label: "A little" },
  { value: "a_lot", label: "A lot" },
];

/** "How did that feel?" after an exercise: optional, saved once, with a calm safety note for a lot of pain or feeling unwell. */
function HowItFelt({ onSave }: { onSave: (answer: FeltAnswer) => void }) {
  const [felt, setFelt] = useState<FeltReport | undefined>(undefined);
  const [pain, setPain] = useState<PainReport | undefined>(undefined);
  const [stopped, setStopped] = useState(false);
  const [saved, setSaved] = useState(false);
  const answered = felt !== undefined || pain !== undefined || stopped;
  const save = () => {
    if (!answered || saved) return;
    onSave({ felt, pain, stopped });
    setSaved(true);
  };
  return (
    <section className="xe-felt" aria-labelledby="xe-felt-title">
      <h3 id="xe-felt-title">How did that feel?</h3>
      <p className="xe-felt-hint">Optional. Choose what fits, then save.</p>
      <div className="xe-chips" role="group" aria-labelledby="xe-felt-title">
        {FELT_CHOICES.map(choice => <button key={choice.value} type="button" className="xe-chip" aria-pressed={felt === choice.value} disabled={saved} onClick={() => setFelt(felt === choice.value ? undefined : choice.value)}>{choice.label}</button>)}
      </div>
      <p className="xe-felt-question" id="xe-felt-pain">Any pain?</p>
      <div className="xe-chips" role="group" aria-labelledby="xe-felt-pain">
        {PAIN_CHOICES.map(choice => <button key={choice.value} type="button" className="xe-chip" aria-pressed={pain === choice.value} disabled={saved} onClick={() => setPain(pain === choice.value ? undefined : choice.value)}>{choice.label}</button>)}
      </div>
      <label className="xe-check xe-felt-stopped"><input type="checkbox" checked={stopped} disabled={saved} onChange={event => setStopped(event.target.checked)} /> I stopped because I felt unwell</label>
      {(pain === "a_lot" || stopped) && (
        <div className="xe-felt-safety" role="alert">
          <b>Please stop for today and rest.</b> Talk to your physiotherapist about how you felt before you exercise again. If it feels like an emergency, call 999.
        </div>
      )}
      {saved
        ? <p className="xe-felt-saved"><Check size={16} aria-hidden="true" /> Thank you. Your answer is saved.</p>
        : <button type="button" className="xe-secondary xe-felt-save" disabled={!answered} onClick={save}>Save how it felt</button>}
    </section>
  );
}

// ---------- camera frame building and drawing ----------

function buildFrame(session: ExerciseSession, det: Detection, side: Side, t: number, aspect: number, extra: { zone?: HandZone | null; gripAxis?: [number, number, number]; support?: SlideSupport } = {}): Frame {
  const cfg = session.cfg;
  const zone = extra.zone ?? null;
  if (cfg.id === "ex_grasp") return graspFrame(det, side, t, aspect, session.reference, { gripAxis: extra.gripAxis });
  if (cfg.id === KNEE_ID) return kneeFrame(det, side, t, aspect, session.reference);
  if (cfg.id === TOE_ID) return toeFrame(det, side, t, aspect, session.reference);
  if (cfg.id === SLIDE_ID) return slideFrame(det, side, t, aspect, session.reference, extra.support);
  if (cfg.id === PINCH_ID) {
    // Each pinch starts with the thumb apart: nearly as far as at set-up, and at most halfway from there to the first
    // finger's goal, so a pinch never starts already on target (pinch-target.ts).
    const rest = session.restValues().pinch_index;
    if (!Number.isFinite(rest)) return pinchFrame(det, side, t, aspect, session.reference, { zone: extra.zone ?? null });
    const goal = session.snapshot().phase === "reps" ? Math.min(TOUCH_CLOSURE, session.targets().pinch_index) : pinchPracticeGoal(rest);
    return pinchFrame(det, side, t, aspect, session.reference, { zone: extra.zone ?? null, startGap: Math.max(startGap(rest), gapOf(rest + 0.5 * (goal - rest))) });
  }
  if (cfg.id === "ex_handopen") {
    // Each repetition starts from a relaxed hand, at most as open as the close circle (hand-target.ts).
    const rest = session.restValues().hand_openness;
    const learned = session.learnedValue("hand_openness");
    return handOpenFrame(det, side, t, aspect, session.reference, Number.isFinite(rest) ? { zone, startLimit: startLimit(rest, learned), waiveLimit: waiveLimit(rest, learned) } : { zone });
  }
  const usesPose = cfg.tracking !== "hand";
  const usesHand = cfg.tracking !== "pose";
  let visible = true;
  let missing: string | undefined;
  let values: Frame["values"] = {};
  let comps: Frame["comps"] = {};
  let geo: Frame["geo"];
  if (usesPose) {
    const vis = poseVisibility(det.pose, side, cfg.domain === "lower_limb" ? "lower" : "upper");
    if (!vis.ok) { visible = false; missing = vis.missing; }
    if (det.pose) {
      const out = poseFrameValues(det.pose, side, session.reference);
      values = { ...out.values };
      comps = out.comps;
      geo = out.geo;
    }
  }
  if (usesHand) {
    const wristIdx = poseJoints(side).wrist;
    const wrist = det.pose ? det.pose.landmarks[wristIdx] : undefined;
    const hand = chooseHand(det.hands, cfg.tracking === "pose+hand" ? wrist : undefined);
    const vis = handVisible(hand);
    if (!vis.ok && visible) { visible = false; missing = vis.missing; }
    if (hand) {
      const out = handFrameValues(hand, session.currentStep?.finger ?? 0);
      values = { ...values, ...out.values };
    }
  }
  if (cfg.id === "ex_h2m" && det.pose) comps = mouthCompensations(det.pose, side, session.reference, comps);
  return { t, values, comps, visible, missing, geo, ...(usesSeatedTargets(cfg.id) ? reachLapRest(det.pose, side) : {}), ...(cfg.id === "ex_h2m" ? { mouthPoint: observedMouth(det.pose) } : {}) };
}

function drawOverlay(canvas: HTMLCanvasElement | null, video: HTMLVideoElement, det: Detection, session: ExerciseSession, side: Side, cup?: { x: number; y: number } | null) {
  if (!canvas) return;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  const X = (x: number) => (1 - x) * w; // the video is shown mirrored
  const Y = (y: number) => y * h;
  const j = poseJoints(side);
  const mine = new Set([j.shoulder, j.elbow, j.wrist, j.hip, j.knee, j.ankle, j.foot]);
  // Hand opening (and Pinch and Peg, set up the same way) checks only the face and shoulders: the arm and hips are
  // often behind the table.
  const pinch = session.cfg.id === PINCH_ID;
  const handOpen = session.cfg.id === "ex_handopen" || pinch;
  if (det.pose) {
    const lm = det.pose.landmarks;
    ctx.lineWidth = Math.max(3, w / 220);
    ctx.lineCap = "round";
    for (const [a, b] of handOpen ? POSE_LINES.filter(([a, b]) => a === 11 && b === 12) : POSE_LINES) {
      if ((lm[a]?.visibility ?? 1) < 0.4 || (lm[b]?.visibility ?? 1) < 0.4) continue;
      ctx.strokeStyle = mine.has(a) && mine.has(b) ? "#e18e6d" : "rgba(217,229,220,.85)";
      ctx.beginPath(); ctx.moveTo(X(lm[a].x), Y(lm[a].y)); ctx.lineTo(X(lm[b].x), Y(lm[b].y)); ctx.stroke();
    }
    ctx.fillStyle = "#fff";
    (handOpen ? [0, 11, 12] : [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32]).forEach(i => {
      if ((lm[i]?.visibility ?? 1) < 0.4) return;
      ctx.beginPath(); ctx.arc(X(lm[i].x), Y(lm[i].y), Math.max(3, w / 260), 0, Math.PI * 2); ctx.fill();
    });
  }
  const tracking = session.cfg.tracking;
  if (session.cfg.id === "ex_h2m") {
    const hand = cup !== undefined ? cup : mouthContactPoints(det.pose, side)[0];
    if (hand) {
      const size = Math.max(12, h * 0.03), x = X(hand.x), y = Y(hand.y);
      ctx.strokeStyle = "#fffefa"; ctx.fillStyle = "rgba(225,142,109,.4)"; ctx.lineWidth = Math.max(2, w / 320);
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      ctx.strokeRect(x - size / 2, y - size / 2, size, size);
      ctx.beginPath(); ctx.arc(x + size * 0.65, y, size * 0.3, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    }
  }
  if (tracking !== "pose" && det.hands.length) {
    const wrist = det.pose ? det.pose.landmarks[j.wrist] : undefined;
    const hand = pinch ? pinchHand(det, side) : handOpen ? affectedHand(det, side) : chooseHand(det.hands, tracking === "pose+hand" ? wrist : undefined);
    if (hand) {
      ctx.strokeStyle = "rgba(127,229,163,.95)";
      ctx.lineWidth = Math.max(2, w / 320);
      for (const [a, b] of HAND_LINES) { ctx.beginPath(); ctx.moveTo(X(hand.landmarks[a].x), Y(hand.landmarks[a].y)); ctx.lineTo(X(hand.landmarks[b].x), Y(hand.landmarks[b].y)); ctx.stroke(); }
      ctx.fillStyle = "#fff";
      hand.landmarks.forEach(p => { ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), Math.max(2, w / 360), 0, Math.PI * 2); ctx.fill(); });
      const step = session.currentStep;
      // The thumb tip and the fingertip a pinch step brings together.
      if (step?.kind === "pinch" || (pinch && step?.kind === "reach")) {
        ctx.fillStyle = "#e18e6d";
        const tip = pinch ? PINCH_FINGERS[pinchFinger(step.finger)].tip : 8 + 4 * (step.finger ?? 0);
        [4, tip].forEach(i => { ctx.beginPath(); ctx.arc(X(hand.landmarks[i].x), Y(hand.landmarks[i].y), Math.max(6, w / 120), 0, Math.PI * 2); ctx.fill(); });
      }
    }
  }
}

function drawGhostFor(canvas: HTMLCanvasElement | null, session: ExerciseSession, snap: Snapshot, level: number, side: Side = "right", armrest = false) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  let p = Math.min(1, Math.max(0, level));
  const knee = session.cfg.id === KNEE_ID, toe = session.cfg.id === TOE_ID;
  if (snap.phase === "demo") {
    if (toe) {
      // The toe lift's front-view demonstration shows the patient's own affected side, as the mirror does.
      drawToeDemo(ctx, snap.demoStepElapsedMs, session.cfg.cycle[snap.demoStepIndex]?.kind === "return", canvas.width, canvas.height, performance.now(), window.matchMedia("(prefers-reduced-motion: reduce)").matches, snap.targetArmed, side);
      return;
    }
    if (knee) {
      // The knee's front-view demonstration shows the patient's own affected side, as the mirror does.
      drawKneeDemo(ctx, snap.demoStepElapsedMs, session.cfg.cycle[snap.demoStepIndex]?.kind === "return", canvas.width, canvas.height, performance.now(), window.matchMedia("(prefers-reduced-motion: reduce)").matches, snap.targetArmed, side);
      return;
    }
    if (session.cfg.id === "ex_grasp") {
      drawGraspDemo(ctx, snap.demoStepElapsedMs, Math.max(0, snap.demoStepIndex), canvas.width, canvas.height, performance.now(), window.matchMedia("(prefers-reduced-motion: reduce)").matches, snap.targetArmed);
      return;
    }
    if (session.cfg.id === PINCH_ID) {
      drawPinchDemo(ctx, snap.demoStepElapsedMs, pinchStepOf(session.cfg.cycle, snap.demoStepIndex), canvas.width, canvas.height, performance.now(), window.matchMedia("(prefers-reduced-motion: reduce)").matches, snap.targetArmed);
      return;
    }
    if (session.cfg.id === SLIDE_ID) {
      // The arm elevation's demonstration shows the patient's own affected side (as the mirror does) and their support.
      drawSlideDemo(ctx, snap.demoStepElapsedMs, session.cfg.cycle[snap.demoStepIndex]?.kind === "return", canvas.width, canvas.height, performance.now(), window.matchMedia("(prefers-reduced-motion: reduce)").matches, snap.targetArmed, { side, armrest });
      return;
    }
    if (usesTargetFlow(session.cfg.id)) {
      drawDemoFor(session.cfg.id)(ctx, snap.demoStepElapsedMs, session.cfg.cycle[snap.demoStepIndex]?.kind === "return", canvas.width, canvas.height, performance.now(), window.matchMedia("(prefers-reduced-motion: reduce)").matches, snap.targetArmed);
      return;
    }
    if (!snap.demoReady) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    // each demo step: go to the target for "reach"-like steps, come back for return steps
    const steps = session.cfg.id === "ex_pinch" ? 2 : snap.stepCount;
    const scaled = snap.demoProgress * steps;
    const idx = Math.min(steps - 1, Math.floor(scaled));
    const within = scaled - idx;
    const cycle = session.cfg.id === "ex_pinch" ? null : session.cfg.cycle[idx];
    const returning = cycle ? cycle.kind === "return" : idx === 1;
    p = returning ? 1 - within : Math.min(1, within * 1.3);
  }
  const grasp = session.cfg.id === "ex_grasp", pinch = session.cfg.id === PINCH_ID;
  if (grasp) { ctx.clearRect(0, 0, canvas.width, canvas.height); drawGraspGhost(ctx, snap.stepIndex, p, canvas.width, canvas.height); }
  else if (pinch) { ctx.clearRect(0, 0, canvas.width, canvas.height); drawPinchGhost(ctx, pinchStepOf(session.cfg.cycle, snap.stepIndex), p, canvas.width, canvas.height); }
  else if (session.cfg.id === SLIDE_ID) drawSlideGhost(ctx, p, canvas.width, canvas.height, { side, armrest });
  else if (toe) drawToeScene(ctx, canvas.width, canvas.height, { progress: p, lowering: snap.kind === "return", side, arrow: (snap.phase === "warm" || snap.phase === "reps") && !snap.review, armed: snap.targetArmed, now: performance.now(), reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches });
  else if (knee) drawKneeScene(ctx, canvas.width, canvas.height, { progress: p, lowering: snap.kind === "return", side, arrow: (snap.phase === "warm" || snap.phase === "reps") && !snap.review, armed: snap.targetArmed, now: performance.now(), reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches });
  else drawGhost(ctx, session.cfg.ghost, p, canvas.width, canvas.height);
  if (usesTargetFlow(session.cfg.id) && (snap.phase === "warm" || snap.phase === "reps") && !snap.review) {
    drawTestingTarget(ctx, { ...(grasp ? graspGhostTarget(canvas.width, canvas.height, snap.stepIndex) : pinch ? pinchGhostTarget(canvas.width, canvas.height, pinchStepOf(session.cfg.cycle, snap.stepIndex)) : knee ? kneeGhostTarget(canvas.width, canvas.height, snap.kind === "return", side) : toe ? toeGhostTarget(canvas.width, canvas.height, snap.kind === "return", side) : session.cfg.id === SLIDE_ID ? slideGhostTarget(canvas.width, canvas.height, snap.kind === "return", { side, armrest }) : ghostTargetFor(session.cfg.id)(canvas.width, canvas.height, snap.kind === "return")), armed: snap.targetArmed, contact: snap.targetArmed && snap.inZone, progress: snap.holdProgress, now: performance.now(), reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches });
  }
}


function cameraBodyChecks(session: Pick<ExerciseSession, "cfg">, detection: Detection, side: Side, zone: HandZone | null = null, aspect = 4 / 3, lightingInfo?: { lighting: Lighting | null; waived: boolean; dialFits?: boolean; support?: SlideSupport }): Omit<BodyCheck, "progress">[] {
  const labels: Record<string, string> = { nose: "Face", shoulder: `${side === "right" ? "Right" : "Left"} shoulder`, shoulderOther: "Other shoulder", elbow: `${side === "right" ? "Right" : "Left"} elbow`, wrist: `${side === "right" ? "Right" : "Left"} hand`, hip: "Top of thigh", knee: "Knee", ankle: "Ankle", foot: "Foot & toes" };
  const joints = poseJoints(side);
  if (session.cfg.id === "ex_handopen") {
    // Face and shoulders for the posture checks; the hand in the shaded area, palm to the camera, fingers relaxed.
    const hand = affectedHand(detection, side);
    const placed = handVisible(hand).ok && inHandZone(palmRing(hand, aspect), zone, aspect);
    return [
      ...POSE_NEEDS.upper.filter(need => need.joint === "nose" || need.joint === "shoulder" || need.joint === "shoulderOther").map(need => {
        const point = detection.pose?.landmarks[joints[need.joint]];
        return { id: need.joint, label: labels[need.joint], visible: !!point && (point.visibility ?? 1) >= 0.5 && point.x > 0.01 && point.x < 0.99 && point.y > 0.01 && point.y < 0.99, hint: need.say };
      }),
      { id: "wrist", label: `${labels.wrist} in the shaded area`, visible: placed, hint: zone?.hint ?? `Rest your elbow on an armrest or table and hold your ${side} hand up in the shaded area beside your body.` },
      { id: "fingers", label: "Palm to camera, fingers relaxed", visible: placed && palmFacing(hand, side) >= 0.5 && (handOpenness(hand) ?? Infinity) <= REST_OPEN_MAX, hint: "Turn your palm to the camera and let your fingers relax and curl gently. Don't open your hand yet." },
    ];
  }
  if (session.cfg.id === PINCH_ID) {
    // As hand opening: face and shoulders for the posture checks, the hand in the shaded area palm to the camera; then
    // the thumb resting away from the first finger, and the lighting (fingertips are what poor light loses first).
    const hand = pinchHand(detection, side);
    const placed = handVisible(hand).ok && inHandZone(palmRing(hand, aspect), zone, aspect);
    const light = lightingInfo?.lighting;
    return [
      ...POSE_NEEDS.upper.filter(need => need.joint === "nose" || need.joint === "shoulder" || need.joint === "shoulderOther").map(need => {
        const point = detection.pose?.landmarks[joints[need.joint]];
        return { id: need.joint, label: labels[need.joint], visible: !!point && (point.visibility ?? 1) >= 0.5 && point.x > 0.01 && point.x < 0.99 && point.y > 0.01 && point.y < 0.99, hint: need.say };
      }),
      { id: "wrist", label: `${labels.wrist} in the shaded area`, visible: placed, hint: zone?.hint ?? `Rest your elbow on an armrest or table and hold your ${side} hand up in the shaded area beside your body.` },
      { id: "fingers", label: "Palm to camera, thumb apart", visible: placed && palmFacing(hand, side) >= 0.5 && (pinchGap(hand, 0) ?? 0) >= 0.3, hint: "Turn your palm to the camera and let your thumb rest a little away from your first finger." },
      { id: "lighting", label: lightingInfo?.waived && light && !light.ok ? "Lighting (could be better)" : "Lighting", visible: Boolean(light?.ok || lightingInfo?.waived), hint: light?.hint ?? "Checking the light..." },
    ];
  }
  const inViewCheck = (index: number) => { const point = detection.pose?.landmarks[index]; return !!point && (point.visibility ?? 1) >= 0.5 && point.x > 0.01 && point.x < 0.99 && point.y > 0.01 && point.y < 0.99; };
  if (session.cfg.id === "ex_grasp") {
    // Head to mid-thigh with both hips (the cup's circles and the side-lean check), the whole resting hand (its
    // fingers' start), and the lighting.
    const light = lightingInfo?.lighting;
    const handSeen = handOpenness(graspHand(detection, side)) !== undefined;
    return [
      ...POSE_NEEDS.upper.map(need => need.joint === "wrist"
        ? { id: need.joint, label: labels.wrist, visible: inViewCheck(joints.wrist) && handSeen, hint: GRASP_HAND_HINT }
        : { id: need.joint, label: labels[need.joint] ?? need.joint, visible: inViewCheck(joints[need.joint]), hint: need.say }),
      { id: "hipOther", label: "Top of other thigh", visible: inViewCheck(joints.hipOther), hint: "Move the camera back a little so I can see the top of both thighs." },
      { id: "lighting", label: lightingInfo?.waived && light && !light.ok ? "Lighting (could be better)" : "Lighting", visible: Boolean(light?.ok || lightingInfo?.waived), hint: light?.hint ?? "Checking the light..." },
    ];
  }
  if (session.cfg.id === TOE_ID) {
    // As for the knee, with the affected toes (the measure) and the seated position with the foot flat and toes down.
    const light = lightingInfo?.lighting;
    const both = (a: number, b: number) => inViewCheck(a) && inViewCheck(b);
    const position = toeRestCheck(detection.pose, side, aspect);
    return [
      { id: "nose", label: "Face", visible: inViewCheck(joints.nose), hint: "Move the camera back so I can see you from your head to your feet." },
      { id: "shoulders", label: "Both shoulders", visible: both(joints.shoulder, joints.shoulderOther), hint: "Move the camera back so I can see both shoulders." },
      { id: "hips", label: "Both hips", visible: both(joints.hip, joints.hipOther), hint: "Sit facing the camera so I can see both hips." },
      { id: "knees", label: "Both knees", visible: both(joints.knee, joints.kneeOther), hint: "Move the camera back so I can see both knees." },
      { id: "feet", label: "Both feet", visible: both(joints.ankle, joints.ankleOther), hint: "Move the camera back, or tilt it down, so I can see both feet." },
      { id: "toes", label: `${side === "right" ? "Right" : "Left"} toes`, visible: inViewCheck(joints.foot), hint: "Tilt the camera down a little so I can see your toes." },
      { id: "position", label: "Foot flat, heel down, space around you", visible: Boolean(position.lapRest) && lightingInfo?.dialFits !== false, hint: position.lapMissing ?? (lightingInfo?.dialFits === false ? KNEE_DIAL_HINT : "Sit tall with both feet flat on the floor.") },
      { id: "lighting", label: lightingInfo?.waived && light && !light.ok ? "Lighting (could be better)" : "Lighting", visible: Boolean(light?.ok || lightingInfo?.waived), hint: light?.hint ?? "Checking the light..." },
    ];
  }
  if (session.cfg.id === KNEE_ID) {
    // Head to feet (the trunk checks need the face and shoulders, the other-leg check both feet), the seated position
    // with both feet flat and room round the body, and the lighting.
    const light = lightingInfo?.lighting;
    const both = (a: number, b: number) => inViewCheck(a) && inViewCheck(b);
    const position = kneeRestCheck(detection.pose, side, aspect);
    return [
      { id: "nose", label: "Face", visible: inViewCheck(joints.nose), hint: "Move the camera back so I can see you from your head to your feet." },
      { id: "shoulders", label: "Both shoulders", visible: both(joints.shoulder, joints.shoulderOther), hint: "Move the camera back so I can see both shoulders." },
      { id: "hips", label: "Both hips", visible: both(joints.hip, joints.hipOther), hint: "Sit facing the camera so I can see both hips." },
      { id: "knees", label: "Both knees", visible: both(joints.knee, joints.kneeOther), hint: "Move the camera back so I can see both knees." },
      { id: "feet", label: "Both feet", visible: both(joints.ankle, joints.ankleOther), hint: "Move the camera back, or tilt it down, so I can see both feet." },
      // Set-up also waits for room beside the shoulder for the knee dial: the row says so rather than showing green.
      { id: "position", label: "Feet flat, space around you", visible: Boolean(position.lapRest) && lightingInfo?.dialFits !== false, hint: position.lapMissing ?? (lightingInfo?.dialFits === false ? KNEE_DIAL_HINT : "Sit tall with both feet flat on the floor.") },
      { id: "lighting", label: lightingInfo?.waived && light && !light.ok ? "Lighting (could be better)" : "Lighting", visible: Boolean(light?.ok || lightingInfo?.waived), hint: light?.hint ?? "Checking the light..." },
    ];
  }
  if (session.cfg.id === SLIDE_ID) {
    // Head to thighs (the trunk checks need the face, shoulders and hips), the forearm resting beside the body (on a
    // table or the armrest) with the other hand on its thigh, room beside the arm for the cup, and the lighting.
    const light = lightingInfo?.lighting, support = lightingInfo?.support;
    const on = slideRestOn(support);
    const both = (a: number, b: number) => inViewCheck(a) && inViewCheck(b);
    const position = slideRestCheck(detection.pose, side, aspect, support);
    return [
      { id: "nose", label: "Face", visible: inViewCheck(joints.nose), hint: "Move the camera back so I can see you from your head to your thighs." },
      { id: "shoulders", label: "Both shoulders", visible: both(joints.shoulder, joints.shoulderOther), hint: "Move the camera back so I can see both shoulders." },
      { id: "hips", label: "Both hips", visible: both(joints.hip, joints.hipOther), hint: "Move the camera back so I can see both hips." },
      { id: "arm", label: `${labels.elbow} and hand`, visible: both(joints.elbow, joints.wrist), hint: `Rest your ${side} forearm ${on}, where the camera can see your elbow and hand.` },
      { id: "otherHand", label: "Other hand", visible: inViewCheck(joints.wristOther), hint: "Rest your other hand on your thigh where the camera can see it." },
      // Set-up also waits for room beside the arm for the cup (slideRestCheck): the row says so rather than showing green.
      { id: "position", label: "Forearm resting, room for the cup", visible: Boolean(position.lapRest), hint: position.lapMissing ?? slideRestPrompt(side, support) },
      { id: "lighting", label: lightingInfo?.waived && light && !light.ok ? "Lighting (could be better)" : "Lighting", visible: Boolean(light?.ok || lightingInfo?.waived), hint: light?.hint ?? "Checking the light..." },
    ];
  }
  const checks: Omit<BodyCheck, "progress">[] = session.cfg.tracking === "hand" ? [] : POSE_NEEDS[session.cfg.domain === "lower_limb" ? "lower" : "upper"].map(need => {
    const point = detection.pose?.landmarks[joints[need.joint]];
    return { id: need.joint, label: labels[need.joint] ?? need.joint, visible: !!point && (point.visibility ?? 1) >= 0.5 && point.x > 0.01 && point.x < 0.99 && point.y > 0.01 && point.y < 0.99, hint: need.say };
  });
  if (session.cfg.tracking !== "pose") {
    const wrist = detection.pose?.landmarks[joints.wrist];
    const hand = chooseHand(detection.hands, session.cfg.tracking === "pose+hand" ? wrist : undefined);
    checks.push({ id: "fingers", label: "All fingertips", visible: handVisible(hand).ok, hint: "Move your hand back until every fingertip is in view." });
  }
  return checks;
}

function drawReachTarget(canvas: HTMLCanvasElement | null, target: { x: number; y: number; radius: number }, armed: boolean, contact: boolean, progress: number) {
  const ctx = canvas?.getContext("2d");
  if (!ctx || !canvas) return;
  drawTestingTarget(ctx, { x: (1 - target.x) * canvas.width, y: target.y * canvas.height, radius: target.radius * canvas.height, armed, contact, progress, now: performance.now(), reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches });
}

/** The steps of each repetition as chips: hand opening (palm to camera, open, close) or grasp and transport. */
const HAND_STEPS = ["Palm to camera", "Open", "Close"];
function HandSteps({ current, steps = HAND_STEPS, label: name = "Steps for this repetition" }: { current: number; steps?: string[]; label?: string }) {
  return <ol className="xe-hand-steps" aria-label={name}>
    {steps.map((label, i) => <li key={label} className={i < current ? "is-done" : i === current ? "is-on" : ""} aria-current={i === current ? "step" : undefined}>
      <span aria-hidden="true">{i < current ? "✓" : i + 1}</span>{label}
    </li>)}
  </ol>;
}

/**
 * scale: the measure's units per degree (metricUnit); units: how it is read out (metricUnitName): degrees, shoulder
 * widths for a distance across the body, percent for the pinch's closure, or percent of the lower leg for the toe
 * lift, read as the rise from rest.
 */
function MetricBar({ label, value, threshold, start = 0, scale = 1, units, ready, limit = false, personalized = false, pending = "Keep reaching" }: { label: string; value: number | undefined; threshold: number; start?: number; scale?: number; units?: string; ready: boolean; limit?: boolean; personalized?: boolean; pending?: string }) {
  const range = threshold - start;
  const progress = personalized ? reachAngleProgress(value, threshold, start, scale) : range > 0 && value !== undefined ? (value - start) / range : 0;
  const unitName = units ?? (scale === 1 ? "degrees" : "shoulder widths");
  const angle = unitName === "degrees", closure = unitName === "percent", rise = unitName === "percent of the lower leg";
  const say = (n: number) => angle || closure || rise ? `${Math.round(n)} ${unitName}` : `${n.toFixed(2)} ${unitName}`;
  // The toe lift reads negative at rest: the bar and the read-out are its rise from rest (before practice, of 25%).
  const lifted = rise && value !== undefined && Number.isFinite(start) ? Math.max(0, value - start) : undefined;
  const crossed = ready && progress >= 1;
  const learning = personalized ? "Learning your movement goal" : "Learning starting position";
  const percent = value === undefined ? 0 : Math.min(100, Math.max(0, ready ? progress / 1.4 * 100 : rise ? (lifted ?? 0) / 25 * 100 : value / (limit ? 1.4 : 180) * 100));
  return <section className={`xe-metric ${crossed ? limit ? "is-limit" : "is-met" : ""}`}>
    <div className="xe-metric-label"><b>{label}</b><span>{value === undefined ? "Finding you…" : !ready ? learning : crossed ? limit ? "Ease back" : "Target reached" : limit ? "Within limit" : pending}</span></div>
    <div className="xe-metric-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-valuetext={value === undefined ? "Tracking unavailable" : !ready ? learning : limit ? crossed ? "Above posture limit" : "Within posture limit" : rise ? `Estimated lift ${say(lifted ?? 0)}; goal ${say(Math.max(0, threshold - start))}${personalized ? "; learned at the practice target" : ""}` : `Estimated ${angle ? "angle" : closure ? "closure" : "distance"} ${say(value)}; resting ${angle ? "angle" : closure ? "closure" : "position"} ${say(start)}; goal ${say(threshold)}${personalized ? "; learned at the practice target" : ""}`}><i style={{ width: `${percent}%` }} />{ready && <em style={{ left: `${100 / 1.4}%` }} />}</div>
  </section>;
}
