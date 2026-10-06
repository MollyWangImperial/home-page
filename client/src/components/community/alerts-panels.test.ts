import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { ALERT_IDS, communityAlerts } from "@/content/community-samples";
import { blankCommunityMemory, defaultCommunitySettings, type CommunityMemory, type CommunityPlace } from "@/lib/community-store";
import AlertsPanel from "./AlertsPanel";
import CommunitySearch from "./CommunitySearch";
import FindPanel from "./FindPanel";
import {
  alertLabel,
  alertLink,
  alertOutcome,
  breakEndLabel,
  clockLabel,
  findInCommunity,
  fold,
  foundLabel,
  friendChangeNote,
  highlight,
  matchScore,
  newAlertIds,
  quietNote,
  shownAlerts,
} from "./alerts-helpers";

// The panels read the person's record through useCommunity(). Here it reads the record each test
// sets up, so the panels can be drawn with requests answered, people blocked, groups joined.
const held = vi.hoisted(() => ({ memory: null as CommunityMemory | null }));
vi.mock("@/lib/community-store", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/community-store")>();
  return { ...actual, useCommunity: () => held.memory ?? actual.blankCommunityMemory() };
});

// Midday on Tuesday 6 October, so quiet time (9 pm to 8 am) is not on unless a test says so.
const MIDDAY = new Date(2026, 9, 6, 12, 0);
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(MIDDAY); });
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => { vi.setSystemTime(MIDDAY); held.memory = blankCommunityMemory(); });

const FEED: CommunityPlace = { space: "feed", group: null };
const LOUNGE: CommunityPlace = { space: "lounge", group: null };
const noop = () => {};
const memory = (change: Partial<CommunityMemory>): CommunityMemory => ({ ...blankCommunityMemory(), ...change });

const render = (element: ReactElement, path: string) => renderToStaticMarkup(createElement(Router, { ssrPath: path, children: element })).replace(/ data-loc="[^"]*"/g, "");
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/\s+/g, " ");
/** The opening tags of this kind that carry every one of the given attributes, in any order. */
const tags = (html: string, name: string, ...attributes: string[]) =>
  (html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? []).filter(tag => attributes.every(attribute => tag.includes(attribute)));
const tagWith = (html: string, name: string, ...attributes: string[]) => tags(html, name, ...attributes).length > 0;

const alertsPanel = (over = FEED, path = "/community") =>
  render(createElement(AlertsPanel, { onClose: noop, anchor: null, over, fallbackFocus: () => null }), path);
const findPanel = (over = FEED, path = "/community") =>
  render(createElement(FindPanel, { onClose: noop, anchor: null, over, fallbackFocus: () => null }), path);
const results = (query: string, over = FEED, path = "/community") =>
  render(createElement(CommunitySearch, { results: findInCommunity(held.memory ?? blankCommunityMemory(), query, over), over, onClose: noop }), path);

