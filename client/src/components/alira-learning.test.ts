import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdaptationState, ChangeEntry, LearningSummary, WarmRepRecord } from "@shared/alira-adaptation";
import { ADAPTATION_KEY, CONSENT_KEY, learningToday, REPORTS_KEY, WARM_REP_KEY } from "@/lib/alira-learning-store";
import { AliraLearningPanel } from "./AliraLearning";
import { AliraLearningConsent } from "./AliraLearningConsent";

let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ enabled: true, configured: true }), { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(() => { vi.unstubAllGlobals(); });

const NOTICE = "This is Alira adjusting Zak's own settings within fixed limits. It is not used to train Rehyn's or anyone else's AI models. Every limit and default here is an engineering default awaiting clinician review.";
const TITLES = ["My answers to Alira's questions", "My movement results", "Still pictures from my warm-up", "My name and my goal in my own words", "My journal"];

/** What a reader sees: tags removed, entities decoded, spaces collapsed. */
const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const renderPanel = () => renderToStaticMarkup(createElement(AliraLearningPanel, { onOpenData: () => {} }));
const renderConsent = () => renderToStaticMarkup(createElement(AliraLearningConsent));
const seed = (key: string, value: unknown) => { values.set(key, JSON.stringify(value)); };
const shareMovement = () => seed(CONSENT_KEY, { v: 1, categories: { movement: true }, asked: true, updatedAt: "2026-10-01T08:00:00Z", history: [] });
const adaptation = (over: Partial<AdaptationState>): AdaptationState => ({ v: 1, values: {}, log: [], summaries: [], ...over });
const change = (over: Partial<ChangeEntry> = {}): ChangeEntry => ({
  id: "c1", at: "2026-10-01T09:30:00Z", day: learningToday(), param: "exercise.hold_seconds", from: 1.5, to: 1.2,
  why: "Holds were short in today's warm-up.", evidence: ["The best reach was held for 1.1 s."], by: "alira", trigger: "warm_rep", ...over,
});
const summary = (over: Partial<LearningSummary> = {}): LearningSummary => ({
  id: "s1", day: learningToday(), at: "2026-10-01T09:30:00Z", trigger: "warm_rep",
  text: "Zak's holds were **shorter** than usual, so I made the hold easier.", patientNote: "You worked hard today, so I made holding a little easier.",
  changeIds: ["c1"], rejected: [], model: "claude-test", ...over,
});

describe("Alira's Learning tab", () => {
  it("shows a concise review with accurate access states and the requested clutter removed", () => {
    const html = renderPanel();
    const text = textOf(html);
    expect(text).not.toContain(NOTICE);
    expect(text).not.toContain("Changes made today");
    expect(text).not.toContain("Alira's summary for today");
    expect(text).toContain("Show the 11 settings Alira can adjust");
    expect(text).toContain("What Alira is learning from");
    expect(text.match(/Not shared/g)).toHaveLength(5);
    expect(text).toContain("Choose what Alira can access");
    expect(text).not.toContain("Alira cannot learn or change anything");
    expect(text).not.toContain("Today's warm-up");
    expect(text).not.toContain("Every setting is at its default.");
    expect(text).not.toContain("Ask Alira to review today again");
    expect(text).not.toContain("Reviews today:");
    expect(text).not.toContain("changes a day");
    expect(html).not.toContain("al-notice");
    expect(html).not.toContain("al-status");
    expect(html).not.toContain("al-blocked");
    expect(html).not.toContain("lucide-x");
    expect(html).not.toContain("Undo</button>");
    expect(html).not.toContain("Alira can only make things easier");
    // Suggestions wait until the greeting has been typed out, so none are in the first render.
    expect(html).not.toContain("Suggested questions");
    expect(html).toContain('id="al-input"');
    expect(text).not.toContain("Reset all to defaults");
  });

  it("keeps current adjusted values in All settings without the removed changes card", () => {
    shareMovement();
    seed(ADAPTATION_KEY, adaptation({
      values: { "exercise.hold_seconds": 1.2 },
      log: [
        change(),
        change({ id: "c2", at: "2026-10-01T09:31:00Z", param: "exercise.target_size_scale", from: 1, to: 1.1, why: "The circle was missed twice.", evidence: ["Two misses in a row."], revertedAt: "2026-10-01T10:00:00Z" }),
        change({ id: "old", day: "2020-01-01", why: "An old change from another day." }),
      ],
    }));
    const html = renderPanel();
    const text = textOf(html);
    expect(text).toContain("All settings");
    expect(text).toContain("1.2 s Changed");
    expect(text).not.toContain("Changes made today");
    expect(text).not.toContain("Holds were short in today's warm-up.");
    expect(text).not.toContain("The best reach was held for 1.1 s.");
    expect(text).not.toContain("An old change from another day.");
    expect(html).not.toContain('aria-label="Undo the change');
    expect(JSON.parse(values.get(ADAPTATION_KEY)!).values["exercise.hold_seconds"]).toBe(1.2);
    expect(text).not.toContain("cannot learn or change anything");
    expect(text).not.toContain("1 setting differs from the default.");
    expect(text).not.toContain("Reset all to defaults");
  });

  it("omits the removed summary and changes cards even when review history exists", () => {
    shareMovement();
    seed(ADAPTATION_KEY, adaptation({
      summaries: [
        summary({ id: "yesterday", day: "2020-01-01", text: "Old news from another day." }),
        summary({ id: "s0", at: "2026-10-01T08:00:00Z", trigger: "assessment", text: "An earlier look at the movement check.", patientNote: "", changeIds: [] }),
        summary({ rejected: [{ param: "exercise.reps_scale", reason: "That is more than 1 step harder in one day." }] }),
      ],
    }));
    const html = renderPanel();
    const text = textOf(html);
    expect(text).not.toContain("Alira's summary for today");
    expect(text).not.toContain("You worked hard today");
    expect(text).not.toContain("model claude-test");
    expect(text).not.toContain("Earlier reviews today");
    expect(text).not.toContain("Old news from another day.");
    expect(text).not.toContain("That is more than 1 step harder in one day.");
    expect(text).toContain("All settings");
    expect(JSON.parse(values.get(ADAPTATION_KEY)!).summaries).toHaveLength(3);
  });

  it("keeps the safety restriction after pain without displaying the warm-up card", () => {
    shareMovement();
    const reach = { shoulderFlexion: 58, elbowExtension: 140, wristHeight: 0.9, trunkLeanDeg: 3, shoulderElevationPct: 4, faceApproachPct: 2, heldMs: 1500 };
    const warm: WarmRepRecord = {
      id: "w1", day: learningToday(), at: "2026-10-01T09:00:00Z", source: "survey_end", side: "right", simulated: true,
      rest: { shoulderFlexion: 12, elbowExtension: 105 }, reaches: [null, reach], best: reach, bestExcursionDeg: 46, suggestedReachRung: 0,
    };
    seed(WARM_REP_KEY, { v: 1, records: [warm], skips: [] });
    seed(REPORTS_KEY, [{ day: learningToday(), at: "2026-10-01T09:05:00Z", source: "warm_rep", pain: "a_lot" }]);
    const text = textOf(renderPanel());
    expect(text).not.toContain("Today's warm-up");
    expect(text).not.toContain("Resting angles");
    expect(text).not.toContain("Simulated, not a real reach");
    expect(text).toContain("Alira can only make things easier right now");
    expect(text).toContain("Reported a lot of pain after the warm-up today.");
    expect(text).toContain("We recommend a physiotherapist checks in with Zak");
  });

  it("keeps access choices off when displaying earlier changes without the removed warning", () => {
    seed(ADAPTATION_KEY, adaptation({ values: { "exercise.hold_seconds": 1.2 }, log: [change({ day: "2020-01-01" })] }));
    const text = textOf(renderPanel());
    expect(text).not.toContain("Alira cannot learn or change anything until Zak agrees to share his movement results.");
    expect(text.match(/Not shared/g)).toHaveLength(5);
    expect(JSON.parse(values.get(CONSENT_KEY) ?? "null")).toBeNull();
    expect(text).toContain("All settings");
  });
});

describe("What Alira can learn from", () => {
  it("has five switches in order, all off until the patient switches them on", () => {
    const html = renderConsent();
    expect(html.match(/role="switch"/g)).toHaveLength(5);
    expect(html).not.toContain('checked=""');
    const text = textOf(html);
    expect(text).toContain("What Alira can learn from");
    const positions = TITLES.map(title => text.indexOf(title));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toContain("Switching these off keeps your plan and exercises working with standard settings.");
    expect(text).toContain("Alira only adjusts your own settings, within fixed limits, and you or your care team can undo any change.");
    expect(text).toContain("Your raw videos are never sent for Alira's learning. Still pictures are only taken during a warm-up when that switch is on.");
    expect(text).not.toContain("Last changed:");
    expect(html).not.toContain("alc-history");
  });

  it("shows saved choices and recent history without the removed timestamp", () => {
    seed(CONSENT_KEY, {
      v: 1, categories: { movement: true }, asked: true, updatedAt: "2026-10-01T10:00:00Z",
      history: [
        { at: "2026-10-01T09:00:00Z", categories: { movement: true, journal: true } },
        { at: "2026-10-01T10:00:00Z", categories: { movement: true } },
      ],
    });
    const html = renderConsent();
    expect(html.match(/checked=""/g)).toHaveLength(1);
    const text = textOf(html);
    expect(text).not.toContain("Last changed:");
    expect(text).toContain("Your last 2 changes");
    expect(text).toContain("My journal: switched off.");
    expect(text).toContain("Sharing: My movement results, My journal.");
  });
});
