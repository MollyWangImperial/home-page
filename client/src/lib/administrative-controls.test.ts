import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { administrativeControlsEnabled } from "./administrative-controls";
import { REVIEW_ORIGIN } from "./review-account";
import { seedSampleAssessment } from "./journey-demo";
import { buildJourney, demoDayOffset, ensureJourneyRecords, JOURNEY_CLOCK_EVENT, JOURNEY_DEMO_KEY, journeyNow, journeyUnlocked, loadSessionStore, recordExerciseResult, setDemoDayOffset } from "./journey";
import { loadExerciseCompletion } from "./exercise-completion";

let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-02T10:00:00"));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("administrative controls on local and Render previews", () => {
  it("keeps the local controls enabled", () => {
    vi.stubEnv("DEV", true);
    expect(administrativeControlsEnabled()).toBe(true);
    expect(seedSampleAssessment()).not.toBeNull();
  });

  it("unlocks a sample Journey and advances a completed test session on the production review origin", () => {
    vi.stubEnv("DEV", false);
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { location: { origin: REVIEW_ORIGIN }, dispatchEvent });
    const assessment = seedSampleAssessment()!;
    expect(journeyUnlocked(assessment)).toBe(true);
    const records = ensureJourneyRecords(assessment);
    const model = () => buildJourney({ assessment, ...records, store: loadSessionStore(), now: journeyNow(), range: "all" });
    const first = model();
    first.exercises.filter(ex => ex.launchable).forEach(ex => recordExerciseResult(ex.id, 80));
    expect(model().doneToday).toBe(true);
    expect(loadExerciseCompletion("", assessment)?.allDone).toBe(true);
    setDemoDayOffset(1);
    expect(demoDayOffset()).toBe(1);
    expect(journeyNow().getDate()).toBe(3);
    expect(dispatchEvent.mock.calls[0][0].type).toBe(JOURNEY_CLOCK_EVENT);
    expect(model().day).toBe(first.day + 1);
    expect(model().doneToday).toBe(false);
  });

  it.each(["https://patient.example.com", "https://rehyn-recovery-companion.onrender.com.evil.example"])("does not activate test controls or the stored test clock on %s", origin => {
    vi.stubEnv("DEV", false);
    vi.stubGlobal("window", { location: { origin } });
    values.set(JOURNEY_DEMO_KEY, JSON.stringify({ dayOffset: 5 }));
    expect(administrativeControlsEnabled()).toBe(false);
    expect(seedSampleAssessment()).toBeNull();
    setDemoDayOffset(2);
    expect(demoDayOffset()).toBe(0);
    expect(JSON.parse(values.get(JOURNEY_DEMO_KEY)!).dayOffset).toBe(5);
  });
});
