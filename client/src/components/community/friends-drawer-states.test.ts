import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import type { FriendsTab } from "@/content/community-samples";
import { communityStore, createCommunityStore, type CommunityMemory } from "@/lib/community-store";
import FriendsDrawer from "./FriendsDrawer";
import type { FriendsVisit } from "./friends-visit";

// The drawer after things have been done in it. A server render always reads the store's starting
// state, so these tests hand the drawer a record and a visit of their own.
const given = vi.hoisted(() => ({ memory: null as CommunityMemory | null, visit: null as FriendsVisit | null }));
vi.mock("@/lib/community-store", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/community-store")>();
  return { ...actual, useCommunity: () => given.memory ?? actual.blankCommunityMemory() };
});
vi.mock("./friends-visit", async importOriginal => {
  const actual = await importOriginal<typeof import("./friends-visit")>();
  return { ...actual, useFriendsVisit: () => given.visit ?? actual.friendsVisit.read() };
});

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 6, 12, 0)); });
afterAll(() => { vi.useRealTimers(); });

const DAY = 86_400_000;
let store = createCommunityStore(() => null);
let visit: FriendsVisit = { answered: [], cancelled: [], unblocked: [] };
beforeEach(() => {
  store = createCommunityStore(() => null);
  visit = { answered: [], cancelled: [], unblocked: [] };
});

const render = (tab: FriendsTab) => {
  given.memory = store.load();
  given.visit = visit;
  const drawer = createElement(FriendsDrawer, { tab, onTab: () => {}, onClose: () => {}, onPersonMenu: () => {}, fallbackFocus: () => null, name: "Zak" });
  return renderToStaticMarkup(createElement(Router, { ssrPath: "/community", children: drawer })).replace(/ data-loc="[^"]*"/g, "");
};
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/\s+/g, " ");
/** The text with the tags taken out and nothing in their place, the way a button's name reads. */
const flat = (html: string) => words(html.replace(/<[^>]+>/g, ""));
const tagWith = (html: string, name: string, ...attributes: string[]) =>
  (html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? []).some(tag => attributes.every(attribute => tag.includes(attribute)));

describe("For you, after answering", () => {
  it("shows the friends-now card with Wave hello, the not-now line with Undo, and All caught up", () => {
    store.acceptRequest("joan");
    store.declineRequest("liwei");
    visit = { ...visit, answered: ["joan", "liwei"] };
    let html = render("requests");
    let text = words(html);
    expect(text).toContain("4 friends · no requests waiting");
    expect(text).toContain("You and Joan are friends now");
    expect(text).toContain("Say hello to start things off.");
    expect(text).toContain("Wave hello to Joan");
    expect(text).toContain("Undo accepting Joan's request");
    expect(text).toContain("You chose not now for Li Wei. They won't be told.");
    expect(flat(html)).toContain("Undo, and show Li Wei's request again");
    expect(text).toContain("All caught up. No requests waiting.");
    // The confetti only plays on the card just accepted while the tab was showing.
    expect(html).not.toContain("cm-fr-confetti");

    store.wave("joan");
    html = render("requests");
    text = words(html);
    expect(text).toContain("You waved hello.");
    expect(text).toContain("Waved to Joan");
    expect(tagWith(html, "button", 'class="cm-fr-wave is-on"', 'aria-disabled="true"')).toBe(true);
    expect(text).not.toMatch(/on its way/);
  });

  it("lets earlier answers go: Joan is a friend, in the Friends tab", () => {
    store.acceptRequest("joan");
    const html = render("requests");
    expect(words(html)).not.toContain("Joan wants to be friends");
    expect(words(html)).toContain("Li Wei wants to be friends");
    expect(words(render("friends"))).toContain("Joan New friend");
  });

  it("says when new requests are off, and shows the choice at the foot", () => {
    store.updateSettings({ requestsFrom: "noOne" });
    const text = words(render("requests"));
    expect(text).toContain("New friend requests are off. You chose “No one” in Community settings.");
    expect(text).toContain("Who can send you requests: No one Change");
  });

  it("names only the friends in common that are still friends", () => {
    store.block("margaret");
    const text = words(render("requests"));
    expect(text).toContain("Anne is a friend of yours");
    expect(text).not.toContain("Margaret and Anne are friends of yours");
  });
});

describe("Sent, Friends and Blocked, after a change", () => {
  it("keeps a cancelled request as Request cancelled, with Undo", () => {
    store.cancelRequest("tomasz");
    visit = { ...visit, cancelled: [{ who: "tomasz", at: Date.now() - 2 * DAY }] };
    const html = render("sent");
    const text = words(html);
    expect(tagWith(html, "li", 'class="cm-fr-card cm-fr-sent is-cancelled"')).toBe(true);
    expect(text).toContain("Request cancelled");
    expect(flat(html)).toContain("Undo: keep your request to Tomasz");
    expect(text).toContain("Sent 0 , 0");
  });

  it("keeps a friend blocked in this visit in their place, with Undo and the ··· button", () => {
    store.block("margaret", communityStore.visitStart + 1);
    store.mute("anne");
    const html = render("friends");
    const text = words(html);
    expect(text).toContain("Friends 2 , 2");
    expect(flat(html)).toContain("Undo, and unblock Margaret");
    expect(tagWith(html, "button", 'aria-label="More options for Margaret"')).toBe(true);
    expect(text).not.toContain("Wave to Margaret");
    expect(text).toContain("Active yesterday · posts hidden");
  });

  it("keeps someone unblocked in this visit as Unblocked just now, with Undo", () => {
    store.unblock("gary");
    visit = { ...visit, unblocked: [{ who: "gary", at: Date.now() - 3 * DAY }] };
    const html = render("blocked");
    const text = words(html);
    expect(text).toContain("Unblocked just now");
    expect(flat(html)).toContain("Undo, and block Gary again");
    expect(text).toContain("Blocked 0 , 0");
  });

  it("says so when nobody is blocked or waiting", () => {
    store.unblock("gary");
    store.cancelRequest("tomasz");
    expect(words(render("blocked"))).toContain("You haven't blocked anyone.");
    expect(words(render("sent"))).toContain("No requests waiting for a yes.");
  });
});