describe("the Alerts panel", () => {
  it("is a dialog listing the four new alerts, each a link to where it happened", () => {
    const html = alertsPanel();
    const text = words(html);
    expect(tagWith(html, "div", 'role="dialog"', 'aria-modal="true"', 'class="cm-dialog cm-dialog-panel cm-al-panel"')).toBe(true);
    const heading = html.match(/<h2 id="([^"]+)"[^>]*>Alerts<\/h2>/);
    expect(heading).not.toBeNull();
    expect(tagWith(html, "div", 'role="dialog"', `aria-labelledby="${heading?.[1]}"`)).toBe(true);
    expect(html).toContain("<p>4 new</p>");
    expect(tags(html, "a", 'class="cm-al-row is-new"')).toHaveLength(4);
    expect(tagWith(html, "a", 'href="/community?space=circle"', "cm-al-row is-new")).toBe(true);
    expect(tagWith(html, "a", 'href="/community?space=groups&amp;group=garden"', "cm-al-row is-new")).toBe(true);
    // Both friend requests open the Friends drawer at For you, over the feed.
    expect(tags(html, "a", 'href="/community?panel=friends"', "cm-al-row is-new")).toHaveLength(2);
    expect(tagWith(html, "a", 'aria-label="Joan wants to be friends, new. Saw you in Garden gang. Fancy being friends? 10 minutes ago."')).toBe(true);
    expect(tags(html, "span", 'class="cm-al-new"')).toHaveLength(4);
    expect(text).toContain("Margaret: First tomatoes!");
    expect(text).not.toContain("Earlier");
    expect(text).not.toContain("quiet time until");
    // The foot says when the badge stays quiet, and links to Community settings, at Quiet times, to change it.
    expect(tagWith(html, "a", 'href="/community?space=settings&amp;section=quiet"', "cm-dialog-foot-link")).toBe(true);
    expect(text).toContain("Quiet time: 9 pm to 8 am Change");
  });

  it("opens a friend request over the view the person is on", () => {
    const html = alertsPanel(LOUNGE, "/community?space=lounge");
    expect(tags(html, "a", 'href="/community?space=lounge&amp;panel=friends"', "cm-al-row")).toHaveLength(2);
    expect(tagWith(html, "a", 'href="/community?space=circle"', "cm-al-row")).toBe(true);
    expect(tagWith(html, "a", 'href="/community?space=groups&amp;group=garden"', "cm-al-row")).toBe(true);
  });

  it("says when there is nothing new, and keeps the earlier alerts", () => {
    held.memory = memory({ seenAlerts: [...ALERT_IDS] });
    const html = alertsPanel();
    const text = words(html);
    expect(html).toContain("<p>Nothing new</p>");
    expect(text).toContain("All caught up. Nothing new since you last looked.");
    expect(text).toContain("Earlier");
    expect(tags(html, "a", 'class="cm-al-row "')).toHaveLength(4);
    expect(html).not.toContain('class="cm-al-new"');
  });

  it("follows what has happened since: a friend accepted, a request declined, a group read, a seat taken", () => {
    held.memory = memory({ answers: { joan: "accepted", liwei: "declined" }, read: ["garden"], seated: true });
    const html = alertsPanel();
    for (const outcome of ["Friends now", "You chose not now", "You&#x27;ve caught up", "You took your seat"]) expect(html).toContain(`${outcome}</span>`);
    expect(html).toContain("<p>Nothing new</p>");
  });

  it("leaves out a request from someone blocked, and a message from someone hidden", () => {
    held.memory = memory({ blocks: { joan: Date.now() }, muted: { margaret: Date.now() } });
    const html = alertsPanel();
    const text = words(html);
    expect(text).not.toContain("Joan wants to be friends");
    expect(text).toContain("Li Wei wants to be friends");
    expect(text).toContain("3 new messages in Garden gang");
    expect(text).not.toContain("First tomatoes");
    expect(html).toContain("<p>3 new</p>");
  });

  it("explains quiet time and a break, which keep the badge quiet", () => {
    vi.setSystemTime(new Date(2026, 9, 6, 22, 0));
    expect(words(alertsPanel())).toContain("It's quiet time until 8 am, so the Alerts badge stays quiet. Your alerts are still here.");
    vi.setSystemTime(MIDDAY);
    held.memory = memory({ settings: { ...defaultCommunitySettings(), breakChoice: "day", breakUntil: Date.now() + 86_400_000 } });
    const text = words(alertsPanel());
    expect(text).toContain("You're taking a break until 12 pm tomorrow, so the Alerts badge stays quiet. Nothing is deleted.");
    expect(text).toContain("On a break until 12 pm tomorrow Change");
  });
});

describe("the Find panel", () => {
  it("is a dialog with the search box ready and the places one tap away", () => {
    const html = findPanel();
    const text = words(html);
    expect(tagWith(html, "div", 'role="dialog"', 'aria-modal="true"', 'class="cm-dialog cm-dialog-panel cm-al-find"')).toBe(true);
    expect(html).toMatch(/<h2 id="[^"]+"[^>]*>Find<\/h2>/);
    expect(tagWith(html, "input", 'type="search"', "data-autofocus", 'placeholder="A name, a group or a place"')).toBe(true);
    expect(tagWith(html, "p", 'role="status"', 'class="cm-al-find-count"')).toBe(true);
    for (const href of ["/community", "/community?space=lounge", "/community?space=circle", "/community?space=groups", "/community?space=start", "/community?panel=friends", "/community?space=safety", "/community?space=settings"]) {
      expect(tagWith(html, "a", `href="${href}"`, "cm-al-find-place")).toBe(true);
    }
    expect(tagWith(html, "a", 'href="/community"', 'aria-current="page"', 'aria-label="Feed, you&#x27;re here"')).toBe(true);
    expect(text).toContain("2 requests waiting");
    expect(text).toContain("4 unread messages");
  });

  it("opens the Friends drawer over the view the person is on", () => {
    const html = findPanel(LOUNGE, "/community?space=lounge");
    expect(tagWith(html, "a", 'href="/community?space=lounge&amp;panel=friends"', "cm-al-find-place")).toBe(true);
    expect(tagWith(html, "a", 'href="/community?space=lounge"', 'aria-current="page"')).toBe(true);
  });
});

