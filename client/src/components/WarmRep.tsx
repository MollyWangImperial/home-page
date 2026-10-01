// The daily warm-up on screen: an invitation, one minute of camera (two comfortable reaches), and a
// gentle finish. It is never pass or fail and shows no numbers. The measurement itself lives in
// lib/warm-rep.ts; this component only runs the camera, builds frames, speaks and draws.
//
// Renders under renderToStaticMarkup: nothing touches window or storage during render except the
// store's own guarded reads.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Clock, LoaderCircle, RotateCcw } from "lucide-react";
import { KEY_FRAME_LIMITS, type FeltReport, type GateKind, type KeyFrame, type PainReport, type WarmRepRecord } from "@shared/alira-adaptation";
import {
  holdKeyFrames, learningToday, loadConsent, saveReport, saveWarmRep,
} from "@/lib/alira-learning-store";
import { startLearning } from "@/lib/alira-learning-client";
import { medianGeo, poseFrameValues, poseJoints, poseVisibility, reachLapRest, type Geo, type PoseInput } from "@/lib/exercise-engine/metrics";
import { createTracker, openCamera, type Tracker } from "@/lib/exercise-engine/tracker";
import { createVoice, type RunnerVoice } from "@/lib/exercise-engine/voice";
import { WARM_REP_LINES } from "@/lib/warm-rep-lines";
import { simulatedWarmRep, WarmRepTracker, type WarmRepFrame, type WarmRepPhase, type WarmRepState } from "@/lib/warm-rep";
import "./warm-rep.css";

type Side = "left" | "right";
type Screen = "intro" | "run" | "error" | "done";
type CameraProblem = "blocked" | "missing" | "general";

export type WarmRepProps = {
  source: GateKind;
  side: Side;
  onDone: (record: WarmRepRecord) => void;
  onSkip: () => void;
  /** "Stop for today" after reporting a lot of pain. Without it, the home page opens. */
  onStop?: () => void;
};

/** Spoken once at each phase change; the caption shows the shorter prompt from the tracker. */
const LINES = WARM_REP_LINES;

function lineFor(state: WarmRepState): string {
  switch (state.phase) {
    case "position": return LINES.position;
    case "rest": return LINES.rest;
    case "reach1": return LINES.reach1;
    case "reach2": return LINES.reach2;
    case "relax1":
    case "relax2": return state.reaches[state.reaches.length - 1] ? LINES.relaxHeld : LINES.relaxFree;
    default: return LINES.done;
  }
}

const WARM_LINES = [
  "Thank you. Everything after this starts from here.",
  "Lovely work. I'll set things up from where you are today.",
  "That's all I needed. Today starts in the right place.",
  "Beautifully done. Every day starts somewhere, and today starts here.",
  "Thank you for warming up with me. We'll build gently from here.",
];

const FELT: { value: FeltReport; label: string }[] = [
  { value: "easier", label: "Easier than usual" },
  { value: "about_right", label: "About right" },
  { value: "harder", label: "A bit harder" },
  { value: "much_harder", label: "Much harder" },
];
const PAIN: { value: PainReport; label: string }[] = [
  { value: "none", label: "None" },
  { value: "a_little", label: "A little" },
  { value: "a_lot", label: "A lot" },
];
const STEPS = ["Settle in", "First reach", "Second reach"];

const PROBLEM_COPY: Record<CameraProblem, string> = {
  blocked: "The camera is blocked for this page. Allow the camera in your browser, usually from the icon in the address bar, then choose Try again.",
  missing: "I couldn't use a camera just now. Check that one is connected and not being used by another app, then try again.",
  general: "The camera or the movement guide didn't start this time. That happens now and then, and a second try usually helps.",
};

