import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HowItWorksPanel, Markdown } from "./HowItWorks";
import { MollyProgressPanel } from "./MollyProgress";
import { ProjectHeatmap } from "./ProjectHeatmap";
import { startMollyChat } from "@/lib/molly-daily-chat";
import { HOW_IT_WORKS_VISIT_KEY } from "@/lib/how-it-works-visit";

afterEach(() => { vi.unstubAllGlobals(); });

describe("Settings chat views", () => {
  it("starts the help greeting without headers or premature suggestions", () => {
    const html = renderToStaticMarkup(createElement(HowItWorksPanel));
    expect(html).not.toContain("hw-head");
    expect(html).not.toContain("Suggested questions");
    expect(html).not.toContain("Hi Zak.");
    expect(html).toContain("hw-input");
  });
  it("shows the full help greeting and suggestions immediately after the first visit", () => {
    vi.stubGlobal("localStorage", { getItem: (key: string) => key === HOW_IT_WORKS_VISIT_KEY ? "1" : null });
    const html = renderToStaticMarkup(createElement(HowItWorksPanel));
    expect(html).toContain("Hi Zak. Ask me how Molly built Alira:");
    expect(html).toContain("Suggested questions");
    expect(html).toContain("How are exercise scores calculated?");
    expect(html).toContain("What is the difference between the two scores?");
    expect(html).not.toContain('class="chat-sr"');
  });
  it("has a progress question box without the removed header", () => {
    const html = renderToStaticMarkup(createElement(MollyProgressPanel, { onOpenExercises: () => {} }));
    expect(html).not.toContain("mp-head");
    expect(html).not.toContain("Show all");
    expect(html).toContain("Ask Alira about Molly");
    expect(html).toContain('aria-label="Send"');
  });
  it("shows today's saved report, Zak's history and full answers immediately without typing again", () => {
    const chat = startMollyChat({ updatedAt: "today", days: [] });
    chat.turns = [{ role: "user", text: "What did Molly change?" }, { role: "assistant", text: "Molly refined **today's chat**." }];
    chat.draft = "What comes next?";
    let raw: string | null = JSON.stringify(chat);
    vi.stubGlobal("localStorage", { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; }, removeItem: () => { raw = null; } });
    const html = renderToStaticMarkup(createElement(MollyProgressPanel, { onOpenExercises: () => {} }));
    expect(html).toContain("What did Molly change?");
    expect(html).toMatch(/<strong[^>]*>today&#x27;s chat<\/strong>/);
    expect(html).toContain("What comes next?");
    expect(html).toContain("mp-history");
    expect(html).not.toContain("Alira is typing");
    expect(html).not.toContain("Alira is opening Molly");
  });
  it("starts fresh the next day without rendering yesterday's history or draft", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const chat = startMollyChat({ updatedAt: "yesterday", days: [] }, yesterday);
    chat.turns = [{ role: "user", text: "Yesterday's question" }];
    chat.draft = "Yesterday's draft";
    let raw: string | null = JSON.stringify(chat);
    vi.stubGlobal("localStorage", { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; }, removeItem: () => { raw = null; } });
    const html = renderToStaticMarkup(createElement(MollyProgressPanel, { onOpenExercises: () => {} }));
    expect(html).not.toContain("Yesterday");
    expect(html).not.toContain("mp-history");
    expect(html).toContain("Alira is opening Molly");
    expect(raw).toBeNull();
  });
  it("renders unfinished table rows during character reveal without getting stuck", () => {
    for (const text of ["|", "| Score", "| Score |\n|", "| Score |\n| --- |\n| 30 |", "```ts\nconst a = 1"]) {
      expect(renderToStaticMarkup(createElement(Markdown, { text }))).toContain("hw-md");
    }
  });
  it("makes heatmap figures readable without colour and distinguishes unset estimates from zero", () => {
    const html = renderToStaticMarkup(createElement(ProjectHeatmap));
    expect(html).toContain("25% Easy-level design review, 75% left");
    expect(html).toContain("Assessment task design: In progress, percentage not estimated yet");
    expect(html).toContain("Web front end: Nearly finished, percentage not estimated yet");
    expect(html).toContain("Alira agentic development: Keeps learning");
    expect(html).not.toContain("0% left");
  });
});
