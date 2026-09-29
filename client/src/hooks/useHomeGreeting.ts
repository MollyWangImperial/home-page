import { useEffect, useState } from "react";
import { loadHomeGreeting, rememberHomeGreeting } from "@/lib/home-greeting";
import { dayKey, type HomeStage } from "@/lib/home-stage";

export function useHomeGreeting(stage: HomeStage) {
  const [greeting, setGreeting] = useState(() => ({ ...loadHomeGreeting(stage), run: 0 }));
  if (greeting.stage !== stage || greeting.day !== dayKey(new Date())) {
    setGreeting({ ...loadHomeGreeting(stage), run: greeting.run + 1 });
  }

  useEffect(() => {
    // Count the visit when shown, even if the patient leaves before typing finishes.
    rememberHomeGreeting(greeting);
  }, [greeting]);

  const replay = () => setGreeting(current => ({ ...current, animate: true, run: current.run + 1 }));
  return { greeting, replay };
}
