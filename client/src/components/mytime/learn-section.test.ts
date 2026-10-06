import { describe, expect, it } from "vitest";
import { learnArticles } from "@/content/my-time-learn";
import { splitSentences } from "@/lib/alira-read-aloud";
import { narrate } from "./Reader";
import {
  articleBlocks,
  ASK_TITLE,
  createTryThisWeekStore,
  HELPS_TITLE,
  listenStatus,
  numberWord,
  numberWordCapital,
  openedIds,
  openedLabel,
  togglePick,
  TRY_THIS_WEEK_KEY,
  tryNote,
  weekOf,
} from "./learn-state";

function disk(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(TRY_THIS_WEEK_KEY, initial);
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe("How many questions have been opened", () => {
  it("counts in words the way the cards say it", () => {
    expect(openedLabel(0, 6)).toBe("None opened yet");
    expect(openedLabel(1, 6)).toBe("1 of 6 opened");
    expect(openedLabel(5, 6)).toBe("5 of 6 opened");
    expect(openedLabel(6, 6)).toBe("All six opened");
    expect(openedLabel(7, 6)).toBe("All six opened");
    expect(numberWord(6)).toBe("six");
    expect(numberWordCapital(6)).toBe("Six");
    expect(numberWord(40)).toBe("40");
  });

  it("counts a card as opened once it was turned over or its answer was read", () => {
    const articles = [{ id: "rewiring" }, { id: "fatigue" }, { id: "emotions" }];
    expect(openedIds(articles, [], [])).toEqual([]);
    expect(openedIds(articles, ["learn:fatigue", "stories:fatigue", "stories:rewiring"], [])).toEqual(["fatigue"]);
    expect(openedIds(articles, ["learn:fatigue"], ["emotions", "fatigue"])).toEqual(["fatigue", "emotions"]);
    expect(openedIds(articles, ["learn:unknown"], ["also-unknown"])).toEqual([]);
  });
});

describe("What helps, to try this week", () => {
  it("gives every answer three short tips, read aloud exactly as they are shown", () => {
    for (const article of learnArticles) {
      expect(article.tryThisWeek.length, article.id).toBe(3);
      for (const tip of article.tryThisWeek) {
        expect(tip.length, tip).toBeLessThanOrEqual(100);
        expect(tip, tip).toMatch(/[.?]$/);
        expect(splitSentences(tip).join(" "), tip).toBe(tip);
      }
    }
  });

  it("says how many are ticked", () => {
    expect(tryNote(0)).toBe("Tap one to try this week");
    expect(tryNote(1)).toBe("1 to try this week");
    expect(tryNote(3)).toBe("3 to try this week");
    expect(togglePick([2], 0)).toEqual([0, 2]);
    expect(togglePick([0, 2], 2)).toEqual([0]);
  });

  const tuesday = () => new Date(2026, 9, 6, 10);
  it("remembers the ticks for each answer on this device", () => {
    const saved = disk();
    const store = createTryThisWeekStore(() => saved, tuesday);
    expect(store.picked("fatigue")).toEqual([]);
    expect(store.toggle("fatigue", 2)).toEqual([2]);
    expect(store.toggle("fatigue", 0)).toEqual([0, 2]);
    expect(store.toggle("words", 1)).toEqual([1]);
    expect(store.toggle("words", 1)).toEqual([]);
    expect(JSON.parse(saved.values.get(TRY_THIS_WEEK_KEY)!)).toEqual({ week: "2026-10-05", picks: { fatigue: [0, 2] } });
    const later = createTryThisWeekStore(() => saved, () => new Date(2026, 9, 11, 21));
    expect(later.picked("fatigue")).toEqual([0, 2]);
    expect(later.picked("words")).toEqual([]);
  });

  it("clears the ticks when a new week starts", () => {
    expect(weekOf(new Date(2026, 9, 5))).toBe("2026-10-05");
    expect(weekOf(new Date(2026, 9, 11, 23))).toBe("2026-10-05");
    expect(weekOf(new Date(2026, 9, 12))).toBe("2026-10-12");
    const saved = disk(JSON.stringify({ week: "2026-09-28", picks: { fatigue: [1] } }));
    expect(createTryThisWeekStore(() => saved, tuesday).picked("fatigue")).toEqual([]);
    // A visit that runs past midnight into Monday starts the new week too.
    let now = new Date(2026, 9, 11, 23, 59);
    const store = createTryThisWeekStore(() => disk(), () => now);
    store.toggle("hand", 0);
    expect(store.picked("hand")).toEqual([0]);
    now = new Date(2026, 9, 12, 0, 1);
    expect(store.picked("hand")).toEqual([]);
  });

  it("starts fresh from damaged storage, and keeps working for the visit when storage is blocked", () => {
    expect(createTryThisWeekStore(() => disk("not json"), tuesday).picked("fatigue")).toEqual([]);
    expect(createTryThisWeekStore(() => disk(JSON.stringify({ week: "2026-10-05", picks: { fatigue: [2, "x", -1, 2, 0.5, 0], words: "no", again: [] } })), tuesday).picked("fatigue")).toEqual([0, 2]);
    // Ticks saved before they belonged to a week are not carried over.
    expect(createTryThisWeekStore(() => disk(JSON.stringify({ fatigue: [1] })), tuesday).picked("fatigue")).toEqual([]);
    expect(createTryThisWeekStore(() => disk(JSON.stringify([1, 2])), tuesday).picked("fatigue")).toEqual([]);

    const blocked = createTryThisWeekStore(() => { throw new Error("no storage"); });
    expect(blocked.picked("fatigue")).toEqual([]);
    expect(blocked.toggle("fatigue", 1)).toEqual([1]);
    expect(blocked.picked("fatigue")).toEqual([1]);

    // Storage that can be read but not written (full, or private browsing) keeps the ticks for the visit too.
    const readOnly = { getItem: () => null, setItem: () => { throw new Error("full"); } };
    const store = createTryThisWeekStore(() => readOnly);
    store.toggle("hand", 0);
    expect(store.picked("hand")).toEqual([0]);
  });
});

describe("An answer read aloud", () => {
  it("lights every block it reads, headings included", () => {
    for (const article of learnArticles) {
      const blocks = articleBlocks(article);
      expect(new Set(blocks.map(block => block.key)).size, article.id).toBe(blocks.length);
      for (const block of blocks) {
        // The page splits what it shows into the same sentences Alira reads, so each one can be lit.
        expect(splitSentences(block.text).length, `${article.id} ${block.key}`).toBe(splitSentences(block.shown).length);
        expect(splitSentences(block.text).length, `${article.id} ${block.key}`).toBeGreaterThan(0);
      }
      const narration = narrate(blocks);
      expect(narration.lines.length).toBe(blocks.reduce((sum, block) => sum + splitSentences(block.text).length, 0));
      expect(narration.lines[0]).toBe(article.question);
      expect(blocks.map(block => block.key)).toEqual(expect.arrayContaining(["question", "short", "heading-0", "helps", "try-0", "try-2", "ask-title", "ask"]));
    }
  });

  it("ends a heading like a sentence, without doubling a question mark", () => {
    const rewiring = articleBlocks(learnArticles.find(article => article.id === "rewiring")!);
    const deadline = rewiring.find(block => block.shown === "Is there a deadline?")!;
    expect(deadline.text).toBe("Is there a deadline?");
    expect(rewiring.find(block => block.key === "heading-0")!.text).toBe("What is actually happening.");
    expect(rewiring.find(block => block.key === "helps")).toEqual({ key: "helps", text: `${HELPS_TITLE}.`, shown: HELPS_TITLE });
    expect(rewiring.find(block => block.key === "ask-title")).toEqual({ key: "ask-title", text: `${ASK_TITLE}.`, shown: ASK_TITLE });
  });

  it("says where the reading is in the Listen panel", () => {
    const idle = { index: -1, playing: false, note: "", done: false };
    expect(listenStatus(idle, 10)).toEqual({ title: "Listen with Alira", note: "She reads one sentence at a time, and lights it up.", playLabel: "Listen with Alira", progress: 0 });
    expect(listenStatus({ ...idle, index: 2, playing: true }, 10)).toEqual({ title: "Alira is reading", note: "Sentence 3 of 10. The words light up as she reads.", playLabel: "Pause", progress: 0.3 });
    expect(listenStatus({ ...idle, index: 2 }, 10)).toEqual({ title: "Paused", note: "Sentence 3 of 10. The words light up as she reads.", playLabel: "Carry on listening", progress: 0.3 });
    expect(listenStatus({ ...idle, done: true, note: "That is the end. Listen again whenever you like." }, 10))
      .toEqual({ title: "Listen again", note: "That is the whole answer. Well done.", playLabel: "Listen again", progress: 1 });
    const failed = listenStatus({ ...idle, index: 0, note: "Reading aloud did not start on this device. The words are here to read." }, 10);
    expect(failed.note).toBe("Reading aloud did not start on this device. The words are here to read.");
    expect(failed.title).toBe("Listen with Alira");
    expect(failed.playLabel).toBe("Listen with Alira");
  });
});
