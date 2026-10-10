import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Footprints, Hand, LoaderCircle, Mic, Sparkles } from "lucide-react";
import { useLocation, useSearch } from "wouter";
import { assessmentPlanFrom, loadRememberedAssessment, rememberAssessment, type AssessmentReport, type StartRungs, type StoredAssessment } from "@/lib/assessment";
import { affectedSideFrom, loadOnboardingAnswers } from "@/lib/alira-onboarding";
import { startLearning } from "@/lib/alira-learning-client";
import { adaptedStartRungs } from "@/lib/alira-learning-store";
import { administrativeControlsEnabled } from "@/lib/administrative-controls";
import { hasAssessmentScores, loadJourneyAssessments, type JourneyAssessment } from "@/lib/journey";
import { CAMERA_TASKS, startLevel } from "@/lib/assessment-engine/tasks";
import { buildNativeReport } from "@/lib/assessment-engine/report";
import type { AssessmentTaskId, AssessmentTaskResult, CameraTaskId, GaitResult } from "@/lib/assessment-engine/types";
import AssessmentResults from "@/components/assessment/AssessmentResults";
import WalkingTask from "@/components/assessment/WalkingTask";
import ExerciseRunner from "./ExerciseRunner";
import "./native-assessment.css";

/** The survey's start points with Alira's learned settings applied; the survey's alone if those can't be read. */
function learnedStartRungs(planned: { T1?: string; T3?: string }): StartRungs | undefined {
  try {
    return adaptedStartRungs(planned);
  } catch {
    return undefined;
  }
}

const TASK_NAME: Record<AssessmentTaskId, string> = { T1: "Reach", T3: "Hand to mouth", H4: "Hand opening", H3: "Pinch", L6: "Walking" };
const TASK_ICON: Record<AssessmentTaskId, typeof Hand> = { T1: Hand, T3: Hand, H4: Hand, H3: Hand, L6: Footprints };
/** Encouragement between tasks: never a number (the results come together at the end). */
const CHEERS = ["Nicely done.", "Well done.", "That's it, lovely work.", "Great effort.", "Thank you, that was really helpful."];
/** The "task complete" card moves on by itself after this long. */
const BETWEEN_TASKS_MS = 3200;
/** Walking skipped by the patient is kept as its own result, so the results never call a skip "not measured". */
export const SKIPPED_WALKING: GaitResult = { status: "skipped", reason: "Skipped" };

/** A camera task skipped from inside the runner before any attempt was measured: skipped, not done (attempts count). */
export const skippedBeforeAttempt = (result: AssessmentTaskResult) => result.stoppedBy === "skipped" && (!result.measured || !result.attempts?.length);

/** Nothing measured today never replaces an earlier check that had scores, nor its plan; a first check is always kept, so onboarding moves on. */
export function keepsEarlierAssessment(report: AssessmentReport, earlier: StoredAssessment | null): boolean {
  const total = report.metrics?.function_score?.display_total;
  return !(typeof total === "number" && Number.isFinite(total)) && hasAssessmentScores(earlier);
}

/** The leave dialog's keys: Escape keeps going; Tab and Shift+Tab go round its own buttons, never behind the backdrop. */
export function exitDialogKey(event: { key: string; shiftKey: boolean; preventDefault(): void }, buttons: readonly { focus(): void }[], active: unknown, onStay: () => void) {
  if (event.key === "Escape") { event.preventDefault(); onStay(); return; }
  if (event.key !== "Tab" || !buttons.length) return;
  event.preventDefault();
  const at = buttons.findIndex(button => button === active);
  buttons[event.shiftKey ? (at <= 0 ? buttons.length - 1 : at - 1) : (at + 1) % buttons.length].focus();
}

/** Focuses `target`; the function it returns gives focus back to what had it before, if that is still on the page. */
export function holdFocus(target: { focus(): void } | null | undefined, previous: unknown): () => void {
  target?.focus();
  return () => {
    const back = previous as { focus?: () => void; isConnected?: boolean } | null;
    if (back?.isConnected && typeof back.focus === "function") back.focus();
  };
}

type Stage =
  | { kind: "welcome" }
  | { kind: "task"; index: number }
  | { kind: "run"; index: number }
  | { kind: "between"; index: number; done: AssessmentTaskId; skipped?: boolean; note?: string }
  | { kind: "building" }
  | { kind: "nothing" }
  | { kind: "results"; report: AssessmentReport; previous: JourneyAssessment[]; completedAt: string };

