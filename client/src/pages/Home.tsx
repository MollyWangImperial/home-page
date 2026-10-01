import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import HomeSurprise from "@/components/HomeSurprise";
import QuietFocus from "@/components/QuietFocus";
import RecoveryShell from "@/components/RecoveryShell";
import { fillCopy } from "@/lib/home-stage";
import { loadHomeActionSnapshot, nextHomeAction } from "@/lib/home-next-action";
import { useHomeGreeting } from "@/hooks/useHomeGreeting";
import { useDisplayPrefs } from "@/lib/display-prefs";
import { journeyUnlocked } from "@/lib/journey";
import { rememberYesFromHome, todayLabel } from "./Welcome";

// One invitation, chosen from saved progress. Randomness only varies optional follow-ups.
export default function Home() {
  const [, navigate] = useLocation();
  const [snapshot, setSnapshot] = useState(loadHomeActionSnapshot);
  const [roll] = useState(Math.random);
  const { stage, days } = nextHomeAction(snapshot, roll);
  const { greeting, replay } = useHomeGreeting(stage);
  const action = nextHomeAction(snapshot, roll, greeting.opener);
  const { largeText } = useDisplayPrefs();

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

  return (
    <RecoveryShell active="Home" dateLabel={todayLabel()} className="welcome-shell" onboarding={stage === "assessment"}>
      <QuietFocus
        key={greeting.run}
        animateGreeting={greeting.animate}
        headline={fillCopy(greeting.headline, days)}
        message={fillCopy(action.text, days)}
        cta={action.cta}
        note={fillCopy(action.note, days)}
        onReplay={replay}
        onStart={() => {
          // Re-check on click as well: a different tab or midnight can change what is due.
          const latest = nextHomeAction(loadHomeActionSnapshot(), roll, greeting.opener);
          if (latest.kind === "onboarding") rememberYesFromHome();
          navigate(latest.href);
        }}
      />
      {/* Today's surprise sits under the invitation and only points at pages open to this person. */}
      <HomeSurprise
        access={{ journey: journeyUnlocked(snapshot.assessment), myTime: stage !== "assessment", largeText }}
        delayMs={greeting.animate ? 4600 : 400}
      />
    </RecoveryShell>
  );
}
