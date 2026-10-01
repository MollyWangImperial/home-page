import { drawTestingTarget, drawTargetCompletion } from "@/lib/exercise-engine/target-visual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useRoute, useSearch } from "wouter";
import { ArrowLeft, Camera, Check, Eye, Hand, LoaderCircle, Mic, MicOff, Play, RotateCcw, SkipForward, Sparkles } from "lucide-react";
import { useSettings } from "@/components/AccountSettings";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { buildRung, EXERCISES, DOMAIN_LABEL, LEVEL_BY_RUNG, resolveExercise, usesSeatedTargets, type Rung, type Side } from "@/lib/exercise-engine/config";
import { reachAngleProgress } from "@/lib/exercise-engine/calibration";
import { EXERCISE_PREVIEW_SCREENS, exercisePreviewScreen, exerciseScreenPreview, type ExercisePreviewScreen } from "@/lib/exercise-engine/screen-preview";
import { TARGET_HOLD_MS } from "@/lib/exercise-engine/target-timing";
import { drawGhost, reachGhostPose, mouthGhostPose } from "@/lib/exercise-engine/ghost";
import { drawReachDemo, reachDemoState, reachGhostTarget } from "@/lib/exercise-engine/reach-demo";
import { drawMouthDemo, mouthDemoState, mouthGhostTarget } from "@/lib/exercise-engine/mouth-demo";
import { mouthContact, mouthContactPoints, observedMouth, mouthCompensations } from "@/lib/exercise-engine/mouth-target";
import { compensationStatus, HAND_LINES, POSE_LINES, handFrameValues, handVisible, POSE_NEEDS, poseFrameValues, poseJoints, poseVisibility, reachLapRest, type Frame } from "@/lib/exercise-engine/metrics";
import { ExerciseSession, simFrame, type Snapshot } from "@/lib/exercise-engine/session";
import { chooseHand, createTracker, openCamera, type Detection, type Tracker } from "@/lib/exercise-engine/tracker";
import { createVoice, type RunnerVoice } from "@/lib/exercise-engine/voice";
import { readLabOptions, saveLabSession, writeLabOptions, type LabOptions } from "@/lib/exercise-engine/lab-storage";
import { recordExerciseResult } from "@/lib/journey";
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