// The native movement check (kept at /assessment/native while /assessment uses the original runner) runs every task on the companion's own exercise engine: the same set-up, demonstration, active
// circles, hold ring and live movement bars as the exercises, with levels instead of scored repetitions and the device's
// own voice. Walking is filmed side-on and analysed in the browser. The results come together at the end.
export default function NativeAssessment() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const query = useMemo(() => new URLSearchParams(search), [search]);
  const onboarding = query.get("onboarding") === "1";
  const aliraPath = onboarding ? "/alira?onboarding=1" : "/alira";
  // Admin and development testing only: every task with the simulated patient, saved as test data.
  const sim = query.get("sim") === "1" && administrativeControlsEnabled();
  const answers = useMemo(() => loadOnboardingAnswers(), []);
  const plan = useMemo(() => assessmentPlanFrom(answers), [answers]);
  const side = affectedSideFrom(answers);
  // Alira's learned start points are read once, as the check opens (after any warm-up and learning run).
  const learned = useMemo(() => learnedStartRungs(plan.startRung) as Partial<Record<CameraTaskId, string>> | undefined, [plan]);
  const taskIds = plan.taskIds as AssessmentTaskId[];
  const [caregiverAcknowledged, setCaregiverAcknowledged] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: "welcome" });
  const [confirmExit, setConfirmExit] = useState(false);
  const results = useRef<AssessmentTaskResult[]>([]);
  const walking = useRef<GaitResult | null>(null);
  const skipped = useRef<AssessmentTaskId[]>([]);
  const finished = useRef(false);

  const levelStart = (taskId: CameraTaskId) => {
    const at = learned?.[taskId] ? CAMERA_TASKS[taskId].levels.findIndex(level => level.id === learned[taskId]) : -1;
    return at >= 0 ? at : startLevel(taskId, answers.arm_hand_movement);
  };

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    // The check is over: a leave dialog still open would say it won't be saved.
    setConfirmExit(false);
    // Read before this check is added to the Journey (which happens when the Journey next opens).
    const previous = loadJourneyAssessments();
    const now = new Date();
    const report = buildNativeReport({ results: results.current, walking: walking.current, answers, assignedTaskIds: taskIds, skipped: skipped.current, simulated: sim, now });
    // Nothing measured today: the earlier check's scores and plan stay as they are, and there is nothing new to learn.
    if (keepsEarlierAssessment(report, loadRememberedAssessment())) { setStage({ kind: "nothing" }); return; }
    setStage({ kind: "building" });
    rememberAssessment(report);
    if (!sim) {
      try { void startLearning("assessment"); } catch { /* Learning must never get in the way of the results. */ }
    }
    // A short pause so "putting your map together" reads as a step, not a flicker.
    window.setTimeout(() => setStage({ kind: "results", report, previous, completedAt: now.toISOString() }), 900);
  };

  /** Nothing measured: the check starts again from its welcome, with nothing carried over. */
  const restart = () => {
    results.current = [];
    walking.current = null;
    skipped.current = [];
    finished.current = false;
    setStage({ kind: "welcome" });
  };

  /** The next task after `index` (`skippedTask`: the patient skipped it), skipping pinch when hand opening was tried and never held alone. */
  const advance = (index: number, skippedTask = false) => {
    let next = index + 1;
    let note: string | undefined;
    if (taskIds[next] === "H3") {
      const opening = results.current.find(result => result.taskId === "H4");
      if (opening?.measured && !opening.attempts.some(attempt => attempt.completed && attempt.assist === null)) {
        skipped.current = [...skipped.current, "H3"];
        note = "Pinching comes after hand opening, so we'll leave it for today.";
        next += 1;
      }
    }
    if (next >= taskIds.length) { finish(); return; }
    setStage({ kind: "between", index: next, done: taskIds[index], skipped: skippedTask, note });
  };

  /** The patient skipped a task: walking keeps the skip as its result, so the results tell it from a walk not measured. */
  const skipTask = (index: number) => {
    const id = taskIds[index];
    if (id === "L6") walking.current = SKIPPED_WALKING;
    skipped.current = [...skipped.current, id];
    advance(index, true);
  };

  // The "task complete" card moves on by itself.
  useEffect(() => {
    if (stage.kind !== "between") return;
    const timer = window.setTimeout(() => setStage({ kind: "task", index: stage.index }), BETWEEN_TASKS_MS);
    return () => window.clearTimeout(timer);
  }, [stage]);

  const leave = () => navigate(aliraPath);

  if (!taskIds.length || (plan.caregiverRoute && !caregiverAcknowledged)) return (
    <div className="native-assessment-page"><div className="as-shell"><section className="as-card as-center">
      <h1>Let’s start with supported movement</h1>
      <p>Based on your answers, we’ll leave the arm and hand camera tasks for now. Alira can help you find movements to do with your carer. Those areas will not receive a score.</p>
      <div className="as-actions">
        {taskIds.length > 0 && <button className="as-primary" onClick={() => setCaregiverAcknowledged(true)}>Continue to walking</button>}
        <button className="as-secondary" onClick={leave}>Back to Alira</button>
      </div>
    </section></div></div>
  );

  if (stage.kind === "run") {
    const taskId = taskIds[stage.index];
    const stepLabel = `Task ${stage.index + 1} of ${taskIds.length}`;
    return (
      <div className="native-assessment-page is-running">
        {taskId === "L6"
          ? <WalkingTask key={`walk-${stage.index}`} side={side} walkingHelper={plan.walkingHelper} sim={sim} stepLabel={stepLabel}
            onDone={result => { walking.current = result; advance(stage.index); }}
            onSkip={() => skipTask(stage.index)}
            onExit={() => setConfirmExit(true)} />
          : <ExerciseRunner key={`task-${taskId}`} assessment={{
            ...CAMERA_TASKS[taskId], side, startLevel: levelStart(taskId), stepLabel, sim,
            onDone: result => { results.current = [...results.current.filter(item => item.taskId !== result.taskId), result]; advance(stage.index, skippedBeforeAttempt(result)); },
            // Back only asks: the task keeps running behind the dialog ("Keep going" closes it); leaving unmounts it, which releases the camera.
            onExit: () => setConfirmExit(true),
          }} />}
        {confirmExit && <ExitConfirm onStay={() => setConfirmExit(false)} onLeave={leave} />}
      </div>
    );
  }

  return (
    <div className="native-assessment-page">
      {stage.kind === "results" ? (
        <AssessmentResults report={stage.report} previous={stage.previous} walking={walking.current} taskResults={results.current} completedAt={stage.completedAt}
          onContinue={leave} onHome={() => navigate("/")} />
      ) : (
        <div className="as-shell">
          {stage.kind === "welcome" && <Welcome taskIds={taskIds} sim={sim} onStart={() => setStage({ kind: "task", index: 0 })} onBack={leave} />}
          {stage.kind === "task" && <TaskCard taskId={taskIds[stage.index]} index={stage.index} total={taskIds.length} start={taskIds[stage.index] === "L6" ? -1 : levelStart(taskIds[stage.index] as CameraTaskId)}
            onStart={() => setStage({ kind: "run", index: stage.index })}
            onSkip={() => skipTask(stage.index)}
            onExit={() => setConfirmExit(true)} />}
          {stage.kind === "between" && <Between done={stage.done} skipped={stage.skipped} next={taskIds[stage.index]} index={stage.index} total={taskIds.length} note={stage.note}
            onNext={() => setStage({ kind: "task", index: stage.index })} />}
          {stage.kind === "building" && <section className="as-card as-center" role="status">
            <LoaderCircle className="as-spin" size={34} aria-hidden="true" />
            <h1>Putting your movement map together…</h1>
          </section>}
          {stage.kind === "nothing" && <NothingMeasured onBack={leave} onRetry={restart} />}
        </div>
      )}
      {confirmExit && <ExitConfirm onStay={() => setConfirmExit(false)} onLeave={leave} />}
    </div>
  );
}

