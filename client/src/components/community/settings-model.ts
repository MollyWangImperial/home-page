import { settingsChoices, startHiddenWords, suggestedHiddenWords, type BreakChoice, type MessagesFrom, type PersonId, type PostsSeenBy } from "@/content/community-samples";
import { canSee, cleanHiddenWord, hiddenWordIn, hourLabel, inQuietHours, LIMITS, onBreak, type CommunityMemory, type CommunitySettings, type SettingsSection } from "@/lib/community-store";

// The wording and small rules behind the Community settings page (F5): the one line under each
// section's name, the hours quiet time can start at, the break, the card preview and the words
// a person hides. Everything here describes what happens on this device, and nothing more.

/** The five sections. The address can name one (`?space=settings&section=quiet`), so it lives in the store. */
export type { SettingsSection };

const labelOf = <T extends string>(choices: { id: T; label: string }[], id: T): string => choices.find(choice => choice.id === id)?.label ?? "";
/** "1 friend", "3 friends", or the words for none. */
const counted = (count: number, one: string, many: string, none: string): string => (count === 0 ? none : `${count} ${count === 1 ? one : many}`);

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "7 October", or "Wednesday 7 October" with the weekday, on this device's calendar. */
export function dayLabel(at: number, weekday = false): string {
  const date = new Date(at);
  return `${weekday ? `${WEEKDAYS[date.getDay()]} ` : ""}${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/**
 * Who sees the person's posts, in the words each place uses: the label beside a post and in the
 * composer, the part of the settings summary, and what is said once a post is made.
 */
export function postsAudience(seenBy: PostsSeenBy): { label: string; summary: string; posted: string } {
  if (seenBy === "everyone") return { label: "Everyone", summary: "posts for everyone", posted: "Posted for everyone in My community." };
  if (seenBy === "onlyMe") return { label: "Only me", summary: "posts just for you", posted: "Posted. Only you can see it." };
  return { label: "Friends", summary: "posts for friends", posted: "Posted for your friends." };
}

/** The break on now: "none" once a break has ended, whatever was chosen. */
export const breakNow = (settings: CommunitySettings, now = Date.now()): BreakChoice => (onBreak(settings, now) ? settings.breakChoice : "none");

/** The line under each section's name, in parts: "Town shown", "online dot on", "drawn face". */
export function settingsSummaries(settings: CommunitySettings, town: string, now = Date.now()): Record<SettingsSection, string[]> {
  const until = onBreak(settings, now) && settings.breakUntil !== null ? settings.breakUntil : null;
  return {
    appear: [
      town ? (settings.showTown ? "Town shown" : "Town hidden") : "No town added",
      settings.showOnline ? "online dot on" : "online dot off",
      labelOf(settingsChoices.picture, settings.picture).toLowerCase(),
    ],
    friends: [
      settings.requestsFrom === "noOne" ? "No new requests" : `Requests from ${labelOf(settingsChoices.requestsFrom, settings.requestsFrom).toLowerCase()}`,
      settings.messagesFrom === "friends" ? "messages from friends only" : "messages from friends and groups",
      postsAudience(settings.postsSeenBy).summary,
    ],
    see: [settings.gentleMode ? "Gentle mode on" : "Gentle mode off", counted(settings.hiddenWords.length, "hidden word", "hidden words", "no hidden words")],
    read: [settings.readAloud ? "Read aloud on" : "Read aloud off", `${labelOf(settingsChoices.textSize, settings.textSize).toLowerCase()} text`],
    quiet: [`Quiet from ${hourLabel(settings.quietFrom)} to ${hourLabel(settings.quietUntil)}`, ...(until !== null ? [`on a break until ${dayLabel(until)}`] : [])],
  };
}

/* ------------------------------------------------------------- quiet time */

const QUIET_HOURS = settingsChoices.quietFrom;
/** Whether quiet time already starts at the earliest (7 pm) or the latest (11 pm) hour it can. */
export const quietEdges = (from: number) => ({ earliest: from <= QUIET_HOURS[0], latest: from >= QUIET_HOURS[QUIET_HOURS.length - 1] });

/** Quiet time starting an hour earlier (-1) or later (+1), within 7 pm to 11 pm. */
export function stepQuietFrom(from: number, by: -1 | 1): number {
  const at = QUIET_HOURS.indexOf(from);
  const index = at >= 0 ? at + by : QUIET_HOURS.indexOf(21);
  return QUIET_HOURS[Math.min(QUIET_HOURS.length - 1, Math.max(0, index))];
}

/** What quiet time does: the Alerts badge in the toolbar stays quiet (the alerts are still there). Says so when it is on now. */
export const quietHint = (settings: CommunitySettings, at: Date = new Date()): string =>
  `The Alerts badge stays quiet from ${hourLabel(settings.quietFrom)} to ${hourLabel(settings.quietUntil)}${inQuietHours(settings, at) ? ". It's quiet time now." : ""}`;

/** What a break does, and when the one on now ends. */
export function breakHint(settings: CommunitySettings, now = Date.now()): string {
  return onBreak(settings, now) && settings.breakUntil !== null
    ? `The Alerts badge stays quiet until ${dayLabel(settings.breakUntil, true)}. Nothing is deleted.`
    : "During a break, the Alerts badge stays quiet. Nothing is deleted.";
}

/* -------------------------------------------------------------- the card */

/** Under the name on the card: the town (when it is shown and there is one), groups and friends. */
export function cardLine(showTown: boolean, town: string, groups: number, friends: number): string {
  const parts: string[] = [];
  if (showTown && town) parts.push(town);
  parts.push(groups === 0 ? "No groups yet" : `In ${groups} group${groups === 1 ? "" : "s"}`);
  parts.push(counted(friends, "friend", "friends", "No friends yet"));
  return parts.join(" · ");
}

/** The note under the card. It says "would": in this preview, nobody else sees it. */
export const cardNote = (messagesFrom: MessagesFrom): string =>
  `What other members would see when they tap your name.${messagesFrom === "friends" ? " Only friends could message you." : ""}`;

/** What "Show my town" puts on the card, from the town in the person's profile. */
export const townHint = (town: string): string => (town ? `Puts “${town}” under your name on your card` : "Your profile doesn't have a town yet.");

/** A line of post text for "Sample post at this size", from someone the person still sees. */
const sampleLines: { who: PersonId; text: string }[] = [
  { who: "margaret", text: "First tomatoes off the windowsill!" },
  { who: "joan", text: "Buttoned my own cardigan this morning. All five buttons." },
  { who: "david", text: "Biscuit and I made it to the corner shop and back." },
];
export function sampleLine(memory: CommunityMemory): { who: PersonId | null; text: string } {
  return sampleLines.find(line => canSee(memory, line.who) && !hiddenWordIn(line.text, memory.settings.hiddenWords)) ?? { who: null, text: "This is the size posts are in My community." };
}

/* ----------------------------------------------------------- hidden words */

/** Phones type curly apostrophes ("don’t"); hidden words keep straight ones. */
export const typedWord = (input: string): string => input.replace(/[‘’ʼ]/g, "'");

/** Why a word can't be hidden, in plain words, or null when it can. */
export function hiddenWordProblem(input: string, words: string[]): string | null {
  if (!input.trim()) return "Write a word or a short phrase first.";
  const word = cleanHiddenWord(typedWord(input));
  if (!word) return "Use letters and numbers. Spaces, apostrophes and hyphens are fine too.";
  if (words.includes(word)) return `Posts that mention “${word}” are already hidden.`;
  if (words.length >= LIMITS.hiddenWords) return `You can hide up to ${LIMITS.hiddenWords} words. Remove one to add another.`;
  return null;
}

/** The word offered with one tap: the suggestions first, then any word hidden to begin with that was taken off. */
export function nextSuggestedWord(words: string[]): string | null {
  return [...suggestedHiddenWords, ...startHiddenWords].find(word => !words.includes(word)) ?? null;
}