function cameraConsentNow(): boolean {
  try {
    return loadConsent().camera === true;
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function cameraProblem(error: unknown): CameraProblem {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  if (/NotAllowed|Permission|denied|Security/i.test(text)) return "blocked";
  if (/NotFound|DevicesNotFound|Overconstrained|NotReadable|TrackStart/i.test(text)) return "missing";
  return "general";
}

/** One camera frame as the warm-up needs it, plus the posture snapshot used to learn the resting reference. */
export function warmRepFrameFrom(pose: PoseInput | null, side: Side, reference: Geo | null, t: number): { frame: WarmRepFrame; geo: Geo | null } {
  const view = poseVisibility(pose, side, "upper");
  const lap = reachLapRest(pose, side);
  const frame: WarmRepFrame = { t, visible: view.ok, missing: view.missing, lapReady: lap.lapRest !== undefined, lapMissing: lap.lapMissing };
  if (!pose) return { frame, geo: null };
  const out = poseFrameValues(pose, side, reference);
  const joints = poseJoints(side);
  frame.shoulderFlexion = out.values.shoulder_flexion;
  frame.elbowExtension = out.values.elbow_extension;
  frame.wristY = pose.landmarks[joints.wrist]?.y;
  frame.shoulderY = pose.landmarks[joints.shoulder]?.y;
  if (reference) {
    frame.trunkLeanDeg = out.comps.trunk_lean_delta;
    frame.shoulderElevationPct = out.comps.shoulder_elevation_pct;
    frame.faceApproachPct = out.comps.face_approach_pct;
  }
  return { frame, geo: out.geo ?? null };
}

/** A still of the raw (unmirrored) camera frame, 480 px wide, as a JPEG data URL. */
function captureStill(video: HTMLVideoElement): string | null {
  try {
    if (!video.videoWidth || !video.videoHeight) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = Math.max(1, Math.round((video.videoHeight * 480) / video.videoWidth));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.7);
    const prefix = "data:image/jpeg;base64,";
    return url.startsWith(prefix) && url.length - prefix.length <= KEY_FRAME_LIMITS.maxBase64Chars ? url : null;
  } catch {
    return null;
  }
}

/** The affected arm and a ring at the hand: it fills while settling, and glows as a hold fills. No numbers. */
function drawOverlay(canvas: HTMLCanvasElement | null, video: HTMLVideoElement, pose: PoseInput | null, side: Side, state: WarmRepState, still: boolean, now: number) {
  if (!canvas || !video.videoWidth || !video.videoHeight) return;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  if (!pose) return;
  const X = (x: number) => (1 - x) * w; // the video is shown mirrored
  const Y = (y: number) => y * h;
  const points = pose.landmarks;
  const seen = (i: number) => !!points[i] && (points[i].visibility ?? 1) >= 0.4;
  const line = (a: number, b: number) => {
    if (!seen(a) || !seen(b)) return;
    ctx.beginPath();
    ctx.moveTo(X(points[a].x), Y(points[a].y));
    ctx.lineTo(X(points[b].x), Y(points[b].y));
    ctx.stroke();
  };
  const joints = poseJoints(side);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, w / 320);
  ctx.strokeStyle = "rgba(230, 239, 232, .45)";
  line(11, 12); line(11, 23); line(12, 24); line(23, 24);
  ctx.lineWidth = Math.max(4, w / 150);
  ctx.strokeStyle = "#e18e6d";
  line(joints.shoulder, joints.elbow);
  line(joints.elbow, joints.wrist);
  ctx.fillStyle = "#fffefa";
  [joints.shoulder, joints.elbow, joints.wrist].forEach(i => {
    if (!seen(i)) return;
    ctx.beginPath();
    ctx.arc(X(points[i].x), Y(points[i].y), Math.max(4, w / 170), 0, Math.PI * 2);
    ctx.fill();
  });
  const reaching = state.phase === "reach1" || state.phase === "reach2";
  if (!seen(joints.wrist) || (!reaching && state.phase !== "rest")) return;
  const progress = Math.max(0, Math.min(1, reaching ? state.holdProgress : state.restProgress));
  const x = X(points[joints.wrist].x);
  const y = Y(points[joints.wrist].y);
  const radius = Math.max(22, h * 0.075);
  if (reaching) {
    const reach = radius * (1.9 + (still ? 0 : Math.sin(now / 420) * 0.05));
    const glow = ctx.createRadialGradient(x, y, radius * 0.2, x, y, reach);
    glow.addColorStop(0, `rgba(246, 207, 126, ${0.16 + 0.44 * progress})`);
    glow.addColorStop(1, "rgba(246, 207, 126, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, reach, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineWidth = Math.max(4, radius * 0.16);
  ctx.strokeStyle = "rgba(255, 254, 250, .38)";
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  if (progress > 0) {
    ctx.strokeStyle = reaching ? "#f6cf7e" : "#9bd3ae";
    ctx.beginPath();
    ctx.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
  }
}

const RAYS = Array.from({ length: 7 }, (_, index) => {
  const angle = ((-160 + (140 / 6) * index) * Math.PI) / 180;
  const at = (r: number) => [Math.round((104 + r * Math.cos(angle)) * 10) / 10, Math.round((140 + r * Math.sin(angle)) * 10) / 10];
  return [...at(46), ...at(58)];
});

/** A sun rising over a starting line, with a seedling: the warm-up's artwork. Decorative. */
export function WarmRepArt({ mode }: { mode: "intro" | "done" | "wait" }) {
  const id = `wr${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg className={`wr-art wr-art-${mode}`} viewBox="0 0 240 200" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0" stopColor="#f7edbd" stopOpacity=".95" />
          <stop offset="1" stopColor="#f7edbd" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-sun`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8d991" />
          <stop offset="1" stopColor="#eaa56c" />
        </linearGradient>
        <linearGradient id={`${id}-leaf`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#245b46" />
          <stop offset="1" stopColor="#81b58d" />
        </linearGradient>
        <linearGradient id={`${id}-ground`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e6eee1" />
          <stop offset="1" stopColor="#d3e2cc" />
        </linearGradient>
      </defs>
      <circle className="wr-art-glow" cx="104" cy="132" r="94" fill={`url(#${id}-glow)`} />
      <circle cx="104" cy="136" r="76" fill="none" stroke="#8baf982c" />
      <g className="wr-art-sun">
        <g className="wr-art-rays" stroke="#eab676" strokeWidth="4" strokeLinecap="round">
          {RAYS.map(([x1, y1, x2, y2], index) => <line key={index} x1={x1} y1={y1} x2={x2} y2={y2} />)}
        </g>
        <circle cx="104" cy="140" r="36" fill={`url(#${id}-sun)`} />
      </g>
      <path d="M0 146Q120 126 240 146V200H0Z" fill={`url(#${id}-ground)`} />
      <path className="wr-art-line" d="M22 166Q120 152 218 166" fill="none" stroke="#285b49" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 9" />
      <ellipse cx="170" cy="181" rx="17" ry="3.5" fill="#426c4724" />
      <g className="wr-art-sprout">
        <path d="M170 180C167 167 173 156 170 142" fill="none" stroke="#4a7852" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M170 162C150 164 141 150 143 138C162 139 171 149 170 162Z" fill={`url(#${id}-leaf)`} />
        <path d="M171 148C170 130 182 119 197 119C197 135 188 147 171 148Z" fill={`url(#${id}-leaf)`} />
      </g>
      <g className="wr-art-motes" fill="#93ac78">
        <circle cx="40" cy="96" r="2.5" />
        <circle cx="206" cy="84" r="2" />
        <circle cx="66" cy="44" r="2" />
        <circle cx="152" cy="38" r="1.8" />
      </g>
    </svg>
  );
}

export function WarmRep({ source, side, onDone, onSkip, onStop }: WarmRepProps) {
  const uid = useId();
  // After the survey the warm-up is offered again before the check, so it is not a skip "for today".
  const skipLabel = source === "survey_end" ? "Maybe later" : "Skip for today";
  const [screen, setScreen] = useState<Screen>("intro");
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  const [phase, setPhase] = useState<WarmRepPhase>("position");
  const [caption, setCaption] = useState("");
  const [voiceMissing, setVoiceMissing] = useState(false);
  const [problem, setProblem] = useState<CameraProblem>("general");
  const [allowPretend, setAllowPretend] = useState(() => import.meta.env.DEV === true);
  const [record, setRecord] = useState<WarmRepRecord | null>(null);
  const [warmLine, setWarmLine] = useState(WARM_LINES[0]);
  const [felt, setFelt] = useState<FeltReport | null>(null);
  const [pain, setPain] = useState<PainReport | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackerRef = useRef<Tracker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const voiceRef = useRef<RunnerVoice | null>(null);
  const warmRef = useRef<WarmRepTracker | null>(null);
  const loopRef = useRef(0);
  /** Bumped whenever a run stops, so a camera that opens late is closed again. */
  const runRef = useRef(0);
  const stillsRef = useRef<KeyFrame[]>([]);
  const closing = useRef(false);

  // Testing without a camera: in development, or with ?sim=1.
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("sim") === "1") setAllowPretend(true);
    } catch { /* no address to read */ }
  }, []);

  // Each screen opens with its heading focused, so a screen reader starts in the right place.
  useEffect(() => {
    const heading = headingRef.current;
    if (!heading) return;
    const frame = window.requestAnimationFrame(() => heading.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [screen]);

  /** Camera, model and frame loop off; the voice may finish its sentence. */
  const releaseCamera = useCallback(() => {
    window.clearTimeout(loopRef.current);
    loopRef.current = 0;
    try { trackerRef.current?.close(); } catch { /* already closed */ }
    trackerRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) {
      try { video.pause(); } catch { /* not playing */ }
      video.srcObject = null;
    }
  }, []);

  const stopAll = useCallback(() => {
    runRef.current += 1;
    releaseCamera();
    voiceRef.current?.stop();
    voiceRef.current = null;
    warmRef.current = null;
  }, [releaseCamera]);

  useEffect(() => stopAll, [stopAll]);

  const showDone = useCallback((result: WarmRepRecord) => {
    setRecord(result);
    setWarmLine(WARM_LINES[Math.floor(Math.random() * WARM_LINES.length)] ?? WARM_LINES[0]);
    setFelt(null);
    setPain(null);
    closing.current = false;
    // Kept straight away, so the warm-up counts even if the page is closed on the next screen.
    try { saveWarmRep(result); } catch (error) { console.warn("The warm-up could not be saved yet", error); }
    setScreen("done");
  }, []);

  const fail = useCallback((error: unknown) => {
    console.warn("The warm-up camera could not start", error);
    stopAll();
    setProblem(cameraProblem(error));
    setStarting(false);
    setScreen("error");
  }, [stopAll]);

  const begin = () => {
    stopAll();
    const run = runRef.current;
    const voice = createVoice();
    voice.onAvailability = available => { if (runRef.current === run) setVoiceMissing(!available); };
    voiceRef.current = voice;
    const warm = new WarmRepTracker({ side, source, day: learningToday() });
    warmRef.current = warm;
    stillsRef.current = [];
    setPhase("position");
    setCaption(warm.state().prompt);
    setVoiceMissing(false);
    setStarting(true);
    setScreen("run");
    setAttempt(count => count + 1);
  };

  // Each start opens the camera and the movement model together, then runs the frame loop.
  useEffect(() => {
    if (attempt === 0) return;
    const run = runRef.current;
    const video = videoRef.current;
    const warm = warmRef.current;
    let disposed = false;
    const alive = () => !disposed && runRef.current === run;
    const still = prefersReducedMotion();
    const geos: { t: number; geo: Geo }[] = [];
    let reference: Geo | null = null;
    let lastVideoTime = -1;
    let lastPhase: WarmRepPhase = "position";
    const shown = { text: warm?.state().prompt ?? "", candidate: "", since: 0 };

    const tick = () => {
      if (!alive()) return;
      const tracker = trackerRef.current;
      if (!tracker || !warm || !video) return;
      const t = performance.now();
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        try {
          const detection = tracker.detect(video, t);
          const { frame, geo } = warmRepFrameFrom(detection.pose, side, reference, t);
          if (geo && !reference) {
            geos.push({ t, geo });
            while (geos.length && geos[0].t < t - 4000) geos.shift();
          }
          const state = warm.push(frame);
          if (state.rest && !reference) {
            // Compensation is measured against the posture the rest phase settled on.
            const rest = state.rest;
            reference = medianGeo(geos.filter(item => item.t >= rest.from && item.t <= rest.to).map(item => item.geo)) ?? medianGeo(geos.slice(-15).map(item => item.geo));
            geos.length = 0;
          }
          // A still only with permission at this moment, and never more than two.
          if (state.captureKeyFrame && stillsRef.current.length < 2 && cameraConsentNow()) {
            const dataUrl = captureStill(video);
            if (dataUrl) stillsRef.current.push({ label: `Warm-up reach ${state.reachIndex}, holding`, dataUrl });
          }
          const changed = state.phase !== lastPhase;
          if (changed) {
            lastPhase = state.phase;
            voiceRef.current?.say(lineFor(state));
            setPhase(state.phase);
          }
          // A new caption shows once it has held for a moment, so it never flickers.
          if (state.prompt !== shown.candidate) { shown.candidate = state.prompt; shown.since = t; }
          if (state.prompt !== shown.text && (changed || t - shown.since >= 400)) {
            shown.text = state.prompt;
            setCaption(state.prompt);
          }
          drawOverlay(canvasRef.current, video, detection.pose, side, state, still, t);
          if (state.phase === "done" && state.record) {
            releaseCamera();
            showDone(state.record);
            return;
          }
        } catch (error) {
          console.warn("A warm-up frame could not be read", error);
        }
      }
      loopRef.current = window.setTimeout(tick, 16);
    };

    void (async () => {
      if (!video || !warm) {
        if (alive()) fail(new Error("The camera view did not open."));
        return;
      }
      const [model, camera] = await Promise.allSettled([createTracker("pose"), openCamera(video)]);
      const tracker = model.status === "fulfilled" ? model.value : null;
      const stream = camera.status === "fulfilled" ? camera.value : null;
      if (!alive() || !tracker || !stream) {
        try { tracker?.close(); } catch { /* not open */ }
        stream?.getTracks().forEach(track => track.stop());
        if (alive()) fail(camera.status === "rejected" ? camera.reason : model.status === "rejected" ? model.reason : null);
        return;
      }
      trackerRef.current = tracker;
      streamRef.current = stream;
      setStarting(false);
      voiceRef.current?.say(LINES.position);
      tick();
    })();
    return () => { disposed = true; };
    // One run per start: everything else it reads is a ref or a stable callback.
  }, [attempt]);

  const skip = () => {
    stopAll();
    onSkip();
  };

  const pretend = () => {
    stopAll();
    stillsRef.current = [];
    showDone(simulatedWarmRep({ side, source, day: learningToday() }));
  };

  /** Saves how it felt, the warm-up and any stills, starts Alira's learning, then moves on or stops. */
  const complete = (stop: boolean) => {
    if (!record || closing.current) return;
    closing.current = true;
    try {
      if (felt || pain || stop) saveReport({ source: "warm_rep", ...(felt ? { felt } : {}), ...(pain ? { pain } : {}), ...(stop ? { stopped: true } : {}) });
    } catch (error) { console.warn("How the warm-up felt could not be saved", error); }
    try { saveWarmRep(record); } catch (error) { console.warn("The warm-up could not be saved", error); }
    try {
      if (stillsRef.current.length && cameraConsentNow()) holdKeyFrames(stillsRef.current.slice(0, 2));
    } catch { /* stills are optional */ }
    stillsRef.current = [];
    try {
      // Fire and forget: without permission to learn it does nothing.
      void startLearning("warm_rep").catch(() => undefined);
    } catch (error) { console.warn("Alira's learning could not start", error); }
    stopAll();
    if (!stop) { onDone(record); return; }
    if (onStop) onStop();
    else {
      try { window.location.assign("/"); } catch { /* no page to leave */ }
    }
  };

  const stepIndex = phase === "position" || phase === "rest" ? 0 : phase === "reach1" || phase === "relax1" ? 1 : 2;

  return (
    <div className="wr-root">
      {screen === "intro" && (
        <section className="wr-card wr-intro" aria-labelledby={`${uid}-intro`}>
          <div className="wr-intro-art"><WarmRepArt mode="intro" /></div>
          <div className="wr-intro-copy">
            <h1 id={`${uid}-intro`} className="wr-title" ref={headingRef} tabIndex={-1}>Today's starting line</h1>
            <p className="wr-lede">Two gentle reaches, as far as feels comfortable. There's no score and no wrong answer. It shows me where today begins, so everything after starts in the right place for you.</p>
            <ul className="wr-facts">
              <li><Clock size={18} aria-hidden="true" /><span>About a minute, sitting in a steady chair.</span></li>
            </ul>
            <div className="wr-actions">
              <button type="button" className="wr-primary" onClick={begin}>Let's warm up</button>
              {source !== "survey_end" && <button type="button" className="wr-quiet" onClick={onSkip}>{skipLabel}</button>}
            </div>
          </div>
        </section>
      )}

      {screen === "run" && (
        <section className="wr-run" aria-labelledby={`${uid}-run`}>
          <div className="wr-run-top">
            <h1 id={`${uid}-run`} className="wr-title wr-run-title" ref={headingRef} tabIndex={-1}>Warm-up</h1>
          </div>
          <ol className="wr-steps" aria-label="Warm-up steps">
            {STEPS.map((label, index) => (
              <li key={label} className={index === stepIndex ? "is-now" : index < stepIndex ? "is-past" : ""} aria-current={index === stepIndex ? "step" : undefined}>{label}</li>
            ))}
          </ol>
          <div className="wr-view">
            <figure className="wr-stage" aria-label="Your camera view">
              <video ref={videoRef} playsInline muted aria-hidden="true" />
              <canvas ref={canvasRef} aria-hidden="true" />
              {starting && <div className="wr-starting" aria-hidden="true"><LoaderCircle className="wr-spin" size={30} /><span>Opening the camera…</span></div>}
            </figure>
            <p className="wr-caption" role="status" aria-live="polite">{starting ? "Opening the camera…" : caption}</p>
          </div>
          {voiceMissing && <p className="wr-note">An English voice isn't available in this browser, so the words are shown here instead.</p>}
          {source !== "survey_end" && <div className="wr-run-foot">
            <button type="button" className="wr-quiet" onClick={skip}>{skipLabel}</button>
          </div>}
        </section>
      )}

      {screen === "error" && (
        <section className="wr-card wr-error" aria-labelledby={`${uid}-error`}>
          <h1 id={`${uid}-error`} className="wr-title" ref={headingRef} tabIndex={-1}>The camera didn't open</h1>
          <p className="wr-lede">{PROBLEM_COPY[problem]}</p>
          <p className="wr-note">You can also skip the warm-up for today. Everything after it still works.</p>
          <div className="wr-actions">
            <button type="button" className="wr-primary" onClick={begin}><RotateCcw size={18} aria-hidden="true" /> Try again</button>
            <button type="button" className="wr-secondary" onClick={onSkip}>{skipLabel}</button>
            {allowPretend && <button type="button" className="wr-quiet wr-pretend" onClick={pretend}>Pretend warm-up (testing)</button>}
          </div>
        </section>
      )}

      {screen === "done" && record && (
        <section className="wr-card wr-done" aria-labelledby={`${uid}-done`}>
          <div className="wr-celebrate"><WarmRepArt mode="done" /></div>
          <h1 id={`${uid}-done`} className="wr-title" ref={headingRef} tabIndex={-1}>That's today's starting line.</h1>
          <p className="wr-lede">{warmLine}</p>
          {record.simulated && <p className="wr-note wr-center">A pretend warm-up for testing. Nothing was measured.</p>}
          <div className="wr-feel">
            <fieldset>
              <legend>How did that feel?</legend>
              <div className="wr-chips">
                {FELT.map(option => (
                  <label className="wr-chip" key={option.value}>
                    <input type="radio" name={`${uid}-felt`} value={option.value} checked={felt === option.value} onChange={() => setFelt(option.value)} />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Any pain?</legend>
              <div className="wr-chips">
                {PAIN.map(option => (
                  <label className="wr-chip" key={option.value}>
                    <input type="radio" name={`${uid}-pain`} value={option.value} checked={pain === option.value} onChange={() => setPain(option.value)} />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          {pain === "a_lot" && (
            <div className="wr-safety" role="status">
              <p><b>Thank you for telling me.</b> Please stop for today and rest, and talk to your physiotherapist about the pain before you exercise again. If it feels like an emergency, call 999.</p>
            </div>
          )}
          <div className="wr-actions">
            {pain === "a_lot" ? (
              <>
                <button type="button" className="wr-primary" onClick={() => complete(true)}>Stop for today</button>
                <button type="button" className="wr-secondary" onClick={() => complete(false)}>Continue</button>
              </>
            ) : (
              <button type="button" className="wr-primary" onClick={() => complete(false)}>Continue <ArrowRight size={18} aria-hidden="true" /></button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export default WarmRep;
