import { describe, expect, it } from "vitest";
import {
  activityFromQuery,
  alsoAsked,
  countWord,
  createMyTimeStore,
  dayPart,
  doorTurn,
  featured,
  HUB_LEARN_TURN,
  HUB_STORY_TURN,
  MY_TIME_KEY,
  myTimeActivities,
  myTimeHref,
  myTimeViewFromQuery,
  neighbour,
  readingMinutes,
  suggestedActivity,
  surpriseActivity,
  weekDays,
} from "./my-time";
import { learnArticles, trustedPlaces } from "@/content/my-time-learn";
import { STORIES_NOTE, survivorStories } from "@/content/my-time-stories";
import { splitSentences } from "./alira-read-aloud";

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

  it("says why every activity is there", () => {
    for (const activity of myTimeActivities) {
      expect(activity.helps.length, activity.id).toBeGreaterThan(60);
      if (!activity.source) continue;
      expect(activity.source.url).toMatch(/^https:\/\//);
      expect(activity.source.publisher.length, activity.id).toBeGreaterThan(3);
      expect(activity.source.title.length, activity.id).toBeGreaterThan(3);
    }
    expect(myTimeActivities.find(activity => activity.id === "lantern")?.helps).toMatch(/tell your GP or stroke team/);
  });

  it("reads the section and the item from a link, and keeps older activity links working", () => {
    expect(myTimeViewFromQuery("")).toEqual({ section: null, activity: null, item: null });
    expect(myTimeViewFromQuery("activity=breathing&minutes=3")).toEqual({ section: "play", activity: "breathing", item: null });
    expect(myTimeViewFromQuery("section=play")).toEqual({ section: "play", activity: null, item: null });
    expect(myTimeViewFromQuery("section=learn&read=fatigue")).toEqual({ section: "learn", activity: null, item: "fatigue" });
    expect(myTimeViewFromQuery("section=stories&story=jo&read=fatigue")).toEqual({ section: "stories", activity: null, item: "jo" });
    expect(myTimeViewFromQuery("section=somewhere")).toEqual({ section: null, activity: null, item: null });
    expect(myTimeHref()).toBe("/my-time");
    expect(myTimeHref("learn")).toBe("/my-time?section=learn");
    expect(myTimeHref("play", "pond")).toBe("/my-time?section=play&activity=pond");
    expect(myTimeViewFromQuery(myTimeHref("stories", "david").split("?")[1])).toEqual({ section: "stories", activity: null, item: "david" });
  });

  it("features something unopened, and a different one from day to day", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(featured(items, [], 0).id).toBe("a");
    expect(featured(items, [], 1).id).toBe("b");
    expect(featured(items, ["a"], 0).id).toBe("b");
    expect(featured(items, ["a", "c"], 5).id).toBe("b");
    expect(featured(items, ["a", "b", "c"], 2).id).toBe("c");
    expect(readingMinutes(["one two three"])).toBe(1);
    expect(readingMinutes([Array(480).fill("word").join(" ")])).toBe(3);
  });

  it("turns each front-page door through its three, starting from today's when it is one of them", () => {
    const items = ["a", "b", "c", "d", "e"].map(id => ({ id }));
    const ids = (list: { id: string }[]) => list.map(item => item.id);
    expect(ids(doorTurn(items, ["c", "a", "e"]))).toEqual(["c", "a", "e"]);
    expect(ids(doorTurn(items, ["c", "a", "e"], "a"))).toEqual(["a", "e", "c"]);
    expect(ids(doorTurn(items, ["c", "a", "e"], "b"))).toEqual(["c", "a", "e"]);
    expect(ids(doorTurn(items, ["c", "gone", "e"]))).toEqual(["c", "e"]);
    expect(ids(doorTurn(items, ["gone"]))).toEqual(["a", "b", "c"]);
    // The design's three are all real articles and stories.
    expect(ids(doorTurn(learnArticles, HUB_LEARN_TURN))).toEqual(["fatigue", "emotions", "rewiring"]);
    expect(ids(doorTurn(survivorStories, HUB_STORY_TURN, "lin"))).toEqual(["lin", "david", "margaret"]);
  });

  it("offers other questions beside today's, the unopened ones first", () => {
    const items = ["a", "b", "c", "d", "e"].map(id => ({ id }));
    const ids = (list: { id: string }[]) => list.map(item => item.id);
    expect(ids(alsoAsked(items, "b", []))).toEqual(["c", "d", "e"]);
    expect(ids(alsoAsked(items, "d", []))).toEqual(["e", "a", "b"]);
    expect(ids(alsoAsked(items, "b", ["c", "d"]))).toEqual(["e", "a", "c"]);
    expect(ids(alsoAsked(items, "missing", [], 2))).toEqual(["a", "b"]);
    expect(ids(alsoAsked(items, "a", ["b", "c", "d", "e"], 4))).toEqual(["b", "c", "d", "e"]);
    for (const article of learnArticles) expect(ids(alsoAsked(learnArticles, article.id, []))).not.toContain(article.id);
  });

  it("counts in words where a sentence says how many", () => {
    expect(countWord(6)).toBe("six");
    expect(countWord(4)).toBe("four");
    expect(countWord(1)).toBe("one");
    expect(countWord(13)).toBe("13");
    expect(countWord(2.5)).toBe("2.5");
    // The front page and Play say "nine gentle things" in so many words.
    expect(countWord(myTimeActivities.length)).toBe("nine");
  });
});

