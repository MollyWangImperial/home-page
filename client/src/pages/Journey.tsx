import { useEffect, useMemo, useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import RecoveryShell from "@/components/RecoveryShell";
import MedalCollection from "@/components/MedalCollection";
import JournalDayPages from "@/components/JournalDayPages";
import JourneyProgress from "@/components/JourneyProgress";
import { useLocation, useSearch } from "wouter";
import { loadRememberedAssessment } from "@/lib/assessment";
import { journeyLockReason, journeyUnlocked } from "@/lib/journey";
import { journeyDemoEnabled, seedSampleAssessment } from "@/lib/journey-demo";
import { journeyVisitStore, type JourneyView } from "@/lib/journey-visits";
import { todayLabel } from "./Welcome";
import "./journey-refinements.css";
import "./journal-refinements.css";
import "./medal-refinements.css";

type Tab = "Progress" | "Journal" | "Medals";
const tabFromSearch: Record<string, Tab> = { progress: "Progress", journal: "Journal", medals: "Medals" };

// The Journey stays locked until the first movement check has scores and Alira has designed the
// exercise plan from them (lib/journey.ts). Until then the page explains the next step instead.
export default function Journey() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [tab, setTab] = useState<Tab>(() => tabFromSearch[new URLSearchParams(search).get("tab") ?? ""] ?? "Progress");
  const [journalDate, setJournalDate] = useState<string | null>(null);
  const [assessment, setAssessment] = useState(loadRememberedAssessment);
  const reason = journeyLockReason(assessment);
  const view: JourneyView = journeyUnlocked(assessment) ? tab : "locked";
  // Keep the first entrance active through that visit's renders. A later tab/route visit
  // reads the remembered flag and renders its sections fully visible from the start.
  const animateEntrance = useMemo(() => !journeyVisitStore.hasVisited(view), [view]);
  useEffect(() => { journeyVisitStore.remember(view); }, [view]);

  if (!journeyUnlocked(assessment)) {
    const waitingForPlan = reason === "plan";
    return (
      <RecoveryShell active="Journey" dateLabel={todayLabel()} onboarding={!assessment}>
        <div className="recovery-page journey-page" data-entrance={animateEntrance ? "first" : "seen"}>
          <section className="recovery-page-heading journey-heading"><div><h1>My journey<span>.</span></h1></div></section>
          <section className="journey-locked" aria-labelledby="journey-locked-title">
            <span className="journey-locked-icon" aria-hidden="true"><LockKeyhole size={22} /></span>
            <span className="recovery-overline">{waitingForPlan ? "ALMOST THERE" : "AVAILABLE AFTER YOUR FIRST ASSESSMENT"}</span>
            <h2 id="journey-locked-title">{waitingForPlan ? "Alira is preparing your exercise plan." : "Your journey starts with a short movement check."}</h2>
            <p>{waitingForPlan
              ? "Your movement scores are in. Once Alira has designed your exercise plan from them, your starting point, your daily session and everything you build from day one will appear here."
              : "Once you’ve finished your first movement check and received your scores, Alira will design your exercise plan and your journey will open here: your starting point, your daily session and everything you build from day one."}</p>
            <button className="recovery-primary-button" onClick={() => setLocation(waitingForPlan ? "/alira" : "/alira?onboarding=1")}>{waitingForPlan ? "Continue with Alira" : "Start with Alira"} <ArrowRight size={16} aria-hidden="true" /></button>
            {journeyDemoEnabled() && <button type="button" className="journey-locked-demo" onClick={() => setAssessment(seedSampleAssessment())}>Local testing · load a sample first assessment</button>}
          </section>
        </div>
      </RecoveryShell>
    );
  }

  return (
    <RecoveryShell active="Journey" dateLabel={tab === "Journal" && journalDate ? journalDate : todayLabel()}>
      <div className="recovery-page journey-page" data-entrance={animateEntrance ? "first" : "seen"}>
        <section className="recovery-page-heading journey-heading">
          <div>
            <h1>Your journey<span>.</span></h1>
          </div>
          <div className="journey-tabs" role="tablist" aria-label="Journey sections">
            {(["Progress", "Journal", "Medals"] as Tab[]).map((name) => <button key={name} className={tab === name ? "is-active" : ""} onClick={() => setTab(name)} role="tab" aria-selected={tab === name}>{name}</button>)}
          </div>
        </section>

        {tab === "Progress" && <JourneyProgress animateEntrance={animateEntrance} reveal={new URLSearchParams(search).get("section") === "exercises"} revealShare={new URLSearchParams(search).get("section") === "sharing"} onShowMedals={() => setTab("Medals")} />}
        {tab === "Journal" && <JournalDayPages animateEntrance={animateEntrance} onDateLabel={setJournalDate} />}
        {tab === "Medals" && <MedalCollection />}
      </div>
    </RecoveryShell>
  );
}
