// Offers today's warm-up before the movement check and before an exercise, then lets the page open.
// The decision is made once on mount, and the page (children) mounts only after the gate passes, so
// the check or exercise reads the newest settings Alira may have just learned.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { affectedSideFrom, loadOnboardingAnswers } from "@/lib/alira-onboarding";
import { recordWarmRepSkip, warmRepNeeded } from "@/lib/alira-learning-store";
import { LEARNING_LIMITS, learningRunning, subscribeLearningRun, waitForLearning } from "@/lib/alira-learning-client";
import { WarmRep, WarmRepArt } from "./WarmRep";
import "./warm-rep.css";

type GatePlace = "pre_assessment" | "pre_exercise";
type Stage = "warm" | "wait" | "open";

// "Start now" lets the page open with the current settings; later gates do not wait for that run again.
let waivedRun = false;

/** Whether a page should wait for Alira's learning run in progress. */
export function learningWaitNeeded(): boolean {
  return learningRunning() && !waivedRun;
}

/** The patient chose not to wait for the run in progress; forgotten once that run ends. */
export function waiveLearningWait() {
  if (!learningRunning() || waivedRun) return;
  waivedRun = true;
  const unsubscribe = subscribeLearningRun(() => {
    if (learningRunning()) return;
    waivedRun = false;
    unsubscribe();
  });
}

export function affectedSideNow(): "left" | "right" {
  try {
    return affectedSideFrom(loadOnboardingAnswers());
  } catch {
    return "right";
  }
}

function warmUpOffered(gate: GatePlace): boolean {
  try {
    return warmRepNeeded(gate);
  } catch {
    return false;
  }
}

/** "Alira is getting things ready for you": waits for the learning run (up to the gate limit), or Start now. */
export function LearningWait({ onReady }: { onReady: () => void }) {
  const uid = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const ready = useRef(onReady);
  ready.current = onReady;
  const settled = useRef(false);
  /** Opens the page once, whichever comes first: the run ends, the wait runs out, or Start now. */
  const finish = useRef(() => {
    if (settled.current) return;
    settled.current = true;
    ready.current();
  }).current;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => heading.current?.focus());
    let active = true;
    const done = () => { if (active) finish(); };
    const unsubscribe = subscribeLearningRun(() => { if (!learningRunning()) done(); });
    // Waited long enough for this run: later pages do not wait for it again.
    void waitForLearning(LEARNING_LIMITS.gateWaitMs).then(finished => { if (!finished && active) waiveLearningWait(); done(); }, done);
    if (!learningRunning()) done();
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, []);

  return (
    <main className="wr-page">
      <div className="wr-root">
        <section className="wr-card wr-wait" aria-labelledby={`${uid}-wait`}>
          <WarmRepArt mode="wait" />
          <h1 id={`${uid}-wait`} className="wr-title" ref={heading} tabIndex={-1}>Alira is getting things ready for you…</h1>
          <p className="wr-lede">She's looking at today's warm-up, so what comes next starts in the right place for you. This usually takes a few moments.</p>
          <div className="wr-actions">
            <button type="button" className="wr-primary" onClick={() => { waiveLearningWait(); finish(); }}>Start now</button>
          </div>
        </section>
      </div>
    </main>
  );
}

export function WarmRepGate({ gate, children }: { gate: GatePlace; children: ReactNode }) {
  const [, navigate] = useLocation();
  const [stage, setStage] = useState<Stage>(() => (warmUpOffered(gate) ? "warm" : learningWaitNeeded() ? "wait" : "open"));
  const [side] = useState(affectedSideNow);
  const proceed = () => setStage(learningWaitNeeded() ? "wait" : "open");

  if (stage === "open") return <>{children}</>;
  if (stage === "wait") return <LearningWait onReady={() => setStage("open")} />;
  return (
    <main className="wr-page">
      <WarmRep
        source={gate}
        side={side}
        onDone={proceed}
        onSkip={() => {
          try { recordWarmRepSkip(gate); } catch (error) { console.warn("The skipped warm-up could not be noted", error); }
          proceed();
        }}
        onStop={() => navigate("/")}
      />
    </main>
  );
}

export default WarmRepGate;
