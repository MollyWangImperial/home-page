import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import Community from "@/pages/Community";

vi.mock("@/components/RecoveryShell", () => ({ default: ({ children }: { children: unknown }) => children }));

const page = (path: string) => renderToStaticMarkup(createElement(Router, { ssrPath: path }, createElement(Community))).replace(/ data-loc="[^"]*"/g, "");
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/\s+/g, " ");
/** Whether some opening tag of this kind carries every one of the given attributes, in any order. */
const tagWith = (html: string, name: string, ...attributes: string[]) =>
  (html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? []).some(tag => attributes.every(attribute => tag.includes(attribute)));

describe("My community views", () => {
  it("opens on the feed, with the preview note, the tabs and the side cards", () => {
    const html = page("/community");
    const text = words(html);
    expect(text).toContain("My community");
    expect(tagWith(html, "a", 'href="/community"', 'class="cm-tab is-active"', 'aria-current="page"')).toBe(true);
    for (const space of ["lounge", "circle", "groups"]) expect(tagWith(html, "a", `href="/community?space=${space}"`, 'class="cm-tab "')).toBe(true);
    expect(text).toContain("What's new with you, Zak?");
    for (const name of ["Margaret", "Tomasz", "Priya", "Joan"]) expect(text).toContain(name);
    expect(tagWith(html, "button", 'aria-label="Play Priya&#x27;s voice note, 12 seconds"')).toBe(true);
    expect(text).toContain("Words Sang the whole chorus");
    expect(tagWith(html, "button", 'class="cm-react cm-tone-love "', 'aria-pressed="false"')).toBe(true);
    expect(tagWith(html, "button", 'aria-expanded="false"', 'class="cm-comments-toggle"')).toBe(true);
    expect(text).toContain("Take your seat");
    expect(tagWith(html, "a", 'href="/community?space=groups&amp;group=garden"')).toBe(true);
    expect(tagWith(html, "a", 'href="/community?space=groups&amp;group=walk"')).toBe(true);
    expect(tagWith(html, "a", 'href="/community?space=start"')).toBe(true);
    expect(text).toContain("4 unread");
  });

  it("shows the lounge with its people, quick replies and the tea-break poll", () => {
    const html = page("/community?space=lounge");
    const text = words(html);
    expect(tagWith(html, "a", 'href="/community?space=lounge"', 'aria-current="page"')).toBe(true);
    expect(text).toContain("14 chatting now");
    expect(text).toContain("Alira's chat starter");
    expect(text).toContain("It does get lighter, promise.");
    expect(tagWith(html, "div", 'role="log"', 'aria-live="off"', 'tabindex="0"')).toBe(true);
    for (const reply of ["Hello everyone", "Me too", "Well done!", "Thinking of you"]) expect(text).toContain(reply);
    expect(tagWith(html, "button", 'aria-label="Send a heart"')).toBe(true);
    expect(tagWith(html, "button", 'aria-label="Send as a voice note"', 'aria-pressed="false"')).toBe(true);
    expect(text).toContain("Wave to Tomasz");
    expect(text).toContain("What's in your mug right now?");
    expect(text).toContain("Tap one to see what everyone picked");
  });

  it("shows the Sunday circle with an empty seat kept for the person", () => {
    const html = page("/community?space=circle");
    const text = words(html);
    expect(text).toContain("Nine of us here. One seat is yours.");
    expect(text).toContain("The teacup goes round. Whoever holds it speaks.");
    expect(text).toContain("Pause the teacup");
    expect(text).toContain("An empty seat, kept for you");
    expect(text).toContain("Alira · host has the teacup");
    expect(text).toContain("Take your seat");
    expect(text).toContain("Circles this week");
    expect(text).toContain("Rehyn won't send them yet");
  });

  it("opens a named group, with its challenge, the group list and suggestions", () => {
    const html = page("/community?space=groups&group=walk");
    const text = words(html);
    expect(html).toMatch(/<h2[^>]*id="cm-group-title"[^>]*>Morning walkers<\/h2>/);
    expect(text).toContain("This week: one walk a little further than last week");
    expect(tagWith(html, "span", 'role="progressbar"', 'aria-valuetext="5 of 8"')).toBe(true);
    expect(tagWith(html, "a", 'href="/community?space=groups&amp;group=walk"', 'class="cm-group-pick is-on"', 'aria-current="page"')).toBe(true);
    expect(text).toContain("Groups you might like");
    expect(text).toContain("Knit and natter");
    expect(text).toContain("+ Invite a friend");
  });

  it("falls back to the first group for an unknown group", () => {
    expect(page("/community?space=groups&group=mine-gone")).toMatch(/<h2[^>]*id="cm-group-title"[^>]*>Garden gang<\/h2>/);
  });

  it("starts a group in three steps, with a way back to the feed", () => {
    const html = page("/community?space=start");
    const text = words(html);
    expect(tagWith(html, "a", 'class="cm-back"', 'href="/community"')).toBe(true);
    expect(html).toMatch(/<h1[^>]*data-view-heading[^>]*>Start a group<\/h1>/);
    expect((html.match(/type="radio"/g) ?? []).length).toBe(10);
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(6);
    expect(text).toContain("Start the group");
    expect(text).toContain("Lovely idea, Zak.");
    expect(text).toContain("You and 2 friends");
    expect(html).not.toContain("cm-tabs");
  });
});
