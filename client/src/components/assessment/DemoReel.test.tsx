import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AssessmentTaskId } from "@/lib/assessment-engine/types";
import { walkDemoHeight, WALK_DEMO_CAPTIONS, WALK_DEMO_MS } from "@/lib/assessment-engine/walk-demo";
import { reachDemoDuration } from "@/lib/exercise-engine/reach-demo";
import { pinchDemoDuration } from "@/lib/exercise-engine/pinch-target";
import DemoReel, {
  DEMO_PAUSE_MS, DEMO_SPECS, demoCaption, demoLoopMs, demoMoment, demoProgressLabel, demoSegments, demoTasks, drawDemo, fitDemoCanvas, fitFixedDrawing,
  fitWalkDrawing, narrationCapMs, narrationFinished, NARRATION_MIN_MS, primaryLabel,
} from "./DemoReel";

const ALL: AssessmentTaskId[] = ["T1", "T3", "H4", "H3", "L6"];
const render = (taskIds: AssessmentTaskId[], side: "left" | "right" = "right") =>
  renderToStaticMarkup(createElement(DemoReel, { taskIds, side, onDone: () => {}, onExit: () => {} }));
/** Markup text without tags, entities decoded the way the tests need. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const dotTasks = (html: string) => Array.from(html.matchAll(/<li[^>]*\sdata-task="([A-Z0-9]+)"/g), match => match[1]);
const LISTEN = "Listen to the instruction. The circle will become active when the voice finishes.";

/** A 2D context that records the text it draws and the dash patterns it sets. */
function recordingContext() {
  const texts: string[] = [], dashes: number[][] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key === "measureText") return (value: string) => ({ width: value.length * 7 });
      if (key === "fillText") return (value: string) => { texts.push(value); };
      if (key === "setLineDash") return (dash: number[]) => { dashes.push(dash); };
      if (key in target) return target[key];
      return () => undefined;
    },
    set(target, key: string, value) { target[key] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts, dashes };
}

