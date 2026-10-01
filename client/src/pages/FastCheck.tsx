import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, LoaderCircle, RefreshCw } from "lucide-react";
import { useLocation, useSearch } from "wouter";
import { getAssessmentBase } from "@/lib/assessment";
import { checkFastRunner, fastCheckReturnPath, fastRunnerUrl } from "@/lib/fast-check";
import "./fast-check.css";
import "./fast-check-runtime.css";

// Host the copied FAST runner in the top document so browser comments can target each element.
export default function FastCheck() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const returnPath = fastCheckReturnPath(search);
  const base = useMemo(() => getAssessmentBase(import.meta.env.VITE_ASSESSMENT_BASE, import.meta.env.DEV), []);
  const runtime = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let unmount: (() => void) | undefined;
    setPhase("loading");
    const timeout = setTimeout(() => {
      controller.abort();
      setPhase("error");
    }, 15000);
    void checkFastRunner(fastRunnerUrl(base), controller.signal).then(async () => {
      const { mountFastCheck } = await import("@/lib/fast-check-runtime.js");
      if (!active || controller.signal.aborted || !runtime.current) return;
      unmount = mountFastCheck(runtime.current, base, () => navigate(returnPath), () => setAttempt(value => value + 1));
      clearTimeout(timeout);
      setPhase("ready");
    }).catch(() => {
      if (!active || controller.signal.aborted) return;
      clearTimeout(timeout);
      setPhase("error");
    });
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timeout);
      unmount?.();
    };
  }, [attempt, base, navigate, returnPath]);

  return (
    <main className="fast-check-page">
      <div ref={runtime} className="fast-check-runtime" aria-label="Emergency FAST check" />
      {phase !== "ready" && <section className="fast-check-status" role={phase === "error" ? "alert" : "status"}>
        {phase === "loading" && <LoaderCircle className="fast-check-spinner" size={28} aria-hidden="true" />}
        <h1>{phase === "error" ? "The FAST check couldn’t open" : "Opening your FAST check…"}</h1>
        <p className="fast-check-urgent">If signs are already visible or symptoms started suddenly, call 999 by phone now. Do not wait for this check.</p>
        {phase === "error" && <p>Try opening the check again.</p>}
        <div className="fast-check-actions">
          {phase === "error" && <button type="button" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={18} aria-hidden="true" /> Try again</button>}
          <button type="button" onClick={() => navigate(returnPath)}><ArrowLeft size={18} aria-hidden="true" /> Go back</button>
        </div>
      </section>}
    </main>
  );
}
