import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Alira from "./Alira";

const route = vi.hoisted(() => ({ search: "" }));
vi.mock("wouter", () => ({ useLocation: () => ["/alira", vi.fn()], useSearch: () => route.search }));
vi.mock("@/components/RecoveryShell", () => ({ default: ({ children }: { children: unknown }) => children }));

beforeEach(() => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Alira from a medal", () => {
  it("opens straight on the medal and offers its next step", () => {
    route.search = "medal=baseline";
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain('data-entrance-motion="static"');
    expect(html).toMatch(/Working towards <b[^>]*>Baseline Set<\/b>/);
    expect(html).toContain("Baseline Set is yours when you complete your first assessment.");
    expect(html).toContain("Start my assessment");
    expect(html).toContain("Not now");
  });

  it("keeps the usual welcome when the medal is unknown", () => {
    route.search = "medal=not-a-medal";
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain('data-entrance-motion="staged"');
    expect(html).not.toContain("Working towards");
  });
});
