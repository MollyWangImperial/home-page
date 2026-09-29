import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, LoaderCircle, RefreshCw } from "lucide-react";
import { useLocation, useSearch } from "wouter";
import {
  appAssessmentUrl,
  buildRunnerUrl,
  getAssessmentBase,
  parseRunnerMessage,
  rememberAssessment,
  type StoredAssessment,
} from "@/lib/assessment";
import { affectedSideFrom, loadOnboardingAnswers } from "@/lib/alira-onboarding";
import "./assessment.css";

const LOAD_TIMEOUT_MS = 25000;

// The movement check runs the Rehyn app's real pose runner (camera, movement model, saving)
// inside this page. Everything patients see in the runner is the runner's own UI; this page
// only frames it, listens for its messages and brings them back to Alira afterwards.
export default function Assessment() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const onboarding = new URLSearchParams(search).get("onboarding") === "1";
  const aliraPath = onboarding ? "/alira?onboarding=1" : "/alira";
  const base = useMemo(() => getAssessmentBase(import.meta.env.VITE_ASSESSMENT_BASE, import.meta.env.DEV), []);
  const runnerUrl = useMemo(
    () => buildRunnerUrl(base, { affectedSide: affectedSideFrom(loadOnboardingAnswers()) }),
    [base]
  );
  const runnerOrigin = useMemo(() => new URL(runnerUrl).origin, [runnerUrl]);
  const [loaded, setLoaded] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [tasksDone, setTasksDone] = useState(0);
  const [result, setResult] = useState<StoredAssessment | null>(null);
  const [revision, setRevision] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setLoaded(false);
    setStalled(false);
    const timer = setTimeout(() => setStalled(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [revision]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== runnerOrigin) return;
      if (frame.current && event.source !== frame.current.contentWindow) return;
      const message = parseRunnerMessage(event.data);
      if (!message) return;
      switch (message.type) {
        case "exit":
          navigate(aliraPath);
          break;
        case "task_complete":
          setTasksDone(count => count + 1);
          break;
        case "assessment_complete":
          setResult(rememberAssessment(message.assessment) ?? { id: "", completedAt: new Date().toISOString() });
          break;
        default:
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [aliraPath, navigate, runnerOrigin]);

  return (
    <div className="assessment-page">
      {!result && (
        <iframe
          key={revision}
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
          <span>Your camera and the movement model load next.</span>
        </div>
      )}

      {!loaded && !result && stalled && (
        <div className="assessment-veil is-solid" role="alert">
          <h1>The movement check is taking a while to open</h1>
          <p>
            The assessment service at <b>{runnerOrigin}</b> hasn't answered yet. Check that it is running, then try again.
          </p>
          <div className="assessment-actions">
            <button className="assessment-primary" onClick={() => setRevision(current => current + 1)}>
              <RefreshCw size={17} aria-hidden="true" /> Try again
            </button>
            <button className="assessment-secondary" onClick={() => navigate(aliraPath)}>
              <ArrowLeft size={17} aria-hidden="true" /> Back to Alira
            </button>
          </div>
          <a className="assessment-link" href={appAssessmentUrl(base)} target="_blank" rel="noopener noreferrer">
            Open the assessment in the Rehyn app instead
          </a>
        </div>
      )}

      {result && (
        <div className="assessment-veil is-solid" role="status">
          <span className="assessment-tick" aria-hidden="true">
            <Check size={44} strokeWidth={2.6} />
          </span>
          <h1>Movement check complete</h1>
          <p>
            {tasksDone > 0 ? `${tasksDone} task${tasksDone === 1 ? "" : "s"} recorded. ` : ""}
            Your results are saved with the assessment service{result.id ? ` (record ${result.id.slice(0, 8)}…)` : ""}. Alira will use them for your first week of gentle movements.
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
