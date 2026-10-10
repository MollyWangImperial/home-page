import {
  PERSON_IDS,
  people,
  suggestedGroups,
  type AlertId,
  type CommunityAlert,
  type IncomingRequestId,
  type PersonId,
  type SampleGroup,
  type SuggestedGroupId,
} from "@/content/community-samples";
import {
  alertHref,
  alertList,
  blockedList,
  canSee,
  communityHref,
  friendList,
  friendsHref,
  hourLabel,
  inQuietHours,
  isBlocked,
  isMuted,
  onBreak,
  pendingRequestCount,
  relationship,
  sentList,
  unreadCount,
  type AlertEntry,
  type CommunityMemory,
  type CommunityPlace,
  type CommunitySettings,
  type CommunitySpace,
  type Relationship,
} from "@/lib/community-store";
import { myGroups, type GroupModel } from "./group-model";
import { unreadMessages } from "./messages-model";

// The logic behind the toolbar's Alerts and Find panels (AlertsPanel.tsx, FindPanel.tsx and
// CommunitySearch.tsx), kept apart from the markup so it can be tested on its own. Everything
// here reads the example community and the person's record on this device; nothing is sent.

/* ----------------------------------------------------------------- alerts */

/**
 * The alerts the Alerts panel lists, newest first: all of them, except a friend request from
 * someone the person has blocked since (blocked people and the person no longer see each other).
 */
export function shownAlerts(memory: CommunityMemory): AlertEntry[] {
  return alertList(memory).filter(({ alert }) => !(alert.target.kind === "friends" && alert.who && isBlocked(memory, alert.who)));
}

/** The alerts that are new now. The panel keeps this list while it is open, then marks them seen. */
export function newAlertIds(memory: CommunityMemory): AlertId[] {
  return shownAlerts(memory).filter(entry => entry.isNew).map(entry => entry.alert.id);
}

/**
 * Where an alert leads now (see `alertHref`). A friend request opens the Friends drawer at For you,
 * over the view the person is on, where the request (or the "not now" left by declining it) is.
 * Once the two are friends it opens the Friends tab instead, where that friend is.
 */
export function alertLink(memory: CommunityMemory, alert: CommunityAlert, over: CommunityPlace): string {
  if (alert.target.kind === "friends" && alert.who && relationship(memory, alert.who) === "friend") return friendsHref("friends", over);
  return alertHref(alert, over);
}

/** What has happened since an alert came in, once it has been dealt with: "Friends now", "You've caught up". */
export type AlertOutcome = { label: string; tone: "ok" | "plain" };

export function alertOutcome(memory: CommunityMemory, alert: CommunityAlert): AlertOutcome | null {
  const target = alert.target;
  if (target.kind === "friends" && alert.who) {
    if (relationship(memory, alert.who) === "friend") return { label: "Friends now", tone: "ok" };
    if (memory.answers[alert.who as IncomingRequestId] === "declined") return { label: "You chose not now", tone: "plain" };
    return null;
  }
  if (target.kind === "group") return memory.read.includes(target.group) ? { label: "You've caught up", tone: "ok" } : null;
  if (target.kind === "space" && target.space === "circle") return memory.seated ? { label: "You took your seat", tone: "ok" } : null;
  return null;
}

/** The line under an alert's title. A message quoted from someone blocked or hidden is left out. */
export function alertDetail(memory: CommunityMemory, alert: CommunityAlert): string | null {
  if (alert.target.kind === "group" && alert.who && !canSee(memory, alert.who)) return null;
  return alert.detail || null;
}

/** Whose face an alert shows: the person it is about, unless they are blocked or hidden. */
export function alertFace(memory: CommunityMemory, alert: CommunityAlert): PersonId | null {
  return alert.who && canSee(memory, alert.who) ? alert.who : null;
}

