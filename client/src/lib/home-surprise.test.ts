import { describe, expect, it } from "vitest";
import { createSurpriseStore, eligibleSurprises, pickSurprise, surprises } from "./home-surprise";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const open = { journey: true, myTime: true, largeText: false };
const fresh = { journey: false, myTime: false, largeText: false };

describe("Today's surprise", () => {
  it("only offers places a brand-new user can reach", () => {
    const ids = eligibleSurprises(fresh).map(surprise => surprise.id);
    expect(ids).toEqual(["alira-voice", "warning-signs", "large-text"]);
    expect(eligibleSurprises(open)).toHaveLength(surprises.length);
    expect(eligibleSurprises({ ...open, largeText: true }).some(surprise => surprise.id === "large-text")).toBe(false);
  });
  it("never repeats yesterday's surprise when there is another choice", () => {
    const eligible = eligibleSurprises(open);
    for (let roll = 0; roll < 1; roll += 0.05) expect(pickSurprise(eligible, roll, "medals")?.id).not.toBe("medals");
    expect(pickSurprise([surprises[0]], 0.5, surprises[0].id)?.id).toBe(surprises[0].id);
    expect(pickSurprise([], 0.5)).toBeNull();
  });
  it("keeps the same surprise for the whole day and remembers that it was opened", () => {
    const disk = storage();
    const store = createSurpriseStore(() => disk);
    const morning = new Date(2026, 9, 1, 9);
    const evening = new Date(2026, 9, 1, 21);
    const first = store.today(open, morning, 0.37);
    expect(first.surprise).not.toBeNull();
    expect(first.opened).toBe(false);
    expect(createSurpriseStore(() => disk).today(open, evening, 0.91).surprise?.id).toBe(first.surprise?.id);
    store.open(evening);
    expect(store.today(open, evening, 0.1).opened).toBe(true);
    const tomorrow = store.today(open, new Date(2026, 9, 2, 9), 0.37);
    expect(tomorrow.opened).toBe(false);
    expect(tomorrow.surprise?.id).not.toBe(first.surprise?.id);
  });
  it("'Show me another' cycles through sealed surprises and keeps the next one sealed on reload until opened", () => {
    const disk = storage();
    const store = createSurpriseStore(() => disk);
    const now = new Date(2026, 9, 1, 9);
    const first = store.today(open, now, 0.5).surprise!;
    store.open(now);
    const seen = [first.id];
    for (let step = 1; step < surprises.length; step++) {
      const next = store.another(open, now, (step * 0.37) % 1, seen)!;
      expect(seen).not.toContain(next.id);
      expect(store.today(open, now, 0.9).opened).toBe(false);
      store.open(now);
      seen.push(next.id);
    }
    expect(new Set(seen).size).toBe(surprises.length);
    const wrapped = store.another(open, now, 0.2, seen)!;
    expect(wrapped.id).not.toBe(seen[seen.length - 1]);
    const reloaded = createSurpriseStore(() => disk).today(open, now, 0.9);
    expect(reloaded.surprise?.id).toBe(wrapped.id);
    expect(reloaded.opened).toBe(false);
    store.open(now);
    const reopened = createSurpriseStore(() => disk).today(open, now, 0.9);
    expect(reopened.surprise?.id).toBe(wrapped.id);
    expect(reopened.opened).toBe(true);
  });
  it("drops a remembered surprise that is no longer reachable and picks another", () => {
    const disk = storage();
    const store = createSurpriseStore(() => disk);
    const now = new Date(2026, 9, 3, 9);
    disk.setItem("rehyn.home.surprise.v1", JSON.stringify({ day: "2026-10-03", id: "medals" }));
    const today = store.today(fresh, now, 0.2);
    expect(today.surprise?.needs).toBeUndefined();
  });
});
