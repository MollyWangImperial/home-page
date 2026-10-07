import { afterEach, describe, expect, it, vi } from "vitest";
import {
  alertHref,
  alertList,
  alertsQuiet,
  blankCommunityMemory,
  blockedList,
  blockedSince,
  canSee,
  cleanGroupName,
  cleanHiddenWord,
  COMMUNITY_KEY,
  communityHref,
  communityViewFromQuery,
  createCommunityStore,
  daysAgoLabel,
  defaultCommunitySettings,
  firstName,
  friendList,
  friendsHref,
  hiddenPostList,
  hiddenWordIn,
  hourLabel,
  inQuietHours,
  isBlocked,
  leadsHere,
  listNames,
  mutedList,
  onBreak,
  parseCommunityMemory,
  pendingRequestCount,
  placeOf,
  postVisibility,
  preparePostPhoto,
  relationship,
  requestList,
  sentList,
  timeAgo,
  unreadCount,
  unseenAlertCount,
  viewHref,
} from "./community-store";
import { communityAlerts, feedPosts, inviteFriends, sampleGroups } from "@/content/community-samples";

afterEach(() => { vi.unstubAllGlobals(); });

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(COMMUNITY_KEY, initial);
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}
const saved = (storage: ReturnType<typeof memoryStorage>) => JSON.parse(storage.values.get(COMMUNITY_KEY) ?? "null");
const NOW = Date.UTC(2026, 9, 6, 10, 0);

describe("My community addresses", () => {
  it("reads each view from the query string and builds links back to it", () => {
    expect(communityViewFromQuery("")).toEqual({ space: "feed", group: null });
    expect(communityViewFromQuery("space=lounge")).toEqual({ space: "lounge", group: null });
    expect(communityViewFromQuery("space=circle")).toEqual({ space: "circle", group: null });
    expect(communityViewFromQuery("space=groups&group=walk")).toEqual({ space: "groups", group: "walk" });
    expect(communityViewFromQuery("space=start&group=walk")).toEqual({ space: "start", group: null });
    expect(communityViewFromQuery("space=somewhere")).toEqual({ space: "feed", group: null });
    expect(communityViewFromQuery("space=groups&group=../../etc")).toEqual({ space: "groups", group: null });
    expect(communityHref()).toBe("/community");
    expect(communityHref("feed")).toBe("/community");
    expect(communityHref("lounge")).toBe("/community?space=lounge");
    expect(communityHref("groups", "garden")).toBe("/community?space=groups&group=garden");
    expect(communityHref("groups", "<script>")).toBe("/community?space=groups");
    expect(communityHref("start", "garden")).toBe("/community?space=start");
    expect(communityViewFromQuery(communityHref("groups", "mine-abc").split("?")[1])).toEqual({ space: "groups", group: "mine-abc" });
  });

  it("has addresses for settings, safety and the Friends drawer over any view", () => {
    expect(communityViewFromQuery("space=settings")).toEqual({ space: "settings", group: null });
    expect(communityViewFromQuery("space=safety")).toEqual({ space: "safety", group: null });
    expect(communityHref("settings")).toBe("/community?space=settings");
    expect(communityHref("safety")).toBe("/community?space=safety");

    expect(communityViewFromQuery("panel=friends")).toEqual({ space: "feed", group: null, panel: "friends", tab: "requests" });
    expect(communityViewFromQuery("space=lounge&panel=friends&tab=sent")).toEqual({ space: "lounge", group: null, panel: "friends", tab: "sent" });
    expect(communityViewFromQuery("space=groups&group=walk&panel=friends&tab=blocked")).toEqual({ space: "groups", group: "walk", panel: "friends", tab: "blocked" });
    expect(communityViewFromQuery("panel=friends&tab=enemies")).toMatchObject({ panel: "friends", tab: "requests" });
    expect(communityViewFromQuery("panel=secrets&tab=sent")).toEqual({ space: "feed", group: null });

    expect(communityHref(null, null, { panel: "friends" })).toBe("/community?panel=friends");
    expect(communityHref("lounge", null, { panel: "friends", tab: "sent" })).toBe("/community?space=lounge&panel=friends&tab=sent");
    expect(communityHref("groups", "walk", { panel: "friends", tab: "requests" })).toBe("/community?space=groups&group=walk&panel=friends");
    expect(communityHref("settings", null, { panel: null, tab: "sent" })).toBe("/community?space=settings");
    expect(friendsHref()).toBe("/community?panel=friends");
    expect(friendsHref("blocked", { space: "safety", group: null })).toBe("/community?space=safety&panel=friends&tab=blocked");

    const view = communityViewFromQuery("space=groups&group=garden&panel=friends&tab=friends");
    expect(placeOf(view)).toEqual({ space: "groups", group: "garden" });
    expect(communityViewFromQuery(friendsHref(view.tab, placeOf(view)).split("?")[1])).toEqual(view);
  });

  it("names a section of Community settings, and only there", () => {
    expect(communityViewFromQuery("space=settings&section=quiet")).toEqual({ space: "settings", group: null, section: "quiet" });
    expect(communityViewFromQuery("space=settings&section=secrets")).toEqual({ space: "settings", group: null });
    expect(communityViewFromQuery("space=safety&section=quiet")).toEqual({ space: "safety", group: null });
    expect(communityViewFromQuery("section=see")).toEqual({ space: "feed", group: null });
    expect(communityHref("settings", null, { section: "quiet" })).toBe("/community?space=settings&section=quiet");
    expect(communityHref("settings", null, { section: "friends", panel: "friends", tab: "sent" })).toBe("/community?space=settings&section=friends&panel=friends&tab=sent");
    expect(communityHref("safety", null, { section: "quiet" })).toBe("/community?space=safety");
    for (const query of ["space=settings&section=see", "space=settings&section=friends&panel=friends&tab=sent", "space=groups&group=walk&panel=friends", "", "space=lounge"]) {
      expect(viewHref(communityViewFromQuery(query))).toBe(query ? `/community?${query}` : "/community");
    }
  });

  it("knows when a link leads to the view already showing", () => {
    expect(leadsHere("/community", "")).toBe(true);
    expect(leadsHere("/community", "space=lounge")).toBe(false);
    expect(leadsHere("/community?space=settings&section=quiet", "space=settings")).toBe(true);
    expect(leadsHere("/community?space=settings", "space=settings&section=see")).toBe(true);
    expect(leadsHere("/community?space=settings&section=friends", "space=settings&panel=friends")).toBe(false);
    expect(leadsHere("/community?space=groups&group=walk", "space=groups&group=walk")).toBe(true);
    expect(leadsHere("/community?space=groups&group=garden", "space=groups&group=walk")).toBe(false);
    expect(leadsHere("/community?panel=friends&tab=sent", "panel=friends&tab=sent")).toBe(true);
    expect(leadsHere("/community?panel=friends&tab=sent", "panel=friends")).toBe(false);
    expect(leadsHere("/alira", "")).toBe(false);
    expect(leadsHere("/community-art/face.svg", "")).toBe(false);
  });

  it("sends each alert to the right place", () => {
    const over = { space: "lounge" as const, group: null };
    const href = (id: string) => alertHref(communityAlerts.find(alert => alert.id === id)!, over);
    expect(href("a-joan")).toBe("/community?space=lounge&panel=friends");
    expect(href("a-liwei")).toBe("/community?space=lounge&panel=friends");
    expect(href("a-garden")).toBe("/community?space=groups&group=garden");
    expect(href("a-circle")).toBe("/community?space=circle");
  });
});

