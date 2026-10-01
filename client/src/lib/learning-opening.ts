import { currentValue, formatValue, paramSpec, type AdaptationState, type AutoValues, type Consent } from "@shared/alira-adaptation";

/** Use the saved review and applied log, never infer improvement from a score or invent a change. */
export function learningOpening({ name, state, consent, today, auto = {} }: {
  name: string; state: AdaptationState; consent: Consent; today: string; auto?: AutoValues;
}): string {
  const hello = `Hi ${name.trim() || "there"}.`;
  const latest = state.summaries.filter(review => review.day <= today)
    .sort((a, b) => b.day.localeCompare(a.day) || b.at.localeCompare(a.at))[0];

  if (!consent.movement) {
    // As in the learning chat, earlier findings are hidden after movement sharing is withdrawn.
    const reviewedBefore = Boolean(latest) || state.log.some(entry => entry.by === "alira");
    return `${hello} ${reviewedBefore
      ? "I'm not reviewing new movement results while sharing is off. Your existing settings remain in place. You can choose what I can access above."
      : "I haven't reviewed your movement results or made any learning adjustments yet. If you choose to share your movement results, I can learn from them and tailor your exercises to how you move."}`;
  }
  if (!latest) return `${hello} I haven't completed a learning review for you yet, so I don't have a new finding or adjustment to share. I'll update you here after I review your shared results.`;

  const when = latest.day === today ? "today" : `on ${new Date(`${latest.day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;
  const changes = state.log.filter(entry => entry.by === "alira" && latest.changeIds.includes(entry.id));
  const evidence = changes.flatMap(entry => entry.evidence).find(item => item.trim());
  const finding = evidence
    ? `In my latest review ${when}, I noticed: ${evidence.trim()}`
    : latest.patientNote.trim()
      ? `From my latest review ${when}: ${latest.patientNote.trim()}`
      : `I completed a review of your shared movement results ${when}.`;

  const active = changes.filter(entry => !entry.revertedAt
    && currentValue(state, entry.param) === entry.to
    && state.log.slice().reverse().find(other => other.param === entry.param && !other.revertedAt)?.id === entry.id);
  let adjustments: string;
  if (active.length) {
    adjustments = active.slice(0, 2).map(entry => `I changed **${paramSpec(entry.param).label}** from **${formatValue(entry.param, entry.from)}** to **${formatValue(entry.param, entry.to, auto[entry.param])}** for you.`).join(" ");
    if (active.length > 2) adjustments += ` I also adjusted ${active.length - 2} other settings, which you can see in All settings.`;
  } else if (changes.length) {
    adjustments = "The adjustments from that review have since been undone or replaced. All settings shows the values in use now.";
  } else if (latest.changeIds.length) {
    adjustments = "I can't confirm the recorded adjustments from the saved change history. All settings shows the values in use now.";
  } else {
    adjustments = "I kept your settings unchanged in that review.";
  }
  return `${hello} ${finding}\n\n${adjustments}`;
}
