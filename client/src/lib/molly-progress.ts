// "Molly's Progress": turns the daily summaries written by scripts/molly-progress.mjs into a conversation
// in which Alira tells Zak what Molly has been building. Pure functions, so the wording is testable.
// The summaries hold areas and counts only; every sentence here is templated, nothing is invented.
import { PROJECT_PROGRESS } from "@shared/project-progress";

export type AreaSummary = {
  id: string;
  label: string;
  filesAdded: number;
  filesChanged: number;
  filesRemoved: number;
  linesAdded: number;
  linesRemoved: number;
  highlights: string[];
};

export type DaySummary = {
  date: string; // YYYY-MM-DD, local to Molly's machine
  generatedAt: string;
  firstRun?: boolean;
  quiet: boolean;
  totals: { filesAdded: number; filesChanged: number; filesRemoved: number; linesAdded: number; linesRemoved: number; testFiles: number };
  areas: AreaSummary[];
};

export type ProgressHistory = { updatedAt: string; days: DaySummary[]; source?: "local" | "published" | "deployed" };

export type ThreadMessage =
  | { id: string; from: "alira"; kind: "text"; text: string }
  | { id: string; from: "alira"; kind: "area"; area: AreaSummary; title: string; body: string; benefit: string }
  | { id: string; from: "alira"; kind: "week"; caption: string; bars: { date: string; label: string; lines: number; quiet: boolean }[] }
  | { id: string; from: "alira"; kind: "numbers"; rows: { label: string; value: string }[] }
  | { id: string; from: "alira"; kind: "heatmap"; progress: typeof PROJECT_PROGRESS }
  | { id: string; from: "alira"; kind: "chips"; chips: Chip[] }
  | { id: string; from: "zak"; kind: "text"; text: string };

export type Chip = { id: "meaning" | "numbers" | "earlier" | "thanks" | "try" | "heatmap"; label: string };
const heatmapChip: Chip = { id: "heatmap", label: "Show me the project heatmap" };

// ---------- small helpers ----------

const hash = (s: string) => Array.from(s).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
/** A stable pick, so the same day always reads the same way but different days vary. */
export const pick = <T,>(items: readonly T[], seed: string): T => items[hash(seed) % items.length];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

export function humanize(name: string): string {
  return name
    .replace(/[_$]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .toLowerCase();
}

export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  const d = new Date(`${date}T12:00:00`);
  const t = new Date(`${today}T12:00:00`);
  const diff = Math.round((t.getTime() - d.getTime()) / 86_400_000);
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
}

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const linesOf = (day: DaySummary) => day.totals.linesAdded + day.totals.linesRemoved;

export type Tier = "quiet" | "small" | "solid" | "big" | "huge";
export const tierOf = (day: DaySummary): Tier => {
  const n = linesOf(day);
  return day.quiet || (n === 0 && day.totals.filesAdded + day.totals.filesRemoved === 0) ? "quiet" : n < 150 ? "small" : n < 800 ? "solid" : n < 2500 ? "big" : "huge";
};

/** Days in a row, ending at the latest real (non-baseline) day, on which Molly changed something. */
export function streakOf(days: DaySummary[]): number {
  const real = days.filter(day => !day.firstRun);
  let streak = 0;
  let expected: string | null = null;
  for (const day of real) {
    if (expected && day.date !== expected) break;
    if (day.quiet) break;
    streak++;
    const d = new Date(`${day.date}T12:00:00`);
    d.setDate(d.getDate() - 1);
    expected = localDate(d);
  }
  return streak;
}

// ---------- what each part of the platform means for Zak ----------

