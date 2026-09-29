import { useLocation } from "wouter";
import QuietFocus from "@/components/QuietFocus";
import RecoveryShell from "@/components/RecoveryShell";
import { loadRememberedAssessment } from "@/lib/assessment";
import { fillCopy, homeStage, homeStages, loadLastExerciseDay } from "@/lib/home-stage";
import { useHomeGreeting } from "@/hooks/useHomeGreeting";
import { rememberYesFromHome, todayLabel } from "./Welcome";

// Home for a patient who is past their first sign-in. What Alira says, and where the button
// goes, follow the next step: daily exercises counting down to the re-assessment, a rest note
// once today's session is done, and the re-assessment itself when its date arrives. A patient
// with no assessment on this device is greeted as on the first visit.
export default function Home() {
  const [, navigate] = useLocation();
  const { stage, days } = homeStage(loadRememberedAssessment(), loadLastExerciseDay());
  const copy = homeStages[stage];
  const { greeting, replay } = useHomeGreeting(stage);
  const opener = copy.openers[greeting.opener % copy.openers.length];

  return (
    <RecoveryShell active="Home" dateLabel={todayLabel()} className="welcome-shell" onboarding={stage === "assessment"}>
      <QuietFocus
        key={greeting.run}
        animateGreeting={greeting.animate}
        headline={fillCopy(greeting.headline, days)}
        message={fillCopy(opener.text, days)}
        cta={opener.cta}
        note={fillCopy(copy.note, days)}
        onReplay={replay}
        onStart={() => {
          if (stage === "assessment") rememberYesFromHome();
          navigate(opener.href);
        }}
      />
    </RecoveryShell>
  );
}
