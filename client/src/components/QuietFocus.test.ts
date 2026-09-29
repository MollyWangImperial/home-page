import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import QuietFocus from "./QuietFocus";

function render(animateGreeting: boolean) {
  return renderToStaticMarkup(createElement(QuietFocus, {
    animateGreeting,
    headline: "Welcome to Rehyn, Zak.",
    message: "Hello Zak, I am Alira.",
    cta: "Let's begin",
    note: "You can pause at any point.",
    onStart: () => {},
    onReplay: () => {},
  }));
}

describe("Alira greeting presentation", () => {
  it("types characters and delays the invitation for the first daily visit", () => {
    const html = render(true);
    expect(html).toContain('data-greeting-motion="typing"');
    expect(html).toContain('class="welcome-dots"');
    expect(html).toContain('class="welcome-ch"');
    expect(html).toContain("animation-delay:");
    expect(html).toContain("Alira: Hello Zak, I am Alira.");
  });

  it("renders the complete message and invitation without typing or delays on later visits", () => {
    const html = render(false);
    expect(html).toContain('data-greeting-motion="static"');
    expect(html).toContain('aria-hidden="true">Hello Zak, I am Alira.</span>');
    expect(html).not.toContain('class="welcome-ch"');
    expect(html).not.toContain('class="welcome-dots"');
    expect(html).not.toContain("animation-delay:");
    expect(html).toContain('class="welcome-cta-row"');
  });
});