describe("loading what was saved", () => {
  it("starts afresh from missing, broken or unexpected data", () => {
    for (const raw of [null, "", "{broken", "null", "42", "\"text\"", "[]"]) expect(parseCommunityMemory(raw)).toEqual(blankCommunityMemory());
    const store = createCommunityStore(() => memoryStorage("{not json"));
    expect(store.load()).toEqual(blankCommunityMemory());
  });

  it("rebuilds only the fields and values it knows", () => {
    const post = feedPosts[0].id;
    const memory = parseCommunityMemory(JSON.stringify({
      extra: "ignored",
      reactions: [`${post}:love`, `${post}:love`, `${post}:shout`, "p-nobody:love", `${post}:love:again`, 7],
      hearts: ["lounge:l1", "group:garden:g2", "javascript:alert(1)", { key: "lounge:l2" }],
      friends: ["margaret", "zak", "__proto__"],
      waves: "tomasz",
      vote: "whisky",
      seated: "yes",
      reminders: ["words", "midnight"],
      joined: ["knit", "garden"],
      read: ["garden", "knit"],
      challenges: ["walk", "mine-gone", "book"],
      started: [
        { id: "mine-one", name: "  Tea   and  cake  ", theme: "chatting", friends: ["joan", "tomasz", "joan"], open: true, createdAt: NOW, hello: "Who has news?" },
        { id: "mine-two", name: "", theme: "skydiving", friends: [], createdAt: NOW },
        { id: "not-mine", name: "Taken", theme: "books", friends: [], createdAt: NOW },
        { id: "mine-three", name: "x".repeat(90), theme: "books", friends: "everyone", createdAt: "yesterday" },
        { id: "mine-four", name: "Readers", theme: "books", friends: [], createdAt: NOW, hello: "Buy now!" },
      ],
      posts: [
        { id: "post-a", text: "  Tomatoes!  ", createdAt: NOW, photo: "https://example.com/spy.png", voice: true, feeling: "proud", win: true, owner: "someone" },
        { id: "post-b", text: "", createdAt: NOW, photo: null },
        { id: "post-c", text: "No date" },
        { id: "POST D", text: "Bad id", createdAt: NOW },
        { id: "post-e", text: "Feeling odd", createdAt: NOW, feeling: "giddy", voice: "yes" },
      ],
      replies: { [post]: [{ id: "reply-1", text: "Lovely", createdAt: NOW }, { id: "reply-1", text: "Twice", createdAt: NOW }], "p-nobody": [{ id: "reply-2", text: "Hi", createdAt: NOW }] },
      messages: { garden: [{ id: "note-1", text: "Hello", createdAt: NOW, voice: true }], "mine-one": [{ id: "note-2", text: "", createdAt: NOW, photo: "data:image/svg+xml;base64,PHN2Zz4=" }], unknown: [{ id: "note-3", text: "Hi", createdAt: NOW }] },
    }));

    expect(memory).not.toHaveProperty("extra");
    expect(memory.reactions).toEqual([`${post}:love`]);
    expect(memory.hearts).toEqual(["lounge:l1", "group:garden:g2"]);
    expect(memory.friends).toEqual(["margaret"]);
    expect(memory.waves).toEqual([]);
    expect(memory.vote).toBeNull();
    expect(memory.seated).toBe(false);
    expect(memory.reminders).toEqual(["words"]);
    expect(memory.joined).toEqual(["knit"]);
    expect(memory.read).toEqual(["garden"]);
    expect(memory.started.map(group => group.id)).toEqual(["mine-one", "mine-four"]);
    expect(memory.started[0]).toEqual({ id: "mine-one", name: "Tea and cake", theme: "chatting", friends: ["joan"], open: true, createdAt: NOW, hello: "Who has news?" });
    expect(memory.started[1].hello).toBeNull();
    expect(memory.challenges).toEqual(["walk", "book"]);
    expect(memory.posts).toEqual([
      { id: "post-a", text: "Tomatoes!", createdAt: NOW, photo: null, voice: true, feeling: "proud", win: true },
      { id: "post-e", text: "Feeling odd", createdAt: NOW, photo: null, voice: false, feeling: null, win: false },
    ]);
    expect(memory.replies).toEqual({ [post]: [{ id: "reply-1", text: "Lovely", createdAt: NOW, photo: null, voice: false }] });
    expect(memory.messages).toEqual({ garden: [{ id: "note-1", text: "Hello", createdAt: NOW, photo: null, voice: true }] });
  });

  it("keeps a group name readable and short", () => {
    expect(cleanGroupName("  Morning   walkers ")).toBe("Morning walkers");
    expect(cleanGroupName("   ")).toBe("Your group");
    expect(cleanGroupName(undefined)).toBe("Your group");
    expect(cleanGroupName("y".repeat(80))).toHaveLength(40);
  });
});

