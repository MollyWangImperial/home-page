// When and how Alira invites the patient to share their progress with family.
//
// Alira asks at moments worth sharing (the plan is ready, a first session, a streak, a first
// everyday win, a full week, an improved reassessment), never more than once per moment, never on a
// day the patient reported pain or that things felt harder, at least three days after a "Not now",
// and at most five times in all. "Please don't ask me again" stops it for good. Each invitation
// makes sharing attractive by showing what family would see; none of them uses guilt or pressure,
// so the choice stays freely made.

export const FAMILY_INVITE_KEY = "rehyn.family.invite.v1";
export const INVITE_LIMITS = { maxAsks: 5, daysAfterNotNow: 3 } as const;

export type InviteMoment = "plan_ready" | "first_session" | "first_win" | "streak_3" | "week_one" | "reassessment_up";
export type InviteAnswer = "shown" | "share" | "later" | "never";
export type InviteRecord = { moment: InviteMoment; day: string; answer: InviteAnswer };
export type InviteStore = { v: 1; asks: InviteRecord[]; stopped: boolean };

const MOMENTS: InviteMoment[] = ["plan_ready", "first_session", "first_win", "streak_3", "week_one", "reassessment_up"];
/** Most meaningful first, when several moments are due on the same visit. */
const PRIORITY: InviteMoment[] = ["reassessment_up", "week_one", "streak_3", "first_win", "first_session", "plan_ready"];

const empty = (): InviteStore => ({ v: 1, asks: [], stopped: false });

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadInviteStore(): InviteStore {
  try {
    const raw = storage()?.getItem(FAMILY_INVITE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return empty();
    const answers: InviteAnswer[] = ["shown", "share", "later", "never"];
    const asks = Array.isArray(parsed.asks)
      ? parsed.asks.filter((a: InviteRecord) => a && MOMENTS.includes(a.moment) && typeof a.day === "string" && answers.includes(a.answer)).slice(-20)
      : [];
    return { v: 1, asks, stopped: parsed.stopped === true };
  } catch {
    return empty();
  }
}

function saveInviteStore(store: InviteStore) {
  try { storage()?.setItem(FAMILY_INVITE_KEY, JSON.stringify(store)); } catch { /* the invitation simply shows again later */ }
}

/** Records that an invitation was shown, or the patient's answer to it. */
export function recordInvite(moment: InviteMoment, day: string, answer: InviteAnswer): InviteStore {
  const store = loadInviteStore();
  const asks = store.asks.filter(a => !(a.moment === moment && a.answer === "shown"));
  const next: InviteStore = { v: 1, asks: [...asks, { moment, day, answer }].slice(-20), stopped: store.stopped || answer === "never" };
  saveInviteStore(next);
  return next;
}

export type InviteFacts = {
  today: string;
  sessions: number;
  streak: number;
  wins: number;
  daysSinceStart: number;
  /** An area score in the latest reassessment is higher than at the starting point. */
  improvedOnReassessment: boolean;
};

/** Moments that have happened, so far. */
export function reachedMoments(facts: InviteFacts): InviteMoment[] {
  const out: InviteMoment[] = ["plan_ready"];
  if (facts.sessions >= 1) out.push("first_session");
  if (facts.wins >= 1) out.push("first_win");
  if (facts.streak >= 3) out.push("streak_3");
  if (facts.daysSinceStart >= 6 && facts.sessions >= 3) out.push("week_one");
  if (facts.improvedOnReassessment) out.push("reassessment_up");
  return out;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/**
 * The invitation to show on this visit, or null. Sharing already on, a hard day today, "Please don't
 * ask me again", the overall limit and the gap after "Not now" all mean no invitation.
 */
export function nextInvite(facts: InviteFacts, { sharing, hardDay }: { sharing: boolean; hardDay: boolean }, store: InviteStore = loadInviteStore()): InviteMoment | null {
  if (sharing || hardDay || store.stopped) return null;
  // An invitation already shown today stays on screen until it is answered.
  const shownToday = store.asks.find(a => a.day === facts.today && a.answer === "shown");
  if (shownToday) return shownToday.moment;
  const asked = store.asks.filter(a => a.answer !== "shown" || a.day !== facts.today);
  if (asked.length >= INVITE_LIMITS.maxAsks) return null;
  const lastLater = [...store.asks].reverse().find(a => a.answer === "later" || a.answer === "shown");
  if (lastLater && daysBetween(lastLater.day, facts.today) < INVITE_LIMITS.daysAfterNotNow) return null;
  const done = new Set(store.asks.map(a => a.moment));
  const reached = reachedMoments(facts);
  return PRIORITY.find(moment => reached.includes(moment) && !done.has(moment)) ?? null;
}

export type InviteCopy = { title: string; message: string; share: string };

/** What Alira says at each moment: warm, specific, and always leaving the choice with the patient. */
export function inviteCopy(moment: InviteMoment, name: string): InviteCopy {
  switch (moment) {
    case "plan_ready":
      return {
        title: "Who's in your corner?",
        message: `Your plan is ready, ${name}. Recovery often feels lighter when someone who loves you can see the small steps too, not just the big ones. I can send them a short note each week, so they can cheer you on without you having to explain it all.`,
        share: "Choose who to share with",
      };
    case "first_session":
      return {
        title: "Your very first session",
        message: `That first session is done, ${name}. If someone at home has been rooting for you, this is a lovely first thing for them to see. Shall I let them know how it's going?`,
        share: "Let someone know",
      };
    case "first_win":
      return {
        title: "A win worth telling",
        message: `You've added your first everyday win. Little things like this are often what family most love to hear about, because they show real life getting easier. Would you like to share your wins with someone close?`,
        share: "Share my wins",
      };
    case "streak_3":
      return {
        title: "Three days in a row",
        message: `Three days in a row, ${name}. Steady effort like that deserves an audience. Would you like someone you love to see it and send a word of encouragement?`,
        share: "Share my progress",
      };
    case "week_one":
      return {
        title: "A whole week",
        message: `A whole week of your plan. I write a short letter about each week. Would you like someone close to you to get a copy, so they can celebrate it with you?`,
        share: "Send them my letters",
      };
    case "reassessment_up":
      return {
        title: "Good news to share",
        message: `Your reassessment shows things moving, ${name}. That's news the people who care about you would love to hear. Would you like to share it with them?`,
        share: "Share the good news",
      };
  }
}

/** What family would see, in plain words, so the choice is an informed one. */
export const INVITE_PREVIEW = [
  "A short weekly note from Alira",
  "Which days you did your exercises",
  "The everyday wins you choose to add",
] as const;
export const INVITE_REASSURANCE = "You choose who and what they see, nothing from your journal unless you say so, and you can stop sharing any time.";