/** What a screen reader hears for one alert: everything written on it, in order. */
export function alertLabel(alert: CommunityAlert, detail: string | null, isNew: boolean, outcome: AlertOutcome | null): string {
  const parts = [`${alert.title}${isNew ? ", new" : ""}.`];
  if (detail) parts.push(/[.!?]$/.test(detail) ? detail : `${detail}.`);
  parts.push(outcome ? `${alert.when}. ${outcome.label}.` : `${alert.when}.`);
  return parts.join(" ");
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2:30 pm", "8 am": a time on this device's clock. */
export function clockLabel(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""} ${hours < 12 ? "am" : "pm"}`;
}

/** When a break ends: "2:30 pm today", "2:30 pm tomorrow" or "2:30 pm on Tuesday 13 October". */
export function breakEndLabel(until: number, now = Date.now()): string {
  const end = new Date(until);
  const midnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((midnight(end) - midnight(new Date(now))) / 86_400_000);
  const time = clockLabel(end);
  if (days <= 0) return `${time} today`;
  if (days === 1) return `${time} tomorrow`;
  return `${time} on ${DAY_NAMES[end.getDay()]} ${end.getDate()} ${MONTH_NAMES[end.getMonth()]}`;
}

/**
 * Why the Alerts badge is quiet right now, in words, or null when it isn't: a break the person
 * is taking, or their quiet time at night. The alerts themselves are still listed in the panel.
 */
export function quietNote(settings: CommunitySettings, at: Date = new Date()): string | null {
  if (onBreak(settings, at.getTime()) && settings.breakUntil !== null) {
    return `You're taking a break until ${breakEndLabel(settings.breakUntil, at.getTime())}, so the Alerts badge stays quiet. Nothing is deleted.`;
  }
  if (inQuietHours(settings, at)) return `It's quiet time until ${hourLabel(settings.quietUntil)}, so the Alerts badge stays quiet. Your alerts are still here.`;
  return null;
}

/* ------------------------------------------------------------------- find */

