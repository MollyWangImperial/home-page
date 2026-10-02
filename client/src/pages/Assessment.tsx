import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, LoaderCircle, RefreshCw } from "lucide-react";
import { useLocation, useSearch } from "wouter";
import {
  buildRunnerUrl,
  assessmentPlanFrom,
  getAssessmentBase,
  parseRunnerMessage,
  rememberAssessment,
  type StartRungs,
  type StoredAssessment,
} from "@/lib/assessment";
import { affectedSideFrom, loadOnboardingAnswers } from "@/lib/alira-onboarding";
import { startLearning } from "@/lib/alira-learning-client";
import { adaptedStartRungs } from "@/lib/alira-learning-store";
import { renderReviewControlsEnabled } from "@/lib/administrative-controls";
import "./assessment.css";

const LOAD_TIMEOUT_MS = 25000;

/** The survey's start points with Alira's learned settings applied; the survey's alone if those can't be read. */
function learnedStartRungs(planned: { T1?: string; T3?: string }): StartRungs | undefined {
  try {
    return adaptedStartRungs(planned);
  } catch {
    return undefined;
  }
}

// The movement check runs the Rehyn app's real pose runner (camera, movement model, saving)
// inside this page. Everything patients see in the runner is the runner's own UI; this page
// only frames it, listens for its messages and brings them back to Alira afterwards.
export default function Assessment() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const onboarding = new URLSearchParams(search).get("onboarding") === "1";
  const aliraPath = onboarding ? "/alira?onboarding=1" : "/alira";
  const base = useMemo(() => getAssessmentBase(import.meta.env.VITE_ASSESSMENT_BASE, import.meta.env.DEV), []);
  const answers = useMemo(() => loadOnboardingAnswers(), []);
  const plan = useMemo(() => assessmentPlanFrom(answers), [answers]);
  const [caregiverAcknowledged, setCaregiverAcknowledged] = useState(false);
  // Alira's learned start points are read once, as the check opens (after any warm-up and learning run).
  const runnerUrl = useMemo(
    () => buildRunnerUrl(base, { affectedSide: affectedSideFrom(answers), answers, startRungs: learnedStartRungs(plan.startRung), guestReview: renderReviewControlsEnabled() }),
    [base, answers, plan]
  );
  const runnerOrigin = useMemo(() => new URL(runnerUrl).origin, [runnerUrl]);
  const [loaded, setLoaded] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [tasksDone, setTasksDone] = useState(0);
  const [result, setResult] = useState<StoredAssessment | null>(null);
  const [previewComplete, setPreviewComplete] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const learningStarted = useRef(false);

  useEffect(() => {
    if (loaded || result) return;
    const timer = setTimeout(() => setStalled(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loaded, result]);

  useEffect(() => {
    // Alira reviews the new results in the background, once per check. Without consent it does nothing.
    function learnFromResults() {
      if (learningStarted.current) return;
      learningStarted.current = true;
      try {
        void startLearning("assessment");
      } catch {
        /* Learning must never get in the way of the results. */
      }
    }
    function onMessage(event: MessageEvent) {
      if (event.origin !== runnerOrigin) return;
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const message = parseRunnerMessage(event.data);
      if (!message) return;
      switch (message.type) {
        case "ready":
          setLoaded(true);
          setStalled(false);
          break;
        case "exit":
          navigate(aliraPath);
          break;
        case "task_complete":
          setTasksDone(count => count + 1);
          break;
        case "assessment_complete":
          // Current runners present the analysis and results inside the frame.
          // Keep the fallback for older deployed runners that only post completion.
          if (message.results_in_runner === true) rememberAssessment(message.assessment);
          else setResult(rememberAssessment(message.assessment) ?? { id: "", completedAt: new Date().toISOString() });
          learnFromResults();
          break;
        case "assessment_preview_complete":
          // Keep results visible in the runner; its Done action returns to Alira.
          const previewResult = rememberAssessment(message.assessment);
          learnFromResults();
          if (message.results_in_runner === true) break;
          setPreviewComplete(true);
          setResult(previewResult ?? { id: "", completedAt: new Date().toISOString() });
          break;
        default:
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [aliraPath, navigate, runnerOrigin]);

  if (!plan.taskIds.length || (plan.caregiverRoute && !caregiverAcknowledged)) return (
    <div className="assessment-page"><div className="assessment-veil is-solid">
      <h1>Let’s start with supported movement</h1>
      <p>Based on your answers, we’ll leave the arm and hand camera tasks for now. Alira can help you find movements to do with your carer. Those areas will not receive a score.</p>
      <div className="assessment-actions">
        {plan.taskIds.length > 0 && <button className="assessment-primary" onClick={() => setCaregiverAcknowledged(true)}>Continue to walking</button>}
        <button className="assessment-secondary" onClick={() => navigate(aliraPath)}>Back to Alira</button>
      </div>
    </div></div>
  );

  return (
    <div className="assessment-page">
      {!result && (
        <iframe
          ref={frame}
          className="assessment-runner"
          title="Rehyn movement check"
          src={runnerUrl}
          allow="camera; microphone; autoplay; fullscreen"
          allowFullScreen
          onLoad={() => {
            setLoaded(true);
            setStalled(false);
          }}
        />
      )}

      {!loaded && !result && !stalled && (
        <div className="assessment-veil" role="status">
          <LoaderCircle className="assessment-spinner" size={28} aria-hidden="true" />
          <p>Opening your movement check…</p>
        </div>
      )}

      {!loaded && !result && stalled && (
        <div className="assessment-veil is-solid" role="alert">
          <h1>The movement check is taking a while to open</h1>
          <p>
            The assessment hasn't finished opening in this page. Try reloading, or open it directly below.
          </p>
          <div className="assessment-actions">
            <button className="assessment-primary" onClick={() => window.location.reload()}>
              <RefreshCw size={17} aria-hidden="true" /> Try again
            </button>
            <button className="assessment-secondary" onClick={() => navigate(aliraPath)}>
              <ArrowLeft size={17} aria-hidden="true" /> Back to Alira
            </button>
          </div>
          <a className="assessment-link" href={runnerUrl} target="_blank" rel="noopener noreferrer">
            Open the assessment directly
          </a>
        </div>
      )}

      {result && (
        <div className="assessment-veil is-solid" role="status">
          <span className="assessment-tick" aria-hidden="true">
            <Check size={44} strokeWidth={2.6} />
          </span>
          <h1>{previewComplete ? "Assessment preview complete" : "Movement check complete"}</h1>
          <p>
            {previewComplete ? "You completed the local preview. No recordings or account results were saved." : <>
            {tasksDone > 0 ? `${tasksDone} task${tasksDone === 1 ? "" : "s"} recorded. ` : ""}
            Your results are saved with the assessment service{result.id ? ` (record ${result.id.slice(0, 8)}…)` : ""}. Alira will use them for your first week of gentle movements.
            </>}
          </p>
          <div className="assessment-actions">
            <button className="assessment-primary" onClick={() => navigate(aliraPath)}>
              Back to Alira <ArrowRight size={17} aria-hidden="true" />
            </button>
            <button className="assessment-secondary" onClick={() => navigate("/")}>
              Go to my home
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
