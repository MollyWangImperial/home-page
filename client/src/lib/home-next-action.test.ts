import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSESSMENT_RESULT_KEY, type StoredAssessment } from "./assessment";
import { dayKey, EXERCISES_DONE_KEY } from "./home-stage";
import { JOURNAL_STORAGE_KEY, freshStore } from "./journal-days";
import { JOURNEY_SESSIONS_KEY } from "./journey";
import { loadHomeActionSnapshot, nextHomeAction, type HomeActionSnapshot } from "./home-next-action";

const now = new Date(2026, 9, 1, 14);
const assessment: StoredAssessment = {
  id: "home-test", completedAt: new Date(2026, 8, 30, 14).toISOString(), planChatCompleted: true,
  report: {
    metrics: { function_score: { display_total: 75, areas: { upper_limb: { display_score: 75 } }, tasks: [] } },
    rehab_plan: ["ex_reach", "ex_h2m"].map((id, index) => ({
      id, name: index ? "Hand to mouth" : "Graded Forward Reach", description: "Test movement", sets: 1, reps: 6, frequency: "daily", difficulty: "easy",
    })),
  },
};
const scored = (score = 75) => ({ score, at: now.toISOString() });
const snapshot = (changes: Partial<HomeActionSnapshot> = {}): HomeActionSnapshot => ({
  assessment, now, sessions: {}, sharingConfigured: false, ...changes,
});
const completed = (changes: Partial<HomeActionSnapshot> = {}) => snapshot({
  sessions: { [dayKey(now)]: { ex_reach: scored(), ex_h2m: scored() } }, ...changes,
});
afterEach(() => vi.unstubAllGlobals());

