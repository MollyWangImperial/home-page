import { useLocation } from "wouter";
import QuietFocus from "@/components/QuietFocus";
import RecoveryShell from "@/components/RecoveryShell";
import { FROM_HOME_KEY } from "@/lib/alira-onboarding";
import { fillCopy, homeStages, REASSESSMENT_CYCLE_DAYS } from "@/lib/home-stage";
import { useHomeGreeting } from "@/hooks/useHomeGreeting";

export function todayLabel(now = new Date()): string {
  return `${now.toLocaleDateString("en-GB", { weekday: "long" })}, ${now.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`.toUpperCase();
}

// Leaving a note behind lets Alira pick up from this "yes" and go straight into the questions.
export function rememberYesFromHome() {
  try {
    sessionStorage.setItem(FROM_HOME_KEY, "1");
  } catch {
    /* Session storage can be blocked; the query string carries the same hint. */
  }
}

// First visit: Alira says hello and invites the patient to the first assessment.
export default function Welcome() {
  const [, navigate] = useLocation();
  const { greeting, replay } = useHomeGreeting("assessment");
  const stage = homeStages.assessment;
  const opener = stage.openers[greeting.opener];

  return (
    <RecoveryShell active="Home" dateLabel={todayLabel()} className="welcome-shell" onboarding>
      <QuietFocus
        key={greeting.run}
        animateGreeting={greeting.animate}
        headline={fillCopy(greeting.headline, REASSESSMENT_CYCLE_DAYS)}
        message={fillCopy(opener.text, REASSESSMENT_CYCLE_DAYS)}
        cta={opener.cta}
        note={stage.note}
        onReplay={replay}
        onStart={() => {
          rememberYesFromHome();
          navigate(opener.href);
        }}
      />
    </RecoveryShell>
  );
}
