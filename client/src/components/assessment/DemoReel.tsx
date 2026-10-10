// The movement check's demonstrations (/assessment): before the camera check runs every task in one go, each task's
// demonstration plays once more here, full screen and as large as the window allows, one after another. Each one
// opens with the device voice reading its narration while the target is drawn inactive (a dashed circle); when the
// voice finishes, the movement plays with the exercises' own target activation (the movement, the hold ring, the
// completion ripple), then the return or let-go, a short pause, and it keeps looping without repeating the narration
// until the patient moves on. Reach, hand to mouth, hand opening and pinch reuse the exercise engine's drawings
// (a 300 x 270 drawing space scaled up to the canvas); walking reuses its side-view filming demonstration. With
// reduced motion each shows a still frame (the hold, or the walk's three stills), keeping the captions and narration.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Play, RotateCcw, SkipForward } from "lucide-react";
import { drawWalkFilmingDemo, walkDemoHeight, walkDemoState, WALK_DEMO_CAPTIONS, WALK_DEMO_MS } from "@/lib/assessment-engine/walk-demo";
import type { AssessmentTaskId, CameraTaskId } from "@/lib/assessment-engine/types";
import { drawHandDemo, handDemoDuration, handDemoState } from "@/lib/exercise-engine/hand-target";
import { drawMouthDemo, mouthDemoDuration, mouthDemoState } from "@/lib/exercise-engine/mouth-demo";
import { checkPinchDemoDuration, checkPinchDemoState, drawCheckPinchDemo } from "@/lib/assessment-engine/pinch-demo";
import { drawReachDemo, reachDemoDuration, reachDemoState } from "@/lib/exercise-engine/reach-demo";
import { TARGET_COMPLETION_MS, TARGET_HOLD_MS } from "@/lib/exercise-engine/target-timing";
import { createVoice, type RunnerVoice } from "@/lib/exercise-engine/voice";
import "./demo-reel.css";

export type DemoReelProps = {
  taskIds: AssessmentTaskId[];
  side: "left" | "right";
  onDone(): void;
  onExit(): void;
  /**
   * One task's demonstration just before that task (the runner waits for it): it moves on by itself once the
   * narration and one whole movement have played (a still, a few seconds, with reduced motion); nothing to click.
   */
  autoAdvance?: boolean;
  /** Where this demonstration sits in the whole check, for its heading ("Task 2 of 5"). */
  progress?: { index: number; count: number };
};

/** With reduced motion, an auto-advancing demonstration's still shows this long after the narration. */
export const AUTO_STILL_MS = 4000;
/** When an auto-advancing demonstration moves on, `armedMs` after its narration: one whole loop (or the still). */
export const autoAdvanceAfterMs = (taskId: AssessmentTaskId, reducedMotion: boolean) => (reducedMotion ? AUTO_STILL_MS : demoLoopMs(taskId));

export type DemoSpec = {
  title: string;
  /** Read by the device voice as the demonstration opens, while its target is still inactive. */
  narration: string;
  /** The short "what to do" line under the caption. */
  whatToDo(side: "left" | "right"): string;
};

export const DEMO_SPECS: Record<AssessmentTaskId, DemoSpec> = {
  T1: {
    title: "Reach",
    narration: "Reach. Watch first. When the circle lights up, reach your hand up into it and hold it there for a moment, then bring your hand back to your lap. In the check there can be up to three circles, each a little higher.",
    whatToDo: side => `With your ${side} arm, reach up into the circle and hold, then bring your hand back to your lap.`,
  },
  T3: {
    title: "Hand to mouth",
    narration: "Hand to mouth. Raise your hand to the starting circle, then bring it up to your mouth and hold it there. Keep your head still: your hand comes to your mouth.",
    whatToDo: side => `Bring your ${side} hand up to your mouth and hold, keeping your head still.`,
  },
  H4: {
    title: "Hand opening",
    narration: "Hand opening. Hold your hand up at chest height with your palm facing the camera. Then open your fingers as wide as is comfortable, and hold.",
    whatToDo: side => `Hold your ${side} hand up at chest height, palm to the camera, then open your fingers wide and hold.`,
  },
  H3: {
    title: "Pinch",
    narration: "Pinch. Bring your thumb and first finger together, tip to tip, and hold. Then let go.",
    whatToDo: side => `With your ${side} hand, bring your thumb and first finger together, tip to tip, hold, then let go.`,
  },
  L6: {
    title: "Walking",
    narration: "Walking. Prop your phone sideways at hip height. Stand side-on, about three big steps away. Then walk across at your usual pace, turn, and walk back.",
    whatToDo: () => "Phone sideways at hip height. Walk across side-on at your usual pace, turn, and walk back.",
  },
};