describe("what Find finds", () => {
  it("finds people, groups and places by name or by what is said about them, best first", () => {
    const blank = blankCommunityMemory();
    const gar = findInCommunity(blank, "gar", FEED);
    expect(gar.groups.map(item => item.group.id)).toEqual(["garden"]);
    // Margaret has "gar" in her name; Joan is in Garden gang.
    expect(gar.people.map(item => item.who)).toEqual(["margaret", "joan"]);
    expect(foundLabel(gar)).toBe("2 people and 1 group found");
    expect(findInCommunity(blank, "liwei", FEED).people.map(item => item.who)).toEqual(["liwei"]);
    expect(findInCommunity(blank, "LI WEI", FEED).people.map(item => item.who)).toEqual(["liwei"]);
    expect(findInCommunity(blank, "quiet", FEED).places.map(place => place.id)).toEqual(["settings"]);
    expect(findInCommunity(blank, "blocked", FEED).places.map(place => place.id)).toEqual(["friends-blocked", "safety"]);
    expect(findInCommunity(blank, "friends", FEED).places.map(place => place.id)).toEqual(["friends", "friends-list"]);
    const joan = findInCommunity(blank, "joan", FEED);
    expect(joan.people.map(item => item.who)).toEqual(["joan"]);
    expect(joan.suggested.map(group => group.id)).toEqual(["knit"]);
    const none = findInCommunity(blank, "zzz", FEED);
    expect(none.total).toBe(0);
    expect(foundLabel(none)).toBe("Nothing found");
    expect(findInCommunity(blank, "   ", FEED).browse.map(place => place.id)).toEqual(["feed", "lounge", "circle", "groups", "start", "friends", "safety", "settings"]);
  });

  it("never finds someone blocked, and Gary is not one of the people to find", () => {
    expect(findInCommunity(memory({ blocks: { liwei: Date.now() } }), "li wei", FEED).people).toEqual([]);
    expect(findInCommunity(blankCommunityMemory(), "gary", FEED).people).toEqual([]);
    expect(findInCommunity(memory({ blocks: { gary: 0 } }), "gary", FEED).people).toEqual([]);
  });

  it("moves a group into your groups once it is joined", () => {
    expect(findInCommunity(blankCommunityMemory(), "knit", FEED).suggested.map(group => group.id)).toEqual(["knit"]);
    const joined = findInCommunity(memory({ joined: ["knit"] }), "knit", FEED);
    expect(joined.suggested).toEqual([]);
    expect(joined.groups.map(item => [item.group.id, item.sub])).toEqual([["knit", "You joined · 7 members"]]);
    // Found by why it was suggested ("Joan and 6 others") before joining, and still after.
    expect(findInCommunity(memory({ joined: ["knit"] }), "joan", FEED).groups.map(item => item.group.id)).toEqual(["knit"]);
  });

  it("shows each person with where they stand, groups to open, groups to join and the places", () => {
    held.memory = memory({ muted: { david: Date.now() } });
    const html = results("gar");
    expect(tagWith(html, "a", 'href="/community?space=groups&amp;group=garden"', 'class="cm-al-find-link"', 'aria-label="Garden gang, 6 members, 3 unread"')).toBe(true);
    expect(html).toContain('<mark class="cm-al-find-mark">Gar</mark>den gang');
    expect(html).toContain('Mar<mark class="cm-al-find-mark">gar</mark>et');
    // Margaret is a friend: her pill opens the friends list. Joan is asking: hers opens her request.
    expect(tagWith(html, "a", 'href="/community?panel=friends&amp;tab=friends"', "cm-al-find-friend")).toBe(true);
    expect(tagWith(html, "a", 'class="cm-friend is-asking "', 'href="/community?panel=friends"')).toBe(true);

    const people = words(results("a"));
    expect(people).toContain("Add friend (Priya)");
    expect(people).toContain("Request sent to Tomasz");
    expect(people).toContain("Walks with Biscuit, his dog · posts hidden for you");

    const knit = results("knit");
    expect(tagWith(knit, "button", 'class="cm-join"')).toBe(true);
    expect(words(knit)).toContain("Join Knit and natter");

    const nothing = results("zzz");
    expect(words(nothing)).toContain("Nothing found for “zzz”");
    expect(tags(nothing, "a", "cm-al-find-place")).toHaveLength(8);

    const lounge = results("lounge", LOUNGE, "/community?space=lounge");
    expect(tagWith(lounge, "a", 'href="/community?space=lounge"', 'aria-current="page"')).toBe(true);
    expect(lounge).toContain('<mark class="cm-al-find-mark">lounge</mark>');
  });
});