type Live = { label: string; value: number | undefined; target: number; start: number; unit: string }[];
type CompLive = { label: string; value: number | undefined; limit: number }[];

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
      rung: (usesSeatedTargets(exerciseId) ? 1 : [1, 2, 3].includes(rung) ? rung : 2) as Rung,
      side: (q.get("side") === "left" ? "left" : q.get("side") === "right" ? "right" : saved.side) as Side,
      quick: q.has("quick") ? q.get("quick") === "1" : saved.quick,
      sim: q.has("sim") ? q.get("sim") === "1" : saved.sim,
      chairBack: q.has("chair") ? q.get("chair") === "1" : saved.chairBack,
      // Normal forward reach no longer exposes test/dose modifiers. Explicit simulation URLs
      // remain available to the test bench; screen previews use display fixtures instead.
      ...(usesSeatedTargets(exerciseId) && q.get("sim") !== "1" ? { quick: false, sim: false, chairBack: false, assisted: false } : {}),
    };
  }, [search, exerciseId]);

  const [opts, setOpts] = useState<LabOptions & { rung: Rung }>(initial);
  const [stage, setStage] = useState<Stage>("intro");
  useEffect(() => {
    if (usesSeatedTargets(exerciseId) && stage === "intro" && opts.rung !== 1) {
      setOpts(options => ({ ...options, rung: 1 }));
    }
  }, [exerciseId, stage, opts.rung]);
  const [error, setError] = useState("");
  const [runSnapshot, setSnap] = useState<Snapshot | null>(null);
  const [bodyChecks, setBodyChecks] = useState<BodyCheck[]>([]);
  const bodyProgress = useRef<Record<string, number>>({});
  const bodyLastT = useRef(0);
  const targetCompletion = useRef<{ key: string; startedAt: number } | null>(null);
  const reachTarget = useRef<{ key: string; x: number; y: number; radius: number; startX: number; startY: number; baseY: number; torso: number; lapX: number; lapY: number } | null>(null);
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
  const simRef = useRef({ level: 0, manual: false, sliderLevel: 0, comps: [] as string[], auto: "good" as AutoMode, lastT: 0 });
  const savedRecord = useRef<string | null>(null);
  const debugSessionRef = useRef<DebugVideoSession | null>(null);
  const debugRecorderRef = useRef<DebugVideoRecorder | null>(null);
  const beginningRef = useRef(false);
  // Alira's learning: the record (by finished_at) it was last started for, and whether the running session is simulated.
  const learnedFrom = useRef<string | null>(null);
  const sessionSim = useRef(false);

  simRef.current.comps = simComps;
  simRef.current.auto = auto;

  const cfg = useMemo(() => (base ? resolveExercise(base.id, opts.chairBack) : null), [base, opts.chairBack]);
  const rungSpec = useMemo(() => (base ? buildRung(base.id, opts.rung) : null), [base, opts.rung]);
  const previewScreen = usesSeatedTargets(exerciseId) ? exercisePreviewScreen(new URLSearchParams(search).get("preview")) : null;
  const preview = useMemo(() => previewScreen ? exerciseScreenPreview(previewScreen, opts.rung, opts.side, exerciseId) : null, [previewScreen, opts.rung, opts.side, exerciseId]);
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
    if (canvas && ctx) {
      const pose = state.phase === "setup" || state.phase === "demo" || !state.targetArmed || state.kind === "return" ? 0 : 1;
      drawGhost(ctx, cfg.ghost, pose, canvas.width, canvas.height);
      if ((state.phase === "warm" || state.phase === "reps") && !state.review) drawTestingTarget(ctx, { ...(cfg.id === "ex_h2m" ? mouthGhostTarget : reachGhostTarget)(canvas.width, canvas.height, state.kind === "return"), armed: state.targetArmed, contact: state.inZone && state.targetArmed, progress: state.holdProgress, now: performance.now(), reducedMotion: true });
    }
    const demo = ghostRef.current;
    const demoContext = demo?.getContext("2d");
    if (state.phase === "demo" && demo && demoContext) (cfg.id === "ex_h2m" ? drawMouthDemo : drawReachDemo)(demoContext, state.demoStepElapsedMs, state.kind === "return", demo.width, demo.height, performance.now(), true, state.targetArmed);
  }, [preview, cfg]);

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
      if (s.auto !== "off" && !s.manual) {
        const moving = (snapNow.phase === "warm" || snapNow.phase === "reps") && step && (step.kind === "reach" || step.kind === "open" || step.kind === "pinch");
        const want = !snapNow.targetArmed && (snapNow.phase === "warm" || snapNow.phase === "reps") ? s.level : moving && snapNow.holdProgress < 1 ? (snapNow.phase === "warm" ? 1 : AUTO_LEVEL[s.auto]) : 0;
        s.level += Math.sign(want - s.level) * Math.min(Math.abs(want - s.level), dt * 1.6);
      } else s.level = s.sliderLevel;
      const comps = s.auto === "leaning" && !s.manual ? (session.cfg.compensations[0] ? [session.cfg.compensations[0].id] : []) : s.comps;
      frame = simFrame(t, session.cfg, session.targets(), { level: s.level, compensations: comps });
      if (usesSeatedTargets(session.cfg.id) && (session.snapshot().phase === "warm" || session.snapshot().phase === "reps")) {
        const hand = (session.cfg.id === "ex_h2m" ? mouthGhostPose : reachGhostPose)(Math.min(1, Math.max(0, s.level))).wrist;
        const target = (session.cfg.id === "ex_h2m" ? mouthGhostTarget : reachGhostTarget)(300, 270, step?.kind === "return");
        frame.targetContact = Math.hypot(hand[0] - target.x, hand[1] - target.y) <= target.radius;
        frame.targetProgress = frame.targetContact ? 1 : s.level;
      }
    } else {
      const video = videoRef.current;
      const tracker = trackerRef.current;
      if (video && tracker && video.readyState >= 2 && video.currentTime !== lastVideoTime.current) {
        lastVideoTime.current = video.currentTime;
        try {
          const detection = tracker.detect(video, t);
          frame = buildFrame(session, detection, opts.side, t);
          if (session.snapshot().phase === "setup") {
            const dt = Math.min(100, Math.max(0, t - (bodyLastT.current || t)));
            bodyLastT.current = t;
            setBodyChecks(cameraBodyChecks(session, detection, opts.side).map(check => {
              const progress = Math.max(0, Math.min(1, (bodyProgress.current[check.id] ?? 0) + dt / (check.visible ? 1400 : -550)));
              bodyProgress.current[check.id] = progress;
              return { ...check, progress };
            }));
          }
          const now = session.snapshot();
          if (session.cfg.id === "ex_reach" && (now.phase === "warm" || now.phase === "reps") && !now.review && now.kind === "reach" && detection.pose) {
            const j = poseJoints(opts.side);
            const shoulder = detection.pose.landmarks[j.shoulder];
            const hip = detection.pose.landmarks[j.hip];
            const wrist = detection.pose.landmarks[j.wrist];
            const lap = session.lapPoint;
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
          } else if (session.cfg.id !== "ex_reach" || now.phase === "setup" || now.phase === "demo") reachTarget.current = null;
          if (session.cfg.id === "ex_h2m" && (now.phase === "warm" || now.phase === "reps") && !now.review) {
            const lap = session.lapPoint, mouth = session.mouthPoint;
            if (lap && mouth) {
              // Alira's target size scales the mouth circle and its limits (1 leaves them as before).
              const size = session.tuning.targetSizeScale;
              const radius = Math.max(0.045 * size, Math.min(0.08 * size, lap.bodyScale * 0.18 * size));
              reachTarget.current = { key: `${now.phase}:${now.repIndex}:${now.rung}`, x: mouth.x, y: mouth.y, radius, baseY: mouth.y, torso: lap.bodyScale, startX: lap.x, startY: lap.y, lapX: lap.x, lapY: lap.y };
              if (now.kind === "reach") {
                const points = mouthContactPoints(detection.pose, opts.side);
                frame.visible = frame.visible && points.length > 0;
                if (!points.length) frame.missing = `Bring your ${opts.side} hand and fingertips into view.`;
                frame.targetContact = frame.visible && mouthContact(detection.pose, opts.side, mouth, radius, video.videoWidth / video.videoHeight);
                const distance = Math.min(...points.map(point => Math.hypot((point.x - mouth.x) * video.videoWidth / video.videoHeight, point.y - mouth.y)));
                const startDistance = Math.hypot((lap.x - mouth.x) * video.videoWidth / video.videoHeight, lap.y - mouth.y);
                frame.targetProgress = frame.targetContact ? 1 : Math.max(0, Math.min(0.98, 1 - (distance - radius) / Math.max(0.05, startDistance - radius)));
              }
            } else { frame.visible = false; frame.missing = "Go back to Set up so I can learn your lap and mouth targets."; }
          }
          if (!now.review && reachTarget.current && now.kind === "return" && detection.pose) {
            const wrist = detection.pose.landmarks[poseJoints(opts.side).wrist];
            const target = reachTarget.current;
            const visible = !!wrist && (wrist.visibility ?? 1) >= 0.5 && wrist.x > 0.01 && wrist.x < 0.99 && wrist.y > 0.01 && wrist.y < 0.99;
            frame.visible = visible;
            frame.missing = visible ? undefined : "Bring your affected hand back into view.";
            frame.targetContact = visible && Math.hypot((wrist.x - target.lapX) * video.videoWidth / video.videoHeight, wrist.y - target.lapY) <= target.radius;
          }
          drawOverlay(overlayRef.current, video, detection, session, opts.side);
        } catch (err) {
          console.warn("Exercise tracking frame failed", err);
        }
      }
    }

    if (frame) {
      session.push(frame);
      const currentSnapshot = session.snapshot();
      if (!opts.sim && !currentSnapshot.review && reachTarget.current) {
        if (currentSnapshot.kind === "reach") {
          targetCompletion.current = null;
          drawReachTarget(overlayRef.current, reachTarget.current, currentSnapshot.targetArmed, frame.targetContact === true, currentSnapshot.holdProgress);
        } else if (currentSnapshot.kind === "return") {
          drawReachTarget(overlayRef.current, { ...reachTarget.current, x: reachTarget.current.lapX, y: reachTarget.current.lapY }, currentSnapshot.targetArmed, frame.targetContact === true, currentSnapshot.holdProgress);
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
          roms: session.cfg.romSteps.map(rom => ({ label: rom.label, value: frame!.values[rom.metric], target: targets[rom.id], start: usesSeatedTargets(session.cfg.id) ? snapshot.startingAngles[rom.id] ?? NaN : 0, unit: "°" })),
          comps: session.cfg.compensations.map(comp => ({ label: comp.label, value: compensationStatus(frame!.comps, comp).ratio, limit: 1 })),
        });
        drawGhostFor(ghostRef.current, session, snapshot, opts.sim ? simRef.current.level : snapshot.liveAttainment);
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
  }, [opts.side, opts.sim, stopAll]);

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
    writeLabOptions({ side: opts.side, quick: opts.quick, sim: opts.sim, chairBack: opts.chairBack, assisted: opts.assisted });
    savedRecord.current = null;
    reachTarget.current = null;
    bodyProgress.current = {};
    bodyLastT.current = 0;
    setBodyChecks(cameraBodyChecks({ cfg }, { pose: null, hands: [] } as unknown as Detection, opts.side).map(check => ({ ...check, progress: 0 })));
    const voice = createVoice();
    voice.stop();
    voice.setMuted(muted);
    voice.onSay = setSaid;
    setEnglishAvailable(true);
    voice.onAvailability = setEnglishAvailable;
    voiceRef.current = voice;
    lastVideoTime.current = -1;
    simRef.current = { ...simRef.current, level: 0, manual: false, sliderLevel: 0, lastT: 0 };
    setSimLevel(0);
    // Alira's exercise settings are read once here, so nothing changes mid-session.
    const session = new ExerciseSession({ exerciseId: base.id, rung: opts.rung, side: opts.side, chairBack: opts.chairBack, repsOverride: opts.quick ? 3 : undefined, assisted: opts.assisted, reviewBetweenReps: true, tuning: loadExerciseTuning() }, voice);
    sessionRef.current = session;
    sessionSim.current = opts.sim;
    debugRecorderRef.current = debugSessionRef.current ? new DebugVideoRecorder(debugSessionRef.current, session.cfg.compensations, () => session.reference, clip => setDebugClips(clips => [...clips.filter(item => item.name !== clip.name), clip]), setDebugError) : null;
    setError("");
    if (!opts.sim) {
      setStage("loading");
      try {
        const tracker = await createTracker(cfg.tracking);
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
      // Real attempts count towards today's session on the Journey; simulated runs only in local testing.
      if (!runSnapshot.record.not_attempted && (!opts.sim || import.meta.env.DEV)) recordExerciseResult(exerciseId, runSnapshot.record.score);
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
    if (!record || record.not_attempted || (opts.sim && !import.meta.env.DEV)) { backToSettings(); return; }
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
  const reachDemo = snap?.phase === "demo" && usesSeatedTargets(cfg.id)
    ? (cfg.id === "ex_h2m" ? mouthDemoState : reachDemoState)(snap.demoStepElapsedMs, cfg.cycle[snap.demoStepIndex]?.kind === "return", snap.targetArmed) : null;
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
      {!preview && !englishAvailable && !muted && <p className="xe-note" role="status">An English voice is unavailable in this browser. Instructions are shown in English below.</p>}
      {!preview && debugError && <p className="xe-note" role="status">Debug video: {debugError}</p>}

      {runView && snap && !done && (
        <ol className="xe-beats" aria-label="Session beats">
          {BEATS.map((label, i) => (
            <li key={label} className={i + 1 === beatActive ? "is-on" : i + 1 < beatActive || (i + 1 === 5 ? snap.rescued : false) ? "is-past" : ""}>
              {preview || (i < 3 && i + 1 < snap.beat) ? <button type="button" aria-label={preview ? `Preview ${label}` : `Go back to ${label}`} onClick={() => {
                if (preview) { selectPreview((["setup", "demo-reach", "warm-reach", "reps-reach", "rescue", "results"] as ExercisePreviewScreen[])[i]); return; }
                const session = sessionRef.current;
                if (session?.goBack(i + 1, performance.now())) {
                  if (i === 0) { bodyProgress.current = {}; bodyLastT.current = 0; setBodyChecks(checks => checks.map(check => ({ ...check, progress: 0 }))); }
                  setSnap(session.snapshot());
                }
              }}><span>{i + 1}</span>{label}</button> : <><span>{i + 1}</span>{label}</>}
            </li>
          ))}
        </ol>
      )}

      {(previewScreen === "intro" || (!preview && stage === "intro")) && (
        <Intro base={base} cfg={cfg} opts={opts} setOpts={setOpts} muted={muted} setMuted={setMuted} onStart={begin} onPreview={usesSeatedTargets(base.id) ? () => selectPreview("intro") : undefined} />
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
              <div className="xe-simstage"><canvas ref={ghostRef} width={480} height={390} aria-label={reachDemo ? `Movement demonstration: ${reachDemo.instruction}` : usesSeatedTargets(cfg.id) && (snap.phase === "warm" || snap.phase === "reps") ? `${snap.kind === "return" ? "Lap" : cfg.id === "ex_h2m" ? "Mouth" : "Reach"} target ${snap.targetArmed ? "active" : "inactive while the instruction plays"}` : "Movement ghost"} /><span className="xe-simtag">No camera · simulated patient</span></div>
            ) : (
              <div className="xe-video">
                <video ref={videoRef} playsInline muted />
                <canvas ref={overlayRef} aria-label={usesSeatedTargets(cfg.id) && (snap.phase === "warm" || snap.phase === "reps") ? snap.targetArmed ? "Active movement target" : "Inactive movement target — listen to the instruction" : "Movement tracking overlay"} />
              </div>
            )}
            {snap.prompt && <div className="xe-prompt" role="status">{snap.prompt}</div>}
          </section>

          <aside className="xe-side">
            <div className="xe-card xe-coach">
              <h2>{snap.phase === "setup" ? (snap.calibrationProgress > 0 ? "Hold still..." : "Get in view") : snap.phase === "demo" && !snap.demoReady ? "Watch the demonstration on the right" : snap.caption || (snap.phase === "demo" ? "Watch the movement" : "Get ready")}</h2>
              {snap.phase === "demo" && (snap.demoReady || usesSeatedTargets(cfg.id)) && (preview || !opts.sim) && <canvas ref={ghostRef} className="xe-ghost" width={300} height={240} aria-label={reachDemo ? `Movement demonstration: ${reachDemo.instruction}` : "Movement ghost"} />}
              {reachDemo && <p className="xe-hint">{reachDemo.instruction}</p>}
              <p className="xe-said" aria-live="polite">{viewSaid ? `"${viewSaid}"` : ""}</p>
              {snap.phase === "setup" && <div className="xe-meter"><i style={{ width: `${snap.calibrationProgress * 100}%` }} /></div>}
              {(snap.phase === "warm" || snap.phase === "reps") && (
                <>
                  <div className={`xe-gauge ${snap.inZone ? "is-zone" : ""}`} aria-label="Hold on target" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(snap.holdProgress * 100)}>
                    <i className="fill" style={{ width: `${snap.holdProgress * 100}%` }} />

                  </div>
                  <p className="xe-hint">{!snap.targetArmed ? "Listen to the instruction. Wait for the circle to become active." : snap.kind === "return" || snap.kind === "close" ? "Return your hand to the lap circle and pause" : snap.inZone ? "Hold it there..." : cfg.id === "ex_h2m" ? "Bring your hand to the mouth circle, keeping your head up" : "Reach your hand into the target ring"}</p>
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
              {!snap.targetsReady && <p className="xe-note">{usesSeatedTargets(cfg.id) ? "Hold at the practice circle so I can learn your movement goals." : "Learning your starting position. Your movement goals will appear after practice."}</p>}
              {viewLive.roms.map(r => <MetricBar key={r.label} label={r.label} value={r.value} threshold={r.target} start={r.start} ready={snap.targetsReady} personalized={usesSeatedTargets(cfg.id)} />)}
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
  "exercise.target_zone": id => !usesSeatedTargets(id),
};
const adjustsExercise = (tuning: ExerciseTuning, exerciseId: string) => Object.keys(tuning.changed).some(key => ONLY_SOME_EXERCISES[key]?.(exerciseId) ?? true);

function Intro(props: { base: (typeof EXERCISES)[string]; cfg: ReturnType<typeof resolveExercise>; opts: LabOptions & { rung: Rung }; setOpts: (o: LabOptions & { rung: Rung }) => void; muted: boolean; setMuted: (m: boolean) => void; onStart: () => void; onPreview?: () => void }) {
  const { base, cfg, opts, setOpts, muted, setMuted, onStart, onPreview } = props;
  // Alira's settings as they stand now, so the numbers shown match the session (which reads them again when it starts).
  const tuning = loadExerciseTuning();
  const spec = buildRung(base.id, opts.rung);
  const reps = opts.quick ? 3 : tunedReps(spec.reps, tuning);
  const set = (patch: Partial<LabOptions & { rung: Rung }>) => setOpts({ ...opts, ...patch });
  return (
    <div className="xe-card xe-intro">
      {!usesSeatedTargets(base.id) && <p className="xe-eyebrow">{base.chain}</p>}
      <h2>{base.name}</h2>
      {!usesSeatedTargets(base.id) && <p>For: <b>{base.dailyTask}</b>. Camera: {base.framing}. Tracking: {cfg.tracking === "hand" ? "hand" : cfg.tracking === "pose" ? "body pose" : "body pose and hand"}.</p>}
      {tuning.adapted && adjustsExercise(tuning, base.id) && <p className="xe-note xe-adapted"><Sparkles size={14} aria-hidden="true" /> Alira has adjusted this exercise for you today.</p>}
      <div className="xe-rungs" role="radiogroup" aria-label="Level">
        {([1, 2, 3] as Rung[]).map(rung => {
          const r = buildRung(base.id, rung);
          const unavailable = usesSeatedTargets(base.id) && rung !== 1;
          return (
            <button key={rung} role="radio" disabled={unavailable} aria-checked={!unavailable && opts.rung === rung} className={!unavailable && opts.rung === rung ? "is-on" : ""} onClick={() => set({ rung })}>
              <b>{LEVEL_LABEL[rung]}</b>
              {unavailable && <span>Not available now</span>}
              {!usesSeatedTargets(base.id) && <span>{cfg.romSteps.map(rom => `${rom.label} ${r.targets[rom.id]}°`).join(" · ")}</span>}
              <em>{tunedReps(r.reps, tuning)} reps · {usesSeatedTargets(base.id) ? `hold ${Math.round(TARGET_HOLD_MS * tuning.holdFactor) / 1000}s` : `hold ×${Math.round(r.holdScale * tuning.holdFactor * 100) / 100}`}{r.oppositions ? ` · ${r.oppositions} pinch${r.oppositions > 1 ? "es" : ""}` : ""}</em>
            </button>
          );
        })}
      </div>
      <div className="xe-options">
        <label><span>Affected side</span>
          <select value={opts.side} onChange={e => set({ side: e.target.value as Side })}><option value="right">Right</option><option value="left">Left</option></select>
        </label>
        {!usesSeatedTargets(base.id) && <>
        <label className="xe-check"><input type="checkbox" checked={opts.quick} onChange={e => set({ quick: e.target.checked })} /> Quick test: 3 reps instead of {tunedReps(spec.reps, tuning)}</label>
        <label className="xe-check"><input type="checkbox" checked={opts.sim} onChange={e => set({ sim: e.target.checked })} /> No camera (simulate a patient)</label>
        <label className="xe-check"><input type="checkbox" checked={opts.assisted} onChange={e => set({ assisted: e.target.checked })} /> Someone helped (score × 0.5)</label>
        <label className="xe-check"><input type="checkbox" checked={muted} onChange={e => setMuted(e.target.checked)} /> Mute the voice (subtitles only)</label>
        </>}
      </div>
      {cfg.tracking !== "pose" && !opts.sim && <p className="xe-note"><Hand size={14} aria-hidden="true" /> Hold the hand close to the camera with every fingertip in view.</p>}
      {base.domain === "lower_limb" && !opts.sim && <p className="xe-note">Lower-limb tracking seated and front-on is unverified. If the angles look unstable, try the simulator or a side-on phone position.</p>}
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
          <thead><tr><th>Rep</th><th>Level</th><th>{cfg.id === "ex_h2m" ? "Movement" : "Reach"}</th><th>Form</th><th>Score</th></tr></thead>
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

function buildFrame(session: ExerciseSession, det: Detection, side: Side, t: number): Frame {
  const cfg = session.cfg;
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

function drawOverlay(canvas: HTMLCanvasElement | null, video: HTMLVideoElement, det: Detection, session: ExerciseSession, side: Side) {
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
  if (det.pose) {
    const lm = det.pose.landmarks;
    ctx.lineWidth = Math.max(3, w / 220);
    ctx.lineCap = "round";
    for (const [a, b] of POSE_LINES) {
      if ((lm[a]?.visibility ?? 1) < 0.4 || (lm[b]?.visibility ?? 1) < 0.4) continue;
      ctx.strokeStyle = mine.has(a) && mine.has(b) ? "#e18e6d" : "rgba(217,229,220,.85)";
      ctx.beginPath(); ctx.moveTo(X(lm[a].x), Y(lm[a].y)); ctx.lineTo(X(lm[b].x), Y(lm[b].y)); ctx.stroke();
    }
    ctx.fillStyle = "#fff";
    [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32].forEach(i => {
      if ((lm[i]?.visibility ?? 1) < 0.4) return;
      ctx.beginPath(); ctx.arc(X(lm[i].x), Y(lm[i].y), Math.max(3, w / 260), 0, Math.PI * 2); ctx.fill();
    });
  }
  const tracking = session.cfg.tracking;
  if (session.cfg.id === "ex_h2m") {
    const hand = mouthContactPoints(det.pose, side)[0];
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
    const hand = chooseHand(det.hands, tracking === "pose+hand" ? wrist : undefined);
    if (hand) {
      ctx.strokeStyle = "rgba(127,229,163,.95)";
      ctx.lineWidth = Math.max(2, w / 320);
      for (const [a, b] of HAND_LINES) { ctx.beginPath(); ctx.moveTo(X(hand.landmarks[a].x), Y(hand.landmarks[a].y)); ctx.lineTo(X(hand.landmarks[b].x), Y(hand.landmarks[b].y)); ctx.stroke(); }
      ctx.fillStyle = "#fff";
      hand.landmarks.forEach(p => { ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), Math.max(2, w / 360), 0, Math.PI * 2); ctx.fill(); });
      const step = session.currentStep;
      if (step?.kind === "pinch") {
        ctx.fillStyle = "#e18e6d";
        [4, 8 + 4 * (step.finger ?? 0)].forEach(i => { ctx.beginPath(); ctx.arc(X(hand.landmarks[i].x), Y(hand.landmarks[i].y), Math.max(6, w / 120), 0, Math.PI * 2); ctx.fill(); });
      }
    }
  }
}

function drawGhostFor(canvas: HTMLCanvasElement | null, session: ExerciseSession, snap: Snapshot, level: number) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  let p = Math.min(1, Math.max(0, level));
  if (snap.phase === "demo") {
    if (usesSeatedTargets(session.cfg.id)) {
      (session.cfg.id === "ex_h2m" ? drawMouthDemo : drawReachDemo)(ctx, snap.demoStepElapsedMs, session.cfg.cycle[snap.demoStepIndex]?.kind === "return", canvas.width, canvas.height, performance.now(), window.matchMedia("(prefers-reduced-motion: reduce)").matches, snap.targetArmed);
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
  drawGhost(ctx, session.cfg.ghost, p, canvas.width, canvas.height);
  if (usesSeatedTargets(session.cfg.id) && (snap.phase === "warm" || snap.phase === "reps") && !snap.review) {
    drawTestingTarget(ctx, { ...(session.cfg.id === "ex_h2m" ? mouthGhostTarget : reachGhostTarget)(canvas.width, canvas.height, snap.kind === "return"), armed: snap.targetArmed, contact: snap.targetArmed && snap.inZone, progress: snap.holdProgress, now: performance.now(), reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches });
  }
}


function cameraBodyChecks(session: Pick<ExerciseSession, "cfg">, detection: Detection, side: Side): Omit<BodyCheck, "progress">[] {
  const labels: Record<string, string> = { nose: "Face", shoulder: `${side === "right" ? "Right" : "Left"} shoulder`, shoulderOther: "Other shoulder", elbow: `${side === "right" ? "Right" : "Left"} elbow`, wrist: `${side === "right" ? "Right" : "Left"} hand`, hip: "Top of thigh", knee: "Knee", ankle: "Ankle", foot: "Foot & toes" };
  const joints = poseJoints(side);
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

function MetricBar({ label, value, threshold, start = 0, ready, limit = false, personalized = false }: { label: string; value: number | undefined; threshold: number; start?: number; ready: boolean; limit?: boolean; personalized?: boolean }) {
  const range = threshold - start;
  const progress = personalized ? reachAngleProgress(value, threshold, start) : range > 0 && value !== undefined ? (value - start) / range : 0;
  const crossed = ready && progress >= 1;
  const learning = personalized ? "Learning your movement goal" : "Learning starting position";
  const percent = value === undefined ? 0 : Math.min(100, Math.max(0, ready ? progress / 1.4 * 100 : value / (limit ? 1.4 : 180) * 100));
  return <section className={`xe-metric ${crossed ? limit ? "is-limit" : "is-met" : ""}`}>
    <div className="xe-metric-label"><b>{label}</b><span>{value === undefined ? "Finding you…" : !ready ? learning : crossed ? limit ? "Ease back" : "Target reached" : limit ? "Within limit" : "Keep reaching"}</span></div>
    <div className="xe-metric-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-valuetext={value === undefined ? "Tracking unavailable" : !ready ? learning : limit ? crossed ? "Above posture limit" : "Within posture limit" : `Estimated angle ${Math.round(value)} degrees; resting angle ${Math.round(start)} degrees; goal ${Math.round(threshold)} degrees${personalized ? "; learned at the practice target" : ""}`}><i style={{ width: `${percent}%` }} />{ready && <em style={{ left: `${100 / 1.4}%` }} />}</div>
  </section>;
}
