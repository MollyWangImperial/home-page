import { useSyncExternalStore } from "react";
import {
  ALERT_IDS,
  BREAK_CHOICES,
  CIRCLE_IDS,
  communityAlerts,
  FEED_POST_IDS,
  FEELING_IDS,
  FRIENDS_TABS,
  GROUP_NAME_LIMIT,
  groupHellos,
  INCOMING_REQUEST_IDS,
  incomingRequests,
  inviteFriends,
  MEMBER_IDS,
  MESSAGES_FROM,
  PERSON_IDS,
  POSTS_SEEN_BY,
  PICTURE_CHOICES,
  POLL_OPTION_IDS,
  REACTION_KINDS,
  REPORT_REASONS,
  REQUESTS_FROM,
  SAMPLE_GROUP_IDS,
  sampleGroups,
  settingsChoices,
  startBlocked,
  startFriends,
  startHiddenWords,
  startSent,
  SUGGESTED_GROUP_IDS,
  TEXT_SIZES,
  THEME_IDS,
  type AlertId,
  type BreakChoice,
  type CommunityAlert,
  type FeelingId,
  type FriendsTab,
  type IncomingRequest,
  type IncomingRequestId,
  type MemberId,
  type MessagesFrom,
  type PostsSeenBy,
  type PersonId,
  type PictureChoice,
  type ReactionKind,
  type ReportReason,
  type RequestsFrom,
  type SampleGroupId,
  type SuggestedGroupId,
  type TextSize,
  type ThemeId,
} from "@/content/community-samples";

// My community is a preview: the people in it are examples, and what a person does there stays
// on this device. This file holds the address of each view, and the small record of what the
// person has done (their reactions, waves, votes, groups, seat and posts, their friends, who they
// have blocked or hidden, their reports and their community settings), kept in this browser.

/* ------------------------------------------------------------------ views */

export type CommunitySpace = "feed" | "lounge" | "circle" | "groups" | "start" | "settings" | "safety";
const namedSpaces: CommunitySpace[] = ["lounge", "circle", "groups", "start", "settings", "safety"];
/** Something that opens over a view. Only the Friends drawer has an address of its own. */
export type CommunityPanel = "friends";
/** The sections of Community settings, in the order the page shows them. */
export type SettingsSection = "appear" | "friends" | "see" | "read" | "quiet";
export const SETTINGS_SECTIONS: SettingsSection[] = ["appear", "friends", "see", "read", "quiet"];
/**
 * The view an address points at. `panel` and `tab` are there only while the Friends drawer is open
 * (`tab` is then always set: "requests" unless the address names another). `section` is there only
 * on Community settings, when a link names the setting it is about ("Quiet time: Change").
 */
export type CommunityView = { space: CommunitySpace; group: string | null; panel?: CommunityPanel; tab?: FriendsTab; section?: SettingsSection };
/** A view without anything open over it. */
export type CommunityPlace = { space: CommunitySpace; group: string | null };

const ID = /^[a-z0-9-]{1,48}$/;
const cleanId = (value: unknown): string | null => (typeof value === "string" && ID.test(value) ? value : null);
const isFriendsTab = (value: unknown): value is FriendsTab => typeof value === "string" && (FRIENDS_TABS as string[]).includes(value);
const isSettingsSection = (value: unknown): value is SettingsSection => typeof value === "string" && (SETTINGS_SECTIONS as string[]).includes(value);

/**
 * Which view a link points at:
 *   /community                                   the feed
 *   /community?space=lounge                      the lounge
 *   /community?space=circle                      the Sunday circle
 *   /community?space=groups&group=walk           my groups, with one of them open
 *   /community?space=start                       starting a group
 *   /community?space=settings                    community settings
 *   /community?space=settings&section=quiet      community settings, at Quiet times
 *   /community?space=safety                      safety: reports, blocked and hidden people
 *   /community?space=lounge&panel=friends&tab=sent   the Friends drawer, open over the lounge
 */
export function communityViewFromQuery(search: string): CommunityView {
  const query = new URLSearchParams(search);
  const named = query.get("space") as CommunitySpace | null;
  const space = named && namedSpaces.includes(named) ? named : "feed";
  const view: CommunityView = { space, group: space === "groups" ? cleanId(query.get("group")) : null };
  const section = query.get("section");
  if (space === "settings" && isSettingsSection(section)) view.section = section;
  if (query.get("panel") === "friends") {
    const tab = query.get("tab");
    view.panel = "friends";
    view.tab = isFriendsTab(tab) ? tab : "requests";
  }
  return view;
}

/**
 * A link to a view. With `panel: "friends"` the Friends drawer opens over that view, at `tab`. On
 * Community settings, `section` opens the section a link is about. Existing calls
 * (`communityHref()`, `communityHref("groups", "walk")`) are unchanged.
 */
export function communityHref(space?: CommunitySpace | null, group?: string | null, open?: { panel?: CommunityPanel | null; tab?: FriendsTab | null; section?: SettingsSection | null }): string {
  const params: string[] = [];
  if (space && space !== "feed" && namedSpaces.includes(space)) params.push(`space=${space}`);
  const id = space === "groups" ? cleanId(group) : null;
  if (id) params.push(`group=${id}`);
  const section = open?.section;
  if (space === "settings" && isSettingsSection(section)) params.push(`section=${section}`);
  if (open?.panel === "friends") {
    params.push("panel=friends");
    if (open.tab && open.tab !== "requests" && isFriendsTab(open.tab)) params.push(`tab=${open.tab}`);
  }
  return params.length ? `/community?${params.join("&")}` : "/community";
}

/** The address of a view, written the one way `communityHref` writes it. */
export function viewHref(view: CommunityView): string {
  return communityHref(view.space, view.group, { panel: view.panel ?? null, tab: view.tab ?? null, section: view.section ?? null });
}

/**
 * Whether a link leads to the view already showing (perhaps at another settings section). Such a
 * link replaces the address rather than adding it again, so Back never seems to do nothing.
 * `search` is the address's query now, as wouter's `useSearch()` gives it.
 */
export function leadsHere(href: string, search: string): boolean {
  const at = href.indexOf("?");
  if ((at < 0 ? href : href.slice(0, at)) !== "/community") return false;
  const there = communityViewFromQuery(at < 0 ? "" : href.slice(at + 1));
  const here = communityViewFromQuery(search);
  return there.space === here.space && there.group === here.group && there.panel === here.panel && there.tab === here.tab;
}

