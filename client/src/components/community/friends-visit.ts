import { useSyncExternalStore } from "react";
import {
  INCOMING_REQUEST_IDS,
  incomingRequests,
  startFriends,
  type IncomingRequest,
  type IncomingRequestId,
  type MemberId,
  type PersonId,
} from "@/content/community-samples";
import {
  blockedList,
  blockedSince,
  communityStore,
  friendList,
  isBlocked,
  isMuted,
  relationship,
  requestList,
  sentList,
  type CommunityMemory,
  type FriendEntry,
  type RequestAnswer,
} from "@/lib/community-store";

// The Friends drawer (F4) keeps a row where it was, with an Undo, after something is done to it:
// a request answered, a sent request cancelled, someone unblocked. The community store keeps the
// real record; this only remembers what was done in the drawer during this visit, so the rows are
// still there if the drawer is closed and opened again. It lasts until the page is reloaded and is
// never saved anywhere.

export type FriendsVisit = {
  /** Requests answered in the drawer during this visit. Their card stays: friends now, or not now. */
  answered: IncomingRequestId[];
  /** Sent requests cancelled during this visit, with when each was sent (so Undo puts it back as it was). */
  cancelled: { who: PersonId; at: number }[];
  /** People unblocked during this visit, with when each was blocked (so Undo blocks them from then again). */
  unblocked: { who: MemberId; at: number }[];
};

const EMPTY_VISIT: FriendsVisit = { answered: [], cancelled: [], unblocked: [] };

export function createFriendsVisit() {
  let state: FriendsVisit = EMPTY_VISIT;
  const listeners = new Set<() => void>();
  const set = (next: FriendsVisit) => {
    state = next;
    listeners.forEach(listener => listener());
  };
  return {
    read: (): FriendsVisit => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    answered(who: IncomingRequestId) {
      if (!state.answered.includes(who)) set({ ...state, answered: [...state.answered, who] });
    },
    cancelled(who: PersonId, at: number) {
      set({ ...state, cancelled: [...state.cancelled.filter(item => item.who !== who), { who, at }] });
    },
    resent(who: PersonId) {
      if (state.cancelled.some(item => item.who === who)) set({ ...state, cancelled: state.cancelled.filter(item => item.who !== who) });
    },
    unblocked(who: MemberId, at: number) {
      set({ ...state, unblocked: [...state.unblocked.filter(item => item.who !== who), { who, at }] });
    },
    reblocked(who: MemberId) {
      if (state.unblocked.some(item => item.who === who)) set({ ...state, unblocked: state.unblocked.filter(item => item.who !== who) });
    },
    clear() { set(EMPTY_VISIT); },
  };
}

export type FriendsVisitStore = ReturnType<typeof createFriendsVisit>;
export const friendsVisit = createFriendsVisit();
export const useFriendsVisit = (): FriendsVisit => useSyncExternalStore(friendsVisit.subscribe, friendsVisit.read, () => EMPTY_VISIT);

/* ------------------------------------------------------------- the rows */

export type RequestCardState = "pending" | RequestAnswer;
export type RequestCard = { request: IncomingRequest; state: RequestCardState };

/**
 * The cards in "For you": every request still waiting, every request the person said "not now" to
 * (a line with Undo, so they can change their mind, and so the request's alert still leads to it),
 * and the requests accepted in this visit (a "friends now" card). Requests accepted before this
 * visit have gone: those friends are in the Friends tab. Requests from blocked people are left out.
 */
export function requestCards(memory: CommunityMemory, visit: FriendsVisit): RequestCard[] {
  return requestList(memory).flatMap(({ request, answer }): RequestCard[] => {
    if (answer === null) return [{ request, state: "pending" }];
    return answer === "declined" || visit.answered.includes(request.who) ? [{ request, state: answer }] : [];
  });
}

export type SentRow = { who: PersonId; at: number; cancelled: boolean };

/** The Sent tab: requests still waiting for a yes, and the ones cancelled in this visit, newest first. */
export function sentRows(memory: CommunityMemory, visit: FriendsVisit, now = Date.now()): SentRow[] {
  const rows: SentRow[] = sentList(memory, now).map(entry => ({ who: entry.who, at: entry.at, cancelled: false }));
  visit.cancelled.forEach(item => {
    if (!rows.some(row => row.who === item.who) && relationship(memory, item.who) === "none") rows.push({ who: item.who, at: item.at, cancelled: true });
  });
  return rows.sort((a, b) => b.at - a.at);
}

export type BlockedRow = { who: MemberId; at: number; unblocked: boolean };

/** The Blocked tab: everyone blocked, and the people unblocked in this visit, newest block first. */
export function blockedRows(memory: CommunityMemory, visit: FriendsVisit, now = Date.now()): BlockedRow[] {
  const rows: BlockedRow[] = blockedList(memory, now).map(entry => ({ who: entry.who, at: entry.at, unblocked: false }));
  visit.unblocked.forEach(item => {
    if (!rows.some(row => row.who === item.who) && !isBlocked(memory, item.who)) rows.push({ who: item.who, at: item.at, unblocked: true });
  });
  return rows.sort((a, b) => b.at - a.at);
}

/** A friend, or someone who was a friend until they were blocked during this visit (`blockedAt`). */
export type FriendRow = FriendEntry & { muted: boolean; blockedAt: number | null };

const friendOrder: PersonId[] = [...startFriends.map(friend => friend.who), ...incomingRequests.map(request => request.who)];

/** A friend if it weren't for a block: one of the friends from the start, or a request accepted. */
function befriended(memory: CommunityMemory, who: PersonId): boolean {
  return startFriends.some(friend => friend.who === who) || INCOMING_REQUEST_IDS.some(id => id === who && memory.answers[id] === "accepted");
}

/**
 * The Friends tab, always in the same order. A friend blocked since `since` (this visit) keeps
 * their place, marked blocked with an Undo, so the ··· button that opened the block is still there.
 */
export function friendRows(memory: CommunityMemory, since = communityStore.visitStart, now = Date.now()): FriendRow[] {
  const friends = friendList(memory);
  const order = [...friendOrder, ...friends.map(friend => friend.who).filter(who => !friendOrder.includes(who))];
  return order.flatMap((who): FriendRow[] => {
    const entry = friends.find(friend => friend.who === who);
    if (entry) return [{ ...entry, muted: isMuted(memory, who), blockedAt: null }];
    const at = blockedSince(memory, who, now);
    if (at !== null && at >= since && isBlocked(memory, who) && befriended(memory, who)) {
      return [{ who, status: "", online: false, isNew: false, muted: isMuted(memory, who), blockedAt: at }];
    }
    return [];
  });
}
