// /warm-up: today's warm-up on its own page, first offered at the end of Alira's questions.
// ?gate= says who offered it (survey_end unless pre_assessment or pre_exercise) and ?next= where to
// go afterwards (same-site paths only, otherwise back to Alira). Assessment links return to Alira
// first so the patient can choose to begin the movement check from the chat.

import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import { recordWarmRepSkip } from "@/lib/alira-learning-store";
import { warmUpRoute } from "@/lib/warm-rep";
import { WarmRep } from "@/components/WarmRep";
import { affectedSideNow, LearningWait, learningWaitNeeded } from "@/components/WarmRepGate";
import "@/components/warm-rep.css";

export default function WarmUp() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const { gate, next, back } = useMemo(() => warmUpRoute(search), [search]);
  const [side] = useState(affectedSideNow);
  const [waiting, setWaiting] = useState(false);
  const goNext = () => navigate(next);

  if (waiting) return <LearningWait onReady={goNext} />;
  return (
    <main className="wr-page">
      <nav className="wr-top" aria-label="Warm-up">
        <Link className="wr-back" href={back}><ArrowLeft size={18} aria-hidden="true" /> Back to Alira</Link>
      </nav>
      <WarmRep
        source={gate}
        side={side}
        onDone={() => { if (learningWaitNeeded()) setWaiting(true); else goNext(); }}
        onSkip={() => {
          try { recordWarmRepSkip(gate); } catch (error) { console.warn("The skipped warm-up could not be noted", error); }
          goNext();
        }}
        onStop={() => navigate(back)}
      />
    </main>
  );
}
