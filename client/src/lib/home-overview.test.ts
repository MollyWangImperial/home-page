import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HomeOverview from "@/components/HomeOverview";
import type { StoredAssessment } from "./assessment";
import { dayKey } from "./home-stage";
import { nextHomeAction, type HomeActionSnapshot } from "./home-next-action";
import { activityDuration, aliraLine, nextStep, progressAreas, weekDays } from "./home-overview";

const now = new Date(2026, 9, 7, 14); // Wednesday 7 October
const assessment: StoredAssessment = {
  id: "overview-test", completedAt: new Date(2026, 9, 5, 14).toISOString(), planChatCompleted: true,
  report: {
    metrics: { function_score: { display_total: 60, areas: { upper_limb: { display_score: 62 }, hand: { display_score: 46 }, lower_limb: { display_score: 72 } }, tasks: [] } },
    rehab_plan: ["ex_reach", "ex_h2m", "ex_handopen"].map(id => ({ id, name: id, description: "Test movement", sets: 1, reps: 6, frequency: "Daily", difficulty: "easy" })),
  },
};
const scored = { score: 70, at: now.toISOString() };
const snapshot = (changes: Partial<HomeActionSnapshot> = {}): HomeActionSnapshot => ({ assessment, now, sessions: {}, sharingConfigured: false, ...changes });
const stepFor = (state: HomeActionSnapshot) => nextStep(nextHomeAction(state, 0), state);

describe("the home page's next step", () => {
  it("counts getting started in three steps", () => {
    expect(stepFor(snapshot({ assessment: null }))).toMatchObject({ title: "Let’s get to know you.", step: { current: 1, total: 3, label: "Step 1 of 3" } });
    expect(stepFor(snapshot({ assessment: { id: "unfinished", completedAt: assessment.completedAt } }))).toMatchObject({ step: { label: "Step 2 of 3" } });
    expect(stepFor(snapshot({ assessment: { ...assessment, planChatCompleted: false } }))).toMatchObject({ title: "Your plan is almost ready.", step: { label: "Step 3 of 3" } });
  });

  it("follows today's exercise and gives the duration a clock", () => {
    // Only the everyday reach is ready for patients, so today has one exercise and no steps to count.
    expect(stepFor(snapshot())).toMatchObject({ title: "A gentle start for today.", cta: expect.any(String), timed: true, step: null });
    const done = snapshot({ sessions: { [dayKey(now)]: { ex_reach: scored } } });
    expect(stepFor(done)).toMatchObject({ timed: false, step: { current: 1, total: 1, label: "Done for today" } });
  });

  it("has no step count on re-assessment day", () => {
    const due = snapshot({ assessment: { ...assessment, completedAt: new Date(2026, 8, 23, 14).toISOString() } });
    expect(stepFor(due)).toMatchObject({ title: "Time to see how far you’ve come.", step: null });
  });
});

describe("the home page's progress and week", () => {
  it("shows each area of the latest movement check, and says when one wasn't measured", () => {
    expect(progressAreas(assessment).map(area => [area.label, area.value, area.status])).toEqual([
      ["Reaching", 62, "Building"], ["Hand control", 46, "Building"], ["Moving about", 72, "Steady"],
    ]);
    expect(progressAreas(null).every(area => area.tone === "unmeasured" && area.value === null)).toBe(true);
  });

  it("ticks the days with a scored exercise, Monday to Sunday", () => {
    const week = weekDays(now, { "2026-10-05": { ex_reach: scored }, "2026-10-07": { ex_h2m: scored }, "2026-10-04": { ex_reach: scored } });
    expect(week.map(day => [day.letter, day.date, day.state])).toEqual([
      ["M", 5, "done"], ["T", 6, "missed"], ["W", 7, "today-done"], ["T", 8, "future"], ["F", 9, "future"], ["S", 10, "future"], ["S", 11, "future"],
    ]);
    expect(week[2].label).toBe("Wednesday 7 October, today, practised");
    expect(weekDays(new Date(2026, 9, 11, 9), {}).map(day => day.state).slice(-2)).toEqual(["missed", "today"]);
  });

  it("gives Alira a line for each stage and durations only where the activity states one", () => {
    expect(aliraLine("assessment")).toContain("before we begin");
    expect(aliraLine("exercises")).toBe("Questions about your plan? I can help.");
    expect(activityDuration("sounds")).toBe("20 min");
    expect(activityDuration("breathing")).toBeNull();
  });
});

describe("the home page layout", () => {
  const render = (animate: boolean) => renderToStaticMarkup(createElement(HomeOverview, {
    headline: "Good afternoon, Molly.",
    next: stepFor(snapshot({ assessment: null })),
    onStart: () => {},
    areas: progressAreas({ ...assessment, report: { ...assessment.report, metrics: { function_score: { display_total: 60, areas: { upper_limb: { display_score: 62 } }, tasks: [] } } } }),
    alira: { line: "Questions about your plan? I can help.", animate, run: 0, onReplay: () => {}, onTalk: () => {} },
    week: weekDays(now, {}),
    activity: { id: "sounds", title: "Listen for a while", body: "Rain on the window, for twenty minutes.", duration: "20 min", onOpen: () => {} },
  }));

  it("renders every card from the design with the patient's own values", () => {
    const html = render(false);
    for (const text of ["Good afternoon, Molly.", "Your recovery, at a glance.", "Next step", "Let’s get to know you.", "Step 1 of 3", "Your progress", "Reaching", "Not measured yet", "This week", "Optional activity", "Listen for a while", "20 min", "Talk with Alira"]) {
      expect(html).toContain(text);
    }
    // Scores are drawn as bars, not printed; only assistive technology hears the number.
    expect(html).toContain('aria-valuetext="62 out of 100"');
    expect(html).not.toContain(">62<");
    // An area the check didn't measure has an empty bar.
    expect(html.match(/class="ho-fill"/g)).toHaveLength(2);
    expect(html).not.toContain("See details");
  });

  it("types Alira's line only when the greeting is new today", () => {
    expect(render(true)).toContain("Alira is typing");
    expect(render(true)).toContain('class="ho-ch"');
    expect(render(false)).not.toContain("Alira is typing");
  });
});
