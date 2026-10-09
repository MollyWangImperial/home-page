import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GaitResult } from "@/lib/assessment-engine/types";
import WalkingTask, {
  ASSIST_CHOICES, askToLeave, betterWalk, dialogOpen, MAX_TRIES, RecordingChip, RecordingCounts, retryActions, WALK_STEPS, walkingFigures,
  type WalkingTaskProps,
} from "./WalkingTask";

const render = (props: Partial<WalkingTaskProps> = {}) => renderToStaticMarkup(createElement(WalkingTask, {
  side: "right", walkingHelper: false, onDone: () => {}, onSkip: () => {}, onExit: () => {}, ...props,
}));
/** Markup text without tags, entities decoded the way the tests need. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

const scored: GaitResult = {
  status: "scored", score: 71.4, areaScore: 71.4, assist: "none", components: { speed: 40, cadence: 80 },
  metrics: { speedLegPerS: 0.8, speedMpsEstimate: 0.68, cadence: 96.4, stepLengthSymmetry: 0.944, stepTimeSymmetry: 0.97, kneeFlexA: 52, kneeFlexB: 47.5,
    kneeFlexPeak: 47.5, trunkLeanDeg: 3, stepLengthA: 0.5, stepLengthB: 0.47, steps: 14, passes: 2, seenShare: 0.9, sideOnRatio: 0.2 },
};

describe("WalkingTask intro", () => {
  it("shows how to film the walk: the demonstration, three steps, the safety line and the two ways on", () => {
    const html = render({ stepLabel: "Task 5 of 5" });
    const words = text(html);
    expect(words).toContain("Walking");
    expect(words).toContain("Movement check · Task 5 of 5");
    expect(html).toContain("<canvas");
    expect(html).toContain('role="img"');
    for (const step of WALK_STEPS) expect(words).toContain(step);
    expect(words).toContain("Use your usual walking aid. Have someone nearby. Stop if you feel unsteady.");
    expect(words).toContain("Is anyone holding you while you walk?");
    for (const choice of ASSIST_CHOICES) expect(words).toContain(choice.label);
    expect(words).toContain("Start camera");
    expect(words).toContain("Skip walking today");
    // Nothing is measured yet, so nothing is scored.
    expect(words).not.toMatch(/\bscore\b|\/ 100|out of 100/i);
  });

  it("starts with 'Someone is nearby' when a helper usually walks with the patient, else 'No one'", () => {
    const checked = (html: string) => html.match(/aria-checked="true"[^>]*>([^<]+)</)?.[1];
    expect(checked(render({ walkingHelper: true }))).toBe("Someone is nearby");
    expect(checked(render({ walkingHelper: false }))).toBe("No one");
  });

  it("offers the simulated walk instead of the camera in simulator mode", () => {
    const words = text(render({ sim: true }));
    expect(words).toContain("Start simulated walk");
    expect(words).not.toContain("Start camera");
  });
});

describe("walkingFigures", () => {
  it("shows only real numbers, each rounded once for display", () => {
    expect(walkingFigures(scored)).toEqual([
      { label: "Walking speed", value: "About 0.7 m/s" },
      { label: "Steps a minute", value: "96" },
      { label: "Step evenness", value: "94%" },
      { label: "Knee bend as your foot swings", value: "48°" },
    ]);
  });

  it("leaves out what was not measured, and shows nothing for an unmeasured walk", () => {
    const partial: GaitResult = { ...scored, metrics: { ...scored.metrics, stepLengthSymmetry: undefined, kneeFlexPeak: undefined } } as GaitResult;
    expect(walkingFigures(partial).map(figure => figure.label)).toEqual(["Walking speed", "Steps a minute", "Step timing evenness"]);
    expect(walkingFigures({ status: "not_measured", reason: "I didn't see you walk across.", assist: "none" })).toEqual([]);
    expect(walkingFigures(null)).toEqual([]);
    expect(MAX_TRIES).toBe(3);
  });
});

describe("Back", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("only hushes the voice and asks the page, so 'Keep going' finds the task still running", () => {
    const order: string[] = [];
    askToLeave({ stop: () => order.push("voice stopped") }, () => order.push("asked the page"));
    expect(order).toEqual(["voice stopped", "asked the page"]);
    // Before the voice has started there is nothing to hush.
    const onExit = vi.fn();
    askToLeave(null, onExit);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("holds the walk's start while the page's leave dialog is open", () => {
    expect(dialogOpen()).toBe(false);
    const querySelector = vi.fn((selector: string) => selector === '[role="dialog"][aria-modal="true"]' ? {} : null);
    vi.stubGlobal("document", { querySelector });
    expect(dialogOpen()).toBe(true);
    vi.stubGlobal("document", { querySelector: () => null });
    expect(dialogOpen()).toBe(false);
  });
});

describe("a later try that fails keeps the walk measured earlier", () => {
  const failed: GaitResult = { status: "not_measured", reason: "I saw too few steps. Walk a little further across the picture.", assist: "none" };
  const labels = (triesLeft: number, earlier: boolean) => retryActions(triesLeft, earlier).map(action => `${action.primary ? "*" : ""}${action.label}`);

  it("keeps the best scored walk, never an unmeasured one", () => {
    const lower = { ...scored, score: 60.2 } as Extract<GaitResult, { status: "scored" }>;
    expect(betterWalk(null, failed)).toBeNull();
    expect(betterWalk(null, scored)).toBe(scored);
    expect(betterWalk(scored, failed)).toBe(scored);
    expect(betterWalk(scored, lower)).toBe(scored);
    expect(betterWalk(lower, scored)).toBe(scored);
  });

  it("offers it after a failed try, and uses it on the last try", () => {
    // No earlier walk: as before.
    expect(labels(2, false)).toEqual(["*Try again", "Skip walking today"]);
    expect(labels(0, false)).toEqual(["*Continue", "Skip walking today"]);
    // An earlier walk was measured: it can be used now, and going on after the last try uses it.
    expect(labels(1, true)).toEqual(["*Try again", "Use my earlier result", "Skip walking today"]);
    expect(labels(0, true)).toEqual(["*Use my earlier result", "Skip walking today"]);
    expect(retryActions(0, true).some(action => action.id === "continue")).toBe(false);
    // The camera would not start on a later try: the same choice.
    expect(labels(Infinity, true)).toEqual(["*Try again", "Use my earlier result", "Skip walking today"]);
  });
});

describe("the recording's live numbers", () => {
  it("are shown but not announced every second (no live region, no status role)", () => {
    const chip = renderToStaticMarkup(createElement(RecordingChip, { seconds: 12 }));
    const counts = renderToStaticMarkup(createElement(RecordingCounts, { steps: 7, seconds: 12 }));
    expect(text(chip)).toContain("Recording · 12 s");
    expect(text(counts)).toContain("7 steps so far");
    expect(text(counts)).toContain("12 seconds");
    for (const html of [chip, counts]) {
      expect(html).not.toMatch(/aria-live|role="status"|role="alert"/);
    }
  });
});
