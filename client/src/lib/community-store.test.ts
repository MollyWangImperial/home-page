import { afterEach, describe, expect, it, vi } from "vitest";
import {
  blankCommunityMemory,
  cleanGroupName,
  COMMUNITY_KEY,
  communityHref,
  communityViewFromQuery,
  createCommunityStore,
  firstName,
  listNames,
  parseCommunityMemory,
  preparePostPhoto,
  timeAgo,
  unreadCount,
} from "./community-store";
import { feedPosts, inviteFriends, sampleGroups } from "@/content/community-samples";

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