type AreaStory = { doing: string; benefit: string };
export const AREA_STORIES: Record<string, AreaStory> = {
  exercise: { doing: "teaching the exercise coach", benefit: "Your daily exercises get clearer instructions and fairer scoring, so you can see what is really improving, not just how long you practised." },
  voice: { doing: "tuning my voice", benefit: "I should sound more natural and stay in step with you while you move, so you can keep your eyes on the exercise." },
  alira: { doing: "shaping how I talk with you", benefit: "Our chats should feel more useful and less repetitive, and I should find it easier to answer what you actually asked." },
  movement: { doing: "polishing the movement check", benefit: "Your starting check, the one that sets your first plan, becomes steadier and easier to follow." },
  journey: { doing: "tending your Journey, journal and medals", benefit: "Your progress and your small wins get easier to see, so a good day does not go unnoticed." },
  settings: { doing: "tidying Settings and privacy", benefit: "More control over what is shared, and a calmer place to change how Rehyn works for you." },
  look: { doing: "refreshing how things look", benefit: "Screens that are calmer and easier on the eyes, which matters on a tired day." },
  plumbing: { doing: "working under the hood", benefit: "You will not see this one, but you should feel it: a steadier, quicker app that is safer to rely on." },
  docs: { doing: "writing things down", benefit: "So the people building and checking Rehyn all understand how your plan works, and nothing gets lost in a hand-over." },
  other: { doing: "making a few small touches", benefit: "Small things, but small things add up to an app that feels cared for." },
};
const story = (id: string): AreaStory => AREA_STORIES[id] ?? AREA_STORIES.other;

const effort = (area: AreaSummary) => area.linesAdded + area.linesRemoved + area.filesAdded * 20;

export function areaTitle(area: AreaSummary): string {
  return area.label;
}

export function areaBody(area: AreaSummary): string {
  const parts: string[] = [];
  if (area.filesAdded) parts.push(`${plural(area.filesAdded, "new piece")}`);
  if (area.filesChanged) parts.push(`${plural(area.filesChanged, "piece")} reworked`);
  if (area.filesRemoved) parts.push(`${plural(area.filesRemoved, "piece")} cleared away`);
  const head = `Molly was ${story(area.id).doing}: ${list(parts) || "a light touch"}.`;
  const names = area.highlights.map(humanize).filter(name => name.length > 5).slice(0, 4);
  return names.length ? `${head} Among the new bits: ${list(names)}.` : head;
}

// ---------- the conversation ----------

