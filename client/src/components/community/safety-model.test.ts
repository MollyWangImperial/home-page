import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { blankCommunityMemory, createCommunityStore, isBlocked, type CommunityMemory } from "@/lib/community-store";
import { aboutLine, blockingFacts, clockLabel, fileReport, personWords, postText, quoteFor, reasonOf, safetyLists, savedLabel, unblockQuestion } from "./safety-model";

// Midday on the day the designs show.
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 6, 12, 0)); });
afterAll(() => { vi.useRealTimers(); });

const NOW = new Date(2026, 9, 6, 12, 0).getTime();
const DAY = 86_400_000;

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const freshStore = () => createCommunityStore(() => memoryStorage());

describe("what the sheet says about someone", () => {
  it("describes Gary as the design does once he is no longer blocked", () => {
    const unblocked: CommunityMemory = { ...blankCommunityMemory(), blocks: { gary: 0 } };
    expect(aboutLine(unblocked, "gary")).toBe("Joined 2 days ago · no friends in common · not in your groups");
    expect(aboutLine(blankCommunityMemory(), "gary")).toBe("Joined 2 days ago · blocked · not in your groups");
  });

  it("says where the person stands with someone, and the groups they share", () => {
    const memory = blankCommunityMemory();
    expect(aboutLine(memory, "margaret")).toBe("Leeds · your friend · in 2 of your groups");
    expect(aboutLine(memory, "tomasz")).toBe("New this week · you asked to be friends · in Morning walkers with you");
    expect(aboutLine(memory, "joan")).toBe("Garden gang · wants to be friends · in 2 of your groups");
    expect(aboutLine(memory, "samuel")).toBe("One-handed cooks · in 2 of your groups");
  });

  it("uses each person's own pronouns", () => {
    expect(personWords("gary")).toMatchObject({ name: "Gary", Subject: "He", object: "him", possessive: "his", is: "is" });
    expect(personWords("margaret")).toMatchObject({ Subject: "She", object: "her", possessive: "her" });
    expect(personWords("liwei")).toMatchObject({ name: "Li Wei", subject: "they", Subject: "They", object: "them", possessive: "their", is: "are" });
  });

  it("explains blocking and unblocking the same way in the sheet, the Friends drawer and the Safety page", () => {
    expect(blockingFacts("margaret")).toEqual(["She can't see your posts or comments.", "She can't message you or send a friend request.", "She won't be told. You can unblock any time."]);
    expect(blockingFacts(null)).toEqual(["They can't see your posts or comments.", "They can't message you or send a friend request.", "They are never told that you blocked them."]);
    expect(unblockQuestion("gary")).toBe("Unblock Gary? You'll see his posts again, and he can send you requests. He won't be told.");
    expect(unblockQuestion("liwei")).toBe("Unblock Li Wei? You'll see their posts again, and they can send you requests. They won't be told.");
  });

  it("names the reasons and quotes the example posts", () => {
    expect(reasonOf("health").label).toBe("Unsafe health advice");
    expect(reasonOf("money")).toMatchObject({ tint: "#FBEBC2", ink: "#6B5108" });
    expect(postText("p-gary")).toContain("herbal cure");
    expect(postText(null)).toBeNull();
    expect(postText("p-unknown")).toBeNull();
  });

  it("keeps a quoted post out of sight when gentle mode or a hidden word would", () => {
    const memory = blankCommunityMemory();
    expect(quoteFor(memory, "p-margaret")).toEqual({ text: expect.stringContaining("First tomatoes"), covered: false });
    expect(quoteFor(memory, "p-samuel")).toEqual({ text: "Covered by gentle mode: Samuel shares a hard day.", covered: true });
    expect(quoteFor(memory, "p-anne")).toEqual({ text: "Not shown, because it mentions “hospital”, one of your hidden words.", covered: true });
    const relaxed: CommunityMemory = { ...memory, settings: { ...memory.settings, gentleMode: false, hiddenWords: [] } };
    expect(quoteFor(relaxed, "p-samuel")?.covered).toBe(false);
    expect(quoteFor(relaxed, "p-anne")?.covered).toBe(false);
    expect(quoteFor(memory, null)).toBeNull();
  });
});

