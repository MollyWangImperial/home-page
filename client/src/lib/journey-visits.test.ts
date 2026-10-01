import { describe, expect, it } from "vitest";
import { createJourneyVisitStore, JOURNEY_VISITS_KEY } from "./journey-visits";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe("Journey first-visit entrances", () => {
  it("does not consume the first entrance during repeated render reads", () => {
    const store = createJourneyVisitStore(storage);
    expect(store.hasVisited("Journal")).toBe(false);
    expect(store.hasVisited("Journal")).toBe(false);
  });
  it("remembers each visited view across a fresh mount or page reload", () => {
    const disk = storage();
    const first = createJourneyVisitStore(() => disk);
    first.remember("Journal");
    const returning = createJourneyVisitStore(() => disk);
    expect(returning.hasVisited("Journal")).toBe(true);
    expect(returning.hasVisited("Progress")).toBe(false);
    returning.remember("Progress");
    returning.remember("Medals");
    expect(createJourneyVisitStore(() => disk).hasVisited("Journal")).toBe(true);
    expect(createJourneyVisitStore(() => disk).hasVisited("Medals")).toBe(true);
  });
  it("does not consume unlocked Journey views when the assessment lock page was visited", () => {
    const disk = storage();
    const store = createJourneyVisitStore(() => disk);
    store.remember("locked");
    expect(store.hasVisited("locked")).toBe(true);
    expect(store.hasVisited("Progress")).toBe(false);
    expect(store.hasVisited("Journal")).toBe(false);
  });
  it("ignores malformed saved markers and leaves other browser data untouched", () => {
    const disk = storage();
    const store = createJourneyVisitStore(() => disk);
    disk.setItem("journal.data", "keep");
    for (const raw of ["{", '{"Journal":true}', '["Unknown",42]']) {
      disk.setItem(JOURNEY_VISITS_KEY, raw);
      expect(store.hasVisited("Journal")).toBe(false);
    }
    store.remember("Journal");
    expect(store.hasVisited("Journal")).toBe(true);
    expect(disk.getItem("journal.data")).toBe("keep");
  });
  it("still prevents replay during same-tab navigation when storage is blocked", () => {
    const store = createJourneyVisitStore(() => { throw new Error("Blocked"); });
    store.remember("Journal");
    expect(store.hasVisited("Journal")).toBe(true);
    expect(store.hasVisited("Medals")).toBe(false);
  });
  it("merges the remembered views if writes fail but old storage remains readable", () => {
    const disk = storage();
    disk.setItem(JOURNEY_VISITS_KEY, '["Progress"]');
    const store = createJourneyVisitStore(() => ({ ...disk, setItem: () => { throw new Error("Full"); } }));
    store.remember("Journal");
    store.remember("Medals");
    expect(store.hasVisited("Progress")).toBe(true);
    expect(store.hasVisited("Journal")).toBe(true);
    expect(store.hasVisited("Medals")).toBe(true);
  });
});
