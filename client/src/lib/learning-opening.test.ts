import { describe, expect, it } from "vitest";
import { emptyAdaptation, NO_CONSENT, type AdaptationState, type ChangeEntry, type LearningSummary } from "@shared/alira-adaptation";
import { learningOpening } from "./learning-opening";

const today = "2026-10-01";
const change: ChangeEntry = { id: "c1", day: today, at: "2026-10-01T09:30:00Z", param: "exercise.hold_seconds", from: 1.5, to: 1.2, why: "Short holds.", evidence: ["Your best reach was held for 1.1 seconds."], by: "alira", trigger: "warm_rep" };
const review: LearningSummary = { id: "s1", day: today, at: change.at, trigger: "warm_rep", text: "Long admin report.", patientNote: "Holding felt harder today.", changeIds: [change.id], rejected: [], model: "test" };
const state = (over: Partial<AdaptationState> = {}): AdaptationState => ({ ...emptyAdaptation(), values: { [change.param]: change.to }, log: [change], summaries: [review], ...over });
const opening = (data = state(), shared = true, name = "Zak") => learningOpening({ state: data, consent: { ...NO_CONSENT, movement: shared }, today, name });

describe("Alira's personal learning opening", () => {
  it("uses the saved name, evidence and actual applied change", () => {
    const message = opening(undefined, true, "Alex");
    expect(message).toContain("Hi Alex.");
    expect(message).toContain("latest review today");
    expect(message).toContain(change.evidence[0]);
    expect(message).toContain("**Hold at the target** from **1.5 s** to **1.2 s** for you");
    expect(message).not.toContain("Long admin report");
  });
  it("does not invent findings or changes before the first review", () => {
    expect(opening(emptyAdaptation())).toContain("I haven't completed a learning review for you yet");
    expect(opening(emptyAdaptation(), false)).toContain("I haven't reviewed your movement results or made any learning adjustments yet");
  });
  it("hides earlier patient findings after sharing is withdrawn without denying previous changes", () => {
    const message = opening(state(), false);
    expect(message).toContain("Your existing settings remain in place");
    expect(message).not.toContain(change.evidence[0]);
    expect(message).not.toContain(review.patientNote);
    expect(message).not.toContain("haven't reviewed your movement results");
  });
  it("uses the latest no-change review instead of implying an earlier change is new", () => {
    const message = opening(state({ summaries: [review, { ...review, id: "s2", at: "2026-10-01T10:30:00Z", patientNote: "Your reaches were steady in this review.", changeIds: [] }] }));
    expect(message).toContain("Your reaches were steady in this review.");
    expect(message).toContain("I kept your settings unchanged in that review");
    expect(message).not.toContain("I changed");
  });
  it("dates older reviews and ignores a future review", () => {
    const oldDay = "2026-09-30";
    const message = opening(state({ log: [{ ...change, day: oldDay }], summaries: [{ ...review, day: oldDay }, { ...review, id: "future", day: "2026-10-02", patientNote: "Future finding." }] }));
    expect(message).toContain("latest review on 30 Sept 2026");
    expect(message).not.toContain("latest review today");
    expect(message).not.toContain("Future finding");
  });
  it.each([
    state({ values: {}, log: [{ ...change, revertedAt: "2026-10-01T10:00:00Z" }] }),
    state({ values: { [change.param]: 1.4 }, log: [change, { ...change, id: "c2", at: "2026-10-01T10:00:00Z", from: 1.2, to: 1.4, by: "admin" }] }),
    state({ values: { [change.param]: 1.2 }, log: [change, { ...change, id: "c2", from: 1.4, to: 1.2, by: "admin" }] }),
  ])("does not present undone or replaced adjustments as current", data => {
    const message = opening(data);
    expect(message).toContain("undone or replaced");
    expect(message).not.toContain("I changed **Hold at the target**");
  });
  it("does not attribute an admin's change or a refused proposal to Alira", () => {
    const message = opening(state({ log: [{ ...change, by: "admin" }], summaries: [{ ...review, changeIds: [], rejected: [{ param: change.param, reason: "Out of range." }] }] }));
    expect(message).toContain("I kept your settings unchanged");
    expect(message).not.toContain("I changed");
  });
  it("does not claim a logged adjustment when its record is missing", () => {
    expect(opening(state({ log: [] }))).toContain("I can't confirm the recorded adjustments");
  });
});