describe("when the browser blocks storage", () => {
  it("still works for the visit when reading and writing both fail", () => {
    const blocked = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); } };
    const store = createCommunityStore(() => blocked);
    expect(store.load()).toEqual(blankCommunityMemory());
    store.toggleReaction(feedPosts[1].id, "withyou");
    store.vote("tea");
    store.takeSeat();
    const group = store.startGroup({ name: "Night owls", theme: "chatting", friends: ["anne"], open: false }, NOW);
    expect(store.load().reactions).toEqual([`${feedPosts[1].id}:withyou`]);
    expect(store.load().vote).toBe("tea");
    expect(store.load().seated).toBe(true);
    expect(store.load().started[0]).toMatchObject({ id: group.id, name: "Night owls" });
  });

  it("works without any storage, and when even reaching storage throws", () => {
    const none = createCommunityStore(() => null);
    none.toggleJoined("knit");
    expect(none.load().joined).toEqual(["knit"]);
    const throwing = createCommunityStore(() => { throw new Error("denied"); });
    expect(throwing.load()).toEqual(blankCommunityMemory());
    throwing.toggleFriend("david");
    expect(throwing.load().friends).toEqual(["david"]);
  });

  it("keeps what was done when storage is full", () => {
    const storage = memoryStorage(JSON.stringify({ friends: ["joan"] }));
    const store = createCommunityStore(() => ({ getItem: storage.getItem, setItem: () => { throw new Error("QuotaExceededError"); } }));
    store.toggleFriend("anne");
    expect(store.load().friends).toEqual(["joan", "anne"]);
  });

  it("says whether the last change reached storage, so Settings never claims a save that failed", () => {
    let full = false;
    const storage = memoryStorage(JSON.stringify({ friends: ["joan"] }));
    const store = createCommunityStore(() => ({ getItem: storage.getItem, setItem: (key: string, value: string) => { if (full) throw new Error("QuotaExceededError"); storage.setItem(key, value); } }));
    store.updateSettings({ textSize: "bigger" });
    expect(store.lastSaveKept()).toBe(true);
    full = true;
    store.updateSettings({ textSize: "smaller" });
    // The old record is still in storage, but this change isn't: it lasts for the visit only.
    expect(store.lastSaveKept()).toBe(false);
    expect(store.load().settings.textSize).toBe("smaller");
    expect(saved(storage).settings.textSize).toBe("bigger");
    full = false;
    store.updateSettings({ textSize: "normal" });
    expect(store.lastSaveKept()).toBe(true);
    expect(createCommunityStore(() => null).lastSaveKept()).toBe(true);
    const none = createCommunityStore(() => null);
    none.updateSettings({ gentleMode: false });
    expect(none.lastSaveKept()).toBe(false);
  });
});

