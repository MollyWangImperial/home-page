import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { homeStages } from "./home-stage";

const morning = new Date(2026, 8, 29, 8);
let values: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("daily Home greeting", () => {
  it("animates the first visit without consuming it during render initialization", async () => {
    const { loadHomeGreeting } = await import("./home-greeting");
    expect(loadHomeGreeting("assessment", morning).animate).toBe(true);
    expect(loadHomeGreeting("assessment", morning).animate).toBe(true);
    expect(values.size).toBe(0);
  });

  it("keeps the same greeting and shows it immediately on same-day revisits", async () => {
    const { loadHomeGreeting, rememberHomeGreeting } = await import("./home-greeting");
    const first = loadHomeGreeting("exercises", morning);
    rememberHomeGreeting(first);
    rememberHomeGreeting(first);
    expect(loadHomeGreeting("exercises", new Date(2026, 8, 29, 22))).toEqual({ ...first, animate: false });
  });

  it("survives a fresh app instance with the same persistent storage", async () => {
    const initial = await import("./home-greeting");
    const first = initial.loadHomeGreeting("assessment", morning);
    initial.rememberHomeGreeting(first);
    vi.resetModules();
    const reopened = await import("./home-greeting");
    expect(reopened.loadHomeGreeting("assessment", morning)).toEqual({ ...first, animate: false });
  });

  it.each([
    [new Date(2026, 8, 29, 23, 59), new Date(2026, 8, 30, 0, 1)],
    [new Date(2026, 8, 30, 23, 59), new Date(2026, 9, 1, 0, 1)],
    [new Date(2026, 11, 31, 23, 59), new Date(2027, 0, 1, 0, 1)],
  ])("starts again on the next local calendar day (%s)", async (before, after) => {
    const { loadHomeGreeting, rememberHomeGreeting } = await import("./home-greeting");
    rememberHomeGreeting(loadHomeGreeting("assessment", before));
    const nextDay = loadHomeGreeting("assessment", after);
    expect(nextDay.animate).toBe(true);
    rememberHomeGreeting(nextDay);
    expect(loadHomeGreeting("assessment", after).animate).toBe(false);
  });

  it("updates the patient's next step without replaying and retains each stage's greeting", async () => {
    const { loadHomeGreeting, rememberHomeGreeting } = await import("./home-greeting");
    const first = loadHomeGreeting("assessment", morning);
    rememberHomeGreeting(first);
    for (const stage of ["exercises", "done_today", "reassessment"] as const) {
      const next = loadHomeGreeting(stage, morning);
      expect(next.animate).toBe(false);
      expect(homeStages[stage].openers[next.opener]).toBeDefined();
      rememberHomeGreeting(next);
      expect(loadHomeGreeting(stage, morning)).toEqual(next);
    }
    expect(loadHomeGreeting("assessment", morning)).toEqual({ ...first, animate: false });
  });

  it.each(["not json", "null", "{}", '{"day":123}', '{"day":"yesterday"}'])("handles invalid saved data (%s)", async raw => {
    const { HOME_GREETING_KEY, loadHomeGreeting } = await import("./home-greeting");
    values.set(HOME_GREETING_KEY, raw);
    expect(loadHomeGreeting("assessment", morning).animate).toBe(true);
  });

  it("replaces obsolete copy selections without replaying today's animation", async () => {
    const { HOME_GREETING_KEY, loadHomeGreeting } = await import("./home-greeting");
    values.set(HOME_GREETING_KEY, JSON.stringify({ day: "2026-09-29", visits: { assessment: { headline: 12, opener: 999 } } }));
    const greeting = loadHomeGreeting("assessment", morning);
    expect(greeting.animate).toBe(false);
    expect(typeof greeting.headline).toBe("string");
    expect(homeStages.assessment.openers[greeting.opener]).toBeDefined();
  });

  it("does not repeat during navigation when storage is blocked", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("Blocked"); },
      setItem: () => { throw new Error("Blocked"); },
    });
    const { loadHomeGreeting, rememberHomeGreeting } = await import("./home-greeting");
    const first = loadHomeGreeting("assessment", morning);
    rememberHomeGreeting(first);
    expect(loadHomeGreeting("assessment", morning)).toEqual({ ...first, animate: false });
    expect(loadHomeGreeting("assessment", new Date(2026, 8, 30)).animate).toBe(true);
  });
});
