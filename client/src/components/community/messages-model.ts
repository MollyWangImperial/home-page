import { useSyncExternalStore } from "react";
import { conversations, newConversation, people, PERSON_IDS, sampleGroups, startFriends, type Conversation, type PersonId } from "@/content/community-samples";
import { canSee, communityStore, friendList, relationship, type CommunityMemory, type NoteDraft, type OwnNote } from "@/lib/community-store";
import { lastLine, myGroups, type GroupModel } from "./group-model";

// Messages (the Messages tab and the little window at the bottom of each page): conversations with
// friends, and the person's groups. The friends' words are examples. What the person writes is kept
// on this device, and a friend's answer to it is an example that arrives during this visit only.

const MINUTE = 60_000;

/** One line in a conversation. `removable` lines are the person's own, kept on this device. */
export type ChatLine =
  | { kind: "theirs"; id: string; at: number; who: PersonId; text: string; voice: { seconds: number } | null }
  | { kind: "mine"; id: string; at: number; note: Pick<OwnNote, "text" | "photo" | "voice">; removable: boolean };

export type DirectChat = {
  kind: "direct";
  id: PersonId;
  name: string;
  conversation: Conversation | null;
  lines: ChatLine[];
  /** Lines from them still waiting to be read. */
  unread: number;
  muted: boolean;
  lastAt: number;
  /** The newest line, for the row in the list: "I kept the best one for you." */
  snippet: string;
  /** "Online now", "Active 1 hour ago". */
  status: string;
  online: boolean;
};
export type GroupChat = { kind: "group"; id: string; name: string; group: GroupModel; unread: number; lastAt: number; snippet: string };
export type Chat = DirectChat | GroupChat;

/* ------------------------------------------------------- this visit only */

/** A friend's answer, after the person writes to them: first "is writing", then the words. */
type ChatVisit = { replied: Partial<Record<PersonId, number>>; typing: PersonId | null };
const EMPTY_VISIT: ChatVisit = { replied: {}, typing: null };

export function createChatVisit() {
  let state: ChatVisit = EMPTY_VISIT;
  let timers: number[] = [];
  const listeners = new Set<() => void>();
  const set = (next: ChatVisit) => { state = next; listeners.forEach(listener => listener()); };
  return {
    read: (): ChatVisit => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** The person wrote to `who`. Once a visit, they write back. */
    wrote(who: PersonId) {
      if (typeof window === "undefined" || state.replied[who] !== undefined || state.typing === who) return;
      timers.push(window.setTimeout(() => set({ ...state, typing: who }), 1200));
      timers.push(window.setTimeout(() => set({ replied: { ...state.replied, [who]: Date.now() }, typing: state.typing === who ? null : state.typing }), 3800));
    },
    clear() { timers.forEach(timer => window.clearTimeout(timer)); timers = []; set(EMPTY_VISIT); },
  };
}
export const chatVisit = createChatVisit();
export const useChatVisit = (): ChatVisit => useSyncExternalStore(chatVisit.subscribe, chatVisit.read, () => EMPTY_VISIT);

/** Writes to a friend. Unless the person has turned new messages off, the friend answers, once a visit. */
export function sendDirect(memory: CommunityMemory, who: PersonId, draft: NoteDraft): OwnNote | null {
  const note = communityStore.addDirect(who, draft);
  if (note && memory.settings.messagesFrom !== "noOne") chatVisit.wrote(who);
  return note;
}

/* ---------------------------------------------------------- conversations */

const statusOf = (memory: CommunityMemory, who: PersonId) => friendList(memory).find(friend => friend.who === who) ?? startFriends.find(friend => friend.who === who) ?? null;

function directChat(memory: CommunityMemory, who: PersonId, visit: ChatVisit, since: number): DirectChat {
  const conversation = conversations.find(item => item.who === who) ?? null;
  const lines: ChatLine[] = [
    ...(conversation?.lines ?? []).map((line): ChatLine => (line.from === "them"
      ? { kind: "theirs", id: line.id, at: since - line.minutesAgo * MINUTE, who, text: line.text, voice: line.voice ?? null }
      : { kind: "mine", id: line.id, at: since - line.minutesAgo * MINUTE, note: { text: line.text, photo: null, voice: false }, removable: false })),
    ...(memory.direct[who] ?? []).map((note): ChatLine => ({ kind: "mine", id: note.id, at: note.createdAt, note, removable: true })),
  ];
  const replied = visit.replied[who];
  if (replied !== undefined) lines.push({ kind: "theirs", id: `reply-${who}`, at: replied, who, text: conversation?.reply ?? newConversation.reply, voice: null });
  lines.sort((a, b) => a.at - b.at);
  const last = lines[lines.length - 1];
  const name = people[who].name;
  const snippet = !last ? "Say hello" : last.kind === "theirs" ? (last.voice ? `Voice message · 0:${String(last.voice.seconds).padStart(2, "0")}` : last.text) : `You: ${last.note.voice ? "a voice note" : last.note.text || "a photo"}`;
  const status = statusOf(memory, who);
  return {
    kind: "direct", id: who, name, conversation, lines,
    unread: memory.chatsRead.includes(who) ? 0 : conversation?.unread ?? 0,
    muted: memory.chatsMuted.includes(who),
    lastAt: last?.at ?? 0, snippet,
    status: status?.status ?? people[who].about, online: !!status?.online,
  };
}