describe("when a report was saved", () => {
  it("gives the time today and yesterday, then just the day", () => {
    expect(clockLabel(new Date(2026, 9, 6, 20, 45).getTime())).toBe("8:45 pm");
    expect(clockLabel(new Date(2026, 9, 6, 0, 5).getTime())).toBe("12:05 am");
    expect(clockLabel(new Date(2026, 9, 6, 12, 0).getTime())).toBe("12:00 pm");
    expect(savedLabel(new Date(2026, 9, 6, 9, 10).getTime(), NOW)).toBe("today at 9:10 am");
    expect(savedLabel(new Date(2026, 9, 5, 20, 45).getTime(), NOW)).toBe("yesterday at 8:45 pm");
    expect(savedLabel(NOW - 3 * DAY, NOW)).toBe("3 days ago");
  });
});

describe("saving a report on this device", () => {
  it("keeps the report and blocks the person when asked, so the block hides the post", () => {
    const store = freshStore();
    store.unblock("gary");
    const outcome = fileReport(store, { who: "gary", postId: "p-gary" }, { reason: "health", note: "He sent me the same message too.", alsoBlock: true }, NOW);
    expect(outcome).toEqual({ blocked: true, postHidden: false });
    const memory = store.load();
    expect(isBlocked(memory, "gary")).toBe(true);
    expect(memory.reports[0]).toMatchObject({ who: "gary", postId: "p-gary", reason: "health", note: "He sent me the same message too.", alsoBlock: true, createdAt: NOW });
    expect(memory.hiddenPosts["p-gary"]).toBeUndefined();
  });

  it("hides the post reported when the person is not blocked", () => {
    const store = freshStore();
    const outcome = fileReport(store, { who: "margaret", postId: "p-margaret" }, { reason: "other", note: "", alsoBlock: false }, NOW);
    expect(outcome).toEqual({ blocked: false, postHidden: true });
    expect(store.load().hiddenPosts["p-margaret"]).toBe(NOW);
    expect(isBlocked(store.load(), "margaret")).toBe(false);
    expect(store.load().reports[0]).toMatchObject({ who: "margaret", alsoBlock: false });
  });

  it("doesn't block again someone already blocked", () => {
    const store = freshStore();
    const outcome = fileReport(store, { who: "gary", postId: null }, { reason: "fake", note: "", alsoBlock: true }, NOW);
    expect(outcome).toEqual({ blocked: true, postHidden: false });
    expect(store.load().reports[0]).toMatchObject({ who: "gary", postId: null, alsoBlock: false });
  });

  it("reports a person from the Friends drawer without hiding anything", () => {
    const store = freshStore();
    const outcome = fileReport(store, { who: "david", postId: null }, { reason: "unkind", note: "", alsoBlock: false }, NOW);
    expect(outcome).toEqual({ blocked: false, postHidden: false });
    expect(store.load().hiddenPosts).toEqual({});
  });
});

describe("what the Safety page lists", () => {
  it("lists Gary as blocked three days ago to begin with, and nothing else", () => {
    const lists = safetyLists(blankCommunityMemory(), NOW);
    expect(lists.blocked).toEqual([{ who: "gary", at: NOW - 3 * DAY, muted: false }]);
    expect(lists.muted).toEqual([]);
    expect(lists.posts).toEqual([]);
  });

  it("lists hidden people and posts, leaving a post to its writer's row while they are blocked or hidden", () => {
    const store = freshStore();
    store.mute("anne", NOW - DAY);
    store.hidePost("p-tomasz", NOW - 2 * DAY);
    store.hidePost("p-margaret", NOW);
    store.block("margaret", NOW);
    store.mute("gary", NOW);
    const lists = safetyLists(store.load(), NOW);
    expect(lists.blocked.map(entry => entry.who)).toEqual(["margaret", "gary"]);
    expect(lists.blocked.find(entry => entry.who === "gary")?.muted).toBe(true);
    expect(lists.muted).toEqual([{ who: "anne", at: NOW - DAY }]);
    expect(lists.posts.map(entry => entry.postId)).toEqual(["p-tomasz"]);
  });
});
