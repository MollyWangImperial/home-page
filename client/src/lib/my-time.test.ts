import { describe, expect, it } from "vitest";
import {
  activityFromQuery,
  createMyTimeStore,
  dayPart,
  MY_TIME_KEY,
  myTimeActivities,
  neighbour,
  suggestedActivity,
  surpriseActivity,
  weekDays,
} from "./my-time";

function storage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(MY_TIME_KEY, initial);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe("My Time activities", () => {
  it("keeps the links Alira and Home already use, and knows the new ones", () => {
    for (const id of ["breathing", "memory_game", "sounds", "pond", "chimes", "colour", "postcard", "story", "lantern"]) expect(activityFromQuery(id)).toBe(id);
    expect(activityFromQuery("circle")).toBeNull();
    expect(activityFromQuery(null)).toBeNull();
    expect(new Set(myTimeActivities.map(activity => activity.titleId)).size).toBe(myTimeActivities.length);
  });

  it("opens with something that suits the time of day", () => {
    expect(dayPart(new Date(2026, 9, 1, 4, 59))).toBe("night");
    expect(dayPart(new Date(2026, 9, 1, 5))).toBe("morning");
    expect(dayPart(new Date(2026, 9, 1, 12))).toBe("afternoon");
    expect(dayPart(new Date(2026, 9, 1, 17))).toBe("evening");
    expect(dayPart(new Date(2026, 9, 1, 21))).toBe("night");
    expect(suggestedActivity(new Date(2026, 9, 1, 9)).id).toBe("postcard");
    expect(suggestedActivity(new Date(2026, 9, 1, 19)).id).toBe("story");
    expect(suggestedActivity(new Date(2026, 9, 1, 23)).id).toBe("lantern");
  });

  it("changes the afternoon suggestion from one day to the next", () => {
    const picks = [1, 2, 3, 4].map(day => suggestedActivity(new Date(2026, 9, day, 14)).id);
    expect(new Set(picks).size).toBe(4);
    expect(suggestedActivity(new Date(2026, 9, 1, 13)).id).toBe(suggestedActivity(new Date(2026, 9, 1, 16)).id);
  });

  it("steps round the picker in both directions", () => {
    expect(neighbour("breathing", -1).id).toBe("lantern");
    expect(neighbour("lantern", 1).id).toBe("breathing");
    expect(neighbour("pond", 1).id).toBe("memory_game");
  });

  it("surprises with something untried first, and never the current activity", () => {
    const tried = myTimeActivities.map(activity => activity.id).filter(id => id !== "chimes");
    for (let roll = 0; roll < 1; roll += 0.1) expect(surpriseActivity("pond", tried, roll)).toBe("chimes");
    for (let roll = 0; roll < 1; roll += 0.1) expect(surpriseActivity("pond", [...tried, "chimes"], roll)).not.toBe("pond");
    expect(surpriseActivity("pond", [], Number.NaN)).toBe("breathing");
  });

  it("lists the week from Monday, across a month end", () => {
    expect(weekDays(new Date(2026, 9, 1))).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(weekDays(new Date(2026, 9, 4))[0]).toBe("2026-09-28");
    expect(weekDays(new Date(2026, 9, 5))[0]).toBe("2026-10-05");
  });
});

describe("What My Time remembers", () => {
  it("opens one lily for each day the pond is visited, once a day", () => {
    const store = createMyTimeStore(() => storage());
    const disk = storage();
    const kept = createMyTimeStore(() => disk);
    expect(store.lilies(new Date(2026, 9, 1))).toEqual([false, false, false, false, false, false, false]);
    kept.visitPond(new Date(2026, 8, 29, 9));
    kept.visitPond(new Date(2026, 9, 1, 9));
    kept.visitPond(new Date(2026, 9, 1, 20));
    expect(kept.load().pondDays).toEqual(["2026-09-29", "2026-10-01"]);
    expect(kept.lilies(new Date(2026, 9, 1))).toEqual([false, true, false, true, false, false, false]);
    expect(kept.lilies(new Date(2026, 9, 6))).toEqual([false, false, false, false, false, false, false]);
  });

  it("keeps window colours, album postcards, the story place and what has been tried", () => {
    const disk = storage();
    const store = createMyTimeStore(() => disk);
    store.paint("sunrise", "sun", "#f1cf7a");
    store.paint("sunrise", "lake", "#a9c3df");
    store.paint("leaf", "stem", "#5d8f74");
    expect(store.clearWindow("leaf")).toEqual({ sunrise: { sun: "#f1cf7a", lake: "#a9c3df" } });
    expect(store.toggleKept("lake")).toEqual(["lake"]);
    expect(store.toggleKept("tea")).toEqual(["lake", "tea"]);
    expect(store.toggleKept("lake")).toEqual(["tea"]);
    expect(store.saveStoryPlace({ chapter: 2, sentence: 5 })).toEqual({ chapter: 2, sentence: 5 });
    store.markTried("pond");
    expect(store.markTried("pond")).toEqual(["pond"]);
    expect(createMyTimeStore(() => disk).load()).toEqual({
      tried: ["pond"], pondDays: [], windows: { sunrise: { sun: "#f1cf7a", lake: "#a9c3df" } }, kept: ["tea"], story: { chapter: 2, sentence: 5 },
    });
  });

  it("starts fresh from damaged or missing storage", () => {
    const fresh = { tried: [], pondDays: [], windows: {}, kept: [], story: { chapter: 0, sentence: 0 } };
    expect(createMyTimeStore(() => storage("not json")).load()).toEqual(fresh);
    expect(createMyTimeStore(() => storage(JSON.stringify({ tried: ["circle", 4, "pond"], story: { chapter: -1, sentence: "x" }, windows: { a: { p: 3 } } }))).load())
      .toEqual({ ...fresh, tried: ["pond"], windows: { a: {} } });
    const blocked = createMyTimeStore(() => { throw new Error("no storage"); });
    expect(blocked.load()).toEqual(fresh);
    expect(blocked.markTried("pond")).toEqual(["pond"]);
  });
});
