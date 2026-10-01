import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, X } from "lucide-react";
import { useLocation } from "wouter";
import { patientLine } from "@shared/plan-review";
import { learningToday } from "@/lib/alira-learning-store";
import {
  loadPlanReview, markChangesSeen, markChangesShown, planReviewVersion, subscribePlanReview, unseenChanges,
} from "@/lib/plan-review-store";
import "./plan-change-reminder.css";

/**
 * The reminder in the lower-right corner: whenever Alira's daily plan review changes the plan, a
 * message circle appears and opens once to say what changed and why. It stays until the patient
 * presses "Got it". Alira's Journey note repeats the changes the next day.
 */
export default function PlanChangeReminder() {
  const [, navigate] = useLocation();
  const version = useSyncExternalStore(subscribePlanReview, planReviewVersion, planReviewVersion);
  const state = useMemo(() => loadPlanReview(), [version]);
  // Newest first.
  const changes = useMemo(() => unseenChanges(state).slice().reverse(), [state]);
  const newest = changes[0]?.at ?? null;
  const [open, setOpen] = useState(false);
  const bubble = useRef<HTMLButtonElement>(null);

  // A new batch of changes opens the reminder once, without taking focus from what the patient is doing.
  useEffect(() => {
    if (!newest || (state.shownAt && state.shownAt >= newest)) return;
    setOpen(true);
    markChangesShown(state);
  }, [newest, state]);

  if (!changes.length) return null;
  const today = learningToday();
  const close = () => {
    setOpen(false);
    bubble.current?.focus();
  };
  const acknowledge = () => {
    setOpen(false);
    markChangesSeen();
  };
  const ask = () => {
    markChangesSeen();
    navigate("/alira");
  };
  const count = changes.length;

  return (
    <div className="pcr" role="region" aria-label="Plan changes from Alira">
      {open && (
        <div
          className="pcr-panel"
          id="pcr-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="pcr-title"
          onKeyDown={event => {
            if (event.key === "Escape") close();
          }}
        >
          <div className="pcr-head">
            <h2 id="pcr-title">Alira changed your plan</h2>
            <button type="button" className="pcr-close" aria-label="Close" onClick={close}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <ul className="pcr-list" aria-live="polite">
            {changes.map(change => <li key={change.id}>{patientLine(change, today, "popup")}</li>)}
          </ul>
          <div className="pcr-actions">
            <button type="button" className="pcr-primary" onClick={acknowledge}>Got it</button>
            <button type="button" className="pcr-link" onClick={ask}>
              Ask Alira about this <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        ref={bubble}
        className={`pcr-bubble ${open ? "is-open" : ""}`}
        aria-expanded={open}
        aria-controls="pcr-panel"
        aria-label={`Alira changed your plan: ${count === 1 ? "one update" : `${count} updates`}`}
        onClick={() => setOpen(current => !current)}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 12h4l2-5 4 10 2-5h6" />
        </svg>
        <span className="pcr-badge" aria-hidden="true">{count}</span>
      </button>
    </div>
  );
}
