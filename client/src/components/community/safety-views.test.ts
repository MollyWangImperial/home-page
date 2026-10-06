import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { blankCommunityMemory, type CommunityMemory, type SafetyTarget } from "@/lib/community-store";
import Community from "@/pages/Community";
import FeedView from "./Feed";
import { SafetySheetSteps, type SheetStart, type SheetStep } from "./PostMenu";
import { SafetyPage } from "./SafetyView";

vi.mock("@/components/RecoveryShell", () => ({ default: ({ children }: { children: unknown }) => children }));

// Midday, so quiet time (9 pm to 8 am) never hides the alerts badge while the tests run.
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 6, 12, 0)); });
afterAll(() => { vi.useRealTimers(); });

const render = (path: string, element: ReactElement) => renderToStaticMarkup(createElement(Router, { ssrPath: path, children: element })).replace(/ data-loc="[^"]*"/g, "");
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/\s+/g, " ");
/** Whether some opening tag of this kind carries every one of the given attributes, in any order. */
const tagWith = (html: string, name: string, ...attributes: string[]) =>
  (html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? []).some(tag => attributes.every(attribute => tag.includes(attribute)));

/** Nothing leaves the device: no team reads reports, nobody is told, and nothing is recorded or sent. */
const PROMISES = [/rehyn team/i, /24 hours/i, /we check/i, /being checked/i, /\breceived\b/i, /moderat/i, /\breview/i, /notif/i, /tell us/i, /we'll include/i, /send report/i, /follow your report/i, /know it was you/i, /say it out loud/i, /listening/i];
const promises = (text: string) => PROMISES.filter(pattern => pattern.test(text)).map(String);

const safetyPage = (memory: CommunityMemory) =>
  render("/community?space=safety", createElement(SafetyPage, { memory, name: "Zak", warningSignsHref: "/fast-check?returnTo=%2F", onPersonMenu: () => {} }));
const sheet = (target: SafetyTarget, start?: SheetStart, path = "/community") =>
  render(path, createElement(SafetySheetSteps, { target, name: "Zak", titleId: "sheet-title", onClose: () => {}, start }));
const margaret: SafetyTarget = { who: "margaret", postId: "p-margaret" };

describe("the Safety page", () => {
  it("shows Gary blocked, what can be done, and links to Friends, Settings, Warning signs and Alira", () => {
    const html = render("/community?space=safety", createElement(Community));
    const text = words(html);
    expect(html).toMatch(/<h2[^>]*data-view-heading[^>]*>Safety<\/h2>/);
    expect(text).toContain("Your reports, blocked and hidden people");
    expect(text).toContain("You haven't reported anything.");
    expect(text).toContain("Gary Blocked 3 days ago");
    expect(tagWith(html, "button", 'class="cm-sa-pill"')).toBe(true);
    expect(text).toContain("Unblock Gary");
    expect(tagWith(html, "a", 'href="/community?space=safety&amp;panel=friends&amp;tab=blocked"', 'class="cm-sa-link"')).toBe(true);
    expect(tagWith(html, "a", 'href="/community?space=settings&amp;section=see"', 'class="cm-card cm-sa-settings"')).toBe(true);
    expect(html).toMatch(/<a[^>]*href="\/fast-check\?returnTo=[^"]*"[^>]*>See Warning signs<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/alira"[^>]*>Talk it through with Alira<\/a>/);
    for (const item of ["What you can do", "Hide someone's posts", "Block someone", "Report a post"]) expect(text).toContain(item);
    expect(text).toContain("Press More options on any post");
    expect(promises(words(safetyPage(blankCommunityMemory())))).toEqual([]);
  });

  it("lists each report as kept on this device, with what was said and a way to remove it", () => {
    const memory: CommunityMemory = {
      ...blankCommunityMemory(),
      reports: [{ id: "report-a", who: "gary", postId: "p-gary", reason: "health", note: "He sent me the same message too.", alsoBlock: true, createdAt: new Date(2026, 9, 6, 9, 10).getTime() }],
    };
    const html = safetyPage(memory);
    const text = words(html);
    expect(text).toContain("Gary · Unsafe health advice");
    expect(text).toContain("Saved today at 9:10 am");
    expect(text).toContain("“Message me for a herbal cure");
    expect(text).toContain("Your note: He sent me the same message too.");
    expect(text).toContain("Kept on this device");
    expect(text).toContain("Remove your report about Gary");
    expect(text).not.toContain("You haven't reported anything");
    expect(promises(text)).toEqual([]);
  });

  it("lists people and posts hidden, each with a way back and a ··· for more", () => {
    const memory: CommunityMemory = { ...blankCommunityMemory(), muted: { anne: Date.now() }, hiddenPosts: { "p-tomasz": Date.now() } };
    const html = safetyPage(memory);
    const text = words(html);
    expect(text).toContain("Anne Posts hidden today");
    expect(text).toContain("Show posts from Anne");
    expect(tagWith(html, "button", 'aria-label="More options for Anne"', 'aria-haspopup="dialog"')).toBe(true);
    expect(text).toContain("Tomasz's post Hidden today");
    expect(text).toContain("Show it (Tomasz's post)");
    expect(tagWith(html, "button", 'aria-label="More options for Tomasz&#x27;s post"')).toBe(true);
  });

  it("says when no one is blocked or hidden", () => {
    const text = words(safetyPage({ ...blankCommunityMemory(), blocks: { gary: 0 } }));
    expect(text).toContain("No one is blocked or hidden.");
    expect(text).not.toContain("Unblock");
  });
});