/** The Friends drawer at a tab, open over a view (the feed, unless another is given). */
export function friendsHref(tab?: FriendsTab | null, over?: CommunityPlace | null): string {
  return communityHref(over?.space ?? "feed", over?.group ?? null, { panel: "friends", tab: tab ?? null });
}

/** The same view with the drawer closed. */
export function placeOf(view: CommunityView): CommunityPlace {
  return { space: view.space, group: view.group };
}

/** Where an alert leads. Friends alerts open the drawer over the view the person is on. */
export function alertHref(alert: Pick<CommunityAlert, "target">, over?: CommunityPlace | null): string {
  const target = alert.target;
  if (target.kind === "friends") return friendsHref(target.tab, over);
  if (target.kind === "group") return communityHref("groups", target.group);
  return communityHref(target.space);
}

/* ----------------------------------------------------------------- memory */

export const COMMUNITY_KEY = "rehyn.community.v1";

export type OwnPost = { id: string; text: string; createdAt: number; photo: string | null; voice: boolean; feeling: FeelingId | null; win: boolean };
/** A reply under a post, or a message in a group. */
export type OwnNote = { id: string; text: string; createdAt: number; photo: string | null; voice: boolean };
export type StartedGroup = { id: string; name: string; theme: ThemeId; friends: PersonId[]; open: boolean; createdAt: number; hello: string | null };

export type RequestAnswer = "accepted" | "declined";
/** A report the person made. It is kept on this device; in this preview it is not sent anywhere. */
export type CommunityReport = { id: string; who: MemberId; postId: string | null; reason: ReportReason; note: string; alsoBlock: boolean; createdAt: number };

/** The person's choices on the Community settings page. They apply to My community only. */
export type CommunitySettings = {
  /** How you appear: show your town under your name, a green dot when you are online, and which picture. */
  showTown: boolean;
  showOnline: boolean;
  picture: PictureChoice;
  /** Friends and messages, and who sees the person's own posts in the feed. */
  requestsFrom: RequestsFrom;
  messagesFrom: MessagesFrom;
  postsSeenBy: PostsSeenBy;
  /** What you see: gentle mode covers sad or upsetting posts; heart counts; posts with these words are hidden. */
  gentleMode: boolean;
  showHeartCounts: boolean;
  hiddenWords: string[];
  /** Reading and listening: a Listen button on posts; voice notes with their words written underneath; text size. */
  readAloud: boolean;
  writeOutVoiceNotes: boolean;
  textSize: TextSize;
  /** Quiet times: no alert badges from `quietFrom` (an hour, 19 to 23) until `quietUntil` (8, for 8 am). */
  quietFrom: number;
  quietUntil: number;
  /** A break from My community, and when it ends (null when there is none). */
  breakChoice: BreakChoice;
  breakUntil: number | null;
};

export function defaultCommunitySettings(): CommunitySettings {
  return {
    showTown: true, showOnline: true, picture: "drawn",
    // Posts are for friends to begin with: the more private choice, until the person picks another.
    requestsFrom: "everyone", messagesFrom: "friends", postsSeenBy: "friends",
    gentleMode: true, showHeartCounts: true, hiddenWords: [...startHiddenWords],
    readAloud: false, writeOutVoiceNotes: true, textSize: "normal",
    quietFrom: 21, quietUntil: 8, breakChoice: "none", breakUntil: null,
  };
}

export type CommunityMemory = {
  /** "postId:kind", for each reaction switched on. */
  reactions: string[];
  /** Hearts given to messages: "lounge:l1", "group:garden:g2". */
  hearts: string[];
  /**
   * Friend requests sent from this device. A raw list: who is a friend, asking, asked or blocked
   * is worked out by `relationship()`, so use `requestFriend` and `cancelRequest` to change it.
   */
  friends: PersonId[];
  waves: PersonId[];
  vote: string | null;
  seated: boolean;
  reminders: string[];
  /** Suggested groups joined. */
  joined: SuggestedGroupId[];
  /** Groups whose weekly challenge the person has joined in with. */
  challenges: string[];
  /** Groups whose unread badge has been cleared. */
  read: SampleGroupId[];
  started: StartedGroup[];
  posts: OwnPost[];
  replies: Record<string, OwnNote[]>;
  messages: Record<string, OwnNote[]>;
  /** Answers to the friend requests waiting for the person. A request with no answer is still waiting. */
  answers: Partial<Record<IncomingRequestId, RequestAnswer>>;
  /** Requests sent before this visit (`startSent`) that the person has cancelled. */
  cancelled: PersonId[];
  /** When each request in `friends` was sent. */
  sentAt: Partial<Record<PersonId, number>>;
  /** Who is blocked, and since when. 0 marks someone blocked to begin with (`startBlocked`) who has been unblocked. */
  blocks: Partial<Record<MemberId, number>>;
  /** People whose posts and messages are hidden ("Hide Gary's posts"), and since when. */
  muted: Partial<Record<MemberId, number>>;
  /** Single posts hidden, and since when. */
  hiddenPosts: Partial<Record<string, number>>;
  /** Reports made, newest first. */
  reports: CommunityReport[];
  /** Alerts the person has seen. */
  seenAlerts: AlertId[];
  settings: CommunitySettings;
};

export const LIMITS = { posts: 40, notes: 60, started: 20, postText: 600, noteText: 400, photo: 400_000, reports: 40, reportNote: 400, hiddenWords: 20, hiddenWord: 30 } as const;

