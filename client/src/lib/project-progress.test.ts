import { describe, expect, it } from "vitest";
import { EXERCISE_DESIGN_REVIEW, PROJECT_PROGRESS, progressPercentages } from "@shared/project-progress";
import { EXERCISES } from "./exercise-engine/config";

describe("Project design progress", () => {
  it("measures the reviewed Easy designs against the current exercise catalogue", () => {
    expect(EXERCISE_DESIGN_REVIEW.total).toBe(Object.keys(EXERCISES).length);
    for (const id of EXERCISE_DESIGN_REVIEW.reviewed) expect(EXERCISES[id]).toBeDefined();
    expect(PROJECT_PROGRESS.areas.find(area => area.id === "exercise")).toMatchObject({ completedPercent: 25, remainingPercent: 75, measure: "Easy-level design review" });
  });
  it("keeps unagreed figures and continuous learning out of the completion scale", () => {
    expect(PROJECT_PROGRESS.areas.find(area => area.id === "assessment")).toMatchObject({ completedPercent: null, remainingPercent: null });
    expect(PROJECT_PROGRESS.areas.find(area => area.id === "frontend")).toMatchObject({ status: "Nearly finished", completedPercent: null, remainingPercent: null });
    expect(PROJECT_PROGRESS.areas.find(area => area.id === "alira")).toMatchObject({ status: "Keeps learning", completedPercent: null, remainingPercent: null });
  });
  it("calculates the remaining share only from a valid agreed estimate", () => {
    expect(progressPercentages(92.5)).toEqual({ completedPercent: 92.5, remainingPercent: 7.5 });
    expect(progressPercentages(0)).toEqual({ completedPercent: 0, remainingPercent: 100 });
    expect(progressPercentages(100)).toEqual({ completedPercent: 100, remainingPercent: 0 });
    for (const value of [null, NaN, -1, 101]) expect(progressPercentages(value)).toEqual({ completedPercent: null, remainingPercent: null });
  });
});
