import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import JourneyProgress from "./JourneyProgress";
import { rememberAssessment, rememberAssessmentPlan } from "@/lib/assessment";
import { recordExerciseResult } from "@/lib/journey";

vi.mock("wouter", async importOriginal => ({ ...await importOriginal<typeof import("wouter")>(), useLocation: () => ["/journey", vi.fn()] }));

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 2, 10));
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function prepareCandidatePlan() {
  const report = {
    id: "start-policy-test", metrics: { function_score: { display_total: 100, areas: { hand: { display_score: 100 } }, tasks: [] } },
    clinical_review_gate: { rehab_access: "blocked", patient_message: "These are exercise choices to review. Your sitting support needs have not yet been confirmed." },
    rehab_plan: ["ex_grasp", "supported_only"].map(id => ({ id, name: id === "ex_grasp" ? "Cylindrical Grasp and Transport" : "Supported movement", description: "A prepared plan entry.", sets: 1, reps: 6, frequency: "Daily" })),
  };
  rememberAssessmentPlan(rememberAssessment(report)!, report, true);
}

it("shows Start for reach and development exercises without the removed review notice", () => {
  prepareCandidatePlan();
  const html = renderToStaticMarkup(createElement(JourneyProgress));
  expect(html).toContain('aria-label="Start Graded Forward Reach"');
  expect(html).toContain('aria-label="Start Cylindrical Grasp and Transport"');
  expect(html).toContain('aria-label="Start Supported movement"');
  expect(html).not.toMatch(/Paused|sitting support needs|choices to review|Open in Rehyn/);
});

it("keeps Start available after reach completes while showing the saved score and rest invitation", () => {
  prepareCandidatePlan();
  recordExerciseResult("ex_reach", 80);
  const html = renderToStaticMarkup(createElement(JourneyProgress));
  expect(html).toContain("Rest well.");
  expect(html).toContain('aria-label="Start Graded Forward Reach"');
  expect(html).toContain('aria-label="Start Cylindrical Grasp and Transport"');
  expect(html).toContain('class="jp-plan-score"');
});
