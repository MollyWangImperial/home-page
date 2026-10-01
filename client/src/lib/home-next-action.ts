import { loadRememberedAssessment, type StoredAssessment } from "./assessment";
import { dayKey, daysToReassessment, homeStages, type HomeStage, type Opener } from "./home-stage";
import { hasAssessmentScores, journeyNow, launchablePlan, loadSessionStore, loadShareSettings, planDesigned, type SessionStore } from "./journey";
import { addDays, loadJournal, type JournalPage } from "./journal-days";

export type HomeActionKind = "onboarding" | "assessment" | "reassessment" | "plan" | "review" | "exercises" | "journal" | "share" | "medals";
export type HomeAction = Opener & { kind: HomeActionKind; stage: HomeStage; days: number; note: string };
export type HomeActionSnapshot = {
  assessment: StoredAssessment | null;
  sessions: SessionStore;
  now: Date;
  journalPage?: JournalPage;
  sharingConfigured: boolean;
};

// Reading Home must not create a journal, complete a session, or change sharing preferences.
export function loadHomeActionSnapshot(now = new Date()): HomeActionSnapshot {
  const journal = loadJournal(now);
  return {
    assessment: loadRememberedAssessment(),
    sessions: loadSessionStore(),
    now: journeyNow(now),
    journalPage: journal.pages[addDays(dayKey(now), journal.testDays)],
    sharingConfigured: loadShareSettings().configured || journal.share.configured,
  };
}

const EXERCISES_HREF = "/journey?tab=progress&section=exercises";

/** Required steps are deterministic; only the optional follow-ups use the visit's random roll. */
export function nextHomeAction(snapshot: HomeActionSnapshot, roll: number, openerIndex = 0): HomeAction {
  const { assessment, sessions, now, journalPage, sharingConfigured } = snapshot;
  const days = daysToReassessment(assessment, now);
  const fromStage = (kind: HomeActionKind, stage: HomeStage): HomeAction => {
    const copy = homeStages[stage];
    return { kind, stage, days, note: copy.note, ...copy.openers[openerIndex % copy.openers.length] };
  };

  if (!assessment) return fromStage("onboarding", "assessment");
  if (assessment.report?.clinical_review_gate?.rehab_access === "blocked") {
    return { ...fromStage("review", "exercises"),
      text: "Hi {n}. Your plan needs a review before we start exercising. Let’s look at the next step together.",
      cta: "Review my next step", href: hasAssessmentScores(assessment) && planDesigned(assessment) ? EXERCISES_HREF : "/alira",
      note: "Alira can help you review the guidance saved with your plan." };
  }
  if (!hasAssessmentScores(assessment)) {
    return { ...fromStage("assessment", "assessment"), href: "/assessment",
      text: "Hi {n}. Let’s finish your movement check so your exercise plan can be based on your scores.",
      cta: "Continue my movement check" };
  }
  if (days === 0) return fromStage("reassessment", "reassessment");
  if (!planDesigned(assessment)) {
    return { ...fromStage("plan", "exercises"), href: "/alira",
      text: "Your movement scores are here, {n}. Let’s continue with Alira to prepare your exercise plan.",
      cta: "Continue with Alira", note: "Your scores and answers are saved." };
  }
  const plan = launchablePlan(assessment);
  if (!plan.length) {
    return { ...fromStage("review", "exercises"), href: EXERCISES_HREF,
      text: "Hi {n}. Let’s review your plan and the support you need for your next movements.",
      cta: "Review my exercise plan", note: "Alira can help you review the next step." };
  }
  const results = sessions[dayKey(now)] ?? {};
  const completed = plan.filter(exercise => Number.isFinite(results[exercise.id]?.score));
  const next = plan.find(exercise => !Number.isFinite(results[exercise.id]?.score));
  if (next) {
    const action = { ...fromStage("exercises", "exercises"), href: EXERCISES_HREF };
    return completed.length ? { ...action,
      text: `You’ve completed ${completed.length} of today’s ${plan.length} movements, {n}. ${next.name} is next. Shall we continue?`,
      cta: "Continue today’s exercises" } : action;
  }

  // A missing journal page has most of the weight. Completed entries and an existing
  // sharing setup (including one deliberately switched off) are not requested again.
  const hasJournalPage = !!journalPage && (journalPage.mood >= 0 || !!journalPage.text.trim() || (journalPage.voice ?? 0) > 0);
  const followUps: (HomeAction & { weight: number })[] = [];
  const base = { stage: "done_today" as const, days, note: "Your session is complete. Choose what feels right for you." };
  if (!hasJournalPage) followUps.push({ ...base, kind: "journal", weight: 5,
    text: "Well done today, {n}. Your exercises are complete. Shall we keep a few words about how today felt in your journal?",
    cta: "Keep today in my journal", href: "/journey?tab=journal" });
  if (!sharingConfigured) followUps.push({ ...base, kind: "share", weight: 2,
    text: "Lovely work today, {n}. Your session is complete. Would you like to choose what to share with your family?",
    cta: "Choose what to share", href: "/journey?tab=progress&section=sharing" });
  followUps.push({ ...base, kind: "medals", weight: 1,
    text: "That’s today’s session done, {n}. Every step counts. Shall we take a moment to look at your medals?",
    cta: "See my medals", href: "/journey?tab=medals" });
  const total = followUps.reduce((sum, action) => sum + action.weight, 0);
  let pick = Math.max(0, Math.min(Number.isFinite(roll) ? roll : 0, 0.999999)) * total;
  for (const action of followUps) {
    pick -= action.weight;
    if (pick < 0) return action;
  }
  return followUps[followUps.length - 1];
}
