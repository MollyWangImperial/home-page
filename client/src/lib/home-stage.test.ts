import { describe, expect, it } from "vitest";
import {
  dayKey,
  daysToReassessment,
  fillCopy,
  homeStage,
  homeStages,
  pickHeadline,
  pickOpener,
  REASSESSMENT_CYCLE_DAYS,
} from "./home-stage";

const done = (daysAgo: number, now: Date) => ({ id: "a1", completedAt: new Date(now.getTime() - daysAgo * 86400000).toISOString() });

describe("home page stages", () => {
  const now = new Date(2026, 8, 29, 14, 30);
  it("greets a patient without an assessment as on the first visit", () => {
    expect(homeStage(null, null, now)).toEqual({ stage: "assessment", days: REASSESSMENT_CYCLE_DAYS });
  });
  it("counts down daily exercises to the re-assessment two weeks after the first assessment", () => {
    expect(homeStage(done(5, now), null, now)).toEqual({ stage: "exercises", days: 9 });
    expect(daysToReassessment(done(0, now), now)).toBe(14);
    expect(daysToReassessment({ id: "a1", completedAt: "not a date" }, now)).toBe(REASSESSMENT_CYCLE_DAYS);
  });
  it("shows the rest note once today's exercises are done", () => {
    expect(homeStage(done(5, now), dayKey(now), now).stage).toBe("done_today");
    expect(homeStage(done(5, now), "2026-09-28", now).stage).toBe("exercises");
  });
  it("asks for the re-assessment once its date has arrived, even if it is overdue", () => {
    expect(homeStage(done(14, now), null, now)).toEqual({ stage: "reassessment", days: 0 });
    expect(homeStage(done(20, now), dayKey(now), now).stage).toBe("reassessment");
  });
  it("fills the name and the countdown into the copy", () => {
    expect(fillCopy("Hi {n}, your re-assessment is in {d}.", 1)).toBe("Hi Zak, your re-assessment is in 1 day.");
    expect(fillCopy("{D} until we check.", 9)).toBe("9 days until we check.");
  });
  it("keeps the fixed welcome headline for new patients and a time-of-day greeting otherwise", () => {
    expect(pickHeadline("assessment")).toBe("Welcome to Rehyn, {n}.");
    expect(pickHeadline("exercises", new Date(2026, 8, 29, 8), () => 0)).toBe("Good morning, {n}.");
    expect(pickHeadline("exercises", new Date(2026, 8, 29, 20), () => 0.99)).toBe("Lovely to see you, {n}.");
  });
  it("never repeats the previous opener when there is a choice, and every opener has a destination", () => {
    expect(pickOpener("exercises", 2, () => 0.5)).not.toBe(2);
    for (const stage of Object.values(homeStages)) for (const opener of stage.openers) expect(opener.href.startsWith("/")).toBe(true);
    expect(homeStages.reassessment.openers.every(o => o.href === "/assessment")).toBe(true);
    expect(homeStages.assessment.openers.every(o => o.href.includes("onboarding=1"))).toBe(true);
  });
});