describe("DemoReel", () => {
  it("opens on the first demonstration: where we are, its title, the canvas, the controls and a dot per task", () => {
    const html = render(ALL);
    const words = text(html);
    expect(words).toContain("Movement check · Demo 1 of 5");
    expect(html).toMatch(/<h1[^>]*>Reach<\/h1>/);
    expect(html).toContain("<canvas");
    expect(html).toMatch(/<canvas[^>]*role="img"[^>]*aria-label="Reach demonstration: Listen to the instruction/);
    for (const control of ["Skip the demos", "Exit", "Watch again", "Next demo"]) expect(words).toContain(control);
    expect(words).not.toContain("Start the check");
    expect(dotTasks(html)).toEqual(ALL);
    expect(html).toMatch(/<li[^>]*\sdata-task="T1" class="demo-reel-dot is-current" aria-current="step">/);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    // The live caption starts on the narration (the inactive target), with the short "what to do" line under it.
    expect(words).toContain(LISTEN);
    expect(words).toContain("What to do: With your right arm, reach up into the circle and hold, then bring your hand back to your lap.");
    // Every button is a real button, and nothing is scored here.
    expect(html.match(/<button[^>]*\stype="button"/g)).toHaveLength(4);
    expect(words).not.toMatch(/\bscore\b|\/ 100|out of 100/i);
  });

  it("shows only the listed tasks, in their order", () => {
    const html = render(["T3", "H3"], "left");
    const words = text(html);
    expect(words).toContain("Movement check · Demo 1 of 2");
    expect(html).toMatch(/<h1[^>]*>Hand to mouth<\/h1>/);
    expect(words).toContain("Bring your left hand up to your mouth");
    expect(dotTasks(html)).toEqual(["T3", "H3"]);
    for (const title of ["Reach", "Hand opening", "Walking"]) expect(words).not.toContain(title);
    expect(demoTasks(["L6", "T1", "L6", "X9", "toString"])).toEqual(["L6", "T1"]);
  });

  it("starts the check from the last demonstration's primary button", () => {
    const words = text(render(["L6"]));
    expect(words).toContain("Movement check · Demo 1 of 1");
    expect(words).toContain("Walking");
    expect(words).toContain("Start the check");
    expect(words).not.toContain("Next demo");
    expect(words).toContain("Listen to the instruction. The demonstration plays when the voice finishes.");
    expect(primaryLabel(0, 5)).toBe("Next demo");
    expect(primaryLabel(3, 5)).toBe("Next demo");
    expect(primaryLabel(4, 5)).toBe("Start the check");
    expect(demoProgressLabel(2, 5)).toBe("Movement check · Demo 3 of 5");
  });

  it("renders nothing when there is nothing to demonstrate", () => {
    expect(render([])).toBe("");
  });
});

describe("narration", () => {
  it("has a short British-English narration for every task, opening with its title", () => {
    for (const id of ALL) {
      const { title, narration, whatToDo } = DEMO_SPECS[id];
      expect(narration.startsWith(`${title}.`)).toBe(true);
      expect(narration.length).toBeGreaterThan(40);
      expect(narration.length).toBeLessThan(260);
      expect(narration).not.toMatch(/\b(color|center|meter|practicing)\b/i);
      expect(whatToDo("right").length).toBeGreaterThan(20);
    }
    expect(DEMO_SPECS.H3.narration).toBe("Pinch. Bring your thumb and first finger together, tip to tip, and hold. Then let go.");
    expect(DEMO_SPECS.L6.narration).toContain("Prop your phone sideways at hip height.");
  });

  it("arms the target when the voice is quiet, after a short minimum, and never waits forever", () => {
    const line = DEMO_SPECS.T1.narration;
    expect(narrationFinished(0, false, line)).toBe(false);
    expect(narrationFinished(NARRATION_MIN_MS - 1, false, line)).toBe(false);
    expect(narrationFinished(NARRATION_MIN_MS, false, line)).toBe(true);
    expect(narrationFinished(8000, true, line)).toBe(false);
    expect(narrationFinished(narrationCapMs(line), true, line)).toBe(true);
    // The cap leaves well over the voice's own reading time for the line.
    expect(narrationCapMs(line)).toBeGreaterThan(600 + line.length * 52);
  });
});

describe("the demonstration's timeline", () => {
  it("waits on the narration, then moves, returns, pauses and loops", () => {
    expect(demoMoment("T1", null)).toEqual({ phase: "narration", elapsedMs: 0, loop: 0 });
    expect(demoMoment("T1", -5).phase).toBe("narration");
    const move = reachDemoDuration(false), back = reachDemoDuration(true);
    expect(demoSegments("T1")).toEqual([{ kind: "move", ms: move }, { kind: "return", ms: back }, { kind: "pause", ms: DEMO_PAUSE_MS }]);
    expect(demoMoment("T1", 0)).toEqual({ phase: "move", elapsedMs: 0, loop: 0 });
    const returning = demoMoment("T1", move + 10);
    expect(returning).toMatchObject({ phase: "return", loop: 0 });
    expect(returning.elapsedMs).toBeCloseTo(10, 6);
    const paused = demoMoment("T1", move + back + 100);
    expect(paused.phase).toBe("pause");
    expect(paused.elapsedMs).toBeCloseTo(100, 6);
    const again = demoMoment("T1", demoLoopMs("T1") * 2 + 5);
    expect(again.phase).toBe("move");
    expect(again.loop).toBe(2);
    expect(again.elapsedMs).toBeCloseTo(5, 6);
  });

  it("pinches then lets go, and walks its own loop", () => {
    expect(demoSegments("H3").map(segment => segment.ms)).toEqual([pinchDemoDuration(false), pinchDemoDuration(true), DEMO_PAUSE_MS]);
    expect(demoSegments("L6")).toEqual([{ kind: "move", ms: WALK_DEMO_MS }]);
    expect(demoMoment("L6", WALK_DEMO_MS + 250)).toEqual({ phase: "move", elapsedMs: 250, loop: 1 });
  });

  it("captions each moment with the demonstration's own instruction", () => {
    expect(demoCaption("T1", null, false)).toBe(LISTEN);
    expect(demoCaption("T1", 0, false)).toBe("Reach forward and touch the circle");
    expect(demoCaption("T1", reachDemoDuration(false) - 900, false)).toMatch(/^Hold on target · \d+%$/);
    expect(demoCaption("T1", reachDemoDuration(false) + 10, false)).toBe("Return your hand to the lap circle");
    expect(demoCaption("T1", reachDemoDuration(false) + reachDemoDuration(true) + 200, false)).toBe("Lap target complete");
    // Pinch, as the check asks it: thumb to first finger, no peg.
    expect(demoCaption("H3", 0, false)).toBe("Bring your thumb to your first finger, tip to tip");
    expect(demoCaption("H3", pinchDemoDuration(false) + 10, false)).toBe("Open your thumb and finger");
    expect(demoCaption("H3", 5000, true)).toBe("Hold the pinch");
    // Reduced motion: the still frame's caption, the hold without a frozen percentage.
    expect(demoCaption("T1", 5000, true)).toBe("Hold on target");
    expect(demoCaption("H4", 5000, true)).toBe("Hold your hand open");
    for (const t of [500, 3200, 7000]) expect(WALK_DEMO_CAPTIONS).toContain(demoCaption("L6", t, false));
    expect(demoCaption("L6", 100, true)).toContain(WALK_DEMO_CAPTIONS[0]);
  });

  it("draws the inactive target during the narration, then the movement, for every task", () => {
    const size = { drawWidth: 300, drawHeight: 270 };
    const narration = recordingContext();
    drawDemo(narration.ctx, "T1", null, size, 1000, false);
    expect(narration.dashes).toContainEqual([10, 8]);
    expect(narration.texts).toContain("Reach target");
    const lap = recordingContext();
    drawDemo(lap.ctx, "T1", reachDemoDuration(false) + 50, size, 1000, false);
    expect(lap.texts).toContain("Lap target");
    const pinch = recordingContext();
    drawDemo(pinch.ctx, "H3", pinchDemoDuration(false) + 50, size, 1000, false);
    expect(pinch.texts).toContain("Let go");
    for (const id of ["T3", "H4"] as const) for (const reduced of [false, true]) {
      const { ctx, texts } = recordingContext();
      drawDemo(ctx, id, 400, size, 1000, reduced);
      expect(texts.length).toBeGreaterThan(0);
    }
    const walk = recordingContext();
    drawDemo(walk.ctx, "L6", null, { drawWidth: 700, drawHeight: walkDemoHeight(700, false) }, 1000, false);
    expect(walk.texts).toEqual(expect.arrayContaining(["Set up", "What the camera sees", WALK_DEMO_CAPTIONS[0]]));
  });
});

describe("fitting the canvas", () => {
  it("scales the engine's 300 x 270 drawing to the largest box of its shape that fits", () => {
    const wide = fitFixedDrawing(1000, 600);
    expect(wide.cssHeight).toBe(600);
    expect(wide.cssWidth).toBe(666);
    const tall = fitFixedDrawing(328, 700);
    expect(tall.cssWidth).toBe(328);
    expect(tall.cssHeight).toBe(295);
    for (const fit of [wide, tall]) {
      expect(fit.cssWidth / fit.cssHeight).toBeCloseTo(300 / 270, 2);
      expect(fit.drawWidth).toBeCloseTo(300, 0);
      expect(fit.drawHeight).toBeCloseTo(270, 0);
      expect(fit.cssWidth).toBeCloseTo(fit.drawWidth * fit.scale, 6);
    }
    // A huge window is capped; an unmeasured stage falls back to the drawing's own size.
    expect(fitFixedDrawing(5000, 5000).cssWidth).toBeLessThanOrEqual(1280);
    expect(fitFixedDrawing(0, 0)).toMatchObject({ cssWidth: 300, cssHeight: 270 });
  });

  it("lays the walk out side by side on a large screen and stacked on a phone, inside the space either way", () => {
    for (const [width, height, sideBySide] of [[1400, 680, true], [328, 400, false], [700, 190, true]] as const) {
      const fit = fitWalkDrawing(width, height, false);
      expect(fit.cssWidth).toBeLessThanOrEqual(width);
      expect(fit.cssHeight).toBeLessThanOrEqual(height);
      expect(fit.drawWidth >= 520).toBe(sideBySide);
      // The drawing keeps the shape the walk demonstration asks for at its width.
      expect(fit.drawHeight).toBe(walkDemoHeight(fit.drawWidth, false));
      expect(fit.cssHeight / fit.cssWidth).toBeCloseTo(fit.drawHeight / fit.drawWidth, 1);
    }
    // Large: the side-by-side picture fills the height, scaled up so its text grows too.
    const large = fitWalkDrawing(1400, 680, false);
    expect(large.cssHeight).toBeGreaterThanOrEqual(670);
    expect(large.scale).toBeGreaterThan(1);
    // Reduced motion: the three stills' own shape.
    const still = fitWalkDrawing(1200, 600, true);
    expect(still.drawHeight).toBe(walkDemoHeight(still.drawWidth, true));
    expect(fitDemoCanvas("L6", 1400, 680, false)).toEqual(large);
    expect(fitDemoCanvas("H4", 1000, 600, false)).toEqual(fitFixedDrawing(1000, 600));
  });
});
