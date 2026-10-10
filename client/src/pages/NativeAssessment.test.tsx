import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NativeAssessment, { Between, ExitConfirm, NothingMeasured, SKIPPED_WALKING, exitDialogKey, holdFocus, keepsEarlierAssessment, skippedBeforeAttempt } from "./NativeAssessment";
import { ONBOARDING_STORAGE_KEY } from "@/lib/alira-onboarding";
import { loadRememberedAssessment, rememberAssessment } from "@/lib/assessment";
import { buildNativeReport } from "@/lib/assessment-engine/report";
import { CAMERA_TASKS } from "@/lib/assessment-engine/tasks";
import type { AssessmentTaskId, AssessmentTaskResult, AttemptRecord, CameraTaskId, GaitResult } from "@/lib/assessment-engine/types";
import AssessmentResults from "@/components/assessment/AssessmentResults";

vi.mock("wouter", () => ({ useLocation: () => ["/assessment", vi.fn()], useSearch: () => "onboarding=1", useRoute: () => [false, null] }));
const noop = () => {};
/** The page's words, without markup or entities. */
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
/** Markup without the development source locations the JSX plugin adds. */
const markup = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replace(/ data-loc="[^"]*"/g, "");
const ids = (taskId: CameraTaskId) => CAMERA_TASKS[taskId].levels.map(level => level.id);
const held = (taskId: CameraTaskId, levelId: string): AttemptRecord => ({
  level: ids(taskId).indexOf(levelId), levelId, assist: null, completed: true, touched: true, peakProgress: 1, durationMs: 4000,
  compensations: Object.fromEntries(CAMERA_TASKS[taskId].compensations.map(rule => [rule.id, "not_detected" as const])),
});
const taskResult = (taskId: CameraTaskId, attempts: AttemptRecord[], over: Partial<AssessmentTaskResult> = {}): AssessmentTaskResult => ({
  taskId, exerciseId: CAMERA_TASKS[taskId].exerciseId, levelIds: ids(taskId), startLevel: ids(taskId).length - 1,
  tryOut: { completed: true, peakProgress: 1 }, attempts, movementSeen: attempts.length > 0,
  stoppedBy: "top_reached", measured: attempts.length > 0, side: "right", insights: {}, ...over,
});
const ALL: AssessmentTaskId[] = ["T1", "T3", "H4", "H3", "L6"];
const reportOf = (results: AssessmentTaskResult[], skipped: AssessmentTaskId[], walking: GaitResult | null = null) =>
  buildNativeReport({ results, walking, answers: {}, assignedTaskIds: ALL, skipped, simulated: false, now: new Date("2026-10-09T10:00:00Z") });
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());
describe("the native movement check", () => {
  it("opens on its own welcome with the tasks in order, the device voice and no embedded runner", () => {
    const html = renderToStaticMarkup(createElement(NativeAssessment));
    expect(html).toContain("Let’s see how you move today");
    const order = ["Reach", "Hand to mouth", "Hand opening", "Pinch", "Walking"].map(name => html.indexOf(`</svg>${name}</li>`));
    expect(order.every(at => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("device’s own voice");
    expect(html).not.toContain("<iframe");
  });
  it("leaves out walking for someone who uses a wheelchair", () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ get_around: "wheelchair" }));
    const html = renderToStaticMarkup(createElement(NativeAssessment));
    expect(html).toContain("4 short tasks");
    expect(html).not.toContain("</svg>Walking</li>");
  });
  it("starts with supported movement for someone reporting no arm movement and a wheelchair", () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ arm_hand_movement: "none", get_around: "wheelchair" }));
    const html = renderToStaticMarkup(createElement(NativeAssessment));
    expect(html).toContain("supported movement");
    expect(html).not.toContain("Let’s see how you move today");
  });
});

describe("skipping a task", () => {
  it("the card between tasks says a skipped task was skipped, with no tick and no cheer", () => {
    const skipped = markup(createElement(Between, { done: "T1", skipped: true, next: "T3", index: 1, total: 5, onNext: noop }));
    expect(skipped).toContain("<h1>Reach skipped</h1>");
    expect(skipped).not.toContain("as-tick");
    expect(skipped).not.toContain("as-lead");
    expect(words(skipped)).toContain("Next: Hand to mouth · task 2 of 5");
    const done = markup(createElement(Between, { done: "T1", next: "T3", index: 1, total: 5, onNext: noop }));
    expect(done).toContain("<h1>Reach done</h1>");
    expect(done).toContain("as-tick");
    expect(words(done)).toContain("Well done.");
    // The page's own pinch note still shows after a skip, without a cheer.
    const noted = renderToStaticMarkup(createElement(Between, { done: "H4", skipped: true, next: "L6", index: 4, total: 5, note: "Pinching comes after hand opening, so we'll leave it for today.", onNext: noop }));
    expect(words(noted)).toContain("Hand opening skipped Pinching comes after hand opening, so we'll leave it for today.");
  });

  it("a camera task skipped inside the runner counts as skipped only before any attempt", () => {
    expect(skippedBeforeAttempt(taskResult("H3", [], { stoppedBy: "skipped" }))).toBe(true);
    expect(skippedBeforeAttempt(taskResult("H3", [held("H3", "partial")], { stoppedBy: "skipped" }))).toBe(false);
    expect(skippedBeforeAttempt(taskResult("T1", [held("T1", "r160")]))).toBe(false);
    expect(skippedBeforeAttempt(taskResult("T1", [], { stoppedBy: "not_measured" }))).toBe(false);
  });

  it("walking skipped is kept as its own result, so the results say it was not part of today's check", () => {
    expect(SKIPPED_WALKING).toEqual({ status: "skipped", reason: "Skipped" });
    const report = reportOf([taskResult("T1", [held("T1", "r160")])], ["T3", "H4", "H3", "L6"], SKIPPED_WALKING);
    const html = renderToStaticMarkup(createElement(AssessmentResults, { report, previous: [], walking: SKIPPED_WALKING, taskResults: [], completedAt: "2026-10-09T10:00:00.000Z", onContinue: noop, onHome: noop }));
    expect(words(html)).toContain("Walking was not part of today's check.");
    expect(words(html)).not.toContain("I couldn't measure your walking");
  });
});

