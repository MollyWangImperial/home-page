// The movement check's walking task (L6), filmed side-on with the phone propped sideways at hip height: how to film it
// (an animated demonstration, three steps, the safety line, who is holding you), a live set-up with the exercises' look
// (the phone on its side, head to feet, side-on, room to walk across, lighting; standing still records the trunk's
// standing angle), the recording (the device's own voice, a live step count, stopping by itself after across-and-back
// and standing still), then an honest result: real numbers only, or why it could not be measured, keeping the best walk
// measured so far for a later try that fails. Back only asks the page to confirm (so "Keep going" carries on); the
// camera, tracker, voice and timers are released when the task closes.

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Check, LoaderCircle, Mic, MicOff, Play, RotateCcw, ShieldCheck, SkipForward, Square } from "lucide-react";
import { analyzeGait, gaitSetupCheck, legLength, LiveGait, pelvisX, syntheticWalk, trunkAngleDeg, type GaitFrame } from "@/lib/assessment-engine/gait";
import { drawWalkFilmingDemo, walkDemoHeight, WALK_DEMO_CAPTIONS, WALK_DEMO_MS } from "@/lib/assessment-engine/walk-demo";
import { roundHalfUp } from "@/lib/assessment-engine/function-score";
import type { GaitResult, WalkAssist } from "@/lib/assessment-engine/types";
import { LightingProbe } from "@/lib/exercise-engine/lighting";
import { POSE_LINES, type Pt } from "@/lib/exercise-engine/metrics";
import { createTracker, openCamera, type Tracker } from "@/lib/exercise-engine/tracker";
import { createVoice, type RunnerVoice } from "@/lib/exercise-engine/voice";
import "@/pages/exercise-engine.css";
import "./walking-task.css";

export type WalkingTaskProps = {
  side: "left" | "right";
  /** The survey said someone usually helps the patient walk: "Someone is nearby" starts selected. */
  walkingHelper: boolean;
  /** No camera: a simulated walker goes through the same analysis (admin and development testing). */
  sim?: boolean;
  /** Where this task sits in the check, e.g. "Task 5 of 5". */
  stepLabel?: string;
  onDone(result: GaitResult): void;
  onSkip(): void;
  onExit(): void;
};

type Stage = "intro" | "setup" | "recording" | "analysing" | "result" | "error";
type RowId = "frame" | "body" | "side" | "room" | "light";
type ScoredWalk = Extract<GaitResult, { status: "scored" }>;
type Row = { id: RowId; label: string; ok: boolean; hint: string; progress: number };

export const WALK_STEPS = [
  "Prop your phone or laptop sideways at hip height, on a shelf, table or chair.",
  "Stand side-on, about 3 big steps in front of it, at one edge of the picture.",
  "When you hear ‘Go’, walk across at your usual pace, past the other edge, turn, and walk back.",
] as const;
export const ASSIST_CHOICES: { value: WalkAssist; label: string }[] = [
  { value: "holds", label: "Yes, they hold me" },
  { value: "nearby", label: "Someone is nearby" },
  { value: "none", label: "No one" },
];
const BEATS = ["How to film", "Set up", "Walk", "Result"];
export const MAX_TRIES = 3;
/** The recording stops by itself at this length. */
const MAX_RECORDING_MS = 45000;
/** Standing still this long, with every set-up row good, records the standing trunk angle and starts the walk. */
const STAND_STILL_MS = 2000;
/** Standing still: the pelvis stays within this share of a leg length. */
const STILL_LEGS = 0.12;
/** The simulator plays its walk this many times faster than real time. */
const SIM_SPEED = 4;
const SETUP_LINE = "Prop your phone sideways at hip height. Stand side-on, about 3 big steps away, at one edge of the picture. Then stand still for a moment.";
const GO_LINE = "Ready… Go! Walk across, turn, and walk back.";
const ROW_LABELS: Record<RowId, string> = { frame: "Phone on its side", body: "Head to feet in view", side: "Side-on to the camera", room: "Enough room to walk across", light: "Lighting" };
const ROW_IDS: RowId[] = ["frame", "body", "side", "room", "light"];
const EMPTY_ROWS: Row[] = ROW_IDS.map(id => ({ id, label: ROW_LABELS[id], ok: false, hint: "", progress: 0 }));
const emptyProgress = (): Record<RowId, number> => ({ frame: 0, body: 0, side: 0, room: 0, light: 0 });
/** A modal dialog (the page's "Leave the movement check?") is open over the task: hold the walk's start until it closes. */
export const dialogOpen = () => typeof document !== "undefined" && document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
/** The leg and arm points of each side, so the overlay can show the affected side in coral. */
const SIDE_POINTS = { left: new Set([11, 13, 15, 23, 25, 27, 29, 31]), right: new Set([12, 14, 16, 24, 26, 28, 30, 32]) };
const FOOT_LINES: [number, number][] = [[27, 29], [29, 31], [28, 30], [30, 32]];

