// Medals on the Journey page (Medals tab) and the guided next step Alira offers for each one.
// Layout and behaviour come from the design canvas (board A · Start here): the collection count
// shows only what has been earned, never how many are left, so new medals can be added freely.
import type { MedalIcon } from "@/components/MedalArtwork";

export type MedalId = MedalIcon;
export type MedalTone = "consistency" | "milestones" | "courage" | "everyday";
export type Medal = { id: MedalId; name: string; description: string; celebration?: string };
export type MedalCategory = { name: string; tone: MedalTone; note: string; medals: Medal[] };
export type EarnedMedal = { id: MedalId; on: string };

export const medalCategories: MedalCategory[] = [
  {
    name: "Consistency", tone: "consistency", note: "for showing up", medals: [
      { id: "first-step", name: "First Step", description: "Complete your very first session.", celebration: "You finished your first session. Well done for starting." },
      { id: "sunrise", name: "Seven Sunrises", description: "Practise seven days in a row." },
      { id: "weekend", name: "Weekend Warrior", description: "Practise on a Saturday and a Sunday." },
      { id: "month", name: "Month of Mornings", description: "Practise on thirty different days." },
    ],
  },
  {
    name: "Milestones", tone: "milestones", note: "for measured progress", medals: [
      { id: "baseline", name: "Baseline Set", description: "Complete your first assessment." },
      { id: "ten-up", name: "Ten Up", description: "Raise any recovery score by ten points." },
      { id: "steady-hand", name: "Steady Hand", description: "Reach a hand control score of 90." },
      { id: "reassessment", name: "Reassessment Ready", description: "Reach your week 5 reassessment." },
    ],
  },
  {
    name: "Courage", tone: "courage", note: "for speaking up", medals: [
      { id: "voice", name: "Found My Voice", description: "Record your first voice note." },
      { id: "alira", name: "Asked Alira", description: "Ask Alira your first question." },
      { id: "honest-day", name: "Honest Day", description: "Write about a hard day in your journal." },
      { id: "shared", name: "Shared It", description: "Share a win with someone you love." },
    ],
  },
  {
    name: "Everyday life", tone: "everyday", note: "for wins at home", medals: [
      { id: "first-win", name: "First Win", description: "Log your first everyday win." },
      { id: "self-care", name: "Self Care", description: "Log a win with grooming or getting ready." },
      { id: "five-wins", name: "Five Wins", description: "Log five everyday wins." },
      { id: "kitchen", name: "Kitchen Helper", description: "Log a win in the kitchen." },
    ],
  },
];

export const allMedals = medalCategories.flatMap(category =>
  category.medals.map(medal => ({ ...medal, category: category.name, tone: category.tone }))
);
export type MedalWithCategory = (typeof allMedals)[number];

/** Earned medals, oldest first. Reference state for now: the patient finished their first session today. */
export const earnedMedals: EarnedMedal[] = [{ id: "first-step", on: "Today" }];

/** The medals offered under "Within reach next", in order. */
export const withinReachNext: MedalId[] = ["baseline", "alira"];

export function findMedal(id: string | null | undefined): MedalWithCategory | null {
  return allMedals.find(medal => medal.id === id) ?? null;
}

export function earnedOn(id: MedalId, earned: EarnedMedal[] = earnedMedals): string | null {
  return earned.find(medal => medal.id === id)?.on ?? null;
}

/** "Earned today" or "Earned on 8 Sep". */
export function earnedLabel(on: string): string {
  return on.toLowerCase() === "today" ? "Earned today" : `Earned on ${on}`;
}

// ---- Alira's guided next step -----------------------------------------------------------------
// "Start with Alira" in a medal's pop-up opens /alira?medal=<id>. Alira explains the medal, offers
// one next step, and after the patient's reply leads them to the place where it is earned.

export type MedalNextStep =
  | { kind: "assessment" }
  | { kind: "ask" }
  | { kind: "go"; label: string; href: string };

export type MedalGuide = {
  /** Alira's opening message about the medal. */
  intro: string;
  /** The patient's reply chip. */
  reply: string;
  /** Alira's answer to that reply. */
  follow: string;
  next: MedalNextStep;
  /** Short action shown on the medal's card when it is marked "Up next". */
  upNext: string;
};

export const MEDALS_PATH = "/journey?tab=medals";
const week: MedalNextStep = { kind: "go", label: "Open my week", href: "/journey?tab=progress" };
const journal: MedalNextStep = { kind: "go", label: "Open my journal", href: "/journey?tab=journal" };
const wins: MedalNextStep = { kind: "go", label: "Add a win", href: "/journey?tab=progress" };
const assessmentFollow = "Great. Find a spot where the camera can see you, with a little room around you. I'll guide you through each movement, one at a time.";
const winFollow = "Lovely. Add it under Everyday wins on your journey page. A few words is plenty.";

