import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Assessment from "./Assessment";
import { ONBOARDING_STORAGE_KEY } from "@/lib/alira-onboarding";

vi.mock("wouter", () => ({ useLocation: () => ["/assessment", vi.fn()], useSearch: () => "onboarding=1" }));
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());
describe("copied assessment host", () => {
  it("opens the camera runner full-screen with the new ladder and ordered tasks", () => {
    const html = renderToStaticMarkup(createElement(Assessment));
    expect(html).toContain('title="Rehyn movement check"');
    expect(html).toContain('allow="camera; microphone; autoplay; fullscreen"');
    expect(html).toContain('ladder=1');
    expect(html).toContain('task_ids=T1%2CT3%2CH4%2CH3%2CL6');
    expect(html).toContain('r160');
  });
  it("retains the left affected side from the Claude site's answers", () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ side_affected: "left" }));
    expect(renderToStaticMarkup(createElement(Assessment))).toContain('affected_side=left');
  });
  it("keeps the runner closed for someone reporting no arm movement and a wheelchair", () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ arm_hand_movement: "none", get_around: "wheelchair" }));
    const html = renderToStaticMarkup(createElement(Assessment));
    expect(html).toContain('supported movement');
    expect(html).not.toContain('<iframe');
  });
});