function Welcome({ taskIds, sim, onStart, onBack }: { taskIds: AssessmentTaskId[]; sim: boolean; onStart: () => void; onBack: () => void }) {
  const minutes = Math.max(5, Math.round(taskIds.length * 2.2));
  return (
    <section className="as-card as-welcome" aria-labelledby="as-welcome-title">
      <span className="as-eyebrow"><Sparkles size={14} aria-hidden="true" /> Movement check</span>
      <h1 id="as-welcome-title">Let’s see how you move today</h1>
      <p className="as-lead">About {minutes} minutes · {taskIds.length} short {taskIds.length === 1 ? "task" : "tasks"} · nothing to hold or wear. Each task shows you the movement first, then gives you a few levels to try.</p>
      <ol className="as-tasks" aria-label="Tasks in this check">
        {taskIds.map((id, i) => { const Icon = TASK_ICON[id]; return <li key={id}><span>{i + 1}</span><Icon size={16} aria-hidden="true" />{TASK_NAME[id]}</li>; })}
      </ol>
      <ul className="as-notes">
        <li><Mic size={15} aria-hidden="true" /> Your device’s own voice reads each instruction aloud. Turn your sound on.</li>
        <li>Sit in a stable chair with a back, in good light, with the camera in front of you.</li>
        <li>Move only as far as is comfortable, and stop if anything hurts. You can skip any task.</li>
      </ul>
      {sim && <p className="as-test">Test mode: a simulated patient does every task, and the results are saved as test data.</p>}
      <div className="as-actions">
        <button className="as-primary" onClick={onStart}>Start the check <ArrowRight size={18} aria-hidden="true" /></button>
        <button className="as-secondary" onClick={onBack}><ArrowLeft size={17} aria-hidden="true" /> Back to Alira</button>
      </div>
    </section>
  );
}

