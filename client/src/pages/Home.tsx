import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import HomeOverview, { type HomeActivity } from "@/components/HomeOverview";
import RecoveryShell from "@/components/RecoveryShell";
import { fillCopy } from "@/lib/home-stage";
import { loadHomeActionSnapshot, nextHomeAction } from "@/lib/home-next-action";
import { activityDuration, aliraLine, nextStep, progressAreas, weekDays } from "@/lib/home-overview";
import { surpriseStore, type Surprise } from "@/lib/home-surprise";
import { useHomeGreeting } from "@/hooks/useHomeGreeting";
import { setDisplayPrefs, useDisplayPrefs } from "@/lib/display-prefs";
import { fastCheckPath } from "@/lib/fast-check";
import { journeyUnlocked } from "@/lib/journey";
import { profileName, useProfile } from "@/lib/profile";
import { rememberYesFromHome, todayLabel } from "./Welcome";

// The home page: the next step chosen from saved progress, the latest movement check at a glance,
// this week's practice, Alira, and one optional activity. Randomness only varies optional extras.
export default function Home() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const [snapshot, setSnapshot] = useState(loadHomeActionSnapshot);
  const [roll] = useState(Math.random);
  const { stage, days } = nextHomeAction(snapshot, roll);
  const { greeting, replay } = useHomeGreeting(stage);
  const action = nextHomeAction(snapshot, roll, greeting.opener);
  const { largeText } = useDisplayPrefs();
  const name = profileName(useProfile());
  const unlocked = journeyUnlocked(snapshot.assessment);
  const access = { journey: unlocked, myTime: stage !== "assessment", largeText };
  const [extra, setExtra] = useState<Surprise | null>(() => surpriseStore.today(access, new Date(), roll).surprise);

  useEffect(() => {
    const refresh = () => setSnapshot(loadHomeActionSnapshot());
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(refresh, 60000);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  const start = () => {
    // Re-check on click as well: a different tab or midnight can change what is due.
    const latest = nextHomeAction(loadHomeActionSnapshot(), roll, greeting.opener);
    if (latest.kind === "onboarding") rememberYesFromHome();
    navigate(latest.href);
  };
  const openExtra = (chosen: Surprise) => {
    if (chosen.action === "large-text") {
      setDisplayPrefs({ largeText: true });
      setExtra(surpriseStore.another({ ...access, largeText: true }, new Date(), Math.random(), [chosen.id]));
      return;
    }
    if (chosen.action === "fast-check") { navigate(fastCheckPath(location, search)); return; }
    if (chosen.href) navigate(chosen.href);
  };
  const next = nextStep(action, snapshot);
  // An activity that only makes sense once (larger text) gives way as soon as it is no longer needed.
  const shownExtra = extra && !(extra.action === "large-text" && largeText) ? extra : null;
  const activity: HomeActivity | null = shownExtra
    ? { id: shownExtra.id, title: shownExtra.cta, body: shownExtra.title, duration: activityDuration(shownExtra.id), onOpen: () => openExtra(shownExtra) }
    : null;

  return (
    <RecoveryShell active="Home" dateLabel={todayLabel(snapshot.now)} className="welcome-shell home-shell" onboarding={stage === "assessment"}>
      <HomeOverview
        headline={fillCopy(greeting.headline, days, name)}
        next={{ ...next, note: fillCopy(next.note, days, name) }}
        onStart={start}
        areas={progressAreas(snapshot.assessment)}
        onDetails={unlocked ? () => navigate("/journey?tab=progress") : undefined}
        alira={{ line: aliraLine(stage), animate: greeting.animate, run: greeting.run, onReplay: replay,
          onTalk: () => navigate(stage === "assessment" ? "/alira?onboarding=1" : "/alira") }}
        week={weekDays(snapshot.now, snapshot.sessions)}
        activity={activity}
      />
    </RecoveryShell>
  );
}
