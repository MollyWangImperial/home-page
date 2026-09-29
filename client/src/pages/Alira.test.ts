import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Alira from "./Alira";
import { ALIRA_VISIT_KEY } from "@/lib/alira-visit";
import { ONBOARDING_STORAGE_KEY, onboardingQuestions } from "@/lib/alira-onboarding";

const route = vi.hoisted(() => ({ search: "onboarding=1" }));
vi.mock("wouter", () => ({ useLocation: () => ["/alira", vi.fn()], useSearch: () => route.search }));
vi.mock("@/components/RecoveryShell", () => ({ default: ({ children }: { children: unknown }) => children }));

beforeEach(() => {
  route.search = "onboarding=1";
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Alira arrival", () => {
  it("stages the first entrance without the header assessment card", () => {
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain('data-entrance-motion="staged"');
    expect(html).not.toContain("ao-status-card");
  });

  it("shows the full welcome and all modules immediately on a return visit", () => {
    localStorage.setItem(ALIRA_VISIT_KEY, JSON.stringify({ started: false }));
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain('data-entrance-motion="static"');
    expect(html).toContain('class="ao-chat ao-reveal in"');
    expect(html).toContain("Hi Zak, I&#x27;m Alira.");
    expect(html).toContain("Before we plan anything");
    expect(html).not.toContain('class="ao-ch"');
    expect(html).not.toContain("ao-status-card");
  });

  it("shows the first question immediately when returning from Home", () => {
    route.search += "&from=home";
    localStorage.setItem(ALIRA_VISIT_KEY, JSON.stringify({ started: false }));
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain(onboardingQuestions[0].t);
    expect(html).toContain("Less than a month ago");
    expect(html).not.toContain("ao-status-card");
  });

  it("resumes the next unanswered question without typing", () => {
    localStorage.setItem(ALIRA_VISIT_KEY, JSON.stringify({ started: true }));
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ stroke_when: "1_3m" }));
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain(onboardingQuestions[1].t);
    expect(html).toContain("Left side");
    expect(html).not.toContain('class="ao-ch"');
    expect(html).not.toContain("ao-status-card");
  });

  it("keeps the movement-check action in the conversation after all questions", () => {
    localStorage.setItem(ALIRA_VISIT_KEY, JSON.stringify({ started: true }));
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(Object.fromEntries(onboardingQuestions.map(q => [q.k, q.o[0].v]))));
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain("Your movement check");
    expect(html).toContain("Start now");
    expect(html).not.toContain("Open in the Rehyn app instead");
    expect(html).not.toContain("Answer the questions again");
    expect(html).not.toContain("ao-status-card");
  });
});