describe("reactions", () => {
  it("switch on with one tap and off with another, and are remembered", () => {
    const storage = memoryStorage();
    const store = createCommunityStore(() => storage);
    const heard = vi.fn();
    store.subscribe(heard);
    const post = feedPosts[0].id;

    store.toggleReaction(post, "love");
    store.toggleReaction(post, "welldone");
    expect(store.hasReaction(post, "love")).toBe(true);
    expect(saved(storage).reactions).toEqual([`${post}:love`, `${post}:welldone`]);
    expect(createCommunityStore(() => storage).load().reactions).toEqual([`${post}:love`, `${post}:welldone`]);

    store.toggleReaction(post, "love");
    expect(store.hasReaction(post, "love")).toBe(false);
    expect(saved(storage).reactions).toEqual([`${post}:welldone`]);
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it("ignores posts it doesn't know and keeps the same snapshot when nothing changes", () => {
    const store = createCommunityStore(() => memoryStorage());
    const before = store.load();
    expect(store.toggleReaction("p-nobody", "love")).toBe(before);
    expect(store.load()).toBe(before);
    expect(store.toggleHeart("not a key")).toBe(before);
    store.toggleHeart("lounge:l1");
    expect(store.load().hearts).toEqual(["lounge:l1"]);
    store.toggleHeart("lounge:l1");
    expect(store.load().hearts).toEqual([]);
  });

  it("keeps waves and the poll vote, and a wave can't be taken back", () => {
    const storage = memoryStorage();
    const store = createCommunityStore(() => storage);
    store.wave("priya");
    store.wave("priya");
    store.vote("coffee");
    store.vote("not-a-drink");
    expect(saved(storage)).toMatchObject({ waves: ["priya"], vote: "coffee" });
  });
});

describe("groups", () => {
  it("joins and leaves suggested groups", () => {
    const storage = memoryStorage();
    const store = createCommunityStore(() => storage);
    store.toggleJoined("knit");
    store.toggleJoined("book");
    expect(store.load().joined).toEqual(["knit", "book"]);
    store.toggleJoined("knit");
    expect(createCommunityStore(() => storage).load().joined).toEqual(["book"]);
  });

  it("clears unread badges and remembers the weekly challenge", () => {
    const store = createCommunityStore(() => memoryStorage());
    const waiting = sampleGroups.reduce((sum, group) => sum + group.unread, 0);
    expect(unreadCount(store.load())).toBe(waiting);
    store.markRead("garden");
    store.markRead("garden");
    store.markRead("mine-unknown");
    expect(store.load().read).toEqual(["garden"]);
    expect(unreadCount(store.load())).toBe(waiting - 3);
    store.toggleChallenge("walk");
    expect(store.load().challenges).toEqual(["walk"]);
    store.toggleChallenge("walk");
    expect(store.load().challenges).toEqual([]);
  });

  it("starts a group, says hello in it, changes who is invited, and closes it", () => {
    const storage = memoryStorage();
    const store = createCommunityStore(() => storage);
    const group = store.startGroup({ name: "  Green   fingers  ", theme: "gardening", friends: ["margaret", "tomasz" as never, "joan"], open: true }, NOW);
    expect(group).toMatchObject({ name: "Green fingers", theme: "gardening", friends: ["margaret", "joan"], open: true, createdAt: NOW, hello: null });
    expect(group.id).toMatch(/^mine-[a-z0-9-]+$/);
    expect(communityViewFromQuery(communityHref("groups", group.id).split("?")[1]).group).toBe(group.id);

    const second = store.startGroup({ name: "", theme: "books", friends: [], open: false }, NOW + 1000);
    expect(second.name).toBe("Your group");
    expect(second.id).not.toBe(group.id);
    expect(store.load().started.map(item => item.id)).toEqual([second.id, group.id]);

    store.setGroupHello(group.id, "Hello everyone!");
    store.setGroupHello(second.id, "Something else");
    store.toggleGroupFriend(group.id, "anne");
    store.toggleGroupFriend(group.id, "margaret");
    expect(store.addMessage(group.id, { text: "First!" }, NOW + 2000)).toMatchObject({ text: "First!", voice: false, photo: null });
    store.toggleChallenge(group.id);

    const reloaded = createCommunityStore(() => storage).load();
    expect(reloaded.started.find(item => item.id === group.id)).toMatchObject({ hello: "Hello everyone!", friends: ["joan", "anne"] });
    expect(reloaded.started.find(item => item.id === second.id)?.hello).toBeNull();
    expect(reloaded.messages[group.id]).toHaveLength(1);
    expect(reloaded.challenges).toEqual([group.id]);
    expect(inviteFriends).toContain("anne");

    store.closeGroup(group.id);
    const after = createCommunityStore(() => storage).load();
    expect(after.started.map(item => item.id)).toEqual([second.id]);
    expect(after.messages[group.id]).toBeUndefined();
    expect(after.challenges).toEqual([]);
  });

  it("only keeps messages for groups the person is in", () => {
    const store = createCommunityStore(() => memoryStorage());
    expect(store.addMessage("mine-missing", { text: "Hello?" })).toBeNull();
    expect(store.addMessage("garden", { text: "   " })).toBeNull();
    const voice = store.addMessage("garden", { text: "Say it for me", voice: true }, NOW);
    expect(voice).toMatchObject({ text: "Say it for me", voice: true });
    store.removeMessage("garden", voice!.id);
    expect(store.load().messages).toEqual({});
  });
});

describe("what the person writes", () => {
  it("keeps posts on this device, newest first, and lets them go", () => {
    const storage = memoryStorage();
    const store = createCommunityStore(() => storage);
    expect(store.addPost({ text: "   " })).toBeNull();
    expect(store.addPost({ text: "", photo: "https://example.com/a.png" })).toBeNull();
    const first = store.addPost({ text: "A walk to the gate.", win: true, feeling: "proud" }, NOW);
    const second = store.addPost({ text: "", voice: true, photo: "data:image/jpeg;base64,YQ==" }, NOW + 1);
    expect(first).toMatchObject({ win: true, feeling: "proud", voice: false, photo: null });
    expect(second).toMatchObject({ text: "", voice: false, photo: "data:image/jpeg;base64,YQ==" });
    expect(saved(storage).posts.map((post: { id: string }) => post.id)).toEqual([second!.id, first!.id]);
    store.removePost(first!.id);
    expect(createCommunityStore(() => storage).load().posts.map(post => post.id)).toEqual([second!.id]);
  });

  it("keeps replies under the example posts only", () => {
    const store = createCommunityStore(() => memoryStorage());
    const post = feedPosts[1].id;
    expect(store.addReply("p-nobody", { text: "Hi" })).toBeNull();
    const reply = store.addReply(post, { text: "  You're not alone.  " }, NOW);
    expect(reply?.text).toBe("You're not alone.");
    expect(store.load().replies[post]).toHaveLength(1);
    store.removeReply(post, reply!.id);
    expect(store.load().replies).toEqual({});
  });

  it("remembers the seat in the circle and reminders", () => {
    const storage = memoryStorage();
    const store = createCommunityStore(() => storage);
    expect(store.justSeated(NOW)).toBe(false);
    store.takeSeat();
    expect(store.justSeated()).toBe(true);
    store.toggleReminder("words");
    store.toggleReminder("never");
    expect(createCommunityStore(() => storage).load()).toMatchObject({ seated: true, reminders: ["words"] });
  });
});

describe("small helpers", () => {
  it("says when, and lists names, in plain English", () => {
    expect(timeAgo(NOW, NOW + 20_000)).toBe("Just now");
    expect(timeAgo(NOW, NOW + 60_000)).toBe("1 minute ago");
    expect(timeAgo(NOW, NOW + 5 * 60_000)).toBe("5 minutes ago");
    expect(timeAgo(NOW, NOW + 3 * 3_600_000)).toBe("3 hours ago");
    expect(timeAgo(NOW, NOW + 30 * 3_600_000)).toBe("Yesterday");
    expect(timeAgo(NOW, NOW + 5 * 86_400_000)).toMatch(/^\d{1,2} October$/);
    expect(listNames([])).toBe("");
    expect(listNames(["Margaret"])).toBe("Margaret");
    expect(listNames(["Margaret", "Joan"])).toBe("Margaret and Joan");
    expect(listNames(["Margaret", "Joan", "Anne"])).toBe("Margaret, Joan and Anne");
    expect(firstName("  Zak Ahmed ")).toBe("Zak");
    expect(firstName("")).toBe("there");
  });
});

describe("friends", () => {
  it("starts with three friends, two requests waiting, one sent and Gary blocked", () => {
    const memory = blankCommunityMemory();
    expect(friendList(memory).map(friend => friend.who)).toEqual(["david", "margaret", "anne"]);
    expect(requestList(memory).map(entry => [entry.request.who, entry.answer])).toEqual([["joan", null], ["liwei", null]]);
    expect(pendingRequestCount(memory)).toBe(2);
    expect(sentList(memory, NOW)).toEqual([{ who: "tomasz", at: NOW - 2 * 86_400_000, beforeVisit: true }]);
    expect(relationship(memory, "david")).toBe("friend");
    expect(relationship(memory, "joan")).toBe("incoming");
    expect(relationship(memory, "tomasz")).toBe("sent");
    expect(relationship(memory, "priya")).toBe("none");
    expect(relationship(memory, "gary")).toBe("blocked");
  });

  it("accepts, declines and takes an answer back, and the Friends badge agrees", () => {
    const storage = memoryStorage();
    const store = createCommunityStore(() => storage);
    store.acceptRequest("joan");
    store.declineRequest("liwei");
    let memory = createCommunityStore(() => storage).load();
    expect(memory.answers).toEqual({ joan: "accepted", liwei: "declined" });
    expect(pendingRequestCount(memory)).toBe(0);
    expect(friendList(memory).map(friend => friend.who)).toEqual(["david", "margaret", "anne", "joan"]);
    expect(friendList(memory)[3]).toMatchObject({ isNew: true });
    expect(relationship(memory, "liwei")).toBe("none");
    store.undoAnswer("liwei");
    memory = store.load();
    expect(relationship(memory, "liwei")).toBe("incoming");
    expect(pendingRequestCount(memory)).toBe(1);
    // A wave to a new friend is the same wave as anywhere else.
    store.wave("joan");
    expect(store.load().waves).toEqual(["joan"]);
  });

  it("sends and cancels requests, so the Add friend buttons and the Sent tab agree", () => {
    const storage = memoryStorage();
    const store = createCommunityStore(() => storage);
    store.requestFriend("priya", NOW);
    store.requestFriend("david", NOW);
    expect(relationship(store.load(), "priya")).toBe("sent");
    expect(store.load().friends).toEqual(["priya"]);
    expect(sentList(store.load(), NOW + 1000).map(entry => entry.who)).toEqual(["priya", "tomasz"]);

    store.cancelRequest("tomasz");
    store.cancelRequest("priya");
    store.cancelRequest("david");
    let memory = createCommunityStore(() => storage).load();
    expect(memory.cancelled).toEqual(["tomasz"]);
    expect(memory.friends).toEqual([]);
    expect(memory.sentAt).toEqual({});
    expect(sentList(memory)).toEqual([]);

    // Undo in the Sent tab sends it again.
    store.requestFriend("tomasz", NOW);
    memory = store.load();
    expect(memory.cancelled).toEqual([]);
    expect(sentList(memory, NOW).map(entry => entry.who)).toEqual(["tomasz"]);

    // Asking someone who is already asking says yes, even after "Not now".
    store.declineRequest("joan");
    store.requestFriend("joan", NOW);
    expect(relationship(store.load(), "joan")).toBe("friend");
  });

  it("keeps the low-level toggle working, with the time it was sent", () => {
    const store = createCommunityStore(() => memoryStorage());
    store.toggleFriend("samuel", NOW);
    expect(store.load()).toMatchObject({ friends: ["samuel"], sentAt: { samuel: NOW } });
    store.toggleFriend("samuel", NOW);
    expect(store.load().friends).toEqual([]);
    expect(store.load().sentAt).toEqual({});
  });
});

describe("blocking, hiding and reporting", () => {
  it("unblocks Gary, who was blocked to begin with, and remembers it", () => {
    const storage = memoryStorage();
    const store = createCommunityStore(() => storage);
    expect(blockedList(store.load(), NOW)).toEqual([{ who: "gary", at: NOW - 3 * 86_400_000 }]);
    expect(blockedSince(store.load(), "gary", NOW)).toBe(NOW - 3 * 86_400_000);
    store.unblock("gary");
    expect(saved(storage).blocks).toEqual({ gary: 0 });
    const reloaded = createCommunityStore(() => storage).load();
    expect(isBlocked(reloaded, "gary")).toBe(false);
    expect(blockedList(reloaded)).toEqual([]);
    expect(postVisibility(reloaded, feedPosts[0])).toEqual({ shown: true });
    store.block("gary", NOW);
    expect(store.load().blocks).toEqual({ gary: NOW });
    expect(blockedSince(store.load(), "gary")).toBe(NOW);
  });

  it("blocks and unblocks anyone, hiding them from friends and requests", () => {
    const store = createCommunityStore(() => memoryStorage());
    store.block("margaret", NOW);
    store.block("joan", NOW + 1);
    store.block("margaret", NOW + 5);
    let memory = store.load();
    expect(blockedList(memory, NOW).map(entry => entry.who)).toEqual(["joan", "margaret", "gary"]);
    expect(relationship(memory, "margaret")).toBe("blocked");
    expect(friendList(memory).map(friend => friend.who)).toEqual(["david", "anne"]);
    expect(pendingRequestCount(memory)).toBe(1);
    expect(canSee(memory, "margaret")).toBe(false);
    store.acceptRequest("joan");
    expect(store.load().answers).toEqual({});
    store.unblock("margaret");
    memory = store.load();
    expect(memory.blocks).toEqual({ joan: NOW + 1 });
    expect(relationship(memory, "margaret")).toBe("friend");
  });

  it("hides someone's posts, or a single post, and shows them again", () => {
    const storage = memoryStorage();
    const store = createCommunityStore(() => storage);
    const margaret = feedPosts.find(post => post.who === "margaret")!;
    const tomasz = feedPosts.find(post => post.who === "tomasz")!;
    store.mute("margaret", NOW);
    store.hidePost(tomasz.id, NOW + 1);
    store.hidePost("p-nobody", NOW);
    let memory = createCommunityStore(() => storage).load();
    expect(mutedList(memory)).toEqual([{ who: "margaret", at: NOW }]);
    expect(hiddenPostList(memory)).toEqual([{ postId: tomasz.id, at: NOW + 1 }]);
    expect(postVisibility(memory, margaret)).toEqual({ shown: false, why: "muted", at: NOW, word: null });
    expect(postVisibility(memory, tomasz)).toEqual({ shown: false, why: "post", at: NOW + 1, word: null });
    expect(canSee(memory, "margaret")).toBe(false);
    expect(relationship(memory, "margaret")).toBe("friend");
    store.unmute("margaret");
    store.unhidePost(tomasz.id);
    memory = store.load();
    expect(memory.muted).toEqual({});
    expect(memory.hiddenPosts).toEqual({});
    expect(postVisibility(memory, margaret)).toEqual({ shown: true });
  });

  it("hides posts that mention a hidden word, at the start of a word", () => {
    expect(hiddenWordIn("Back at the hospital today", ["hospital", "falls"])).toBe("hospital");
    expect(hiddenWordIn("Hospitals are busy", ["hospital"])).toBe("hospital");
    expect(hiddenWordIn("He FALLS asleep", ["falls"])).toBe("falls");
    expect(hiddenWordIn("A secure handrail", ["cure"])).toBeNull();
    expect(hiddenWordIn("Cured!", ["cure"])).toBe("cure");
    expect(hiddenWordIn("Nothing here", [])).toBeNull();
    const anne = feedPosts.find(post => post.who === "anne")!;
    expect(postVisibility(blankCommunityMemory(), anne)).toEqual({ shown: false, why: "words", at: 0, word: "hospital" });
  });

  it("keeps reports on this device, blocking too when asked", () => {
    const storage = memoryStorage();
    const store = createCommunityStore(() => storage);
    expect(store.report({ who: "nobody" as never, reason: "money" })).toBeNull();
    expect(store.report({ who: "david", reason: "shouting" as never })).toBeNull();
    const first = store.report({ who: "priya", postId: "p-priya", reason: "unkind", note: "  Not   kind  " }, NOW);
    const second = store.report({ who: "gary", postId: "p-unknown", reason: "health", alsoBlock: true }, NOW + 1);
    expect(first).toMatchObject({ who: "priya", postId: "p-priya", reason: "unkind", note: "Not kind", alsoBlock: false, createdAt: NOW });
    expect(second).toMatchObject({ who: "gary", postId: null, alsoBlock: true });
    const memory = createCommunityStore(() => storage).load();
    expect(memory.reports.map(report => report.id)).toEqual([second!.id, first!.id]);
    expect(isBlocked(memory, "priya")).toBe(false);
    store.report({ who: "samuel", reason: "other", alsoBlock: true }, NOW + 2);
    expect(isBlocked(store.load(), "samuel")).toBe(true);
    expect(store.load().hiddenPosts).toEqual({});
    store.removeReport(first!.id);
    expect(store.load().reports.map(report => report.id)).not.toContain(first!.id);
  });
});

describe("alerts", () => {
  it("counts new alerts until they are seen, or dealt with", () => {
    const store = createCommunityStore(() => memoryStorage());
    expect(unseenAlertCount(store.load())).toBe(4);
    store.markAlertsSeen(["a-circle"]);
    expect(unseenAlertCount(store.load())).toBe(3);
    store.acceptRequest("joan");
    store.markRead("garden");
    expect(alertList(store.load()).filter(entry => entry.isNew).map(entry => entry.alert.id)).toEqual(["a-liwei"]);
    store.markAlertsSeen();
    expect(unseenAlertCount(store.load())).toBe(0);
    expect(store.load().seenAlerts).toEqual(["a-circle", "a-joan", "a-garden", "a-liwei"]);
  });

  it("treats the circle alert as done once the seat is taken", () => {
    const store = createCommunityStore(() => memoryStorage());
    store.takeSeat();
    expect(alertList(store.load()).find(entry => entry.alert.id === "a-circle")?.isNew).toBe(false);
  });
});

describe("community settings", () => {
  it("starts with the designed defaults", () => {
    expect(blankCommunityMemory().settings).toEqual({
      showTown: true, showOnline: true, picture: "drawn", requestsFrom: "everyone", messagesFrom: "friends", postsSeenBy: "friends",
      gentleMode: true, showHeartCounts: true, hiddenWords: ["hospital", "falls"], readAloud: false, writeOutVoiceNotes: true,
      textSize: "normal", quietFrom: 21, quietUntil: 8, breakChoice: "none", breakUntil: null,
    });
  });

  it("checks every change and remembers it", () => {
    const storage = memoryStorage();
    const store = createCommunityStore(() => storage);
    store.updateSettings({ gentleMode: false, textSize: "bigger", picture: "initial", quietFrom: 22 });
    store.updateSettings({ textSize: "huge" as never, quietFrom: 3, requestsFrom: "noOne", showOnline: "yes" as never });
    const settings = createCommunityStore(() => storage).load().settings;
    expect(settings).toMatchObject({ gentleMode: false, textSize: "bigger", picture: "initial", quietFrom: 22, requestsFrom: "noOne", showOnline: true });
    // Who can see my posts: one of Everyone, Friends or Only me, and nothing else.
    store.updateSettings({ postsSeenBy: "everyone" });
    store.updateSettings({ postsSeenBy: "strangers" as never });
    expect(createCommunityStore(() => storage).load().settings.postsSeenBy).toBe("everyone");
    store.updateSettings({ postsSeenBy: "onlyMe" });
    expect(createCommunityStore(() => storage).load().settings.postsSeenBy).toBe("onlyMe");
    const before = store.load();
    expect(store.updateSettings({ textSize: "bigger" })).toBe(before);
    store.resetSettings();
    expect(store.load().settings).toEqual(defaultCommunitySettings());
  });

  it("adds and removes hidden words, cleanly", () => {
    const store = createCommunityStore(() => memoryStorage());
    expect(cleanHiddenWord("  Money  Talk ")).toBe("money talk");
    expect(cleanHiddenWord("<b>")).toBe("");
    expect(store.addHiddenWord("Cure")).toBe(true);
    expect(store.addHiddenWord("cure")).toBe(false);
    expect(store.addHiddenWord("   ")).toBe(false);
    expect(store.load().settings.hiddenWords).toEqual(["hospital", "falls", "cure"]);
    store.removeHiddenWord("hospital");
    expect(store.load().settings.hiddenWords).toEqual(["falls", "cure"]);
    for (let i = 0; i < 30; i++) store.addHiddenWord(`word${i}`);
    expect(store.load().settings.hiddenWords).toHaveLength(20);
  });

  it("takes a break of a day or a week, and ends it", () => {
    const store = createCommunityStore(() => memoryStorage());
    store.takeBreak("day", NOW);
    expect(store.load().settings).toMatchObject({ breakChoice: "day", breakUntil: NOW + 86_400_000 });
    expect(onBreak(store.load().settings, NOW + 1000)).toBe(true);
    expect(onBreak(store.load().settings, NOW + 2 * 86_400_000)).toBe(false);
    store.takeBreak("week", NOW);
    expect(store.load().settings.breakUntil).toBe(NOW + 7 * 86_400_000);
    store.takeBreak("none", NOW);
    expect(store.load().settings).toMatchObject({ breakChoice: "none", breakUntil: null });
  });

  it("knows quiet time, from the evening until 8 am", () => {
    const settings = defaultCommunitySettings();
    const at = (hour: number) => new Date(2026, 9, 6, hour, 30);
    expect(inQuietHours(settings, at(12))).toBe(false);
    expect(inQuietHours(settings, at(20))).toBe(false);
    expect(inQuietHours(settings, at(21))).toBe(true);
    expect(inQuietHours(settings, at(2))).toBe(true);
    expect(inQuietHours(settings, at(8))).toBe(false);
    expect(alertsQuiet(settings, at(12))).toBe(false);
    expect(alertsQuiet({ ...settings, breakChoice: "day", breakUntil: at(12).getTime() + 1000 }, at(12))).toBe(true);
    expect(hourLabel(21)).toBe("9 pm");
    expect(hourLabel(8)).toBe("8 am");
    expect(hourLabel(12)).toBe("12 pm");
    expect(hourLabel(0)).toBe("12 am");
  });
});

describe("loading friends, safety and settings", () => {
  it("rebuilds only what it knows", () => {
    const memory = parseCommunityMemory(JSON.stringify({
      friends: ["priya", "samuel"],
      answers: { joan: "accepted", liwei: "maybe", margaret: "accepted" },
      cancelled: ["tomasz", "priya", 7],
      sentAt: { priya: NOW, samuel: "now", david: NOW },
      blocks: { gary: 0, margaret: NOW, david: 0, nobody: NOW, anne: -4 },
      muted: { samuel: NOW, tomasz: 0, "__proto__": NOW },
      hiddenPosts: { "p-tomasz": NOW, "p-nobody": NOW },
      reports: [
        { id: "report-a", who: "gary", postId: "p-gary", reason: "health", note: "x".repeat(900), alsoBlock: true, createdAt: NOW },
        { id: "report-a", who: "gary", reason: "health", createdAt: NOW },
        { id: "report-b", who: "zak", reason: "health", createdAt: NOW },
        { id: "report-c", who: "anne", reason: "rude", createdAt: NOW },
        { id: "not-a-report", who: "anne", reason: "other", createdAt: NOW },
        { id: "report-d", who: "anne", postId: "elsewhere", reason: "other", createdAt: NOW },
      ],
      seenAlerts: ["a-joan", "a-nothing", "a-joan"],
      settings: { showTown: false, picture: "cartoon", hiddenWords: ["Falls", "<script>", "falls", 3, "hip op"], textSize: "smaller", quietFrom: 25, quietUntil: 7, breakChoice: "week", breakUntil: NOW, readAloud: "true" },
    }));
    expect(memory.answers).toEqual({ joan: "accepted" });
    expect(memory.cancelled).toEqual(["tomasz"]);
    expect(memory.sentAt).toEqual({ priya: NOW });
    expect(memory.blocks).toEqual({ gary: 0, margaret: NOW });
    expect(memory.muted).toEqual({ samuel: NOW });
    expect(memory.hiddenPosts).toEqual({ "p-tomasz": NOW });
    expect(memory.reports.map(report => report.id)).toEqual(["report-a", "report-d"]);
    expect(memory.reports[0].note).toHaveLength(400);
    expect(memory.reports[1].postId).toBeNull();
    expect(memory.seenAlerts).toEqual(["a-joan"]);
    expect(memory.settings).toEqual({
      ...defaultCommunitySettings(),
      showTown: false, hiddenWords: ["falls", "hip op"], textSize: "smaller", quietUntil: 7, breakChoice: "week", breakUntil: NOW,
    });
    expect(parseCommunityMemory(JSON.stringify({ settings: { hiddenWords: [] } })).settings.hiddenWords).toEqual([]);
    expect(parseCommunityMemory(JSON.stringify({ settings: { breakChoice: "day" } })).settings).toMatchObject({ breakChoice: "none", breakUntil: null });
  });

  it("says how long ago, in days", () => {
    const noon = new Date(2026, 9, 6, 12).getTime();
    expect(daysAgoLabel(noon - 3_600_000, noon)).toBe("today");
    expect(daysAgoLabel(noon - 86_400_000, noon)).toBe("yesterday");
    expect(daysAgoLabel(noon - 3 * 86_400_000, noon)).toBe("3 days ago");
    expect(daysAgoLabel(noon - 30 * 86_400_000, noon)).toMatch(/^on \d{1,2} September$/);
  });
});

describe("photos chosen for a post", () => {
  it("refuses other kinds of file before opening them", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    await expect(preparePostPhoto({ type: "image/svg+xml", size: 100 } as File)).rejects.toThrow("JPG, PNG or WebP");
    await expect(preparePostPhoto({ type: "image/png", size: 20 * 1024 * 1024 } as File)).rejects.toThrow("12 MB");
    expect(decode).not.toHaveBeenCalled();
  });

  it("shrinks the photo on the device, keeping its shape, and lets go of the original", async () => {
    const bitmap = { width: 1440, height: 960, close: vi.fn() };
    const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: () => context, toDataURL: vi.fn(() => "data:image/jpeg;base64,YWJj") };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    vi.stubGlobal("document", { createElement: () => canvas });
    expect(await preparePostPhoto({ type: "image/jpeg", size: 100 } as File)).toBe("data:image/jpeg;base64,YWJj");
    expect(canvas.width).toBe(720);
    expect(canvas.height).toBe(480);
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 720, 480);
    expect(canvas.toDataURL).toHaveBeenCalledWith("image/jpeg", 0.8);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it("explains when a photo can't be opened", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("decode")));
    await expect(preparePostPhoto({ type: "image/webp", size: 100 } as File)).rejects.toThrow("couldn't be opened");
  });
});