const reducedMotionNow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const median = (values: number[]) => { const s = values.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length ? s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 : NaN; };
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** The real numbers a measured walk shows, rounded once for display (none made up; a missing one is left out). */
export function walkingFigures(result: GaitResult | null): { label: string; value: string }[] {
  if (result?.status !== "scored") return [];
  const m = result.metrics, out: { label: string; value: string }[] = [];
  if (finite(m.speedMpsEstimate) && m.speedMpsEstimate > 0) out.push({ label: "Walking speed", value: `About ${((roundHalfUp(m.speedMpsEstimate * 10) ?? 0) / 10).toFixed(1)} m/s` });
  if (finite(m.cadence) && m.cadence > 0) out.push({ label: "Steps a minute", value: String(roundHalfUp(m.cadence)) });
  const even = finite(m.stepLengthSymmetry) ? m.stepLengthSymmetry : finite(m.stepTimeSymmetry) ? m.stepTimeSymmetry : null;
  if (even !== null) out.push({ label: finite(m.stepLengthSymmetry) ? "Step evenness" : "Step timing evenness", value: `${roundHalfUp(even * 100)}%` });
  if (finite(m.kneeFlexPeak)) out.push({ label: "Knee bend as your foot swings", value: `${roundHalfUp(m.kneeFlexPeak)}°` });
  return out;
}

export type RetryAction = { id: "retry" | "earlier" | "continue" | "skip"; label: string; primary: boolean };

/**
 * The choices after a walk that could not be measured (or a camera that would not start): try again while tries are
 * left, else go on. A walk measured earlier is never thrown away: it can be used instead, and on the last try going on
 * uses it.
 */
export function retryActions(triesLeft: number, hasEarlier: boolean): RetryAction[] {
  const out: RetryAction[] = [];
  if (triesLeft > 0) out.push({ id: "retry", label: "Try again", primary: true });
  if (hasEarlier) out.push({ id: "earlier", label: "Use my earlier result", primary: triesLeft <= 0 });
  else if (triesLeft <= 0) out.push({ id: "continue", label: "Continue", primary: true });
  out.push({ id: "skip", label: "Skip walking today", primary: false });
  return out;
}

/** The walk to keep for later: the higher-scoring of the one kept so far and a new one (unmeasured walks never replace it). */
export function betterWalk(kept: ScoredWalk | null, outcome: GaitResult): ScoredWalk | null {
  return outcome.status !== "scored" || (kept && kept.score >= outcome.score) ? kept : outcome;
}

/**
 * Back: hush the voice and ask the page to confirm. Nothing is released here, so the page's "Keep going" carries on
 * where the task was; leaving unmounts the task, which releases the camera, model, loop and voice.
 */
export function askToLeave(voice: Pick<RunnerVoice, "stop"> | null, onExit: () => void) {
  voice?.stop();
  onExit();
}

/** The recording chip on the camera view. Not a live region: its seconds would be read out every second. */
export function RecordingChip({ seconds }: { seconds: number }) {
  return <span className="wt-rec-chip"><i aria-hidden="true" /> Recording · {seconds} s</span>;
}

/** The live step count and time. Read when visited, not announced: they change too often for a live region. */
export function RecordingCounts({ steps, seconds }: { steps: number; seconds: number }) {
  return (
    <div className="wt-live">
      <div><b>{steps}</b><span>steps so far</span></div>
      <div><b>{seconds}</b><span>seconds</span></div>
    </div>
  );
}