export function blankCommunityMemory(): CommunityMemory {
  return {
    reactions: [], hearts: [], friends: [], waves: [], vote: null, seated: false, reminders: [], joined: [], challenges: [], read: [], started: [], posts: [], replies: {}, messages: {},
    answers: {}, cancelled: [], sentAt: {}, blocks: {}, muted: {}, hiddenPosts: {}, reports: [], seenAlerts: [], settings: defaultCommunitySettings(),
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const oneOf = <T extends string>(allowed: readonly T[]) => (value: unknown): value is T => typeof value === "string" && (allowed as readonly string[]).includes(value);

/** The distinct strings in a saved list that pass `keep`, at most `limit` of them. */
function strings<T extends string>(value: unknown, keep: (item: unknown) => item is T, limit = 200): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  value.forEach(item => { if (keep(item) && !out.includes(item) && out.length < limit) out.push(item); });
  return out;
}

const clip = (value: unknown, limit: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "");
const when = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
/** Only small JPEG, PNG or WebP pictures made on this device are kept. Nothing points elsewhere. */
export function cleanPhoto(value: unknown): string | null {
  return typeof value === "string" && value.length <= LIMITS.photo && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : null;
}

const reactionKey = (postId: string, kind: ReactionKind) => `${postId}:${kind}`;
const isReaction = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const [post, kind, extra] = value.split(":");
  return extra === undefined && FEED_POST_IDS.includes(post) && oneOf(REACTION_KINDS)(kind);
};
const isHeart = (value: unknown): value is string => typeof value === "string" && /^(?:lounge|group):[a-z0-9-]{1,48}(?::[a-z0-9-]{1,48})?$/.test(value);
const isId = (value: unknown): value is string => cleanId(value) !== null;

function readNote(value: unknown): OwnNote | null {
  if (!isObject(value)) return null;
  const id = cleanId(value.id);
  const text = clip(value.text, LIMITS.noteText);
  const photo = cleanPhoto(value.photo);
  const createdAt = when(value.createdAt);
  if (!id || !createdAt || (!text && !photo)) return null;
  return { id, text, createdAt, photo, voice: value.voice === true && !!text };
}

function readPost(value: unknown): OwnPost | null {
  if (!isObject(value)) return null;
  const id = cleanId(value.id);
  const text = clip(value.text, LIMITS.postText);
  const photo = cleanPhoto(value.photo);
  const createdAt = when(value.createdAt);
  if (!id || !createdAt || (!text && !photo)) return null;
  return { id, text, createdAt, photo, voice: value.voice === true && !!text, feeling: oneOf(FEELING_IDS)(value.feeling) ? value.feeling : null, win: value.win === true };
}

export function cleanGroupName(value: unknown): string {
  return clip(value, GROUP_NAME_LIMIT) || "Your group";
}

function readStarted(value: unknown): StartedGroup | null {
  if (!isObject(value)) return null;
  const id = cleanId(value.id);
  const createdAt = when(value.createdAt);
  if (!id || !id.startsWith("mine-") || !createdAt || !oneOf(THEME_IDS)(value.theme)) return null;
  return {
    id, createdAt, theme: value.theme, name: cleanGroupName(value.name),
    friends: strings(value.friends, oneOf(inviteFriends)),
    open: value.open === true,
    hello: oneOf(groupHellos)(value.hello) ? value.hello : null,
  };
}

/** A list of notes kept under each known key, newest last, at most `limit` per key. */
function notesByKey(value: unknown, keep: (key: string) => boolean): Record<string, OwnNote[]> {
  const out: Record<string, OwnNote[]> = {};
  if (!isObject(value)) return out;
  Object.keys(value).forEach(key => {
    if (!ID.test(key) || !keep(key) || !Array.isArray(value[key])) return;
    const notes: OwnNote[] = [];
    (value[key] as unknown[]).forEach(item => {
      const note = readNote(item);
      if (note && !notes.some(other => other.id === note.id)) notes.push(note);
    });
    if (notes.length) out[key] = notes.slice(-LIMITS.notes);
  });
  return out;
}

/** Times kept under known keys. With `zero`, a 0 is kept too (it marks someone unblocked). */
function timesByKey<K extends string>(value: unknown, keep: (key: string) => key is K, zero = false): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  if (!isObject(value)) return out;
  Object.keys(value).forEach(key => {
    if (!keep(key)) return;
    const at = value[key];
    if (zero && at === 0) out[key] = 0;
    else if (when(at)) out[key] = when(at);
  });
  return out;
}