function TaskCard({ taskId, index, total, start, onStart, onSkip, onExit }: { taskId: AssessmentTaskId; index: number; total: number; start: number; onStart: () => void; onSkip: () => void; onExit: () => void }) {
  const camera = taskId === "L6" ? null : CAMERA_TASKS[taskId];
  const Icon = TASK_ICON[taskId];
  return (
    <section className="as-card as-task" aria-labelledby="as-task-title">
      <div className="as-progress" aria-label={`Task ${index + 1} of ${total}`}>{Array.from({ length: total }, (_, i) => <i key={i} className={i < index ? "is-done" : i === index ? "is-on" : ""} />)}</div>
      <span className="as-eyebrow"><Icon size={14} aria-hidden="true" /> Task {index + 1} of {total}</span>
      <h1 id="as-task-title">{TASK_NAME[taskId]}</h1>
      {camera ? <>
        <p className="as-lead">{camera.ask}</p>
        <p className="as-sub">There are {camera.levels.length} levels. You’ll start at <b>{camera.levels[start]?.label.toLowerCase()}</b> and move up or down depending on how it goes.</p>
        <ol className="as-levels" aria-label="Levels">
          {camera.levels.map((level, i) => <li key={level.id} className={i === start ? "is-start" : ""}><span>{i + 1}</span>{level.label}{i === start && <em>start</em>}</li>)}
        </ol>
        <p className="as-setup">{camera.setup}</p>
      </> : <p className="as-lead">A short walk across the room, filmed side-on, so I can see your step rhythm, speed and balance. I’ll show you how to set up the camera first.</p>}
      <div className="as-actions">
        <button className="as-primary" onClick={onStart}>Start this task <ArrowRight size={18} aria-hidden="true" /></button>
        <button className="as-secondary" onClick={onSkip}>Skip this task</button>
        <button className="as-link" onClick={onExit}>Leave the check</button>
      </div>
    </section>
  );
}

/** Between tasks: a tick and a cheer for a task done; a skipped task is said plainly, with no tick and no cheer. */
export function Between({ done, skipped = false, next, index, total, note, onNext }: { done: AssessmentTaskId; skipped?: boolean; next: AssessmentTaskId; index: number; total: number; note?: string; onNext: () => void }) {
  const lead = [skipped ? "" : CHEERS[index % CHEERS.length], note ?? ""].filter(Boolean).join(" ");
  return (
    <section className="as-card as-center as-between" role="status" aria-live="polite">
      {!skipped && <span className="as-tick" aria-hidden="true"><Check size={40} strokeWidth={2.6} /></span>}
      <h1>{`${TASK_NAME[done]} ${skipped ? "skipped" : "done"}`}</h1>
      {lead && <p className="as-lead">{lead}</p>}
      <p className="as-sub">Next: <b>{TASK_NAME[next]}</b> · task {index + 1} of {total}</p>
      <div className="as-actions"><button className="as-primary" onClick={onNext}>Next task <ArrowRight size={18} aria-hidden="true" /></button></div>
    </section>
  );
}

/** Nothing measured today, after an earlier check with scores: that check and its plan stay, and the patient can try again. */
export function NothingMeasured({ onBack, onRetry }: { onBack: () => void; onRetry: () => void }) {
  return (
    <section className="as-card as-center" aria-labelledby="as-nothing-title">
      <h1 id="as-nothing-title">Nothing measured today</h1>
      <p className="as-lead">That’s all right. Your earlier results and your exercise plan stay as they are.</p>
      <p className="as-sub">You can try the check again now, or another day.</p>
      <div className="as-actions">
        <button className="as-primary" onClick={onBack}><ArrowLeft size={17} aria-hidden="true" /> Back to Alira</button>
        <button className="as-secondary" onClick={onRetry}>Try again</button>
      </div>
    </section>
  );
}

/** Leaving asks first: focus starts on "Keep going", Escape keeps going, Tab stays inside, and focus goes back to the button that opened it. */
export function ExitConfirm({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const stay = useRef<HTMLButtonElement>(null);
  useEffect(() => holdFocus(stay.current, document.activeElement), []);
  // On the document, so Escape and Tab still work after a tap on the backdrop moved focus off the buttons.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => exitDialogKey(event, box.current ? Array.from(box.current.querySelectorAll("button")) : [], document.activeElement, onStay);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onStay]);
  return (
    <div ref={box} className="as-backdrop" role="dialog" aria-modal="true" aria-labelledby="as-exit-title" aria-describedby="as-exit-note">
      <section className="as-card as-center as-dialog">
        <h2 id="as-exit-title">Leave the movement check?</h2>
        <p id="as-exit-note">This check won’t be saved. You can start it again from Alira whenever you like.</p>
        <div className="as-actions">
          <button ref={stay} className="as-primary" onClick={onStay}>Keep going</button>
          <button className="as-secondary" onClick={onLeave}>Leave</button>
        </div>
      </section>
    </div>
  );
}