describe("the hide, block or report sheet", () => {
  it("marks the post it is about, and that post's ··· button, while it is open", () => {
    const html = render("/community", createElement(FeedView, { name: "Zak", here: 14, onMore: () => {}, openPostId: "p-margaret" }));
    expect(html).toMatch(/<article class="cm-card cm-post [^"]*is-acting"[^>]*>(?:(?!<\/article>)[\s\S])*aria-label="More options for Margaret&#x27;s post"[^>]*aria-expanded="true"/);
    expect((html.match(/is-acting/g) ?? []).length).toBe(1);
    expect((html.match(/aria-expanded="true"/g) ?? []).length).toBe(1);
    const closed = render("/community", createElement(FeedView, { name: "Zak", here: 14, onMore: () => {} }));
    expect(closed).not.toContain("is-acting");
    expect(tagWith(closed, "button", 'aria-label="More options for Margaret&#x27;s post"', 'aria-expanded="false"')).toBe(true);
  });

  it("opens on the menu: who it is about, then hide, block or report", () => {
    const html = sheet(margaret);
    const text = words(html);
    expect(html).toMatch(/<h2[^>]*id="sheet-title"[^>]*>Margaret<span class="cm-sr">&#x27;s post<\/span><\/h2>/);
    expect(tagWith(html, "h2", 'id="sheet-title"', 'tabindex="-1"')).toBe(true);
    expect(text).toContain("Leeds · your friend · in 2 of your groups");
    expect(text).toContain("Something not right? Choose what you'd like to do. Margaret won't be told.");
    expect(text).toContain("Hide Margaret's posts You stop seeing them. Nothing else changes.");
    expect(text).toContain("Block Margaret She can't see you, message you or find you.");
    expect(text).toContain("Report Margaret Say what's wrong. Your report stays on this device.");
    expect(text).toContain("Never mind");
    expect(tagWith(html, "button", 'aria-label="Close"')).toBe(true);
  });

  it("knows someone is already blocked", () => {
    const text = words(sheet({ who: "gary", postId: null }));
    expect(text).not.toContain("Hide Gary's posts");
    expect(text).toContain("Gary is blocked");
    expect(text).toContain("Joined 2 days ago · blocked · not in your groups");
    const details = words(sheet({ who: "gary", postId: null }, { step: "details", reason: "money" }));
    expect(details).toContain("Gary is already blocked.");
    expect(details).not.toContain("Also block Gary");
  });

  it("asks why first, with five reasons to press, and Next waits for one", () => {
    const html = sheet(margaret, { step: "reason" });
    const text = words(html);
    expect(text).toContain("Step 1 of 2");
    expect(html).toMatch(/<h2[^>]*id="sheet-title"[^>]*>What&#x27;s wrong with this post\?<\/h2>/);
    expect((html.match(/aria-pressed="false"/g) ?? []).length).toBe(5);
    for (const reason of ["Selling or asking for money", "Unsafe health advice", "Unkind or bullying", "Pretending to be someone", "Something else"]) expect(text).toContain(reason);
    expect(tagWith(html, "div", 'role="group"', 'aria-labelledby="sheet-title"')).toBe(true);
    expect(tagWith(html, "button", 'aria-disabled="true"', 'class="cm-sa-wide cm-sa-waiting"')).toBe(true);
    expect(tagWith(html, "p", 'role="status"')).toBe(true);
    const chosen = sheet(margaret, { step: "reason", reason: "health" });
    expect((chosen.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    expect(tagWith(chosen, "button", 'aria-disabled="false"', 'class="cm-sa-wide cm-sa-green"')).toBe(true);
  });

  it("then takes a note, quotes the post, and has Also block switched on", () => {
    const html = sheet(margaret, { step: "details", reason: "health" });
    const text = words(html);
    expect(text).toContain("Step 2 of 2");
    expect(text).toContain("This post · Unsafe health advice");
    expect(text).toContain("“First tomatoes off the windowsill!");
    expect(html).toMatch(/<textarea[^>]*maxlength="400"/i);
    expect(tagWith(html, "button", 'role="switch"', 'aria-checked="true"')).toBe(true);
    expect(text).toContain("Also block Margaret");
    expect(text).toContain("She won't be able to see you or message you");
    expect(text).toContain("Save report");
    expect(html).not.toMatch(/microphone|Say it out loud/i);
  });

  it("keeps a post covered by gentle mode or a hidden word out of the quote", () => {
    const gentle = words(sheet({ who: "samuel", postId: "p-samuel" }, { step: "details", reason: "other" }));
    expect(gentle).toContain("Covered by gentle mode: Samuel shares a hard day.");
    expect(gentle).not.toContain("couldn't manage the stairs");
    const hidden = words(sheet({ who: "anne", postId: "p-anne" }, { step: "details", reason: "other" }));
    expect(hidden).toContain("one of your hidden words");
    expect(hidden).not.toContain("Back at the hospital");
  });

  it("reports a person, rather than a post, without quoting anything", () => {
    const html = sheet({ who: "liwei", postId: null }, { step: "details", reason: "unkind" });
    expect(words(html)).toContain("About Li Wei · Unkind or bullying");
    expect(words(html)).toContain("They won't be able to see you or message you");
    expect(html).not.toContain("cm-sa-quote-text");
    expect(words(sheet({ who: "liwei", postId: null }, { step: "reason" }))).toContain("What's wrong?");
  });

  it("ends with thanks, and says only what really happened on this device", () => {
    const html = sheet(margaret, { step: "sent", reason: "health", outcome: { blocked: true, postHidden: false } });
    const text = words(html);
    expect(html).toMatch(/<h2[^>]*id="sheet-title"[^>]*>Thank you, Zak\.<\/h2>/);
    expect(text).toContain("Your report is saved on this device.");
    expect(text).toContain("Margaret won't be told.");
    expect(text).toContain("Margaret is blocked, so you won't see her posts.");
    expect(text).not.toContain("This post is hidden for you.");
    expect(text).toContain("Back to the feed");
    expect(html).toMatch(/<a[^>]*href="\/community\?space=safety"[^>]*>See my reports<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/alira"[^>]*>Feeling shaken\? Talk it through with Alira<\/a>/);
  });

  it("says Done rather than Back to the feed when it opened somewhere else", () => {
    const text = words(sheet(margaret, { step: "sent", reason: "other", outcome: { blocked: false, postHidden: true } }, "/community?space=safety"));
    expect(text).toContain("This post is hidden for you.");
    expect(text).not.toContain("is blocked, so");
    expect(text).not.toContain("Back to the feed");
    expect(text).toContain("Done");
  });

  it("says what blocking does before blocking, and offers Undo after", () => {
    const block = words(sheet(margaret, { step: "block" }));
    expect(block).toContain("Block Margaret?");
    expect(block).toContain("She can't see your posts or comments.");
    expect(block).toContain("She can't message you or send a friend request.");
    expect(block).toContain("She won't be told. You can unblock any time.");
    expect(block).toContain("Cancel");
    expect(block).toContain("Report Margaret as well");
    const blocked = words(sheet(margaret, { step: "blocked", blockedHere: true }));
    expect(blocked).toContain("Margaret is blocked");
    expect(blocked).toContain("Unblock her any time from Safety.");
    expect(blocked).toContain("Undo : unblock Margaret");
  });

  it("hides someone's posts, offering a block instead", () => {
    const text = words(sheet({ who: "liwei", postId: null }, { step: "muted" }));
    expect(text).toContain("Li Wei's posts are hidden");
    expect(text).toContain("Li Wei won't be told. If they are bothering you, blocking stops that too.");
    expect(text).toContain("Block them instead");
  });

  it("never promises a team, a review, a recording or anyone being told", () => {
    const steps: SheetStep[] = ["menu", "reason", "details", "sent", "block", "blocked", "muted"];
    for (const step of steps) {
      const text = words(sheet(margaret, { step, reason: "money", outcome: { blocked: true, postHidden: false }, blockedHere: true }));
      expect({ step, found: promises(text) }).toEqual({ step, found: [] });
    }
  });
});