/**
 * Conversations with friends, newest first: the examples, and any the person started. Someone
 * blocked, or whose posts and messages are hidden, is out of sight here too.
 */
export function directChats(memory: CommunityMemory, visit: ChatVisit = EMPTY_VISIT, since = communityStore.visitStart): DirectChat[] {
  const started = PERSON_IDS.filter(who => (memory.direct[who]?.length ?? 0) > 0 && !conversations.some(item => item.who === who));
  return [...conversations.map(item => item.who), ...started]
    .filter(who => canSee(memory, who))
    .map(who => directChat(memory, who, visit, since))
    .sort((a, b) => b.lastAt - a.lastAt);
}

/** The person's groups, as conversations. */
export function groupChats(memory: CommunityMemory, since = communityStore.visitStart): GroupChat[] {
  return myGroups(memory, since).map(group => {
    const own = memory.messages[group.id] ?? [];
    const lastAt = Math.max(group.lastAt, ...own.map(note => note.createdAt));
    return { kind: "group", id: group.id, name: group.name, group, unread: group.unread, lastAt, snippet: lastLine(group, memory, null, who => people[who].name, who => canSee(memory, who)) };
  });
}

/**
 * The conversation a link names: a friend (one the person already talks to, or any friend in
 * sight, for a new conversation) or one of their groups. Null for anyone else.
 */
export function chatById(memory: CommunityMemory, id: string | null | undefined, visit: ChatVisit = EMPTY_VISIT, since = communityStore.visitStart): Chat | null {
  if (!id) return null;
  if ((PERSON_IDS as string[]).includes(id)) {
    const who = id as PersonId;
    const talking = conversations.some(item => item.who === who) || (memory.direct[who]?.length ?? 0) > 0;
    return canSee(memory, who) && (talking || canWrite(memory, who)) ? directChat(memory, who, visit, since) : null;
  }
  return groupChats(memory, since).find(chat => chat.id === id) ?? null;
}

/** Every conversation, newest first. */
export function allChats(memory: CommunityMemory, visit: ChatVisit = EMPTY_VISIT, since = communityStore.visitStart): Chat[] {
  return [...directChats(memory, visit, since), ...groupChats(memory, since)].sort((a, b) => b.lastAt - a.lastAt);
}

/** Friends the person could start a conversation with (anyone they already talk to opens that conversation). */
export function friendsToMessage(memory: CommunityMemory): PersonId[] {
  return friendList(memory).map(friend => friend.who).filter(who => canSee(memory, who));
}

/** Conversations with friends waiting to be read, for the Messages tab and the window at the bottom. Muted ones count for nothing. */
export function unreadMessages(memory: CommunityMemory): number {
  return directChats(memory).filter(chat => !chat.muted && chat.unread > 0).length;
}

/** The groups a friend shares with the person. */
export function groupsWith(who: PersonId): GroupModel["id"][] {
  return sampleGroups.filter(group => group.faces.includes(who)).map(group => group.id);
}

/** The person's other friends who share a group with this one. */
export function mutualFriends(memory: CommunityMemory, who: PersonId): PersonId[] {
  const shared = groupsWith(who);
  return friendList(memory).map(friend => friend.who).filter(other => other !== who && canSee(memory, other) && sampleGroups.some(group => shared.includes(group.id) && group.faces.includes(other)));
}

/** Whether a friend can be written to: they are a friend, and in sight. */
export const canWrite = (memory: CommunityMemory, who: PersonId) => relationship(memory, who) === "friend" && canSee(memory, who);

/** What day a line was said, for the little label above each day's lines: "Today", "Yesterday", "Tuesday". */
export function dayLabel(then: number, now = Date.now()): string {
  const day = (time: number) => { const date = new Date(time); return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000; };
  const days = Math.round(day(now) - day(then));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(then).toLocaleDateString("en-GB", days < 7 ? { weekday: "long" } : { day: "numeric", month: "long" });
}