describe("What My Time has to read", () => {
  it("gives every article a hook, a short answer, things that help and a source to check", () => {
    expect(new Set(learnArticles.map(article => article.id)).size).toBe(learnArticles.length);
    for (const article of learnArticles) {
      expect(article.question.endsWith("?"), article.id).toBe(true);
      expect(article.hook.length, article.id).toBeGreaterThan(30);
      expect(article.short.length, article.id).toBeGreaterThan(80);
      expect(article.sections.length, article.id).toBeGreaterThan(0);
      expect(article.helps.length, article.id).toBeGreaterThan(2);
      expect(article.sources.length, article.id).toBeGreaterThan(0);
      for (const source of article.sources) expect(source.url).toMatch(/^https:\/\/(www\.)?(stroke\.org\.uk|stroke\.org|nhs\.uk)\//);
    }
    for (const place of trustedPlaces) expect(place.url).toMatch(/^https:\/\//);
  });

  it("splits what is read aloud into whole sentences", () => {
    expect(splitSentences("No. The fastest recovery comes first. Is there a deadline?")).toEqual(["No.", "The fastest recovery comes first.", "Is there a deadline?"]);
    expect(splitSentences("The note said, “For your garden.” She laughed")).toEqual(["The note said, “For your garden.”", "She laughed"]);
    expect(splitSentences("  ")).toEqual([]);
    for (const article of learnArticles) for (const section of article.sections) for (const paragraph of section.paragraphs) {
      expect(splitSentences(paragraph).join(" "), article.id).toBe(paragraph);
    }
    for (const story of survivorStories) for (const paragraph of story.paragraphs) expect(splitSentences(paragraph).join(" "), story.id).toBe(paragraph);
  });

  it("tells stories from both survivors and carers, and says how they were made", () => {
    expect(survivorStories.some(story => story.voice === "survivor")).toBe(true);
    expect(survivorStories.some(story => story.voice === "carer")).toBe(true);
    expect(new Set(survivorStories.map(story => story.id)).size).toBe(survivorStories.length);
    for (const story of survivorStories) {
      expect(story.paragraphs.length, story.id).toBeGreaterThan(4);
      expect(story.helped.length, story.id).toBe(3);
    }
    // The list says the stories combine experiences people often describe; each story's own note
    // names its characters as fictional (stories-section.test.ts).
    expect(STORIES_NOTE).toMatch(/combining experiences/);
  });
});

describe("Finding the way round My Time", () => {
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
    store.markRead("learn", "fatigue");
    store.markRead("stories", "jo");
    expect(store.markRead("learn", "fatigue")).toEqual(["learn:fatigue", "stories:jo"]);
    expect(createMyTimeStore(() => disk).load()).toEqual({
      tried: ["pond"], pondDays: [], windows: { sunrise: { sun: "#f1cf7a", lake: "#a9c3df" } }, kept: ["tea"], story: { chapter: 2, sentence: 5 }, read: ["learn:fatigue", "stories:jo"],
    });
  });

  it("starts fresh from damaged or missing storage", () => {
    const fresh = { tried: [], pondDays: [], windows: {}, kept: [], story: { chapter: 0, sentence: 0 }, read: [] };
    expect(createMyTimeStore(() => storage("not json")).load()).toEqual(fresh);
    expect(createMyTimeStore(() => storage(JSON.stringify({ tried: ["circle", 4, "pond"], story: { chapter: -1, sentence: "x" }, windows: { a: { p: 3 } } }))).load())
      .toEqual({ ...fresh, tried: ["pond"], windows: { a: {} } });
    const blocked = createMyTimeStore(() => { throw new Error("no storage"); });
    expect(blocked.load()).toEqual(fresh);
    expect(blocked.markTried("pond")).toEqual(["pond"]);
  });
});
