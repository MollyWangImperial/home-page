import { useEffect } from "react";
import { useLocation } from "wouter";
import { REVIEW_HOUR } from "@shared/plan-review";
import { subscribeLearning } from "@/lib/alira-learning-store";
import { JOURNEY_CLOCK_EVENT } from "@/lib/journey";
import { runPlanReview } from "@/lib/plan-review";

/**
 * Runs Alira's daily plan review (lib/plan-review.ts): on every page, when the app comes back into
 * view, as soon as a "How did that feel?" answer is saved, at REVIEW_HOUR while the app is open, and
 * straight away when local testing moves to the next day.
 */
export function usePlanReview() {
  const [location] = useLocation();

  useEffect(() => {
    void runPlanReview();
  }, [location]);

  useEffect(() => {
    let soon: number | undefined;
    const run = () => {
      window.clearTimeout(soon);
      soon = window.setTimeout(() => void runPlanReview(), 250);
    };
    const unsubscribe = subscribeLearning(run);
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    const onClock = () => void runPlanReview();
    window.addEventListener("focus", run);
    window.addEventListener(JOURNEY_CLOCK_EVENT, onClock);
    document.addEventListener("visibilitychange", onVisible);
    let evening: number | undefined;
    const schedule = () => {
      const next = new Date();
      next.setHours(REVIEW_HOUR, 0, 5, 0);
      if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
      evening = window.setTimeout(() => {
        run();
        schedule();
      }, Math.min(next.getTime() - Date.now(), 2147483647));
    };
    schedule();
    return () => {
      unsubscribe();
      window.removeEventListener("focus", run);
      window.removeEventListener(JOURNEY_CLOCK_EVENT, onClock);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearTimeout(soon);
      window.clearTimeout(evening);
    };
  }, []);
}