const hourWord = (hour: number) => (hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");

const OPENERS = [
  "I have been peeking over Molly's shoulder again. Come and see.",
  "Pull up a chair. Molly's been busy and I have notes.",
  "I kept a little diary of what Molly built. Shall we read it together?",
  "Quick report from the workshop, straight from Molly's desk.",
] as const;

const HEADLINES: Record<Exclude<Tier, "quiet">, readonly string[]> = {
  small: ["A gentle day: Molly made a handful of careful changes.", "Small steps today, which is how most recoveries, and most software, move forward."],
  solid: ["A solid day of work. Molly moved a good few things forward.", "Steady progress today. Molly got a real chunk of work done."],
  big: ["A big day. Molly poured a lot into Rehyn.", "Busy workshop today. There is quite a lot to tell you."],
  huge: ["Goodness, a huge day. Molly built a great deal.", "That was a marathon of a day in the workshop. Let me squeeze it into a few messages."],
};

export function buildThread(history: ProgressHistory | null, now: Date = new Date()): ThreadMessage[] {
  const today = localDate(now);
  const days = history?.days ?? [];
  const latest = days[0];
  const msgs: ThreadMessage[] = [];
  let n = 0;
  const say = (text: string) => msgs.push({ id: `m${n++}`, from: "alira", kind: "text", text });

  say(`${hourWord(now.getHours())}, Zak.`);
  if (!latest) {
    say("Molly has not checked in yet. Every evening at 8, Molly's work on the platform is summed up and sent to me, so the first note will be here soon.");
    say("Come back tomorrow morning and I will have something to tell you.");
    msgs.push({ id: `m${n++}`, from: "alira", kind: "chips", chips: [heatmapChip] });
    return msgs;
  }

  say(pick(OPENERS, latest.date));

  if (latest.firstRun) {
    const t = latest.totals;
    const top = [...latest.areas].sort((a, b) => effort(b) - effort(a)).slice(0, 3).map(a => lc(a.label));
    const files = t.filesAdded + t.filesChanged;
    say(`Today is day one of my diary. I started keeping notes on Molly's work, and I counted ${files} pieces that make up Rehyn, around ${t.linesAdded.toLocaleString("en-GB")} lines in all.`);
    if (top.length) say(`Most of that lives in ${list(top)}. From tomorrow I will tell you what changed each day, not just what is there.`);
    msgs.push({ id: `m${n++}`, from: "alira", kind: "chips", chips: chipsFor(latest, days) });
    return msgs;
  }

  const when = dayLabel(latest.date, today).toLowerCase();
  const tier = tierOf(latest);
  if (tier === "quiet") {
    say(`${cap(when)}'s note is in, and it is a quiet one: Molly took a breather and nothing changed.`);
    say(pick(["Rest is part of building something good. I will keep the lights on.", "Even gardeners let the soil sit now and then."], latest.date));
    const streak = streakOf(days);
    if (!streak && days.length > 1) {
      const lastBusy = days.find(d => !d.quiet && !d.firstRun);
      if (lastBusy) say(`The last busy day was ${dayLabel(lastBusy.date, today).toLowerCase()}. I will tell you the moment Molly is back at it.`);
    }
    msgs.push({ id: `m${n++}`, from: "alira", kind: "chips", chips: chipsFor(latest, days) });
    return msgs;
  }

  say(pick(HEADLINES[tier], latest.date));
  const top = [...latest.areas].sort((a, b) => effort(b) - effort(a));
  top.slice(0, 3).forEach((area, i) => {
    if (i === 0) say(`The biggest share went to ${lc(area.label)}.`);
    msgs.push({ id: `m${n++}`, from: "alira", kind: "area", area, title: areaTitle(area), body: areaBody(area), benefit: story(area.id).benefit });
  });
  const rest = top.slice(3);
  if (rest.length) say(`There were also smaller touches in ${list(rest.map(a => lc(a.label)))}.`);
  if (latest.totals.testFiles > 0) say(`And ${plural(latest.totals.testFiles, "safety check")} were touched too. Those are the tests that catch mistakes before they reach you.`);

  const streak = streakOf(days);
  if (streak >= 2) say(`That makes ${streak} days in a row. Steady beats speedy.`);

  const bars = lastDays(days, today, 7);
  if (bars.some(b => b.lines > 0)) msgs.push({ id: `m${n++}`, from: "alira", kind: "week", caption: "Molly's week at a glance: taller means more changed that day.", bars });
  msgs.push({ id: `m${n++}`, from: "alira", kind: "chips", chips: chipsFor(latest, days) });
  return msgs;
}

/** Lower-case a label for use mid-sentence, keeping the name Alira capitalised. */
const lc = (label: string) => (label.startsWith("Alira") ? label : label.charAt(0).toLowerCase() + label.slice(1));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function lastDays(days: DaySummary[], today: string, count: number) {
  const out: { date: string; label: string; lines: number; quiet: boolean }[] = [];
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() - (count - 1));
  for (let i = 0; i < count; i++) {
    const date = localDate(d);
    const day = days.find(x => x.date === date && !x.firstRun);
    out.push({ date, label: d.toLocaleDateString("en-GB", { weekday: "short" }), lines: day ? linesOf(day) : 0, quiet: !day || day.quiet });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function chipsFor(latest: DaySummary, _days: DaySummary[]): Chip[] {
  const chips: Chip[] = [{ id: "meaning", label: "What does this mean for me?" }, heatmapChip];
  if (latest.areas.some(a => a.id === "exercise" && !latest.quiet)) return [...chips, { id: "try", label: "Take me to the exercises" }];
  return [...chips, { id: "numbers", label: "Show me the numbers" }];
}

/** Alira's answer to a quick reply. */
export function replyTo(chip: Chip["id"], history: ProgressHistory | null, now: Date = new Date()): ThreadMessage[] {
  const days = history?.days ?? [];
  const latest = days[0];
  const today = localDate(now);
  const out: ThreadMessage[] = [];
  let n = 0;
  const say = (text: string) => out.push({ id: `r${chip}${n++}`, from: "alira", kind: "text", text });
  if (chip === "heatmap") {
    say("Here is the design work Molly has finished and what remains. The percentage shown measures the recorded Easy exercise reviews; the other estimates will appear once they are agreed.");
    out.push({ id: `r${chip}${n++}`, from: "alira", kind: "heatmap", progress: PROJECT_PROGRESS });
    out.push({ id: `r${chip}${n++}`, from: "alira", kind: "chips", chips: latest ? [{ id: "meaning", label: "What does this mean for me?" }, { id: "numbers", label: "Show me the numbers" }, { id: "try", label: "Take me to the exercises" }] : [{ id: "try", label: "Take me to the exercises" }] });
    return out;
  }
  if (chip === "try") {
    say("Of course. The new exercise work is in Settings, under Exercise engine. I will take you there now.");
    return out;
  }
  if (!latest) { say("Nothing to explain yet, but I will be the first to tell you when there is."); return out; }

  if (chip === "meaning") {
    const areas = [...latest.areas].sort((a, b) => effort(b) - effort(a)).slice(0, 3);
    if (latest.firstRun) say("Nothing has changed yet. Today is my starting point, so there is no difference for you to feel. From tomorrow I will tell you what each day of Molly's work should mean for you.");
    else if (!areas.length) say("Today nothing changed, so there is nothing new for you. Everything works as it did yesterday.");
    else {
      say("In plain words, here is what it should mean for you:");
      areas.forEach(area => say(`${area.label}: ${story(area.id).benefit}`));
      say("I can only promise what Molly intends. If something feels off when you use it, tell me and I will pass it on.");
    }
  } else if (chip === "numbers") {
    const t = latest.totals;
    out.push({
      id: `r${chip}${n++}`, from: "alira", kind: "numbers",
      rows: [
        { label: "New pieces", value: String(t.filesAdded) },
        { label: "Pieces reworked", value: String(t.filesChanged) },
        { label: "Pieces cleared away", value: String(t.filesRemoved) },
        { label: "Lines written", value: t.linesAdded.toLocaleString("en-GB") },
        { label: "Lines removed", value: t.linesRemoved.toLocaleString("en-GB") },
        { label: "Safety checks touched", value: String(t.testFiles) },
      ],
    });
    say(latest.firstRun ? "Those are totals for everything Rehyn contains today, the starting point for my diary." : "Those are for the latest day. Lines are a rough measure of effort, not of how much better things got.");
  } else if (chip === "earlier") {
    const earlier = days.filter(d => d.date !== latest.date && !d.firstRun).slice(0, 4);
    if (!earlier.length) say("This is the first full day in my diary, so there is nothing earlier yet.");
    earlier.forEach(day => {
      const top = [...day.areas].sort((a, b) => effort(b) - effort(a))[0];
      say(day.quiet ? `${dayLabel(day.date, today)}: a quiet day, nothing changed.` : `${dayLabel(day.date, today)}: ${tierWord(tierOf(day))}, mostly ${top ? lc(top.label) : "small touches"}.`);
    });
  } else {
    say(pick(["Any time, Zak. Molly builds, I keep you posted, and you keep moving.", "My pleasure. Keep going, and I will keep watching the workshop for you."], latest.date));
  }
  return out;
}

const tierWord = (tier: Tier) => ({ quiet: "a quiet day", small: "a gentle day", solid: "a solid day", big: "a big day", huge: "a huge day" })[tier];

/** How long Alira "types" before a message appears, so the thread reads like a conversation. */
export function typingMs(message: ThreadMessage): number {
  if (message.kind === "text") return Math.min(2000, Math.max(650, 350 + message.text.length * 16));
  if (message.kind === "area") return 1100;
  return 800;
}