/** The pose drawn over the mirrored video (or the simulator's stage), the affected side in coral. */
function drawPose(canvas: HTMLCanvasElement | null, landmarks: Pt[] | null, width: number, height: number, side: "left" | "right", background?: string) {
  if (!canvas) return;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); }
  if (!landmarks?.length) return;
  const X = (x: number) => (1 - x) * width, Y = (y: number) => y * height;
  const mine = SIDE_POINTS[side];
  ctx.lineWidth = Math.max(3, width / 220);
  ctx.lineCap = "round";
  for (const [a, b] of [...POSE_LINES, ...FOOT_LINES]) {
    const p = landmarks[a], q = landmarks[b];
    if (!p || !q || (p.visibility ?? 1) < 0.4 || (q.visibility ?? 1) < 0.4) continue;
    ctx.strokeStyle = mine.has(a) && mine.has(b) ? "#e18e6d" : "rgba(217,229,220,.85)";
    ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.y)); ctx.lineTo(X(q.x), Y(q.y)); ctx.stroke();
  }
  ctx.fillStyle = "#fff";
  for (const i of [0, 11, 12, 23, 24, 25, 26, 27, 28, 29, 30]) {
    const p = landmarks[i];
    if (!p || (p.visibility ?? 1) < 0.4) continue;
    ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), Math.max(3, width / 260), 0, Math.PI * 2); ctx.fill();
  }
}