export const medalGuides: Record<MedalId, MedalGuide> = {
  "first-step": {
    intro: "You earned First Step by finishing your very first session. Well done for starting.",
    reply: "Show me my medals", follow: "Here they are. Each one lights up when you earn it.",
    next: { kind: "go", label: "See my medals", href: MEDALS_PATH }, upNext: "See my medals",
  },
  sunrise: {
    intro: "Seven Sunrises is yours when you practise seven days in a row. One short session a day is all it takes. Shall we look at this week's sessions?",
    reply: "Show me this week", follow: "Here's your week. Each session you finish brings the next sunrise closer.",
    next: week, upNext: "See my week",
  },
  weekend: {
    intro: "Weekend Warrior is yours when you practise on a Saturday and a Sunday. Weekends are often quieter, which can make them a good time for a short session. Shall we look at your week?",
    reply: "Show me this week", follow: "Here's your week. One short session on Saturday and one on Sunday is all it needs.",
    next: week, upNext: "See my week",
  },
  month: {
    intro: "Month of Mornings is yours after practising on thirty different days. The days don't need to be in a row, so there's no pressure if you miss one. Shall we look at your week?",
    reply: "Show me this week", follow: "Here's your week. Every session you finish counts towards the thirty.",
    next: week, upNext: "See my week",
  },
  baseline: {
    intro: "Baseline Set is yours when you complete your first assessment. I'll guide you through a few gentle movements on camera, so we have a starting point to measure your progress from. Ready to begin?",
    reply: "Start my assessment", follow: assessmentFollow,
    next: { kind: "assessment" }, upNext: "Start assessment",
  },
  "ten-up": {
    intro: "Ten Up is yours when any recovery score rises by ten points. Your scores come from your movement check, so that's the first step. Shall we do it now?",
    reply: "Start my assessment", follow: assessmentFollow,
    next: { kind: "assessment" }, upNext: "Start assessment",
  },
  "steady-hand": {
    intro: "Steady Hand is yours when your hand control score reaches 90. Your hand score comes from your movement check, so let's start there. Shall we do it now?",
    reply: "Start my assessment", follow: assessmentFollow,
    next: { kind: "assessment" }, upNext: "Start assessment",
  },
  reassessment: {
    intro: "Reassessment Ready is yours when you reach your week 5 reassessment. Your plan is built from your first assessment, so that's the first step. Shall we do it now?",
    reply: "Start my assessment", follow: assessmentFollow,
    next: { kind: "assessment" }, upNext: "Start assessment",
  },
  voice: {
    intro: "Found My Voice is yours when you record your first voice note. You can record one in your journal. A few words about your day is plenty. Shall we open it?",
    reply: "Open my journal", follow: "Here's your journal. Press Say it instead and speak whenever you're ready.",
    next: journal, upNext: "Record a note",
  },
  alira: {
    intro: "Asked Alira is yours when you ask me your first question. It can be about your exercises, feeling tired, or anything on your mind.",
    reply: "I have a question", follow: "Go ahead, type it or say it below. There are no silly questions.",
    next: { kind: "ask" }, upNext: "Ask Alira",
  },
  "honest-day": {
    intro: "Honest Day is yours when you write about a hard day in your journal. Hard days are part of recovery, and writing them down helps us both see the whole picture. Would you like to open your journal?",
    reply: "Open my journal", follow: "Here's your journal. Write as much or as little as you like.",
    next: journal, upNext: "Open my journal",
  },
  shared: {
    intro: "Shared It is yours when you share a win with someone you love. First, let's log a win you're proud of, however small. Shall we?",
    reply: "Log a win", follow: "Lovely. Add your win under Everyday wins, and then you can share it.",
    next: wins, upNext: "Log a win",
  },
  "first-win": {
    intro: "First Win is yours when you log your first everyday win, like making a cup of tea or getting dressed. Did you manage something like that today?",
    reply: "Log a win", follow: winFollow, next: wins, upNext: "Log a win",
  },
  "self-care": {
    intro: "Self Care is yours when you log a win with grooming or getting ready, like brushing your hair or washing your face. Did you manage one today?",
    reply: "Log a win", follow: winFollow, next: wins, upNext: "Log a win",
  },
  "five-wins": {
    intro: "Five Wins is yours after logging five everyday wins. Every small thing counts. Shall we log one now?",
    reply: "Log a win", follow: winFollow, next: wins, upNext: "Log a win",
  },
  kitchen: {
    intro: "Kitchen Helper is yours when you log a win in the kitchen, like making toast or a hot drink. Did you do anything in the kitchen today?",
    reply: "Log a win", follow: winFollow, next: wins, upNext: "Log a win",
  },
};

/** The guide for /alira?medal=<id>, or null when the id is missing or unknown. */
export function findMedalGuide(id: string | null | undefined): (MedalGuide & { medal: MedalWithCategory }) | null {
  const medal = findMedal(id);
  return medal ? { ...medalGuides[medal.id], medal } : null;
}