describe("Home's next step", () => {
  it.each([0, 0.7, 0.999])("starts onboarding before any optional suggestion (%s)", roll => {
    const action = nextHomeAction(snapshot({ assessment: null }), roll);
    expect(action.kind).toBe("onboarding");
    expect(action.href).toBe("/alira?onboarding=1&from=home");
  });

  it("requires movement scores rather than treating a saved assessment id as completion", () => {
    const action = nextHomeAction(snapshot({ assessment: { id: "unfinished", completedAt: assessment.completedAt } }), 0.99);
    expect(action.kind).toBe("assessment");
    expect(action.href).toBe("/assessment");
  });

  it("finishes the plan conversation before exercises, even on a previously unlocked Journey", () => {
    const action = nextHomeAction(completed({ assessment: { ...assessment, planChatCompleted: false } }), 0.99);
    expect(action.kind).toBe("plan");
    expect(action.href).toBe("/alira");
  });

  it("needs a saved plan list as well as a completed plan conversation", () => {
    expect(nextHomeAction(snapshot({ assessment: { ...assessment, report: { metrics: assessment.report!.metrics } } }), 0).kind).toBe("plan");
  });

  it.each([0, 0.7, 0.999])("prioritizes a due reassessment over exercises and follow-ups (%s)", roll => {
    const action = nextHomeAction(completed({ now: new Date(2026, 9, 14, 14) }), roll);
    expect(action.kind).toBe("reassessment");
    expect(action.href).toBe("/assessment");
    expect(action.days).toBe(0);
  });

  it("respects a blocked plan instead of encouraging exercise or a new camera check", () => {
    const blocked = { ...assessment, report: { ...assessment.report, clinical_review_gate: { rehab_access: "blocked" } } };
    const action = nextHomeAction(completed({ assessment: blocked, now: new Date(2026, 9, 30) }), 0);
    expect(action.kind).toBe("review");
    expect(action.href).toContain("section=exercises");
    expect(nextHomeAction(snapshot({ assessment: { ...blocked, planChatCompleted: false } }), 0).href).toBe("/alira");
    expect(nextHomeAction(snapshot({ assessment: { ...blocked, report: { ...blocked.report, metrics: undefined } } }), 0).href).toBe("/alira");
  });

  it("opens the exercise section and identifies the next unfinished movement", () => {
    const action = nextHomeAction(snapshot({ sessions: { [dayKey(now)]: { ex_reach: scored() } } }), 0.999);
    expect(action.kind).toBe("exercises");
    expect(action.href).toBe("/journey?tab=progress&section=exercises");
    expect(action.text).toContain("1 of today’s 2");
    expect(action.text).toContain("Hand to mouth is next");
  });

  it("uses actual completion, including a score of zero, rather than the legacy done marker", () => {
    expect(nextHomeAction(completed({ sessions: { [dayKey(now)]: { ex_reach: scored(0), ex_h2m: scored(0) } } }), 0).kind).toBe("journal");
    expect(nextHomeAction(snapshot({ sessions: { [dayKey(now)]: { ex_reach: scored(NaN), ex_h2m: scored() } } }), 0).kind).toBe("exercises");
  });

  it("does not let yesterday's completed session hide today's exercises", () => {
    expect(nextHomeAction(completed({ now: new Date(2026, 9, 2, 0, 1) }), 0.99).kind).toBe("exercises");
  });

  it.each([{ rehab_plan: [] }, { rehab_plan: [{ id: "supported_only", name: "Supported movement", description: "With a carer", sets: 1, reps: 5, frequency: "daily" }] }])("reviews an empty or supported plan instead of marking it complete", ({ rehab_plan }) => {
    const action = nextHomeAction(snapshot({ assessment: { ...assessment, report: { ...assessment.report, rehab_plan } } }), 0.99);
    expect(action.kind).toBe("review");
    expect(action.href).toContain("section=exercises");
  });

  it("varies only completed-session follow-ups and gives a missing journal most of the weight", () => {
    const counts: Record<string, number> = {};
    for (let index = 0; index < 800; index++) {
      const action = nextHomeAction(completed(), index / 800);
      counts[action.kind] = (counts[action.kind] ?? 0) + 1;
    }
    expect(counts).toEqual({ journal: 500, share: 200, medals: 100 });
    expect(nextHomeAction(completed(), 0.7).href).toBe("/journey?tab=progress&section=sharing");
    expect(nextHomeAction(completed(), 0.99).href).toBe("/journey?tab=medals");
  });

  it.each([
    { mood: 3 as const, text: "" }, { mood: -1 as const, text: "A small win" }, { mood: -1 as const, text: "", voice: 10 },
  ])("stops asking for a journal page once a mood, words or a voice note are kept", journalPage => {
    expect(nextHomeAction(completed({ journalPage }), 0).kind).toBe("share");
  });

  it("keeps a blank unsaved page eligible and respects an existing sharing setup", () => {
    expect(nextHomeAction(completed({ journalPage: { mood: -1, text: "  " }, sharingConfigured: true }), 0.7).kind).toBe("journal");
    expect(nextHomeAction(completed({ journalPage: { mood: 4, text: "Done" }, sharingConfigured: true }), 0).kind).toBe("medals");
  });

  it("retains the same optional action when the greeting is replayed", () => {
    expect(nextHomeAction(completed(), 0.7, 0)).toEqual(nextHomeAction(completed(), 0.7, 2));
  });

  it("reads state without creating records and follows the Journal's test day", () => {
    const journal = freshStore(now);
    journal.testDays = 1;
    journal.pages["2026-10-02"] = { mood: 3, text: "Kept on the journal test day" };
    const saved = new Map([
      [ASSESSMENT_RESULT_KEY, JSON.stringify(assessment)],
      [EXERCISES_DONE_KEY, dayKey(now)], // A stale completion marker must not skip the second movement.
      [JOURNEY_SESSIONS_KEY, JSON.stringify({ [dayKey(now)]: { ex_reach: scored() } })],
      [JOURNAL_STORAGE_KEY, JSON.stringify(journal)],
    ]);
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: (key: string) => saved.get(key) ?? null, setItem });
    const state = loadHomeActionSnapshot(now);
    expect(state.journalPage?.text).toBe("Kept on the journal test day");
    expect(nextHomeAction(state, 0).kind).toBe("exercises");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("falls back to onboarding when browser storage is unavailable", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("Unavailable"); } });
    expect(nextHomeAction(loadHomeActionSnapshot(now), 0.99).kind).toBe("onboarding");
  });
});
