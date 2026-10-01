import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import JourneyExercises from "./JourneyExercises";
import { rememberAssessment } from "@/lib/assessment";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

it("shows the plan dose and readable goal without the removed preview note", () => {
  rememberAssessment({ preview_only: true, testing_random: true, metrics: { function_score: { areas: { upper_limb: { display_score: 50 } }, tasks: [] } },
    rehab_plan: [{ id: "ex_h2m", name: "Hand-to-Mouth ADL Practice", description: "A virtual cup appears.", sets: 3, reps: 10, frequency: "Twice daily", linked_goal: "eating" }] });
  const html = renderToStaticMarkup(createElement(JourneyExercises));
  expect(html).toContain('id="exercises"');
  expect(html).toContain("Hand-to-Mouth ADL Practice");
  expect(html).toContain("Twice daily");
  expect(html).toContain("Eating and drinking without help");
  expect(html).not.toContain("random test scores");
  expect(html).toContain("Arm 50/100");
});

it("does not invent exercises when the selector asks for supported movement", () => {
  rememberAssessment({ preview_only: true, metrics: { function_score: { areas: {}, tasks: [] } }, rehab_plan: [], function_rehab_plan: { caregiver_domains: ["hand"] } });
  const html = renderToStaticMarkup(createElement(JourneyExercises));
  expect(html).toContain("start with supported movement");
  expect(html).not.toContain("View exercise");
});

it("retains the safety-review explanation for candidate plans", () => {
  rememberAssessment({ preview_only: true, metrics: { function_score: { areas: {}, tasks: [] } }, rehab_plan: [], clinical_review_gate: { rehab_access: "blocked", patient_message: "Sitting support needs have not yet been confirmed." } });
  expect(renderToStaticMarkup(createElement(JourneyExercises))).toContain("Sitting support needs have not yet been confirmed");
});
