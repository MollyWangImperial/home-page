import { useSyncExternalStore } from "react";
import {
  CIRCLE_IDS,
  FEED_POST_IDS,
  FEELING_IDS,
  GROUP_NAME_LIMIT,
  groupHellos,
  inviteFriends,
  PERSON_IDS,
  POLL_OPTION_IDS,
  REACTION_KINDS,
  SAMPLE_GROUP_IDS,
  sampleGroups,
  SUGGESTED_GROUP_IDS,
  THEME_IDS,
  type FeelingId,
  type PersonId,
  type ReactionKind,
  type SampleGroupId,
  type SuggestedGroupId,
  type ThemeId,
} from "@/content/community-samples";

// My community is a preview: the people in it are examples, and what a person does there stays
// on this device. This file holds the address of each view, and the small record of what the
// person has done (their reactions, waves, votes, groups, seat and posts), kept in this browser.

/* ------------------------------------------------------------------ views */

export type CommunitySpace = "feed" | "lounge" | "circle" | "groups" | "start";
const namedSpaces: CommunitySpace[] = ["lounge", "circle", "groups", "start"];
export type CommunityView = { space: CommunitySpace; group: string | null };

const ID = /^[a-z0-9-]{1,48}$/;
const cleanId = (value: unknown): string | null => (typeof value === "string" && ID.test(value) ? value : null);

/**
 * Which view a link points at:
 *   /community                          the feed
 *   /community?space=lounge             the lounge
 *   /community?space=circle             the Sunday circle
 *   /community?space=groups&group=walk  my groups, with one of them open
 *   /community?space=start              starting a group
 */
export function communityViewFromQuery(search: string): CommunityView {
  const query = new URLSearchParams(search);
  const named = query.get("space") as CommunitySpace | null;
  const space = named && namedSpaces.includes(named) ? named : "feed";
  return { space, group: space === "groups" ? cleanId(query.get("group")) : null };
}

export function communityHref(space?: CommunitySpace | null, group?: string | null): string {
  if (!space || space === "feed") return "/community";
  const id = space === "groups" ? cleanId(group) : null;
  return `/community?space=${space}${id ? `&group=${id}` : ""}`;
}

/* ----------------------------------------------------------------- memory */

export const COMMUNITY_KEY = "rehyn.community.v1";

export type OwnPost = { id: string; text: string; createdAt: number; photo: string | null; voice: boolean; feeling: FeelingId | null; win: boolean };
/** A reply under a post, or a message in a group. */
export type OwnNote = { id: string; text: string; createdAt: number; photo: string | null; voice: boolean };
export type StartedGroup = { id: string; name: string; theme: ThemeId; friends: PersonId[]; open: boolean; createdAt: number; hello: string | null };

export type CommunityMemory = {
  /** "postId:kind", for each reaction switched on. */
  reactions: string[];
  /** Hearts given to messages: "lounge:l1", "group:garden:g2". */
  hearts: string[];
  /** Friend requests to example people. */
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
};

export const LIMITS = { posts: 40, notes: 60, started: 20, postText: 600, noteText: 400, photo: 400_000 } as const;

export function blankCommunityMemory(): CommunityMemory {
  return { reactions: [], hearts: [], friends: [], waves: [], vote: null, seated: false, reminders: [], joined: [], challenges: [], read: [], started: [], posts: [], replies: {}, messages: {} };
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

/**
 * The record lives in memory for the visit and is copied to storage after each change. When the
 * browser blocks storage, or it is full, everything still works until the page is closed.
 */
export function createCommunityStore(access: () => CommunityStorage | null) {
  let memory: CommunityMemory | null = null;
  let seatTakenAt = 0;
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
    save(next);
    notify();
    return next;
  };
  const note = (draft: NoteDraft, now: number, prefix: string): OwnNote | null => {
    const text = clip(draft.text, LIMITS.noteText);
    const photo = cleanPhoto(draft.photo);
    if (!text && !photo) return null;
    return { id: newId(prefix, now), text, createdAt: now, photo, voice: !!draft.voice && !!text };
  };

  return {
    load,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Reads storage again, for when another tab has changed it. */
    refresh() { memory = read(); notify(); },

    toggleReaction: (postId: string, kind: ReactionKind) => change(current =>
      FEED_POST_IDS.includes(postId) ? { ...current, reactions: flip(current.reactions, reactionKey(postId, kind)) } : current),
    hasReaction: (postId: string, kind: ReactionKind) => load().reactions.includes(reactionKey(postId, kind)),
    toggleHeart: (key: string) => change(current => (isHeart(key) ? { ...current, hearts: flip(current.hearts, key) } : current)),
    toggleFriend: (id: PersonId) => change(current => ({ ...current, friends: flip(current.friends, id) })),
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