export default function WalkingTask({ side, walkingHelper, sim = false, stepLabel, onDone, onSkip, onExit }: WalkingTaskProps) {
  const [stage, setStage] = useState<Stage>("intro");
  const [assist, setAssist] = useState<WalkAssist>(walkingHelper ? "nearby" : "none");
  const [rows, setRows] = useState<Row[]>(EMPTY_ROWS);
  const [stillProgress, setStillProgress] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [rec, setRec] = useState({ seconds: 0, steps: 0 });
  const [result, setResult] = useState<GaitResult | null>(null);
  // The best walk measured so far (highest score): a later try that fails, or a camera that will not start, can use it.
  const [best, setBest] = useState<ScoredWalk | null>(null);
  const [tries, setTries] = useState(0);
  const [error, setError] = useState("");
  const [said, setSaid] = useState("");
  const [muted, setMuted] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState(true);
  const [reduced, setReduced] = useState(reducedMotionNow);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<HTMLCanvasElement>(null);
  const demoRef = useRef<HTMLCanvasElement>(null);
  const demoWrapRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef<Tracker | null>(null);
  const voiceRef = useRef<RunnerVoice | null>(null);
  // The frame loop runs on a 16 ms timer, as the exercises' does (it keeps going when the tab is in the background).
  const loopRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  // Every way out bumps the generation, so a camera or model still opening, or a pending analysis, is dropped.
  const generation = useRef(0);
  const stageRef = useRef<Stage>("intro");
  const assistRef = useRef(assist);
  const mutedRef = useRef(muted);
  const framesRef = useRef<GaitFrame[]>([]);
  const liveRef = useRef(new LiveGait());
  const lightingProbe = useRef(new LightingProbe());
  const progressRef = useRef<Record<RowId, number>>(emptyProgress());
  const lastTRef = useRef(0);
  const lastVideoTime = useRef(-1);
  const standRef = useRef<{ t: number; x: number; leg: number; trunk: number | null }[]>([]);
  const standingTrunk = useRef<number | undefined>(undefined);
  const recordStart = useRef(0);
  const hintRef = useRef({ text: "", at: 0, failingSince: 0 });
  const recShown = useRef({ seconds: -1, steps: -1 });

  stageRef.current = stage;
  assistRef.current = assist;
  mutedRef.current = muted;

  const go = (next: Stage) => { stageRef.current = next; setStage(next); };
  const later = (fn: () => void, ms: number) => { timersRef.current.push(window.setTimeout(fn, ms)); };
  const voice = () => {
    if (!voiceRef.current) {
      // The movement check speaks with the device's own voice.
      const created = createVoice();
      created.setMuted(mutedRef.current);
      created.onSay = setSaid;
      created.onAvailability = setVoiceAvailable;
      voiceRef.current = created;
    }
    return voiceRef.current;
  };

  /** The camera, the movement model and the frame loop (the voice keeps going: the result is still to be said). */
  const releaseCamera = useCallback(() => {
    window.clearTimeout(loopRef.current);
    loopRef.current = 0;
    trackerRef.current?.close();
    trackerRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  /** Everything: camera, model, loop, timers and voice; anything still opening is dropped. */
  const stopAll = useCallback(() => {
    generation.current++;
    releaseCamera();
    timersRef.current.forEach(timer => window.clearTimeout(timer));
    timersRef.current = [];
    voiceRef.current?.stop();
  }, [releaseCamera]);

  useEffect(() => stopAll, [stopAll]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(query.matches);
    query.addEventListener?.("change", change);
    return () => query.removeEventListener?.("change", change);
  }, []);

  // The how-to-film demonstration: animated while the intro shows, still frames with reduced motion.
  useEffect(() => {
    if (stage !== "intro") return;
    const canvas = demoRef.current, wrap = demoWrapRef.current;
    if (!canvas || !wrap) return;
    let raf = 0, width = 0, height = 0;
    const started = performance.now();
    const size = () => {
      const next = Math.max(260, Math.round(wrap.clientWidth || 340));
      if (next === width) return;
      width = next; height = walkDemoHeight(width, reduced);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduced && ctx) drawWalkFilmingDemo(ctx, 0, width, height, true);
    };
    size();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(size) : null;
    observer?.observe(wrap);
    const frame = () => {
      const ctx = canvas.getContext("2d");
      if (ctx) drawWalkFilmingDemo(ctx, (performance.now() - started) % WALK_DEMO_MS, width, height, false);
      raf = requestAnimationFrame(frame);
    };
    if (!reduced) raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); observer?.disconnect(); };
  }, [stage, reduced]);

  /** Analyse the recorded frames (after a short "measuring" card) and show the result. */
  const finish = useCallback((frames: GaitFrame[]) => {
    releaseCamera();
    go("analysing");
    const run = generation.current;
    later(() => {
      if (run !== generation.current) return;
      const outcome = analyzeGait(frames, { assist: assistRef.current, standingTrunkDeg: standingTrunk.current });
      setResult(outcome);
      setBest(kept => betterWalk(kept, outcome));
      setTries(count => count + 1);
      go("result");
      voice().say(outcome.status === "scored" ? "Walking measured. Thank you." : `I couldn't measure your walking. ${outcome.reason}`);
    }, reducedMotionNow() ? 250 : 1100);
  }, [releaseCamera]);

  const resetRecording = () => {
    framesRef.current = [];
    liveRef.current = new LiveGait();
    recShown.current = { seconds: -1, steps: -1 };
    setRec({ seconds: 0, steps: 0 });
  };

  const startRecording = (t: number) => {
    resetRecording();
    recordStart.current = t;
    go("recording");
    voice().stop();
    voice().say(GO_LINE);
  };

  /** The live recording's numbers, re-rendered only when they change. */
  const showRec = (seconds: number, steps: number) => {
    if (recShown.current.seconds === seconds && recShown.current.steps === steps) return;
    recShown.current = { seconds, steps };
    setRec({ seconds, steps });
  };

  /** One camera frame: the overlay, then the set-up rows or the recording. */
  const onFrame = (video: HTMLVideoElement, landmarks: Pt[] | null, t: number) => {
    const aspect = video.videoWidth / video.videoHeight;
    drawPose(overlayRef.current, landmarks, video.videoWidth, video.videoHeight, side);
    if (stageRef.current === "setup") {
      const light = lightingProbe.current.sample(video, landmarks ? { landmarks, world: [] } : null, t);
      const check = gaitSetupCheck(landmarks, aspect);
      const waived = lightingProbe.current.waived();
      // First, the picture: landscape and upright (rotation lock, or the phone left standing, cannot pass).
      const current: Omit<Row, "progress">[] = [
        { id: "frame", label: ROW_LABELS.frame, ok: check.upright.ok, hint: check.upright.hint },
        { id: "body", label: ROW_LABELS.body, ok: check.wholeBody.ok, hint: check.wholeBody.hint },
        { id: "side", label: ROW_LABELS.side, ok: check.sideOn.ok, hint: check.sideOn.hint },
        { id: "room", label: ROW_LABELS.room, ok: check.room.ok, hint: check.room.hint },
        { id: "light", label: waived && light && !light.ok ? "Lighting (could be better)" : ROW_LABELS.light, ok: Boolean(light?.ok || waived), hint: light?.hint ?? "Checking the light..." },
      ];
      // Each row fills over 1.4 s while it holds and empties faster when it slips, as in the exercises' set-up.
      const dt = Math.min(100, Math.max(0, t - (lastTRef.current || t)));
      lastTRef.current = t;
      const next = current.map(row => {
        const progress = Math.max(0, Math.min(1, progressRef.current[row.id] + dt / (row.ok ? 1400 : -550)));
        progressRef.current[row.id] = progress;
        return { ...row, progress };
      });
      setRows(next);
      // Back was pressed and the page is asking whether to leave: wait, saying nothing and not starting the walk.
      if (dialogOpen()) { hintRef.current.failingSince = 0; standRef.current = []; setStillProgress(0); return; }
      const ready = next.every(row => row.ok && row.progress >= 1);
      // Read the first thing to fix aloud when it has not been fixed for a while (and not over and over).
      const failing = next.find(row => !row.ok);
      if (!failing) hintRef.current.failingSince = 0;
      else {
        if (!hintRef.current.failingSince) hintRef.current.failingSince = t;
        const v = voiceRef.current;
        if (failing.hint && t - hintRef.current.failingSince > 4000 && v && !v.busy(t) && (failing.hint !== hintRef.current.text || t - hintRef.current.at > 12000)) {
          hintRef.current = { text: failing.hint, at: t, failingSince: t };
          v.say(failing.hint);
        }
      }
      // Standing still with everything good: 2 s of the standing trunk angle, then the walk.
      const x = landmarks ? pelvisX(landmarks, aspect) : null, leg = landmarks ? legLength(landmarks, aspect) : null;
      if (!ready || x === null || leg === null) { standRef.current = []; setStillProgress(0); return; }
      const first = standRef.current[0];
      if (first && Math.abs(x - first.x) > STILL_LEGS * first.leg) standRef.current = [];
      standRef.current.push({ t, x, leg, trunk: trunkAngleDeg(landmarks, aspect) });
      const span = t - standRef.current[0].t;
      setStillProgress(Math.min(1, span / STAND_STILL_MS));
      if (span >= STAND_STILL_MS) {
        const trunks = standRef.current.map(sample => sample.trunk).filter(finite);
        standingTrunk.current = trunks.length >= 5 ? median(trunks) : undefined;
        standRef.current = [];
        startRecording(t);
      }
      return;
    }
    if (stageRef.current === "recording") {
      const frame: GaitFrame = { t, landmarks: landmarks ?? [], aspect };
      framesRef.current.push(frame);
      const state = liveRef.current.push(frame);
      const elapsed = t - recordStart.current;
      showRec(Math.floor(elapsed / 1000), state.steps);
      if ((state.passes >= 2 && state.still) || elapsed >= MAX_RECORDING_MS) finish(framesRef.current);
    }
  };
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  /** The camera loop: each new video frame through the movement model. */
  const loop = useCallback(() => {
    loopRef.current = window.setTimeout(loop, 16);
    const video = videoRef.current, tracker = trackerRef.current;
    if (!video || !tracker || video.readyState < 2 || video.currentTime === lastVideoTime.current || !video.videoWidth) return;
    lastVideoTime.current = video.currentTime;
    const t = performance.now();
    let landmarks: Pt[] | null = null;
    try {
      const pose = tracker.detect(video, t).pose;
      // Plain copies: the recording keeps them after the model has moved on.
      landmarks = pose ? pose.landmarks.map(p => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })) : null;
    } catch { landmarks = null; }
    onFrameRef.current(video, landmarks, t);
  }, []);

  /** The simulator: a synthetic walker played through the live counter and the analysis, a few times faster. */
  const startSim = () => {
    const run = generation.current;
    const frames = syntheticWalk({
      noise: 0.002, seed: tries + 1, cadence: 92, stepLength: 0.62, stepLengthRatio: 0.86, stepTimeRatio: 1.1,
      kneeFlex: [56, 40], trunkLean: 6, standingLean: 2,
    });
    const standing = frames.slice(0, 20).map(frame => trunkAngleDeg(frame.landmarks, frame.aspect)).filter(finite);
    standingTrunk.current = standing.length ? median(standing) : undefined;
    resetRecording();
    go("recording");
    voice().say(GO_LINE);
    const started = performance.now();
    let steps = 0;
    const step = () => {
      if (run !== generation.current) return;
      const simT = (performance.now() - started) * SIM_SPEED;
      // The frames "filmed" so far go to the live counter and the recording, as the camera's would.
      while (framesRef.current.length < frames.length && frames[framesRef.current.length].t <= simT) {
        const frame = frames[framesRef.current.length];
        framesRef.current.push(frame);
        steps = liveRef.current.push(frame).steps;
      }
      const latest = framesRef.current[framesRef.current.length - 1] ?? frames[0];
      drawPose(simRef.current, latest.landmarks, 640, Math.round(640 / latest.aspect), side, "#15281f");
      showRec(Math.floor(latest.t / 1000), steps);
      if (framesRef.current.length >= frames.length) { finish(framesRef.current); return; }
      loopRef.current = window.setTimeout(step, 16);
    };
    loopRef.current = window.setTimeout(step, 16);
  };

  const start = async () => {
    stopAll();
    const run = generation.current;
    setResult(null);
    setError("");
    setRows(EMPTY_ROWS);
    setStillProgress(0);
    progressRef.current = emptyProgress();
    lastTRef.current = 0;
    lastVideoTime.current = -1;
    standRef.current = [];
    standingTrunk.current = undefined;
    hintRef.current = { text: "", at: 0, failingSince: 0 };
    lightingProbe.current.reset();
    if (sim) { startSim(); return; }
    go("setup");
    voice().say(SETUP_LINE);
    try {
      const tracker = await createTracker("pose");
      if (run !== generation.current) { tracker.close(); return; }
      trackerRef.current = tracker;
      // The set-up view (and its <video>) renders with the stage; wait for the element.
      for (let i = 0; i < 50 && !videoRef.current; i++) await new Promise(resolve => setTimeout(resolve, 20));
      if (!videoRef.current) throw new Error("The camera view did not open.");
      const stream = await openCamera(videoRef.current);
      if (run !== generation.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      setCameraReady(true);
      loopRef.current = window.setTimeout(loop, 16);
    } catch (err) {
      if (run !== generation.current) return;
      stopAll();
      const message = err instanceof Error ? err.message : String(err);
      setError(/denied|permission|NotAllowed/i.test(message) ? "Camera permission was blocked. Allow the camera for this site, then choose Try again." : `Could not start the camera or movement model: ${message}`);
      go("error");
    }
  };

  const exit = () => askToLeave(voiceRef.current, onExit);
  const skip = () => { stopAll(); onSkip(); };
  const done = (outcome: GaitResult) => { stopAll(); onDone(outcome); };
  // Stop: what was filmed so far is analysed (too little says so honestly).
  const stopRecording = () => finish(framesRef.current);
  const toggleMute = () => { const next = !muted; setMuted(next); mutedRef.current = next; voiceRef.current?.setMuted(next); };

  const camera = stage === "setup" || stage === "recording";
  const beat = stage === "intro" ? 0 : stage === "setup" || stage === "error" ? 1 : stage === "recording" ? 2 : 3;
  const figures = walkingFigures(result);
  const triesLeft = MAX_TRIES - tries;
  const earlierNote = best ? <p className="xe-note wt-center-note">Your earlier walk was measured. You can use that result.</p> : null;
  const retryButtons = (actions: RetryAction[]) => actions.map(action => {
    const Icon = action.id === "retry" ? RotateCcw : action.id === "earlier" ? Check : action.id === "skip" ? SkipForward : null;
    const choose = action.id === "retry" ? () => void start() : action.id === "earlier" ? () => { if (best) done(best); } : action.id === "continue" ? () => { if (result) done(result); } : skip;
    return <button key={action.id} className={action.primary ? "xe-primary" : "xe-secondary"} onClick={choose}>{Icon ? <><Icon size={16} aria-hidden="true" /> {action.label}</> : action.label}</button>;
  });

  return (
    <div className="xe-page wt-page">
      <header className="xe-top">
        <button className="xe-back" onClick={exit}><ArrowLeft size={18} aria-hidden="true" /> Back</button>
        <div className="xe-title">
          <span className="xe-domain">Movement check{stepLabel ? ` · ${stepLabel}` : ""}</span>
          <h1>Walking</h1>
        </div>
        {stage !== "intro" && (
          <button className="xe-icon" onClick={toggleMute} aria-label={muted ? "Turn voice on" : "Turn voice off"} title={muted ? "Voice off" : "Voice on"}>
            {muted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
        )}
      </header>
      {stage !== "intro" && !voiceAvailable && !muted && <p className="xe-note wt-note" role="status">An English voice is unavailable in this browser. Instructions are shown in English below.</p>}

      <ol className="xe-beats" aria-label="Walking steps">
        {BEATS.map((label, i) => <li key={label} className={i === beat ? "is-on" : i < beat ? "is-past" : ""} aria-current={i === beat ? "step" : undefined}><span>{i + 1}</span>{label}</li>)}
      </ol>

      {stage === "intro" && (
        <div className="xe-card wt-intro">
          <div className="wt-demo" ref={demoWrapRef}>
            <canvas ref={demoRef} role="img" aria-label={`How to film your walk. ${WALK_DEMO_CAPTIONS.join(" ")} A helper can walk on the far side of you, never between you and the camera.`} />
          </div>
          <ol className="wt-steps">
            {WALK_STEPS.map(step => <li key={step}>{step}</li>)}
          </ol>
          <p className="wt-safety"><ShieldCheck size={18} aria-hidden="true" /> Use your usual walking aid. Have someone nearby. Stop if you feel unsteady.</p>
          <fieldset className="wt-assist">
            <legend>Is anyone holding you while you walk?</legend>
            <div className="xe-chips" role="radiogroup" aria-label="Is anyone holding you while you walk?">
              {ASSIST_CHOICES.map(choice => (
                <button key={choice.value} type="button" role="radio" className="xe-chip" aria-checked={assist === choice.value} onClick={() => setAssist(choice.value)}>{choice.label}</button>
              ))}
            </div>
            {assist === "nearby" && <p className="wt-assist-note">They can walk beside you on the far side, away from the camera.</p>}
          </fieldset>
          <div className="xe-actions">
            <button className="xe-primary" onClick={() => void start()}>{sim ? <Play size={16} aria-hidden="true" /> : <Camera size={16} aria-hidden="true" />} {sim ? "Start simulated walk" : "Start camera"}</button>
            <button className="xe-secondary" onClick={skip}><SkipForward size={16} aria-hidden="true" /> Skip walking today</button>
          </div>
        </div>
      )}

      {camera && (
        <div className="xe-run wt-run">
          <section className="xe-stage" aria-label={sim ? "Simulated walk" : "Camera view"}>
            {sim ? (
              <div className="xe-simstage wt-simstage"><canvas ref={simRef} width={640} height={480} aria-label="Simulated walker" /><span className="xe-simtag">No camera · simulated walk</span></div>
            ) : (
              <div className="xe-video">
                <video ref={videoRef} playsInline muted />
                <canvas ref={overlayRef} aria-label="Movement tracking overlay" />
              </div>
            )}
            {stage === "recording" && <RecordingChip seconds={rec.seconds} />}
          </section>

          <aside className="xe-side">
            <div className="xe-card xe-coach">
              <h2>{stage === "recording" ? "Walk across, turn, and walk back" : !cameraReady ? "Opening the camera…" : stillProgress > 0 ? "Stand still…" : "Get in view"}</h2>
              <p className="xe-said" aria-live="polite">{said ? `“${said}”` : ""}</p>
              {stage === "setup" && (cameraReady
                ? <>
                  <div className="xe-meter" role="progressbar" aria-label="Standing still" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(stillProgress * 100)}><i style={{ width: `${stillProgress * 100}%` }} /></div>
                  <p className="xe-hint">{rows.every(row => row.ok) ? "Stand still for a moment, side-on, at one edge of the picture." : "Prop the phone sideways at hip height, and stand about 3 big steps away."}</p>
                </>
                : <p className="xe-hint wt-loading"><LoaderCircle className="xe-spin" size={18} aria-hidden="true" /> Opening the camera and movement model…</p>)}
              {stage === "recording" && (
                <>
                  <RecordingCounts steps={rec.steps} seconds={rec.seconds} />
                  <p className="xe-hint">Walk at your usual pace, past the other edge, then turn and come back. Stand still when you are done.</p>
                  <div className="xe-actions">
                    <button className="xe-secondary" onClick={stopRecording}><Square size={14} aria-hidden="true" /> Stop</button>
                  </div>
                </>
              )}
            </div>

            {stage === "setup" && !sim && (
              <div className="xe-card xe-body-checks">
                <h3>Get ready to walk</h3>
                {rows.map(row => (
                  <div className={`xe-body-check ${row.ok ? "is-visible" : "is-missing"}`} key={row.id}>
                    <div className="xe-body-label"><b>{row.label}</b><span>{row.ok ? row.progress >= 1 ? "Good ✓" : "Found · hold it" : "Not yet"}</span></div>
                    <div className="xe-body-meter" role="progressbar" aria-label={row.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(row.progress * 100)}><i style={{ transform: `scaleX(${row.progress})` }} /></div>
                    {!row.ok && row.hint && <p>{row.hint}</p>}
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}

      {stage === "analysing" && (
        <div className="xe-card wt-center" role="status">
          <LoaderCircle className="xe-spin" size={30} aria-hidden="true" />
          <div>
            <h2>Measuring your walk…</h2>
            <div className="wt-measuring" aria-hidden="true"><i /></div>
          </div>
        </div>
      )}

      {stage === "result" && result?.status === "scored" && (
        <div className="xe-card wt-result" role="status">
          <span className="xe-tick"><Check size={34} aria-hidden="true" /></span>
          <h2>Walking measured</h2>
          {figures.length > 0 && (
            <dl className="wt-figures">
              {figures.map(figure => <div key={figure.label}><dt>{figure.label}</dt><dd>{figure.value}</dd></div>)}
            </dl>
          )}
          {result.assist === "holds" && <p className="xe-note wt-center-note">Measured with someone holding you.</p>}
          <p className="xe-note wt-center-note">Estimates from the video, not a medical test.</p>
          <div className="xe-actions">
            <button className="xe-primary" onClick={() => done(result)}><Check size={16} aria-hidden="true" /> Use these results</button>
            {triesLeft > 0 && <button className="xe-secondary" onClick={() => void start()}><RotateCcw size={16} aria-hidden="true" /> Walk again</button>}
          </div>
        </div>
      )}

      {stage === "result" && result && result.status !== "scored" && (
        <div className="xe-card wt-result" role="alert">
          <h2>I couldn&rsquo;t measure your walking</h2>
          {"reason" in result && <p className="wt-reason">{result.reason}</p>}
          <p className="xe-note wt-center-note">{triesLeft > 0 ? `You can try ${triesLeft === 1 ? "once more" : `${triesLeft} more times`}.` : "That was the last try for today."}</p>
          {earlierNote}
          <div className="xe-actions">{retryButtons(retryActions(triesLeft, Boolean(best)))}</div>
        </div>
      )}

      {stage === "error" && (
        <div className="xe-card" role="alert">
          <h2>Couldn&rsquo;t start</h2>
          <p>{error}</p>
          {earlierNote}
          <div className="xe-actions">{retryButtons(retryActions(Infinity, Boolean(best)))}</div>
        </div>
      )}
    </div>
  );
}
