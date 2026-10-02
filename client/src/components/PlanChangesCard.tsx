import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ChangeReason, Level, PlanChange } from "@shared/plan-review";
import { emailStatus, loadPlanReview, planReviewVersion, subscribePlanReview } from "@/lib/plan-review-store";
import { profileName, useProfile } from "@/lib/profile";
import "./plan-changes-card.css";

// Settings > Alira's Learning: every change Alira's daily plan review made to the plan, why, and
// whether the admin email went out. Read-only; the rules live in shared/plan-review.ts.

const LEVEL_NAMES: Record<Level, string> = { 1: "easy", 2: "medium", 3: "difficult" };
const REASON_WORDS: Record<ChangeReason, string> = {
  pain_a_lot: "reported a lot of pain",
  stopped_unwell: "stopped because of feeling unwell",
  pain_a_little: "reported a little pain",
  felt_much_harder: "said it felt much harder",
  stopped_early: "stopped before the last rep",
  low_score: "a low score",
  eased_during_session: "the target had to move closer",
  good_sessions: "two good sessions in a row",
};

function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function describe(change: PlanChange): string {
  const levels = change.fromLevel !== null && change.toLevel !== null && change.fromLevel !== change.toLevel
    ? ` (${LEVEL_NAMES[change.fromLevel]} to ${LEVEL_NAMES[change.toLevel]})` : "";
  const why = capital(change.reasons.map(reason => REASON_WORDS[reason]).join(", "));
  const on = ` on ${dayLabel(change.reviewedDay)}`;
  const through = dayLabel(change.restingThrough ?? change.effectiveDay);
  switch (change.kind) {
    case "easier":
      return `one level easier${levels}. ${why}${on}.`;
    case "harder":
      return `one level harder${levels}. ${why}.`;
    case "rest":
      return `resting through ${through}${levels ? `, then back one level easier${levels}` : ""}. ${why}${on}.`;
    case "rest_day":
      return `resting through ${through}. During the warm-up: ${change.reasons.map(reason => REASON_WORDS[reason]).join(", ")}${on}.`;
    case "steady":
      return `kept at the easiest level (it can't go lower). ${why}${on}.`;
  }
}

export function PlanChangesCard() {
  const name = profileName(useProfile());
  const version = useSyncExternalStore(subscribePlanReview, planReviewVersion, planReviewVersion);
  const state = useMemo(() => loadPlanReview(), [version]);
  const [email, setEmail] = useState<{ configured: boolean; recipient: string | null } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin-alerts/status", { signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then(status => {
        if (status && typeof status.configured === "boolean") setEmail({ configured: status.configured, recipient: typeof status.recipient === "string" ? status.recipient : null });
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const changes = state.changes.slice().reverse().slice(0, 12);
  return (
    <section className="al-card al-plan" aria-labelledby="al-plan-title">
      <h3 id="al-plan-title">Changes to {name}'s plan</h3>
      <p className="al-meta">Made by Alira's daily plan review with fixed rules. Newest first.</p>
      {changes.length === 0 ? (
        <p>No changes yet. Alira reviews the plan every evening at 8pm, and straight away after a warning sign.</p>
      ) : (
        <ul className="al-plan-list">
          {changes.map(change => {
            const status = emailStatus(change, state);
            return (
              <li key={`${change.id}-${change.at}`}>
                <span className="al-plan-day">{dayLabel(change.effectiveDay)}</span>
                <span className="al-plan-text"><b>{change.exerciseName}</b>: {describe(change)}</span>
                {status !== "none" && <span className={`al-tag ${status === "sent" ? "al-tag-ok" : "al-tag-sim"}`}>{status === "sent" ? "Admin emailed" : "Email waiting"}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {email && (
        <p className="al-meta">
          {email.recipient ? `Admin emails go to ${email.recipient}.` : "No admin email address is set."}{" "}
          {email.configured ? "Email is set up." : "Email isn't set up yet, so they wait until it is."}
        </p>
      )}
    </section>
  );
}
