import { useSyncExternalStore } from "react";
import { CONSENT_CATEGORIES, type Consent, type ConsentCategory } from "@shared/alira-adaptation";
import { CONSENT_COPY, learningVersion, loadConsentRecord, saveConsent, subscribeLearning } from "@/lib/alira-learning-store";
import "./alira-learning.css";

const PROMISES = [
  "Switching these off keeps your plan and exercises working with standard settings.",
  "Alira only adjusts your own settings, within fixed limits, and you or your care team can undo any change.",
  "Your raw videos are never sent for Alira's learning. Still pictures are only taken during a warm-up when that switch is on.",
];

function when(at: string | null): string {
  if (!at) return "";
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** One saved choice in plain words: what was switched, or what was shared when there is nothing to compare with. */
function describeChoice(categories: Consent, before: Consent | null): string {
  const switched = before ? CONSENT_CATEGORIES.filter(category => categories[category] !== before[category]) : [];
  if (switched.length) return switched.map(category => `${CONSENT_COPY[category].title}: switched ${categories[category] ? "on" : "off"}.`).join(" ");
  const shared = CONSENT_CATEGORIES.filter(category => categories[category]);
  return shared.length ? `Sharing: ${shared.map(category => CONSENT_COPY[category].title).join(", ")}.` : "Sharing nothing.";
}

/**
 * Data and permissions: the patient's own switches for what Alira may learn from. Everything is off
 * until switched on, and each change is saved straight away with its time.
 */
export function AliraLearningConsent() {
  useSyncExternalStore(subscribeLearning, learningVersion, () => 0);
  const record = loadConsentRecord();
  const history = record.history;
  const recent = history.map((entry, index) => ({ entry, before: index > 0 ? history[index - 1].categories : null })).slice(-3).reverse();

  const choose = (category: ConsentCategory, value: boolean) => {
    const change: Partial<Consent> = {};
    change[category] = value;
    saveConsent(change);
  };

  return (
    <section className="alc" aria-labelledby="alc-title">
      <h3 id="alc-title">What Alira can learn from</h3>
      <p className="alc-intro">Alira can fine-tune your exercises and movement checks by looking at how you are getting on. You decide what she may look at. Everything starts switched off, and you can change your mind at any time.</p>
      <ul className="alc-list">
        {CONSENT_CATEGORIES.map(category => {
          const on = record.categories[category];
          const id = `alc-${category}`;
          return (
            <li key={category}>
              <label className="alc-item">
                <span className="alc-text">
                  <span className="alc-name" id={`${id}-name`}>{CONSENT_COPY[category].title}</span>
                  <span className="alc-detail" id={`${id}-detail`}>{CONSENT_COPY[category].detail}</span>
                </span>
                <span className="alc-control">
                  <input
                    type="checkbox" role="switch" className="alc-input" checked={on}
                    aria-labelledby={`${id}-name`} aria-describedby={`${id}-detail`}
                    onChange={event => choose(category, event.currentTarget.checked)}
                  />
                  <span className="alc-switch" aria-hidden="true" />
                  <span className="alc-state" aria-hidden="true">{on ? "On" : "Off"}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <ul className="alc-promises">{PROMISES.map(line => <li key={line}>{line}</li>)}</ul>
      {recent.length > 0 && (
        <details className="alc-history">
          <summary>{recent.length === 1 ? "Your last change" : `Your last ${recent.length} changes`}</summary>
          <ol>
            {recent.map(({ entry, before }, index) => (
              <li key={`${entry.at}-${index}`}><time dateTime={entry.at}>{when(entry.at) || "At an unknown time"}</time> {describeChoice(entry.categories, before)}</li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