/** A word or short phrase to hide: lower case, single spaces, letters, numbers, apostrophes and hyphens. */
export function cleanHiddenWord(value: unknown): string {
  if (typeof value !== "string") return "";
  const word = value.replace(/\s+/g, " ").trim().toLowerCase().slice(0, LIMITS.hiddenWord).trim();
  return /^[a-z0-9À-ɏ][a-z0-9À-ɏ' -]*$/.test(word) ? word : "";
}

function readReport(value: unknown): CommunityReport | null {
  if (!isObject(value)) return null;
  const id = cleanId(value.id);
  const createdAt = when(value.createdAt);
  if (!id || !id.startsWith("report-") || !createdAt || !oneOf(MEMBER_IDS)(value.who) || !oneOf(REPORT_REASONS)(value.reason)) return null;
  const postId = typeof value.postId === "string" && FEED_POST_IDS.includes(value.postId) ? value.postId : null;
  return { id, who: value.who, postId, reason: value.reason, note: clip(value.note, LIMITS.reportNote), alsoBlock: value.alsoBlock === true, createdAt };
}

/**
 * Rebuilds the settings from what was saved (or a change to them), field by field. A field that is
 * missing or not allowed keeps its value in `base`: the defaults, or the settings before a change.
 */
function readSettings(value: unknown, base: CommunitySettings = defaultCommunitySettings()): CommunitySettings {
  const settings: CommunitySettings = { ...base, hiddenWords: [...base.hiddenWords] };
  if (!isObject(value)) return settings;
  (["showTown", "showOnline", "gentleMode", "showHeartCounts", "readAloud", "writeOutVoiceNotes"] as const).forEach(key => {
    const flag = value[key];
    if (typeof flag === "boolean") settings[key] = flag;
  });
  if (oneOf(PICTURE_CHOICES)(value.picture)) settings.picture = value.picture;
  if (oneOf(REQUESTS_FROM)(value.requestsFrom)) settings.requestsFrom = value.requestsFrom;
  if (oneOf(MESSAGES_FROM)(value.messagesFrom)) settings.messagesFrom = value.messagesFrom;
  if (oneOf(POSTS_SEEN_BY)(value.postsSeenBy)) settings.postsSeenBy = value.postsSeenBy;
  if (oneOf(TEXT_SIZES)(value.textSize)) settings.textSize = value.textSize;
  if (Array.isArray(value.hiddenWords)) settings.hiddenWords = strings((value.hiddenWords as unknown[]).map(cleanHiddenWord), (word): word is string => typeof word === "string" && word.length > 0, LIMITS.hiddenWords);
  if (typeof value.quietFrom === "number" && settingsChoices.quietFrom.includes(value.quietFrom)) settings.quietFrom = value.quietFrom;
  if (typeof value.quietUntil === "number" && Number.isInteger(value.quietUntil) && value.quietUntil >= 4 && value.quietUntil <= 11) settings.quietUntil = value.quietUntil;
  const until = when(value.breakUntil);
  if (value.breakChoice === "none") { settings.breakChoice = "none"; settings.breakUntil = null; }
  else if (oneOf(BREAK_CHOICES)(value.breakChoice) && until) { settings.breakChoice = value.breakChoice; settings.breakUntil = until; }
  return settings;
}

/** Rebuilds the record from what was saved, keeping only the fields and values it knows. */
export function parseCommunityMemory(raw: string | null): CommunityMemory {
  const memory = blankCommunityMemory();
  let saved: unknown;
  try { saved = JSON.parse(raw ?? "null"); } catch { return memory; }
  if (!isObject(saved)) return memory;

  memory.reactions = strings(saved.reactions, isReaction);
  memory.hearts = strings(saved.hearts, isHeart, 400);
  memory.friends = strings(saved.friends, oneOf(PERSON_IDS));
  memory.waves = strings(saved.waves, oneOf(PERSON_IDS));
  memory.vote = oneOf(POLL_OPTION_IDS)(saved.vote) ? saved.vote : null;
  memory.seated = saved.seated === true;
  memory.reminders = strings(saved.reminders, oneOf(CIRCLE_IDS));
  memory.joined = strings(saved.joined, oneOf(SUGGESTED_GROUP_IDS));
  memory.read = strings(saved.read, oneOf(SAMPLE_GROUP_IDS));

  if (Array.isArray(saved.started)) {
    (saved.started as unknown[]).forEach(item => {
      const group = readStarted(item);
      if (group && !memory.started.some(other => other.id === group.id) && memory.started.length < LIMITS.started) memory.started.push(group);
    });
  }
  const groupIds: string[] = [...SAMPLE_GROUP_IDS, ...SUGGESTED_GROUP_IDS, ...memory.started.map(group => group.id)];
  memory.challenges = strings(saved.challenges, (value): value is string => isId(value) && groupIds.includes(value));
  memory.messages = notesByKey(saved.messages, key => groupIds.includes(key));
  memory.replies = notesByKey(saved.replies, key => FEED_POST_IDS.includes(key));

  if (Array.isArray(saved.posts)) {
    (saved.posts as unknown[]).forEach(item => {
      const post = readPost(item);
      if (post && !memory.posts.some(other => other.id === post.id)) memory.posts.push(post);
    });
    memory.posts = memory.posts.slice(0, LIMITS.posts);
  }

  if (isObject(saved.answers)) {
    const answers = saved.answers;
    INCOMING_REQUEST_IDS.forEach(id => {
      const answer = answers[id];
      if (answer === "accepted" || answer === "declined") memory.answers[id] = answer;
    });
  }
  memory.cancelled = strings(saved.cancelled, (value): value is PersonId => startSent.some(item => item.who === value));
  memory.sentAt = timesByKey(saved.sentAt, (key): key is PersonId => (memory.friends as string[]).includes(key));
  memory.blocks = timesByKey(saved.blocks, (key): key is MemberId => oneOf(MEMBER_IDS)(key), true);
  (Object.keys(memory.blocks) as MemberId[]).forEach(who => { if (memory.blocks[who] === 0 && !blockedAtStart(who)) delete memory.blocks[who]; });
  memory.muted = timesByKey(saved.muted, (key): key is MemberId => oneOf(MEMBER_IDS)(key));
  memory.hiddenPosts = timesByKey(saved.hiddenPosts, (key): key is string => FEED_POST_IDS.includes(key));
  if (Array.isArray(saved.reports)) {
    (saved.reports as unknown[]).forEach(item => {
      const report = readReport(item);
      if (report && !memory.reports.some(other => other.id === report.id) && memory.reports.length < LIMITS.reports) memory.reports.push(report);
    });
  }
  memory.seenAlerts = strings(saved.seenAlerts, oneOf(ALERT_IDS));
  memory.settings = readSettings(saved.settings);
  return memory;
}

/* ------------------------------------------------------------------ store */

type CommunityStorage = Pick<Storage, "getItem" | "setItem">;
const flip = <T extends string>(list: T[], value: T): T[] => (list.includes(value) ? list.filter(item => item !== value) : [...list, value]);
let counter = 0;
const newId = (prefix: string, now: number) => `${prefix}-${now.toString(36)}-${(counter++ % 1296).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export type PostDraft = { text: string; photo?: string | null; voice?: boolean; feeling?: FeelingId | null; win?: boolean };
export type NoteDraft = { text: string; photo?: string | null; voice?: boolean };
export type GroupDraft = { name: string; theme: ThemeId; friends: PersonId[]; open: boolean };
export type ReportDraft = { who: MemberId; postId?: string | null; reason: ReportReason; note?: string; alsoBlock?: boolean };
/** Who the hide, block or report sheet is about: a post's writer (with the post), or a person on their own. */
export type SafetyTarget = { who: MemberId; postId: string | null };
/** Opens that sheet. `opener` is the ··· button pressed; the focus goes back to it when the sheet closes. */
export type OpenSafetyMenu = (target: SafetyTarget, opener: HTMLElement) => void;
const DAY = 86_400_000;
const removeKey = <K extends string>(record: Partial<Record<K, number>>, key: K): Partial<Record<K, number>> => {
  const next = { ...record };
  delete next[key];
  return next;
};

/**
 * The record lives in memory for the visit and is copied to storage after each change. When the
 * browser blocks storage, or it is full, everything still works until the page is closed.
 */
export function createCommunityStore(access: () => CommunityStorage | null) {
  let memory: CommunityMemory | null = null;
  let seatTakenAt = 0;
  /** Whether the last change reached the browser's storage (false when it is blocked or full). */
  let lastSaveKept = true;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => { try { listener(); } catch { /* one reader cannot stop the others */ } });

  const read = (): CommunityMemory => {
    try { return parseCommunityMemory(access()?.getItem(COMMUNITY_KEY) ?? null); } catch { return blankCommunityMemory(); }
  };
  const load = (): CommunityMemory => memory ?? (memory = read());
  const save = (next: CommunityMemory): boolean => {
    try {
      const storage = access();
      if (!storage) return false;
      storage.setItem(COMMUNITY_KEY, JSON.stringify(next));
      return true;
    } catch { return false; }
  };
  const change = (edit: (current: CommunityMemory) => CommunityMemory): CommunityMemory => {
    const current = load();
    const next = edit(current);
    if (next === current) return current;
    memory = next;
    lastSaveKept = save(next);
    notify();
    return next;
  };
  const note = (draft: NoteDraft, now: number, prefix: string): OwnNote | null => {
    const text = clip(draft.text, LIMITS.noteText);
    const photo = cleanPhoto(draft.photo);
    if (!text && !photo) return null;
    return { id: newId(prefix, now), text, createdAt: now, photo, voice: !!draft.voice && !!text };
  };

  const answer = (who: IncomingRequestId, value: RequestAnswer) => change(current =>
    INCOMING_REQUEST_IDS.includes(who) && current.answers[who] !== value && !isBlocked(current, who) ? { ...current, answers: { ...current.answers, [who]: value } } : current);
  const changeSettings = (current: CommunityMemory, settings: CommunitySettings): CommunityMemory =>
    (JSON.stringify(settings) === JSON.stringify(current.settings) ? current : { ...current, settings });

  return {
    load,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Reads storage again, for when another tab has changed it. */
    refresh() { memory = read(); notify(); },
    /**
     * Whether the last change was kept in the browser's storage. False when storage is blocked or
     * full: the change then lasts only until the page is closed ("Saved for this visit").
     */
    lastSaveKept: () => lastSaveKept,
    /** When this visit began. Something hidden since then can still show an Undo where it was. */
    visitStart: Date.now(),

    toggleReaction: (postId: string, kind: ReactionKind) => change(current =>
      FEED_POST_IDS.includes(postId) ? { ...current, reactions: flip(current.reactions, reactionKey(postId, kind)) } : current),
    hasReaction: (postId: string, kind: ReactionKind) => load().reactions.includes(reactionKey(postId, kind)),
    toggleHeart: (key: string) => change(current => (isHeart(key) ? { ...current, hearts: flip(current.hearts, key) } : current)),
    /**
     * Low level: flips someone in the list of requests sent from this device, whoever they are.
     * Buttons should use `requestFriend` and `cancelRequest`, which know who is already a friend.
     */
    toggleFriend: (id: PersonId, now = Date.now()) => change(current => {
      if (!PERSON_IDS.includes(id)) return current;
      const on = current.friends.includes(id);
      return { ...current, friends: flip(current.friends, id), sentAt: on ? removeKey(current.sentAt, id) : { ...current.sentAt, [id]: now } };
    }),
    /** A wave can't be taken back, like a real one. */
    wave: (id: PersonId) => change(current => (current.waves.includes(id) ? current : { ...current, waves: [...current.waves, id] })),
    vote: (option: string) => change(current => (POLL_OPTION_IDS.includes(option) && current.vote !== option ? { ...current, vote: option } : current)),
    takeSeat: () => change(current => {
      if (current.seated) return current;
      seatTakenAt = Date.now();
      return { ...current, seated: true };
    }),
    /** True for a few seconds after the seat was taken, so the circle can welcome the person in. */
    justSeated: (now = Date.now()) => seatTakenAt > 0 && now - seatTakenAt < 4000,
    toggleReminder: (id: string) => change(current => (CIRCLE_IDS.includes(id) ? { ...current, reminders: flip(current.reminders, id) } : current)),
    toggleJoined: (id: SuggestedGroupId) => change(current => ({ ...current, joined: flip(current.joined, id) })),
    toggleChallenge: (groupId: string) => change(current => ({ ...current, challenges: flip(current.challenges, groupId) })),
    markRead: (id: string) => change(current => (oneOf(SAMPLE_GROUP_IDS)(id) && !current.read.includes(id) ? { ...current, read: [...current.read, id] } : current)),

    startGroup(draft: GroupDraft, now = Date.now()): StartedGroup {
      const group: StartedGroup = {
        id: newId("mine", now), name: cleanGroupName(draft.name), theme: oneOf(THEME_IDS)(draft.theme) ? draft.theme : "chatting",
        friends: strings(draft.friends, oneOf(inviteFriends)), open: draft.open === true, createdAt: now, hello: null,
      };
      change(current => ({ ...current, started: [group, ...current.started].slice(0, LIMITS.started) }));
      return group;
    },
    setGroupHello: (groupId: string, hello: string | null) => change(current => ({
      ...current,
      started: current.started.map(group => (group.id === groupId ? { ...group, hello: hello && groupHellos.includes(hello) ? hello : null } : group)),
    })),
    toggleGroupFriend: (groupId: string, friend: PersonId) => change(current => ({
      ...current,
      started: current.started.map(group => (group.id === groupId && inviteFriends.includes(friend) ? { ...group, friends: flip(group.friends, friend) } : group)),
    })),
    /** Closing a group removes it, with everything said in it, from this device. */
    closeGroup: (groupId: string) => change(current => {
      if (!current.started.some(group => group.id === groupId)) return current;
      const messages = { ...current.messages };
      delete messages[groupId];
      return { ...current, started: current.started.filter(group => group.id !== groupId), challenges: current.challenges.filter(id => id !== groupId), messages };
    }),

    addPost(draft: PostDraft, now = Date.now()): OwnPost | null {
      const text = clip(draft.text, LIMITS.postText);
      const photo = cleanPhoto(draft.photo);
      if (!text && !photo) return null;
      const post: OwnPost = { id: newId("post", now), text, createdAt: now, photo, voice: !!draft.voice && !!text, feeling: oneOf(FEELING_IDS)(draft.feeling) ? draft.feeling : null, win: !!draft.win };
      change(current => ({ ...current, posts: [post, ...current.posts].slice(0, LIMITS.posts) }));
      return post;
    },
    removePost: (id: string) => change(current => (current.posts.some(post => post.id === id) ? { ...current, posts: current.posts.filter(post => post.id !== id) } : current)),

    addReply(postId: string, draft: NoteDraft, now = Date.now()): OwnNote | null {
      if (!FEED_POST_IDS.includes(postId)) return null;
      const reply = note(draft, now, "reply");
      if (!reply) return null;
      change(current => ({ ...current, replies: { ...current.replies, [postId]: [...(current.replies[postId] ?? []), reply].slice(-LIMITS.notes) } }));
      return reply;
    },
    removeReply: (postId: string, id: string) => change(current => {
      const kept = (current.replies[postId] ?? []).filter(reply => reply.id !== id);
      const replies = { ...current.replies };
      if (kept.length) replies[postId] = kept; else delete replies[postId];
      return { ...current, replies };
    }),

    addMessage(groupId: string, draft: NoteDraft, now = Date.now()): OwnNote | null {
      const current = load();
      const known = (SAMPLE_GROUP_IDS as string[]).includes(groupId) || (SUGGESTED_GROUP_IDS as string[]).includes(groupId) || current.started.some(group => group.id === groupId);
      if (!known) return null;
      const message = note(draft, now, "note");
      if (!message) return null;
      change(latest => ({ ...latest, messages: { ...latest.messages, [groupId]: [...(latest.messages[groupId] ?? []), message].slice(-LIMITS.notes) } }));
      return message;
    },
    removeMessage: (groupId: string, id: string) => change(current => {
      const kept = (current.messages[groupId] ?? []).filter(message => message.id !== id);
      const messages = { ...current.messages };
      if (kept.length) messages[groupId] = kept; else delete messages[groupId];
      return { ...current, messages };
    }),

    /* ---------------------------------------------------------- friends */

    acceptRequest: (who: IncomingRequestId) => answer(who, "accepted"),
    /** "Not now". The person who asked is not told. */
    declineRequest: (who: IncomingRequestId) => answer(who, "declined"),
    /** Takes an answer back: the request is waiting again. */
    undoAnswer: (who: IncomingRequestId) => change(current => {
      if (!current.answers[who]) return current;
      const answers = { ...current.answers };
      delete answers[who];
      return { ...current, answers };
    }),
    /**
     * "Add friend". Asks someone to be friends; for someone already asking, it says yes. A request
     * sent before this visit and cancelled is simply sent again ("Undo" in the Sent tab).
     */
    requestFriend: (who: PersonId, now = Date.now()) => change(current => {
      if (!PERSON_IDS.includes(who)) return current;
      const status = relationship(current, who);
      const asked = INCOMING_REQUEST_IDS.find(id => id === who);
      if (asked && (status === "incoming" || (status === "none" && current.answers[asked] === "declined"))) return { ...current, answers: { ...current.answers, [asked]: "accepted" } };
      if (status !== "none") return current;
      if (startSent.some(item => item.who === who)) return { ...current, cancelled: current.cancelled.filter(id => id !== who) };
      return { ...current, friends: [...current.friends, who], sentAt: { ...current.sentAt, [who]: now } };
    }),
    /** Cancels a request the person sent. The other person is not told. */
    cancelRequest: (who: PersonId) => change(current => {
      if (relationship(current, who) !== "sent") return current;
      let next = current;
      if (startSent.some(item => item.who === who) && !next.cancelled.includes(who)) next = { ...next, cancelled: [...next.cancelled, who] };
      if (next.friends.includes(who)) next = { ...next, friends: next.friends.filter(id => id !== who), sentAt: removeKey(next.sentAt, who) };
      return next;
    }),

    /* ----------------------------------------------------------- safety */

    /** Blocking: you and they stop seeing each other in My community. They are not told. */
    block: (who: MemberId, now = Date.now()) => change(current => (MEMBER_IDS.includes(who) && !isBlocked(current, who) ? { ...current, blocks: { ...current.blocks, [who]: now } } : current)),
    unblock: (who: MemberId) => change(current => {
      if (!isBlocked(current, who)) return current;
      return { ...current, blocks: blockedAtStart(who) ? { ...current.blocks, [who]: 0 } : removeKey(current.blocks, who) };
    }),
    /** "Hide Gary's posts": you stop seeing their posts and messages. Nothing else changes. */
    mute: (who: MemberId, now = Date.now()) => change(current => (MEMBER_IDS.includes(who) && !current.muted[who] ? { ...current, muted: { ...current.muted, [who]: now } } : current)),
    unmute: (who: MemberId) => change(current => (current.muted[who] ? { ...current, muted: removeKey(current.muted, who) } : current)),
    /** Hides one example post for this person. */
    hidePost: (postId: string, now = Date.now()) => change(current => (FEED_POST_IDS.includes(postId) && !current.hiddenPosts[postId] ? { ...current, hiddenPosts: { ...current.hiddenPosts, [postId]: now } } : current)),
    unhidePost: (postId: string) => change(current => (current.hiddenPosts[postId] ? { ...current, hiddenPosts: removeKey(current.hiddenPosts, postId) } : current)),
    /**
     * Keeps a report on this device, newest first, and blocks the person too when asked. It does not
     * hide the post: call `hidePost` for that. In this preview a report is not sent anywhere.
     */
    report(draft: ReportDraft, now = Date.now()): CommunityReport | null {
      if (!oneOf(MEMBER_IDS)(draft.who) || !oneOf(REPORT_REASONS)(draft.reason)) return null;
      const postId = draft.postId && FEED_POST_IDS.includes(draft.postId) ? draft.postId : null;
      const made: CommunityReport = { id: newId("report", now), who: draft.who, postId, reason: draft.reason, note: clip(draft.note, LIMITS.reportNote), alsoBlock: !!draft.alsoBlock, createdAt: now };
      change(current => {
        const next = { ...current, reports: [made, ...current.reports].slice(0, LIMITS.reports) };
        return made.alsoBlock && !isBlocked(next, made.who) ? { ...next, blocks: { ...next.blocks, [made.who]: now } } : next;
      });
      return made;
    },
    /** Removes a report from this device's list. */
    removeReport: (id: string) => change(current => (current.reports.some(item => item.id === id) ? { ...current, reports: current.reports.filter(item => item.id !== id) } : current)),

    /* ----------------------------------------------------------- alerts */

    /** Marks alerts as seen (all of them, unless some are named). */
    markAlertsSeen: (ids: AlertId[] = ALERT_IDS) => change(current => {
      const fresh = ids.filter(id => ALERT_IDS.includes(id) && !current.seenAlerts.includes(id));
      return fresh.length ? { ...current, seenAlerts: [...current.seenAlerts, ...fresh] } : current;
    }),

    /* --------------------------------------------------------- settings */

    /** Changes any settings. Each value is checked; anything not allowed keeps its current value. */
    updateSettings: (patch: Partial<CommunitySettings>) => change(current => changeSettings(current, readSettings({ ...current.settings, ...patch }, current.settings))),
    /** Adds a word to hide posts by. False when it is empty, already there, or the list is full. */
    addHiddenWord(word: string): boolean {
      const clean = cleanHiddenWord(word);
      const words = load().settings.hiddenWords;
      if (!clean || words.includes(clean) || words.length >= LIMITS.hiddenWords) return false;
      change(current => changeSettings(current, { ...current.settings, hiddenWords: [...current.settings.hiddenWords, clean] }));
      return true;
    },
    removeHiddenWord: (word: string) => change(current => changeSettings(current, { ...current.settings, hiddenWords: current.settings.hiddenWords.filter(item => item !== word) })),
    /** Starts a break of a day or a week, or ends one ("none"). */
    takeBreak: (choice: BreakChoice, now = Date.now()) => change(current => changeSettings(current, {
      ...current.settings,
      breakChoice: oneOf(BREAK_CHOICES)(choice) ? choice : "none",
      breakUntil: choice === "day" ? now + DAY : choice === "week" ? now + 7 * DAY : null,
    })),
    resetSettings: () => change(current => changeSettings(current, defaultCommunitySettings())),
  };
}

export type CommunityStore = ReturnType<typeof createCommunityStore>;

export const communityStore = createCommunityStore(() => (typeof localStorage === "undefined" ? null : localStorage));

const EMPTY = blankCommunityMemory();
// Another tab can change the record too. One listener reads it again for every component.
let watchers = 0;
const otherTab = (event: StorageEvent) => { if (event.key === COMMUNITY_KEY || event.key === null) communityStore.refresh(); };
function subscribeCommunity(listener: () => void) {
  const unsubscribe = communityStore.subscribe(listener);
  if (watchers++ === 0 && typeof window !== "undefined") window.addEventListener("storage", otherTab);
  return () => {
    unsubscribe();
    if (--watchers === 0 && typeof window !== "undefined") window.removeEventListener("storage", otherTab);
  };
}
export const useCommunity = (): CommunityMemory => useSyncExternalStore(subscribeCommunity, communityStore.load, () => EMPTY);

/* ---------------------------------------------------------------- helpers */

/** Unread messages waiting across the example groups, until each group is opened. */
export function unreadCount(memory: CommunityMemory): number {
  return sampleGroups.reduce((sum, group) => sum + (memory.read.includes(group.id as SampleGroupId) ? 0 : group.unread), 0);
}

/** The first word of the person's name, for "What's new with you, Zak?". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

/** "Just now", "5 minutes ago", "2 hours ago", "Yesterday", then the date. */
export function timeAgo(then: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (hours < 48) return "Yesterday";
  return new Date(then).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

/** Names in a sentence: "Margaret", "Margaret and Joan", "Margaret, Joan and Anne". */
export function listNames(names: string[]): string {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "today", "yesterday", "3 days ago", then "on 3 October": for "Blocked 3 days ago", "Sent today". */
export function daysAgoLabel(then: number, now = Date.now()): string {
  const day = (time: number) => { const date = new Date(time); return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY; };
  const days = Math.max(0, Math.round(day(now) - day(then)));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return `on ${new Date(then).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`;
}

/** "9 pm", "8 am", "12 pm". */
export function hourLabel(hour: number): string {
  const h = ((Math.round(hour) % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;
}

/* ------------------------------------------- friends, safety and alerts */

function blockedAtStart(who: MemberId): boolean {
  return startBlocked.some(item => item.who === who);
}

export function isBlocked(memory: CommunityMemory, who: MemberId): boolean {
  const at = memory.blocks[who];
  return at === undefined ? blockedAtStart(who) : at > 0;
}

/** When someone was blocked (for someone blocked before this visit, worked out from `now`), or null. */
export function blockedSince(memory: CommunityMemory, who: MemberId, now = Date.now()): number | null {
  const at = memory.blocks[who];
  if (at !== undefined) return at > 0 ? at : null;
  const before = startBlocked.find(item => item.who === who);
  return before ? now - before.daysAgo * DAY : null;
}

export const isMuted = (memory: CommunityMemory, who: MemberId): boolean => !!memory.muted[who];
/** Whether someone's posts and messages are shown: they are neither blocked nor hidden. */
export const canSee = (memory: CommunityMemory, who: MemberId): boolean => !isBlocked(memory, who) && !isMuted(memory, who);
/** Whether something hidden at this time was hidden during this visit, so an Undo can still show where it was. */
export const hiddenThisVisit = (at: number | null | undefined): boolean => !!at && at >= communityStore.visitStart;

/**
 * Where someone stands with the person, in this order: blocked; a friend; asking to be friends
 * (a request waiting in "For you"); asked by the person (in "Sent"); or none of these.
 */
export type Relationship = "blocked" | "friend" | "incoming" | "sent" | "none";
export function relationship(memory: CommunityMemory, who: MemberId): Relationship {
  if (isBlocked(memory, who)) return "blocked";
  if (who === "gary") return "none";
  const asked = INCOMING_REQUEST_IDS.find(id => id === who);
  if (startFriends.some(friend => friend.who === who) || (asked && memory.answers[asked] === "accepted")) return "friend";
  if (asked && !memory.answers[asked]) return "incoming";
  if ((startSent.some(item => item.who === who) && !memory.cancelled.includes(who)) || memory.friends.includes(who)) return "sent";
  return "none";
}

export type FriendEntry = { who: PersonId; status: string; online: boolean; isNew: boolean };
/** The person's friends: the ones they had, then requests accepted on this device. Blocked people are left out. */
export function friendList(memory: CommunityMemory): FriendEntry[] {
  const list: FriendEntry[] = startFriends.filter(friend => !isBlocked(memory, friend.who)).map(friend => ({ ...friend, isNew: false }));
  incomingRequests.forEach(request => {
    if (relationship(memory, request.who) === "friend") list.push({ who: request.who, status: "New friend", online: false, isNew: true });
  });
  return list;
}

export type RequestEntry = { request: IncomingRequest; answer: RequestAnswer | null };
/** The requests that came to the person, answered or not (blocked people are left out). */
export function requestList(memory: CommunityMemory): RequestEntry[] {
  return incomingRequests.filter(request => !isBlocked(memory, request.who)).map(request => ({ request, answer: memory.answers[request.who] ?? null }));
}
/** Requests still waiting for an answer: the Friends badge in the toolbar. */
export const pendingRequestCount = (memory: CommunityMemory): number => requestList(memory).filter(entry => entry.answer === null).length;

export type SentEntry = { who: PersonId; at: number; beforeVisit: boolean };
/** Requests the person has sent that are still waiting, newest first. */
export function sentList(memory: CommunityMemory, now = Date.now()): SentEntry[] {
  const list: SentEntry[] = [];
  startSent.forEach(item => { if (relationship(memory, item.who) === "sent" && !memory.cancelled.includes(item.who)) list.push({ who: item.who, at: now - item.daysAgo * DAY, beforeVisit: true }); });
  memory.friends.forEach(who => {
    if (relationship(memory, who) === "sent" && !list.some(entry => entry.who === who)) list.push({ who, at: memory.sentAt[who] ?? now, beforeVisit: false });
  });
  return list.sort((a, b) => b.at - a.at);
}

export type BlockedEntry = { who: MemberId; at: number };
/** Everyone blocked, newest first. */
export function blockedList(memory: CommunityMemory, now = Date.now()): BlockedEntry[] {
  const list: BlockedEntry[] = [];
  MEMBER_IDS.forEach(who => { const at = blockedSince(memory, who, now); if (at !== null && isBlocked(memory, who)) list.push({ who, at }); });
  return list.sort((a, b) => b.at - a.at);
}
/** People whose posts are hidden, newest first. */
export function mutedList(memory: CommunityMemory): BlockedEntry[] {
  return MEMBER_IDS.filter(who => !!memory.muted[who]).map(who => ({ who, at: memory.muted[who] as number })).sort((a, b) => b.at - a.at);
}
/** Single posts hidden, newest first. */
export function hiddenPostList(memory: CommunityMemory): { postId: string; at: number }[] {
  return FEED_POST_IDS.filter(id => !!memory.hiddenPosts[id]).map(postId => ({ postId, at: memory.hiddenPosts[postId] as number })).sort((a, b) => b.at - a.at);
}

/** The first hidden word a text mentions (matched at the start of a word, so "cure" finds "cured", not "secure"). */
export function hiddenWordIn(text: string, words: string[]): string | null {
  const lower = ` ${text.toLowerCase()}`;
  return words.find(word => {
    if (!word) return false;
    let at = lower.indexOf(word);
    while (at > 0) {
      if (!/[a-z0-9À-ɏ]/.test(lower.charAt(at - 1))) return true;
      at = lower.indexOf(word, at + 1);
    }
    return false;
  }) ?? null;
}

/**
 * Whether an example post shows, and if not, why: its writer is blocked, their posts are hidden,
 * the post itself is hidden, or it mentions a hidden word. `at` is when it was hidden (0 for words).
 */
export type PostVisibility = { shown: true } | { shown: false; why: "blocked" | "muted" | "post" | "words"; at: number; word: string | null };
export function postVisibility(memory: CommunityMemory, post: { id: string; who: MemberId; text: string }, now = Date.now()): PostVisibility {
  if (isBlocked(memory, post.who)) return { shown: false, why: "blocked", at: blockedSince(memory, post.who, now) ?? 0, word: null };
  const muted = memory.muted[post.who];
  if (muted) return { shown: false, why: "muted", at: muted, word: null };
  const hidden = memory.hiddenPosts[post.id];
  if (hidden) return { shown: false, why: "post", at: hidden, word: null };
  const word = hiddenWordIn(post.text, memory.settings.hiddenWords);
  return word ? { shown: false, why: "words", at: 0, word } : { shown: true };
}

/** An alert is done once what it was about has been dealt with (the request answered, the group read, the seat taken). */
function alertDone(memory: CommunityMemory, alert: CommunityAlert): boolean {
  const target = alert.target;
  if (target.kind === "friends" && alert.who) return relationship(memory, alert.who) !== "incoming";
  if (target.kind === "group") return memory.read.includes(target.group);
  if (target.kind === "space" && target.space === "circle") return memory.seated;
  return false;
}
export type AlertEntry = { alert: CommunityAlert; isNew: boolean };
/** Every alert, newest first, and whether it is still new (not seen, and not dealt with yet). */
export function alertList(memory: CommunityMemory): AlertEntry[] {
  return communityAlerts.map(alert => ({ alert, isNew: !memory.seenAlerts.includes(alert.id) && !alertDone(memory, alert) }));
}
export const unseenAlertCount = (memory: CommunityMemory): number => alertList(memory).filter(entry => entry.isNew).length;

/** Quiet time: from `quietFrom` in the evening until `quietUntil` in the morning, on this device's clock. */
export function inQuietHours(settings: CommunitySettings, at: Date = new Date()): boolean {
  const hour = at.getHours();
  return settings.quietFrom > settings.quietUntil ? hour >= settings.quietFrom || hour < settings.quietUntil : hour >= settings.quietFrom && hour < settings.quietUntil;
}
export const onBreak = (settings: CommunitySettings, now = Date.now()): boolean => settings.breakChoice !== "none" && settings.breakUntil !== null && now < settings.breakUntil;
/** Alert badges stay quiet during quiet time and during a break. The alerts are still there when opened. */
export const alertsQuiet = (settings: CommunitySettings, at: Date = new Date()): boolean => inQuietHours(settings, at) || onBreak(settings, at.getTime());

/**
 * Shrinks a chosen photo on this device and strips its details (where and when it was taken).
 * Photos are never uploaded: the small copy is kept with the post in this browser.
 */
export async function preparePostPhoto(file: File, longest = 720): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG or WebP photo.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Choose a photo smaller than 12 MB.");
  if (typeof createImageBitmap !== "function") throw new Error("Photos can't be added in this browser.");
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error("This photo couldn't be opened. Try another one."); }
  try {
    if (!bitmap.width || !bitmap.height) throw new Error("This photo couldn't be opened. Try another one.");
    const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This photo couldn't be opened. Try another one.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    for (const quality of [0.8, 0.65, 0.5]) {
      const photo = cleanPhoto(canvas.toDataURL("image/jpeg", quality));
      if (photo) return photo;
    }
    throw new Error("This photo is too detailed to keep. Try another one.");
  } finally { bitmap.close(); }
}
