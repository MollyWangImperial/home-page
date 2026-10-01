import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import MedalCollection from "./MedalCollection";

vi.mock("wouter", () => ({ useLocation: () => ["/journey", vi.fn()] }));

describe("Medals tab", () => {
  it("counts only the medals collected, never how many are left", () => {
    const html = renderToStaticMarkup(createElement(MedalCollection));
    expect(html).toMatch(/<b[^>]*>1<\/b> medal collected/);
    expect(html).not.toMatch(/of \d+ earned/);
  });

  it("shows the latest medal without a button, and what is within reach next", () => {
    const html = renderToStaticMarkup(createElement(MedalCollection));
    expect(html).toContain("LATEST MEDAL");
    expect(html).toContain("You finished your first session. Well done for starting.");
    expect(html).toContain("Within reach next");
    expect(html).toContain("Complete your first assessment");
    expect(html).not.toContain("Up next");
  });

  it("shows each medal by icon and name only, with the details kept for the pop-up", () => {
    const html = renderToStaticMarkup(createElement(MedalCollection));
    expect(html).toContain("Seven Sunrises");
    expect(html).not.toContain("Practise seven days in a row.");
  });

  it("copes with a patient who has not earned a medal yet", () => {
    const html = renderToStaticMarkup(createElement(MedalCollection, { earned: [] }));
    expect(html).toMatch(/<b[^>]*>0<\/b> medals collected/);
    expect(html).not.toContain("LATEST MEDAL");
    expect(html).toContain("Within reach next");
  });
});
