import { describe, expect, it } from "vitest";
import {
  addDays, daysBetween, freshStore, isEmail, JOURNAL_QUESTIONS, joinNames, longDate, lookbackDay, monthGrid, monthOf, parseStore,
  pickQuestion, recentDays, type JournalPage,
} from "./journal-days";

const page = (mood: JournalPage["mood"] = 3, text = "Something small."): JournalPage => ({ mood, text });

describe("journal day maths", () => {
  it("moves across month ends and counts whole days", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(daysBetween("2026-09-24", "2026-10-01")).toBe(7);
    expect(longDate("2026-09-24")).toBe("Thursday 24 September");
  });

  it("lays a month out Monday first with padding", () => {
    const september = monthGrid(monthOf("2026-09-24"));
    expect(september.length % 7).toBe(0);
    expect(september[0]).toBeNull(); // 1 September 2026 is a Tuesday
    expect(september[1]).toBe("2026-09-01");
    expect(september.filter(Boolean)).toHaveLength(30);
  });
});

describe("the last three days", () => {
  it("is empty on the first day", () => {
    expect(recentDays("2026-09-24", "2026-09-24")).toEqual([]);
  });

  it("never reaches back before the journal began", () => {
    expect(recentDays("2026-09-26", "2026-09-24")).toEqual(["2026-09-25", "2026-09-24"]);
  });

  it("is yesterday, the day before and three days ago, newest first", () => {
    expect(recentDays("2026-10-02", "2026-09-24")).toEqual(["2026-10-01", "2026-09-30", "2026-09-29"]);
  });
});

describe("look back", () => {
  it("stays hidden until enough pages are kept", () => {
    const pages = { "2026-09-24": page(), "2026-09-25": page(), "2026-09-26": page(), "2026-09-27": page() };
    expect(lookbackDay(pages, "2026-10-01")).toBeNull();
  });

  it("shows the page from a week ago once there are enough", () => {
    const pages = { "2026-09-24": page(), "2026-09-25": page(), "2026-09-26": page(), "2026-09-27": page(), "2026-09-28": page() };
    expect(lookbackDay(pages, "2026-10-01")).toBe("2026-09-24");
  });

  it("falls back to the nearest older page when that day is empty", () => {
    const pages = { "2026-09-20": page(), "2026-09-25": page(), "2026-09-26": page(), "2026-09-27": page(), "2026-09-28": page() };
    expect(lookbackDay(pages, "2026-09-28")).toBe("2026-09-20");
  });
});

describe("questions, names and addresses", () => {
  it("never repeats yesterday's question", () => {
    expect(pickQuestion(2, () => 2 / JOURNAL_QUESTIONS.length)).not.toBe(2);
  });

  it("joins family names the way people say them", () => {
    expect(joinNames([{ name: "Mum", email: "m@x.io" }])).toBe("Mum");
    expect(joinNames([{ name: "Mum", email: "m@x.io" }, { name: "Dad", email: "d@x.io" }])).toBe("Mum and Dad");
    expect(joinNames([{ name: "Mum", email: "m@x.io" }, { name: "Dad", email: "d@x.io" }, { name: "Lily", email: "l@x.io" }])).toBe("Mum, Dad and Lily");
  });

  it("accepts only plausible email addresses", () => {
    expect(isEmail("mum@example.com")).toBe(true);
    expect(isEmail("mum@example")).toBe(false);
    expect(isEmail("not an email")).toBe(false);
  });
});

describe("stored journal", () => {
  const now = new Date(2026, 8, 24);

  it("starts fresh when nothing or something broken is stored", () => {
    expect(parseStore(null, now)).toEqual(freshStore(now));
    expect(parseStore("{not json", now)).toEqual(freshStore(now));
    expect(parseStore(JSON.stringify({ v: 2 }), now)).toEqual(freshStore(now));
  });

  it("keeps valid pages and drops malformed ones", () => {
    const raw = JSON.stringify({
      v: 1, startKey: "2026-09-24", testDays: 2,
      pages: { "2026-09-24": { mood: 3, text: "Tea.", voice: 12 }, "2026-09-25": { mood: 9, text: "bad" }, nonsense: { mood: 1, text: "x" } },
      shared: { "2026-09-24": true, "2026-09-25": true },
      questions: { "2026-09-24": 3, "2026-09-25": 99 },
      share: { on: true, configured: true, parts: { words: false }, people: [{ name: "Mum", email: "mum@example.com" }, { name: "", email: "x" }] },
    });
    const store = parseStore(raw, now);
    expect(Object.keys(store.pages)).toEqual(["2026-09-24"]);
    expect(store.pages["2026-09-24"]).toEqual({ mood: 3, text: "Tea.", voice: 12 });
    expect(store.shared).toEqual({ "2026-09-24": true });
    expect(store.questions).toEqual({ "2026-09-24": 3 });
    expect(store.testDays).toBe(2);
    expect(store.share.people).toEqual([{ name: "Mum", email: "mum@example.com" }]);
    expect(store.share.parts.words).toBe(false);
    expect(store.share.on).toBe(true);
  });

  it("turns sharing off when no valid person is left", () => {
    const raw = JSON.stringify({ v: 1, startKey: "2026-09-24", pages: {}, share: { on: true, configured: true, people: [] } });
    expect(parseStore(raw, now).share.on).toBe(false);
  });
});
