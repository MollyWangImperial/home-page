import { describe, expect, it } from "vitest";
import { getAssessmentUrl, isOnboardingLocation } from "./welcome";

describe("new-user welcome routing", () => {
  it("preserves the existing dashboard as the default route", () => {
    expect(isOnboardingLocation("/", "")).toBe(false);
    expect(isOnboardingLocation("/", "onboarding=1")).toBe(false);
    expect(isOnboardingLocation("/welcome", "")).toBe(true);
  });
  it("keeps the welcome navigation when talking with Alira", () => {
    expect(isOnboardingLocation("/alira", "onboarding=1")).toBe(true);
    expect(isOnboardingLocation("/alira", "?onboarding=1")).toBe(true);
    expect(isOnboardingLocation("/alira", "")).toBe(false);
    expect(isOnboardingLocation("/journey", "onboarding=1")).toBe(false);
  });
  it("only enables an explicitly configured HTTPS assessment destination", () => {
    expect(getAssessmentUrl("https://example.com/assessment")).toBe("https://example.com/assessment");
    for (const value of [undefined, null, "", " ", "not a url", "/assessment", "javascript:alert(1)", "http://example.com", "https://user:pass@example.com"]) {
      expect(getAssessmentUrl(value)).toBeNull();
    }
  });
});
