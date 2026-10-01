import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import JournalDayPages from "./JournalDayPages";
import { PAGE_PLACEHOLDER } from "@/lib/journal-days";

describe("Journal return visits", () => {
  it("shows the complete prompt and writing placeholder immediately on return", () => {
    const html = renderToStaticMarkup(createElement(JournalDayPages, { animateEntrance: false }));
    expect(html).toContain(`placeholder="${PAGE_PLACEHOLDER}"`);
    expect(html).not.toContain("dp-caret");
    expect(html).toMatch(/<p[^>]*aria-hidden="true"[^>]*>[^<]+<\/p>/);
    expect(html).toContain("Keep this page");
  });
  it("retains the initial typed prompt for a first visit", () => {
    const html = renderToStaticMarkup(createElement(JournalDayPages, { animateEntrance: true }));
    expect(html).toContain("dp-caret");
    expect(html).toContain('placeholder=""');
  });
});