describe("the logic behind the panels", () => {
  it("scores names, folding case and accents", () => {
    expect(fold("Zoë")).toBe("zoe");
    expect(matchScore("mar", "Margaret")).toBe(0);
    expect(matchScore("one handed", "One-handed cooks")).toBe(0);
    expect(matchScore("gang", "Garden gang")).toBe(1);
    expect(matchScore("ar", "Margaret")).toBe(2);
    expect(matchScore("leeds", "Margaret", ["Leeds"])).toBe(3);
    expect(matchScore("xyz", "Margaret")).toBeNull();
    expect(matchScore("", "Margaret")).toBeNull();
    expect(matchScore("zoe", "Zoë")).toBe(0);
  });

  it("marks the letters that match, in the name as written", () => {
    expect(highlight("Li Wei", "wei")).toEqual([{ text: "Li ", hit: false }, { text: "Wei", hit: true }]);
    expect(highlight("Zoë's group", "zoe")).toEqual([{ text: "Zoë", hit: true }, { text: "'s group", hit: false }]);
    expect(highlight("Margaret", "")).toEqual([{ text: "Margaret", hit: false }]);
  });

  it("knows which alerts are new, which to show, and what has happened since", () => {
    const blank = blankCommunityMemory();
    expect(newAlertIds(blank)).toEqual(["a-circle", "a-joan", "a-garden", "a-liwei"]);
    expect(newAlertIds(memory({ seenAlerts: ["a-circle", "a-garden"] }))).toEqual(["a-joan", "a-liwei"]);
    expect(shownAlerts(memory({ blocks: { liwei: Date.now() } })).map(entry => entry.alert.id)).toEqual(["a-circle", "a-joan", "a-garden"]);
    const alert = (id: string) => communityAlerts.find(item => item.id === id)!;
    expect(alertOutcome(blank, alert("a-joan"))).toBeNull();
    expect(alertOutcome(memory({ answers: { joan: "accepted" } }), alert("a-joan"))).toEqual({ label: "Friends now", tone: "ok" });
    expect(alertOutcome(memory({ answers: { liwei: "declined" } }), alert("a-liwei"))).toEqual({ label: "You chose not now", tone: "plain" });
    expect(alertOutcome(memory({ read: ["garden"] }), alert("a-garden"))).toEqual({ label: "You've caught up", tone: "ok" });
    expect(alertOutcome(memory({ seated: true }), alert("a-circle"))).toEqual({ label: "You took your seat", tone: "ok" });
    expect(alertLabel(alert("a-circle"), "One seat is kept for you", true, null)).toBe("Sunday circle is open, new. One seat is kept for you. Now.");
    expect(alertLabel(alert("a-garden"), null, false, { label: "You've caught up", tone: "ok" })).toBe("3 new messages in Garden gang. 20 minutes ago. You've caught up.");
  });

  it("leads a friend request to the request (or the 'not now' left by declining it), and to the friend once accepted", () => {
    const alert = (id: string) => communityAlerts.find(item => item.id === id)!;
    expect(alertLink(blankCommunityMemory(), alert("a-joan"), LOUNGE)).toBe("/community?space=lounge&panel=friends");
    expect(alertLink(memory({ answers: { joan: "declined" } }), alert("a-joan"), LOUNGE)).toBe("/community?space=lounge&panel=friends");
    expect(alertLink(memory({ answers: { joan: "accepted" } }), alert("a-joan"), LOUNGE)).toBe("/community?space=lounge&panel=friends&tab=friends");
    expect(alertLink(memory({ answers: { joan: "accepted" } }), alert("a-garden"), LOUNGE)).toBe("/community?space=groups&group=garden");
    expect(alertLink(blankCommunityMemory(), alert("a-circle"), LOUNGE)).toBe("/community?space=circle");
  });

  it("says times and breaks the way the app does", () => {
    expect(clockLabel(new Date(2026, 9, 6, 0, 0))).toBe("12 am");
    expect(clockLabel(new Date(2026, 9, 6, 12, 0))).toBe("12 pm");
    expect(clockLabel(new Date(2026, 9, 6, 14, 5))).toBe("2:05 pm");
    const now = MIDDAY.getTime();
    expect(breakEndLabel(now + 6.5 * 3_600_000, now)).toBe("6:30 pm today");
    expect(breakEndLabel(now + 86_400_000, now)).toBe("12 pm tomorrow");
    expect(breakEndLabel(now + 7 * 86_400_000, now)).toBe("12 pm on Tuesday 13 October");
    const settings = defaultCommunitySettings();
    expect(quietNote(settings, MIDDAY)).toBeNull();
    expect(quietNote(settings, new Date(2026, 9, 6, 7, 0))).toContain("quiet time until 8 am");
    expect(quietNote({ ...settings, breakChoice: "week", breakUntil: now + 7 * 86_400_000 }, MIDDAY)).toBe("You're taking a break until 12 pm on Tuesday 13 October, so the Alerts badge stays quiet. Nothing is deleted.");
  });

  it("says what a friend button did, without promising anyone is told", () => {
    expect(friendChangeNote("priya", "none", "sent")).toBe("Request sent to Priya.");
    expect(friendChangeNote("tomasz", "sent", "none")).toBe("Request to Tomasz cancelled. They won't be told.");
    expect(friendChangeNote("joan", "none", "friend")).toBe("You and Joan are friends now.");
    expect(friendChangeNote("joan", "friend", "friend")).toBe("");
  });
});