/** The demonstrations to show: the known task ids, in the given order, each once. */
export function demoTasks(taskIds: readonly string[]): AssessmentTaskId[] {
  const seen = new Set<string>();
  return taskIds.filter((id): id is AssessmentTaskId => {
    if (!Object.prototype.hasOwnProperty.call(DEMO_SPECS, id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export const demoProgressLabel = (index: number, count: number) => `Movement check · Demo ${index + 1} of ${count}`;
/** The primary button: the next demonstration, or (on the last one) the check itself. */
export const primaryLabel = (index: number, count: number) => (index >= count - 1 ? "Start the check" : "Next demo");

// ---------- the engine's drawings, one shape for the four camera tasks ----------

type EngineDemo = {
  duration(returning: boolean): number;
  instruction(elapsedMs: number, returning: boolean, armed: boolean): string;
  draw(ctx: CanvasRenderingContext2D, elapsedMs: number, returning: boolean, width: number, height: number, now: number, reducedMotion: boolean, armed: boolean): void;
};

const ENGINE: Record<CameraTaskId, EngineDemo> = {
  T1: { duration: reachDemoDuration, instruction: (e, r, a) => reachDemoState(e, r, a).instruction, draw: drawReachDemo },
  T3: { duration: mouthDemoDuration, instruction: (e, r, a) => mouthDemoState(e, r, a).instruction, draw: drawMouthDemo },
  H4: { duration: handDemoDuration, instruction: (e, r, a) => handDemoState(e, r, a).instruction, draw: drawHandDemo },
  // Pinch: thumb to first finger and back, with no object, as the check's pinch task asks.
  H3: { duration: checkPinchDemoDuration, instruction: (e, r, a) => checkPinchDemoState(e, r, a).instruction, draw: drawCheckPinchDemo },
};

/** The engine demonstrations' drawing space. */
export const ENGINE_DRAWING = { width: 300, height: 270 } as const;

// ---------- the timeline ----------

/** The short pause after the return (or let-go) before the movement plays again. */
export const DEMO_PAUSE_MS = 900;
/** The inactive target shows at least this long, even when the voice finishes (or fails) at once. */
export const NARRATION_MIN_MS = 1200;
/** Never wait longer than this for a voice that keeps reporting itself busy. */
export const narrationCapMs = (text: string) => 4000 + text.length * 90;
/** The walk's set-up still pulses its phone during the narration: one pulse period (walk-demo's sin(now / 260)), shorter than its 1.8 s standing start. */
const WALK_PULSE_MS = 2 * Math.PI * 260;
const WALK_LISTEN = "Listen to the instruction. The demonstration plays when the voice finishes.";

export type DemoSegment = { kind: "move" | "return" | "pause"; ms: number };
export type DemoPhase = "narration" | DemoSegment["kind"];
export type DemoMoment = { phase: DemoPhase; elapsedMs: number; loop: number };

/** One loop of a demonstration after its narration: the movement, the return (or let-go) and a pause; walking is its own loop. */
export function demoSegments(taskId: AssessmentTaskId): DemoSegment[] {
  if (taskId === "L6") return [{ kind: "move", ms: WALK_DEMO_MS }];
  const demo = ENGINE[taskId];
  return [{ kind: "move", ms: demo.duration(false) }, { kind: "return", ms: demo.duration(true) }, { kind: "pause", ms: DEMO_PAUSE_MS }];
}

export const demoLoopMs = (taskId: AssessmentTaskId) => demoSegments(taskId).reduce((sum, segment) => sum + segment.ms, 0);

/**
 * Where a demonstration is, `armedMs` after its narration finished (null: the narration is still being read): its
 * phase, the time into that phase and which loop it is on.
 */
export function demoMoment(taskId: AssessmentTaskId, armedMs: number | null): DemoMoment {
  if (armedMs === null || !Number.isFinite(armedMs) || armedMs < 0) return { phase: "narration", elapsedMs: 0, loop: 0 };
  const segments = demoSegments(taskId), cycle = demoLoopMs(taskId);
  const loop = Math.floor(armedMs / cycle);
  let t = armedMs - loop * cycle;
  for (const segment of segments) {
    if (t < segment.ms) return { phase: segment.kind, elapsedMs: t, loop };
    t -= segment.ms;
  }
  const last = segments[segments.length - 1];
  return { phase: last.kind, elapsedMs: last.ms, loop };
}

/** The narration has finished: the voice is quiet (after the minimum), or it has run past its cap. */
export function narrationFinished(waitedMs: number, voiceBusy: boolean, text: string): boolean {
  return waitedMs >= NARRATION_MIN_MS && (!voiceBusy || waitedMs >= narrationCapMs(text));
}

/** An engine demonstration's step and time for a moment: the pause keeps the completed return on screen. */
function engineStep(taskId: CameraTaskId, moment: DemoMoment): { returning: boolean; elapsedMs: number } {
  if (moment.phase === "move") return { returning: false, elapsedMs: moment.elapsedMs };
  if (moment.phase === "return") return { returning: true, elapsedMs: moment.elapsedMs };
  return { returning: true, elapsedMs: ENGINE[taskId].duration(true) + moment.elapsedMs };
}

/** The reduced-motion still: the movement held on its target, most of the way round the hold ring. */
const holdStillMs = (taskId: CameraTaskId) => ENGINE[taskId].duration(false) - TARGET_COMPLETION_MS - TARGET_HOLD_MS * 0.3;
const withoutPercent = (text: string) => text.replace(/\s*·\s*\d+%$/, "");

/** The live caption: the demonstration state's own instruction (the walk's caption for walking). */
export function demoCaption(taskId: AssessmentTaskId, armedMs: number | null, reducedMotion: boolean): string {
  if (taskId === "L6") {
    if (armedMs === null) return WALK_LISTEN;
    if (reducedMotion) return `${WALK_DEMO_CAPTIONS[0]} · ${WALK_DEMO_CAPTIONS[1]} ${WALK_DEMO_CAPTIONS[2]}`;
    return WALK_DEMO_CAPTIONS[walkDemoState(demoMoment(taskId, armedMs).elapsedMs).phase];
  }
  const demo = ENGINE[taskId];
  if (armedMs === null) return demo.instruction(0, false, false);
  if (reducedMotion) return withoutPercent(demo.instruction(holdStillMs(taskId), false, true));
  const { returning, elapsedMs } = engineStep(taskId, demoMoment(taskId, armedMs));
  return demo.instruction(elapsedMs, returning, true);
}

/**
 * Draws a demonstration into a `drawWidth` x `drawHeight` space (the caller scales the context to the canvas). While
 * the narration is read the target is inactive; reduced motion draws a still frame.
 */
export function drawDemo(ctx: CanvasRenderingContext2D, taskId: AssessmentTaskId, armedMs: number | null, size: { drawWidth: number; drawHeight: number }, now: number, reducedMotion: boolean) {
  const { drawWidth: width, drawHeight: height } = size;
  if (taskId === "L6") {
    if (reducedMotion) drawWalkFilmingDemo(ctx, 0, width, height, true);
    else drawWalkFilmingDemo(ctx, armedMs === null ? ((now % WALK_PULSE_MS) + WALK_PULSE_MS) % WALK_PULSE_MS : demoMoment(taskId, armedMs).elapsedMs, width, height, false);
    return;
  }
  const demo = ENGINE[taskId];
  if (armedMs === null) { demo.draw(ctx, 0, false, width, height, reducedMotion ? 0 : now, reducedMotion, false); return; }
  if (reducedMotion) { demo.draw(ctx, holdStillMs(taskId), false, width, height, 0, true, true); return; }
  const { returning, elapsedMs } = engineStep(taskId, demoMoment(taskId, armedMs));
  demo.draw(ctx, elapsedMs, returning, width, height, now, false, true);
}

// ---------- fitting the canvas ----------

/** The canvas's size on the page (CSS px), the drawing space it shows and the scale between them. */
export type DemoCanvasFit = { cssWidth: number; cssHeight: number; drawWidth: number; drawHeight: number; scale: number };

const positive = (value: number, fallback: number) => (Number.isFinite(value) && value > 0 ? value : fallback);

/** A fixed drawing (the engine's 300 x 270) scaled to the largest box of its shape inside the area. */
export function fitFixedDrawing(availWidth: number, availHeight: number, drawWidth: number = ENGINE_DRAWING.width, drawHeight: number = ENGINE_DRAWING.height, maxCssWidth = 1280): DemoCanvasFit {
  const w = positive(availWidth, drawWidth), h = positive(availHeight, drawHeight);
  const scale = Math.max(0.25, Math.min(w / drawWidth, h / drawHeight, maxCssWidth / drawWidth));
  const cssWidth = Math.max(1, Math.floor(drawWidth * scale)), cssHeight = Math.max(1, Math.floor(drawHeight * scale));
  return { cssWidth, cssHeight, drawWidth: cssWidth / scale, drawHeight: cssHeight / scale, scale };
}

/**
 * The walking demonstration lays itself out by width (side by side when wide, stacked when narrow), at the height
 * walkDemoHeight asks for. Try its widths and keep the one that shows largest in the area, scaling it up (at most 2x)
 * or down to fit, and counting shrinking against it (small text); at equal size, the wider drawing.
 */
export function fitWalkDrawing(availWidth: number, availHeight: number, reducedMotion: boolean, { minWidth = 260, maxWidth = 960, maxScale = 2 } = {}): DemoCanvasFit {
  const w = positive(availWidth, 340), h = positive(availHeight, walkDemoHeight(340, reducedMotion));
  let best: DemoCanvasFit | null = null, bestScore = -Infinity;
  for (let width = maxWidth; width >= minWidth; width -= 4) {
    const height = walkDemoHeight(width, reducedMotion);
    const scale = Math.min(w / width, h / height, maxScale), shrink = Math.min(1, scale);
    const score = width * height * scale * scale * shrink * shrink;
    if (!best || score > bestScore * 1.005) {
      bestScore = score;
      best = { cssWidth: Math.max(1, Math.floor(width * scale)), cssHeight: Math.max(1, Math.floor(height * scale)), drawWidth: width, drawHeight: height, scale };
    }
  }
  return best ?? fitFixedDrawing(w, h, minWidth, walkDemoHeight(minWidth, reducedMotion));
}

export const fitDemoCanvas = (taskId: AssessmentTaskId, availWidth: number, availHeight: number, reducedMotion: boolean): DemoCanvasFit =>
  taskId === "L6" ? fitWalkDrawing(availWidth, availHeight, reducedMotion) : fitFixedDrawing(availWidth, availHeight);

// ---------- the component ----------

const prefersReducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const px = (value: string) => parseFloat(value) || 0;

export default function DemoReel({ taskIds, side, onDone, onExit, autoAdvance = false, progress }: DemoReelProps) {
  const taskKey = taskIds.join(",");
  const tasks = useMemo(() => demoTasks(taskKey ? taskKey.split(",") : []), [taskKey]);
  const [index, setIndex] = useState(0);
  const [run, setRun] = useState(0);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const [live, setLive] = useState<{ key: string; text: string } | null>(null);
  const titleId = useId();

  const current = Math.min(index, Math.max(0, tasks.length - 1));
  const task: AssessmentTaskId | undefined = tasks[current];
  const demoKey = `${current}:${run}:${task ?? ""}`;

  const stageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const voiceRef = useRef<RunnerVoice | null>(null);
  const fitRef = useRef<(DemoCanvasFit & { dpr: number; version: number }) | null>(null);
  const reducedRef = useRef(reduced);
  const stopRef = useRef<() => void>(() => {});
  const leftRef = useRef(false);
  const onDoneRef = useRef(onDone);
  const onExitRef = useRef(onExit);
  // An auto-advancing demonstration moves on by itself (finishRef: the latest render's "done").
  const autoRef = useRef(autoAdvance);
  autoRef.current = autoAdvance;
  const finishRef = useRef<() => void>(() => {});
  useEffect(() => { onDoneRef.current = onDone; onExitRef.current = onExit; }, [onDone, onExit]);
  useEffect(() => { reducedRef.current = reduced; }, [reduced]);

  // Nothing to demonstrate: go straight on to the check.
  useEffect(() => {
    if (tasks.length || leftRef.current) return;
    leftRef.current = true;
    onDoneRef.current();
  }, [tasks.length]);

  // The voice is released when the reel closes.
  useEffect(() => () => { stopRef.current(); voiceRef.current?.stop(); }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(query.matches);
    query.addEventListener?.("change", change);
    return () => query.removeEventListener?.("change", change);
  }, []);

  // The canvas as large as its stage allows, in the drawing's shape, sharp on high-density screens.
  useEffect(() => {
    if (!task) return;
    const stage = stageRef.current, card = cardRef.current, canvas = canvasRef.current;
    if (!stage || !card || !canvas) return;
    let version = fitRef.current?.version ?? 0;
    const measure = () => {
      const s = getComputedStyle(stage), c = getComputedStyle(card);
      const availWidth = stage.clientWidth - px(s.paddingLeft) - px(s.paddingRight) - px(c.paddingLeft) - px(c.paddingRight);
      const availHeight = stage.clientHeight - px(s.paddingTop) - px(s.paddingBottom) - px(c.paddingTop) - px(c.paddingBottom);
      const fit = fitDemoCanvas(task, availWidth, availHeight, reducedRef.current);
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const pixelWidth = Math.max(1, Math.round(fit.cssWidth * dpr)), pixelHeight = Math.max(1, Math.round(fit.cssHeight * dpr));
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      canvas.style.width = `${fit.cssWidth}px`;
      canvas.style.height = `${fit.cssHeight}px`;
      fitRef.current = { ...fit, dpr, version: ++version };
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(stage);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [task, reduced]);

  // One demonstration: the narration over the inactive target, then the movement, looping until the patient moves on.
  useEffect(() => {
    if (!task) return;
    const voice = (voiceRef.current ??= createVoice());
    const narration = DEMO_SPECS[task].narration;
    const openedAt = performance.now();
    let armedAt: number | null = null, raf = 0, stopped = false, drawnKey = "", caption = "";
    voice.stop();
    voice.say(narration);
    const frame = () => {
      if (stopped) return;
      const now = performance.now();
      if (armedAt === null && narrationFinished(now - openedAt, voice.busy(now), narration)) armedAt = now;
      const armedMs = armedAt === null ? null : now - armedAt;
      const still = reducedRef.current, fit = fitRef.current, ctx = canvasRef.current?.getContext("2d");
      if (ctx && fit) {
        // Reduced motion: draw only when the still changes (narration to hold, a new size).
        const key = `${armedMs === null ? "narration" : "armed"}|${fit.version}|${still}`;
        if (!still || key !== drawnKey) {
          drawnKey = key;
          ctx.setTransform(fit.dpr * fit.scale, 0, 0, fit.dpr * fit.scale, 0, 0);
          drawDemo(ctx, task, armedMs, fit, now, still);
        }
      }
      const text = demoCaption(task, armedMs, still);
      if (text !== caption) { caption = text; setLive({ key: demoKey, text }); }
      if (autoRef.current && armedMs !== null && armedMs >= autoAdvanceAfterMs(task, still)) { finishRef.current(); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    // Auto-advancing: also by the clock, so a page whose frames stall (hidden, throttled) still lets the task start.
    const fallback = autoRef.current ? window.setTimeout(() => { if (!stopped) finishRef.current(); }, narrationCapMs(narration) + demoLoopMs(task) + 2000) : 0;
    const stop = () => { stopped = true; cancelAnimationFrame(raf); window.clearTimeout(fallback); voice.stop(); };
    stopRef.current = stop;
    return stop;
  }, [task, demoKey]);

  // Each demonstration opens with the focus on its primary button.
  useEffect(() => { if (task) nextRef.current?.focus({ preventScroll: true }); }, [current, task]);

  if (!task) return null;
  const spec = DEMO_SPECS[task];
  const last = current >= tasks.length - 1;
  const caption = live?.key === demoKey ? live.text : demoCaption(task, null, reduced);

  const halt = () => { stopRef.current(); voiceRef.current?.stop(); };
  // The check starts once, however often it is asked for.
  const done = () => {
    halt();
    if (leftRef.current) return;
    leftRef.current = true;
    onDoneRef.current();
  };
  // Exit hushes the reel and asks the page; if the page keeps the reel open, "Watch again" or "Next demo" carry on.
  finishRef.current = done;
  const exit = () => { halt(); onExitRef.current(); };
  const next = () => {
    if (last) { done(); return; }
    stopRef.current();
    setIndex(current + 1);
  };
  const watchAgain = () => { stopRef.current(); setRun(count => count + 1); };

  return (
    <section className="demo-reel" aria-labelledby={titleId} data-task={task}>
      <header className="demo-reel-top">
        <button type="button" className="demo-reel-btn demo-reel-quiet demo-reel-exit" onClick={exit}>
          <ArrowLeft size={18} aria-hidden="true" />Exit
        </button>
        <div className="demo-reel-heading">
          <p className="demo-reel-eyebrow">{progress ? `Movement check · Task ${progress.index + 1} of ${progress.count} · Watch first` : demoProgressLabel(current, tasks.length)}</p>
          <h1 id={titleId} className="demo-reel-title">{spec.title}</h1>
        </div>
        <button type="button" className="demo-reel-btn demo-reel-secondary demo-reel-skip" onClick={done}>
          <SkipForward size={17} aria-hidden="true" />{autoAdvance ? "Skip the demo" : "Skip the demos"}
        </button>
      </header>
      <p className="demo-reel-sr" aria-live="polite">{progress ? `Task ${progress.index + 1} of ${progress.count}: ${spec.title}. Watch first.` : `Demo ${current + 1} of ${tasks.length}: ${spec.title}`}</p>

      <div className="demo-reel-stage" ref={stageRef}>
        <div className="demo-reel-card" ref={cardRef}>
          <canvas ref={canvasRef} width={ENGINE_DRAWING.width} height={ENGINE_DRAWING.height} role="img" aria-label={`${spec.title} demonstration: ${caption}`} />
        </div>
      </div>

      <footer className="demo-reel-bottom">
        <p className="demo-reel-caption">{caption}</p>
        <p className="demo-reel-what"><b>What to do:</b> {spec.whatToDo(side)}</p>
        {autoAdvance && <p className="demo-reel-auto">The task starts by itself when the demonstration ends.</p>}
        <div className="demo-reel-controls">
          {!autoAdvance && <ol className="demo-reel-dots" aria-label="Demonstrations">
            {tasks.map((id, i) => (
              <li key={id} data-task={id} className={`demo-reel-dot${i === current ? " is-current" : i < current ? " is-done" : ""}`} aria-current={i === current ? "step" : undefined}>
                <span className="demo-reel-sr">{`${DEMO_SPECS[id].title}${i < current ? " (watched)" : ""}`}</span>
              </li>
            ))}
          </ol>}
          <div className="demo-reel-actions">
            <button type="button" className="demo-reel-btn demo-reel-secondary" onClick={watchAgain}>
              <RotateCcw size={17} aria-hidden="true" />Watch again
            </button>
            <button type="button" ref={nextRef} className="demo-reel-btn demo-reel-primary" onClick={next}>
              {autoAdvance ? <><Play size={17} aria-hidden="true" />Start the task now</> : last ? <><Play size={17} aria-hidden="true" />{primaryLabel(current, tasks.length)}</> : <>{primaryLabel(current, tasks.length)}<ArrowRight size={17} aria-hidden="true" /></>}
            </button>
          </div>
        </div>
      </footer>
    </section>
  );
}