describe("a check where nothing was measured", () => {
  const nothing = () => reportOf([], ALL, SKIPPED_WALKING);
  const measured = () => reportOf([taskResult("T1", [held("T1", "r160")])], ["T3", "H4", "H3", "L6"], SKIPPED_WALKING);

  it("has no daily score", () => {
    expect(nothing().metrics?.function_score?.display_total).toBeNull();
    expect(measured().metrics?.function_score?.display_total).toBe(100);
  });

  it("never replaces an earlier check that had scores", () => {
    rememberAssessment(measured());
    const earlier = loadRememberedAssessment();
    expect(keepsEarlierAssessment(nothing(), earlier)).toBe(true);
    // A check with any score replaces it as usual.
    expect(keepsEarlierAssessment(measured(), earlier)).toBe(false);
  });

  it("is still saved when no earlier check had scores, so onboarding moves on", () => {
    expect(keepsEarlierAssessment(nothing(), null)).toBe(false);
    expect(keepsEarlierAssessment(nothing(), loadRememberedAssessment())).toBe(false);
    rememberAssessment(nothing());
    expect(keepsEarlierAssessment(nothing(), loadRememberedAssessment())).toBe(false);
  });

  it("ends calmly with Back to Alira and Try again, and no numbers", () => {
    const html = markup(createElement(NothingMeasured, { onBack: noop, onRetry: noop }));
    const text = words(html);
    expect(text).toContain("Nothing measured today");
    expect(text).toContain("Your earlier results and your exercise plan stay as they are.");
    expect(html).toMatch(/<button class="as-primary">.*Back to Alira<\/button>/);
    expect(html).toContain('<button class="as-secondary">Try again</button>');
    expect(text).not.toMatch(/\d/);
  });
});

describe("the leave dialog", () => {
  const press = (key: string, shiftKey = false) => {
    const state = { prevented: false };
    return { key, shiftKey, state, preventDefault: () => { state.prevented = true; } };
  };
  const dialogButtons = () => {
    const focused: string[] = [];
    const [stay, leave] = ["Keep going", "Leave"].map(name => ({ name, focus: () => { focused.push(name); } }));
    return { stay, leave, buttons: [stay, leave], focused };
  };

  it("Escape keeps going", () => {
    const { buttons, stay, focused } = dialogButtons();
    const onStay = vi.fn();
    const escape = press("Escape");
    exitDialogKey(escape, buttons, stay, onStay);
    expect(onStay).toHaveBeenCalledTimes(1);
    expect(escape.state.prevented).toBe(true);
    expect(focused).toEqual([]);
  });

  it("Tab and Shift+Tab go round its two buttons, never behind the backdrop", () => {
    const { buttons, stay, leave, focused } = dialogButtons();
    const onStay = vi.fn();
    const tab = press("Tab");
    exitDialogKey(tab, buttons, stay, onStay);
    exitDialogKey(press("Tab"), buttons, leave, onStay);
    exitDialogKey(press("Tab", true), buttons, stay, onStay);
    exitDialogKey(press("Tab", true), buttons, leave, onStay);
    // Focus off the buttons (a tap on the backdrop): Tab comes back to the first, Shift+Tab to the last.
    exitDialogKey(press("Tab"), buttons, null, onStay);
    exitDialogKey(press("Tab", true), buttons, null, onStay);
    expect(focused).toEqual(["Leave", "Keep going", "Leave", "Keep going", "Keep going", "Leave"]);
    expect(tab.state.prevented).toBe(true);
    expect(onStay).not.toHaveBeenCalled();
  });

  it("leaves other keys alone", () => {
    const { buttons, stay, focused } = dialogButtons();
    const onStay = vi.fn();
    const enter = press("Enter");
    exitDialogKey(enter, buttons, stay, onStay);
    expect([enter.state.prevented, focused.length, onStay.mock.calls.length]).toEqual([false, 0, 0]);
  });

  it("focuses Keep going as it opens and gives focus back to the button that opened it", () => {
    const focused: string[] = [];
    const stay = { focus: () => { focused.push("Keep going"); } };
    const release = holdFocus(stay, { isConnected: true, focus: () => { focused.push("Back"); } });
    expect(focused).toEqual(["Keep going"]);
    release();
    expect(focused).toEqual(["Keep going", "Back"]);
    // The page left, or the task moved on: a button no longer on the page is left alone.
    holdFocus(stay, { isConnected: false, focus: () => { focused.push("gone"); } })();
    holdFocus(null, null)();
    expect(focused).toEqual(["Keep going", "Back", "Keep going"]);
  });

  it("is a labelled modal dialog with Keep going first", () => {
    const html = markup(createElement(ExitConfirm, { onStay: noop, onLeave: noop }));
    expect(html).toContain('role="dialog" aria-modal="true" aria-labelledby="as-exit-title" aria-describedby="as-exit-note"');
    expect(html).toContain('<p id="as-exit-note">');
    expect(html.indexOf(">Keep going</button>")).toBeGreaterThan(0);
    expect(html.indexOf(">Keep going</button>")).toBeLessThan(html.indexOf(">Leave</button>"));
  });
});