// Spaces, and the punctuation found in names ("One-handed cooks", "Li Wei"): the ASCII marks, en
// and em dashes, and curly quotes. Letters from any alphabet are kept, so a group named in
// another language can still be found.
const SEPARATORS = /[\s!-\/:-@\[-`{-~–—‘’“”]+/;
const SEPARATORS_ALL = /[\s!-\/:-@\[-`{-~–—‘’“”]+/g;

/** Lower case, with accents taken off (the combining marks from 0x300 to 0x36F), so "zoe" finds "Zoë". */
export function fold(text: string): string {
  const split = text.normalize("NFD").toLowerCase();
  let folded = "";
  for (let i = 0; i < split.length; i++) {
    const code = split.charCodeAt(i);
    if (code < 0x300 || code > 0x36f) folded += split.charAt(i);
  }
  return folded;
}

/** The words someone typed, folded. Spaces and punctuation only separate them. */
export function queryWords(query: string): string[] {
  return fold(query).split(SEPARATORS).filter(Boolean);
}

const squash = (folded: string) => folded.replace(SEPARATORS_ALL, "");

/**
 * How well a name (and some other words about it) matches what was typed, best first:
 *   0  the name starts with it ("mar" finds Margaret; "liwei" finds Li Wei)
 *   1  every word is in the name, and the first starts one of its words ("gang" finds Garden gang)
 *   2  every word is somewhere in the name
 *   3  every word is in the name or the other words (a town, a note about the place)
 * Null when it doesn't match at all.
 */
export function matchScore(query: string, name: string, extra: string[] = []): number | null {
  const words = queryWords(query);
  if (!words.length) return null;
  const folded = fold(name);
  const whole = squash(words.join(""));
  if (squash(folded).startsWith(whole)) return 0;
  if (words.every(word => folded.includes(word)) || squash(folded).includes(whole)) {
    return folded.split(SEPARATORS).some(part => part.startsWith(words[0])) ? 1 : 2;
  }
  const rest = fold(extra.join(" "));
  return words.every(word => folded.includes(word) || rest.includes(word)) ? 3 : null;
}

/** A name in pieces, with the parts that match what was typed marked, to show why it was found. */
export type NamePiece = { text: string; hit: boolean };

export function highlight(name: string, query: string): NamePiece[] {
  const words = queryWords(query);
  if (!words.length || !name) return [{ text: name, hit: false }];
  // Fold the name a letter at a time, remembering which letter each folded one came from.
  let folded = "";
  const from: number[] = [];
  for (let i = 0; i < name.length; i++) {
    const piece = fold(name.charAt(i));
    for (let k = 0; k < piece.length; k++) { folded += piece.charAt(k); from.push(i); }
  }
  const marks: boolean[] = new Array(name.length).fill(false);
  words.forEach(word => {
    const at = folded.indexOf(word);
    if (at < 0) return;
    for (let k = at; k < at + word.length; k++) marks[from[k]] = true;
  });
  const pieces: NamePiece[] = [];
  for (let i = 0; i < name.length; i++) {
    const last = pieces[pieces.length - 1];
    if (last && last.hit === marks[i]) last.text += name.charAt(i);
    else pieces.push({ text: name.charAt(i), hit: marks[i] });
  }
  return pieces;
}

/** A place in My community that Find can open: a space, a page, or a tab of the Friends drawer. */
export type PlaceId = "feed" | "lounge" | "circle" | "groups" | "messages" | "start" | "friends" | "friends-sent" | "friends-list" | "friends-blocked" | "privacy" | "safety" | "settings";
export type Place = {
  id: PlaceId;
  label: string;
  note: string;
  href: string;
  /** Other words that find it ("quiet" finds Settings). */
  words: string[];
  /** Shown before anything is typed, as one-tap ways in. The rest are found by searching. */
  browse: boolean;
  /** The view it opens, so the one the person is on can say "You're here". */
  space?: CommunitySpace;
};

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Every place, with its links pointing at the Friends drawer over the view the person is on. */
export function communityPlaces(memory: CommunityMemory, over: CommunityPlace): Place[] {
  const waiting = pendingRequestCount(memory);
  const unread = unreadCount(memory);
  const sent = sentList(memory).length;
  const friends = friendList(memory).length;
  const blocked = blockedList(memory).length;
  const letters = unreadMessages(memory);
  return [
    { id: "feed", label: "Feed", note: "Posts from everyone", href: communityHref(), words: ["feed", "posts", "home", "news", "write", "share"], browse: true, space: "feed" },
    { id: "lounge", label: "The lounge", note: "Drop in for a chat", href: communityHref("lounge"), words: ["lounge", "chat", "talk", "live", "tea", "poll"], browse: true, space: "lounge" },
    { id: "circle", label: "Sunday circle", note: memory.seated ? "You have your seat" : "Open now", href: communityHref("circle"), words: ["circle", "sunday", "teacup", "seat", "share", "talk"], browse: true, space: "circle" },
    { id: "groups", label: "My groups", note: unread ? count(unread, "unread message", "unread messages") : "Your group chats", href: communityHref("groups"), words: ["groups", "group", "chats", "messages", "challenge"], browse: true, space: "groups" },
    { id: "messages", label: "Messages", note: letters ? `${count(letters, "conversation", "conversations")} waiting` : "Messages with friends", href: communityHref("messages"), words: ["messages", "message", "inbox", "write", "reply", "private"], browse: true, space: "messages" },
    { id: "start", label: "Start a group", note: "A corner for your people", href: communityHref("start"), words: ["start", "new group", "create", "make", "begin"], browse: true, space: "start" },
    { id: "friends", label: "Friends", note: waiting ? `${count(waiting, "request", "requests")} waiting` : "Friends and requests", href: friendsHref(null, over), words: ["friends", "friend requests", "requests", "for you", "people you may know", "accept"], browse: true },
    { id: "safety", label: "Safety", note: "Reports, blocked and hidden", href: communityHref("safety"), words: ["safety", "report", "reports", "block", "blocked", "unblock", "hide", "hidden", "scam", "help"], browse: true, space: "safety" },
    { id: "settings", label: "Settings", note: "Quiet time, text size and more", href: communityHref("settings"), words: ["settings", "community settings", "quiet", "quiet time", "night", "break", "text size", "bigger text", "gentle mode", "hidden words", "hide words", "picture", "photo", "read aloud", "voice notes", "privacy", "alerts"], browse: true, space: "settings" },
    { id: "friends-sent", label: "Requests you sent", note: sent ? `${sent} waiting for a yes` : "None waiting", href: friendsHref("sent", over), words: ["sent", "requests sent", "friend requests", "cancel", "waiting"], browse: false },
    { id: "friends-list", label: "Your friends", note: count(friends, "friend", "friends"), href: friendsHref("friends", over), words: ["friends", "my friends", "wave", "online"], browse: false },
    { id: "friends-blocked", label: "Blocked people", note: blocked ? `${blocked} blocked` : "No one blocked", href: friendsHref("blocked", over), words: ["blocked", "block", "unblock"], browse: false },
    { id: "privacy", label: "Who can reach you", note: "Your privacy, in Friends", href: communityHref("friends"), words: ["privacy", "who can message", "message me", "who sees", "online", "town"], browse: false, space: "friends" },
  ];
}

export type PersonResult = { who: PersonId; status: Relationship; muted: boolean };
export type GroupResult = { group: GroupModel; sub: string };
export type FindResults = {
  /** What was typed, and its words. With no words, Find shows the places to browse. */
  query: string;
  words: string[];
  people: PersonResult[];
  /** The person's own groups: started, examples and joined. */
  groups: GroupResult[];
  /** Groups they might like and haven't joined. */
  suggested: SampleGroup[];
  places: Place[];
  total: number;
  /** The one-tap places, shown before anything is typed or when nothing is found. */
  browse: Place[];
};

/** Puts the matches first, best first; ties keep their order. */
function ranked<T>(items: T[], score: (item: T) => number | null): T[] {
  return items
    .map((item, index) => ({ item, index, score: score(item) }))
    .filter((entry): entry is { item: T; index: number; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(entry => entry.item);
}

/**
 * Finds the example people, the person's groups, groups they might like, and places, by name.
 * Blocked people are never found (Gary, who has no drawing, isn't one of the people to find).
 */
export function findInCommunity(memory: CommunityMemory, query: string, over: CommunityPlace): FindResults {
  const words = queryWords(query);
  const places = communityPlaces(memory, over);
  const browse = places.filter(place => place.browse);
  if (!words.length) return { query, words, people: [], groups: [], suggested: [], places: [], total: 0, browse };

  const found = {
    people: ranked(PERSON_IDS.filter(who => !isBlocked(memory, who)), who => matchScore(query, people[who].name, [people[who].about]))
      .map((who): PersonResult => ({ who, status: relationship(memory, who), muted: isMuted(memory, who) })),
    groups: ranked(myGroups(memory), group => matchScore(query, group.name, [group.meta, suggestedGroups.find(item => item.id === group.id)?.why ?? "", "group"]))
      .map((group): GroupResult => ({ group, sub: group.kind === "joined" ? `You joined · ${group.meta}` : group.meta })),
    suggested: ranked(suggestedGroups.filter(group => !memory.joined.includes(group.id as SuggestedGroupId)), group => matchScore(query, group.name, [group.why ?? "", "group"])),
    places: ranked(places, place => matchScore(query, place.label, [place.note, ...place.words])),
  };
  const total = found.people.length + found.groups.length + found.suggested.length + found.places.length;
  return { query, words, ...found, total, browse };
}

/** "2 people, 1 group and 1 place", or "Nothing found". */
export function foundLabel(results: Pick<FindResults, "people" | "groups" | "suggested" | "places">): string {
  const groups = results.groups.length + results.suggested.length;
  const parts: string[] = [];
  if (results.people.length) parts.push(count(results.people.length, "person", "people"));
  if (groups) parts.push(count(groups, "group", "groups"));
  if (results.places.length) parts.push(count(results.places.length, "place", "places"));
  if (!parts.length) return "Nothing found";
  return `${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]} found`;
}

/** What a screen reader hears after a friend button in Find changes someone's place with the person. */
export function friendChangeNote(who: PersonId, was: Relationship, now: Relationship): string {
  if (was === now) return "";
  const name = people[who].name;
  if (now === "sent") return `Request sent to ${name}.`;
  if (now === "friend") return `You and ${name} are friends now.`;
  if (now === "none" && was === "sent") return `Request to ${name} cancelled. They won't be told.`;
  return "";
}
