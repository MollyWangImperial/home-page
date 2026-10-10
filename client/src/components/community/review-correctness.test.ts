import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { createCommunityStore, type CommunityMemory } from "@/lib/community-store";
import CircleView from "./Circle";
import { calendarPage, circleIcs, googleCalendarUrl, nextMeeting, outlookCalendarUrl } from "./circle-calendar";
import FeedView from "./Feed";
import FriendsPage from "./FriendsPage";
import GroupsView from "./Groups";
import LoungeView from "./Lounge";
import MessagesView from "./Messages";
import MessagesDock from "./MessagesDock";
import { unreadMessages } from "./messages-model";
import StartGroupView from "./StartGroup";

// Review checks for the My community toolbar features (Find, Alerts, Friends, Safety, Settings).
// Each test below describes a problem found in review, now fixed, so it stays fixed. Each one has a
// "guard" test beside it that checks the set-up itself works.

vi.mock("@/components/RecoveryShell", () => ({ default: ({ children }: { children: unknown }) => children }));

const given = vi.hoisted(() => ({ memory: null as CommunityMemory | null }));
vi.mock("@/lib/community-store", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/community-store")>();
  return { ...actual, useCommunity: () => given.memory ?? actual.blankCommunityMemory() };
});

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 6, 12, 0)); });
afterAll(() => { vi.useRealTimers(); });

let store = createCommunityStore(() => null);
beforeEach(() => {
  store = createCommunityStore(() => null);
  given.memory = null;
});

const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/\s+/g, " ");
const render = (path: string, element: ReturnType<typeof createElement>) => {
  given.memory = store.load();
  return words(renderToStaticMarkup(createElement(Router, { ssrPath: path, children: element })));
};

describe("a blocked person stays out of sight across My community", () => {
  it("guard: the circle seats Margaret, and the lounge and group chat leave her out once she is blocked", () => {
    expect(render("/community?space=circle", createElement(CircleView, { active: false, name: "Zak" }))).toContain("Margaret");
    store.block("margaret");
    expect(render("/community?space=groups&group=garden", createElement(GroupsView, { active: false, requested: "garden" }))).not.toContain("Margaret: First tomatoes!");
  });

  // The sheet says "You won't see each other in My community": the Sunday circle leaves her chair
  // empty, doesn't name her, and doesn't pass her the teacup.
  it("leaves a blocked person out of the Sunday circle", () => {
    store.block("margaret");
    const text = render("/community?space=circle", createElement(CircleView, { active: false, name: "Zak" }));
    expect(text).not.toContain("Margaret");
    expect(text).toContain("Eight of us here. One seat is yours.");
    expect(text).not.toContain("My granddaughter");
  });

  // Someone whose posts are hidden keeps their seat (only their words are hidden).
  it("keeps a hidden person's seat in the circle", () => {
    store.mute("margaret");
    const text = render("/community?space=circle", createElement(CircleView, { active: false, name: "Zak" }));
    expect(text).toContain("Margaret");
    expect(text).toContain("Nine of us here. One seat is yours.");
  });

  // "Who's coming?" offers only people not blocked, and doesn't tick Margaret to begin with.
  it("leaves a blocked person out of Start a group's friend picker", () => {
    store.block("margaret");
    const text = render("/community?space=start", createElement(StartGroupView, { name: "Zak" }));
    expect(text).not.toContain("Margaret");
    expect(text).toContain("You and 1 friend");
  });

  // The feed's "My groups" card drops a blocked or hidden writer's message, as My groups and Alerts do.
  it("drops a blocked writer's message from the feed's My groups card", () => {
    store.block("margaret");
    const text = render("/community", createElement(FeedView, { name: "Zak", here: 14, onMore: () => {} }));
    expect(text).not.toContain("Margaret: First tomatoes!");
    expect(text).toContain("Joan: Mine are still green.");
  });

  it("guard: the feed's My groups card quotes Margaret while she is in sight", () => {
    expect(render("/community", createElement(FeedView, { name: "Zak", here: 14, onMore: () => {} }))).toContain("Margaret: First tomatoes!");
  });

  // The lounge's one-tap replies name people: one to someone blocked would reach nobody.
  it("leaves out the lounge's quick reply to someone blocked", () => {
    const lounge = () => render("/community?space=lounge", createElement(LoungeView, { active: false, here: 14, onHere: () => {} }));
    expect(lounge()).toContain("Welcome, Tomasz");
    store.block("tomasz");
    const text = lounge();
    expect(text).not.toContain("Welcome, Tomasz");
    expect(text).toContain("Well done, Margaret");
  });

  // Messages: a blocked friend's conversation goes, and so does their unread count.
  it("leaves a blocked friend's conversation out of Messages and its count", () => {
    const messages = () => render("/community?space=messages", createElement(MessagesView, { active: false, chat: null, onPersonMenu: () => {} }));
    expect(messages()).toContain("Margaret");
    expect(unreadMessages(store.load())).toBe(2);
    store.block("margaret");
    expect(messages()).not.toContain("Margaret");
    expect(unreadMessages(store.load())).toBe(1);
    expect(render("/community?space=messages&chat=margaret", createElement(MessagesView, { active: false, chat: "margaret", onPersonMenu: () => {} }))).not.toContain("I kept the best one");
  });
});

describe("Messages, the Messages window and Friends", () => {
  it("counts a conversation until it is read, and not at all while it is muted", () => {
    expect(unreadMessages(store.load())).toBe(2);
    store.markChatRead("margaret");
    expect(unreadMessages(store.load())).toBe(1);
    store.toggleChatMuted("david");
    expect(unreadMessages(store.load())).toBe(0);
    expect(render("/community?space=messages&chat=david", createElement(MessagesView, { active: false, chat: "david", onPersonMenu: () => {} }))).toContain("Notifications muted");
  });

  it("keeps what the person writes, in order, and lets them remove it", () => {
    const note = store.addDirect("anne", { text: "See you on Thursday." }, Date.now());
    expect(note).not.toBeNull();
    const text = render("/community?space=messages&chat=anne", createElement(MessagesView, { active: false, chat: "anne", onPersonMenu: () => {} }));
    expect(text).toContain("Thank you for Thursday.");
    expect(text.indexOf("Thank you for Thursday.")).toBeLessThan(text.indexOf("See you on Thursday."));
    expect(text).toContain("Remove your message");
    store.removeDirect("anne", note!.id);
    expect(store.load().direct.anne).toBeUndefined();
  });

  it("says so when messages are off, and offers the way to change it", () => {
    store.updateSettings({ messagesFrom: "noOne" });
    const text = render("/community?space=messages&chat=margaret", createElement(MessagesView, { active: false, chat: "margaret", onPersonMenu: () => {} }));
    expect(text).toContain("Messages to you are off");
    expect(text).toContain("Change who can message you");
  });

  it("shows the Messages window while a message waits, and leaves it away once everything is read", () => {
    const dock = (space: "feed" | "messages") => render("/community", createElement(MessagesDock, { space }));
    expect(dock("feed")).toContain("Messages 2 unread Margaret: I promised you one");
    expect(dock("messages")).toBe("");
    store.markChatRead("margaret");
    store.markChatRead("david");
    expect(dock("feed")).toBe("");
  });

  it("Friends: each privacy choice shows what is chosen, and what it means", () => {
    store.updateSettings({ messagesFrom: "noOne", postsSeenBy: "everyone", showOnline: false });
    given.memory = store.load();
    const html = renderToStaticMarkup(createElement(Router, { ssrPath: "/community?space=friends", children: createElement(FriendsPage, { onPersonMenu: () => {} }) }));
    const text = words(html);
    expect(text).toContain("No one can message you.");
    expect(text).toContain("Everyone in My community sees what you share.");
    expect(html).toMatch(/aria-pressed="true">No one</);
    expect(html).toMatch(/aria-pressed="true">Everyone</);
    expect(html).toMatch(/role="switch"[^>]*aria-checked="false"/);
  });
});

/* ------------------------------------------------------- the circle's calendar */

describe("adding a circle to the person's own calendar", () => {
  const hand = { id: "hand", name: "Hand and arm circle", detail: "Gentle stretches, together", day: 2, hour: 15, minutes: 45 };

  it("finds the next meeting, a week on once today's has started", () => {
    // Tuesday 6 October 2026, midday: today's 3 pm circle is next. At 4 pm it is next week's.
    expect(nextMeeting(hand, new Date(2026, 9, 6, 12, 0))).toEqual(new Date(2026, 9, 6, 15, 0));
    expect(nextMeeting(hand, new Date(2026, 9, 6, 16, 0))).toEqual(new Date(2026, 9, 13, 15, 0));
    expect(nextMeeting({ day: 0, hour: 16 }, new Date(2026, 9, 10, 9, 0))).toEqual(new Date(2026, 9, 11, 16, 0));
    expect(calendarPage(new Date(2026, 9, 13, 15, 0))).toEqual({ day: "TUE", date: "13" });
  });

  it("fills in Google and Outlook with the circle's name and time, and nothing about the person", () => {
    const start = new Date(Date.UTC(2026, 9, 13, 14, 0));
    const google = new URL(googleCalendarUrl(hand, start, "https://rehyn.test"));
    expect(google.origin).toBe("https://calendar.google.com");
    expect(google.searchParams.get("text")).toBe("Hand and arm circle");
    expect(google.searchParams.get("dates")).toBe("20261013T140000Z/20261013T144500Z");
    expect(google.searchParams.get("recur")).toBe("RRULE:FREQ=WEEKLY");
    const outlook = new URL(outlookCalendarUrl(hand, start));
    expect(outlook.searchParams.get("subject")).toBe("Hand and arm circle");
    expect(outlook.searchParams.get("startdt")).toBe("2026-10-13T14:00:00.000Z");
    for (const url of [google, outlook]) expect(url.search).not.toMatch(/zak|@/i);
  });

  it("writes a calendar file that repeats weekly and reminds half an hour before", () => {
    const file = circleIcs({ ...hand, name: "Hand, arm; circle" }, new Date(Date.UTC(2026, 9, 13, 14, 0)), "", new Date(Date.UTC(2026, 9, 6, 11, 0)));
    expect(file.split("\r\n")).toEqual(expect.arrayContaining(["BEGIN:VCALENDAR", "DTSTART:20261013T140000Z", "DTEND:20261013T144500Z", "RRULE:FREQ=WEEKLY", "SUMMARY:Hand\\, arm\\; circle", "TRIGGER:-PT30M", "END:VCALENDAR"]));
  });
});

/* -------------------------------------------------------------------------------------------- */

// The shared dialog (dialog.tsx) holds the page still while a drawer or a sheet is open. The safety
// sheet can open over the Friends drawer. When both go in one commit ("See my reports" or "Talk it
// through with Alira" in the sheet, which close it and change the address) or the drawer goes
// first (the browser's Back button: the drawer goes with the address, the sheet one effect later),
// React runs the drawer's clean-up first. Each dialog used to put back what it saw when it opened,
// so the sheet put back "hidden" and the page could no longer scroll until a reload. Now the page
// is let go when the last of them closes, in either order.
//
// There is no DOM test environment in this repo, so this runs dialog.tsx's real effect with React's
// hooks stubbed and a small stand-in for the document.

type Cleanup = () => void;
type Simulated = { whileOpen: string; afterClose: string; listenersLeft: number };

async function openDrawerThenSheet(closeOrder: "drawer first" | "sheet first"): Promise<Simulated> {
  vi.resetModules();
  const effects: (() => void | Cleanup)[] = [];
  const boxes: unknown[] = [];
  vi.doMock("react", async importOriginal => {
    const actual = await importOriginal<typeof import("react")>();
    return {
      ...actual,
      useEffect: (run: () => void | Cleanup) => { effects.push(run); },
      useLayoutEffect: () => {},
      useState: (start: unknown) => [typeof start === "function" ? (start as () => unknown)() : start, () => {}],
      // The dialog's first ref (its box) starts as null: hand it a stand-in element.
      useRef: (start: unknown) => ({ current: start === null && boxes.length ? boxes.shift() : start }),
    };
  });

  class StandIn {
    isConnected = true;
    closest() { return null; }
    contains() { return false; }
    querySelector() { return null; }
    hasAttribute() { return true; }
    setAttribute() {}
    focus() {}
  }
  const listeners = new Set<unknown>();
  const fakeDocument = {
    activeElement: new StandIn(),
    documentElement: { style: { overflow: "" } },
    getElementById: () => null,
    addEventListener: (_type: string, listener: unknown) => { listeners.add(listener); },
    removeEventListener: (_type: string, listener: unknown) => { listeners.delete(listener); },
  };
  const scope = globalThis as Record<string, unknown>;
  const before = { document: scope.document, HTMLElement: scope.HTMLElement };
  scope.document = fakeDocument;
  scope.HTMLElement = StandIn;
  try {
    const { default: CommunityDialog } = await import("./dialog");
    const open = (kind: "drawer" | "sheet"): Cleanup => {
      boxes.push(new StandIn());
      CommunityDialog({ kind, labelledBy: `${kind}-title`, onClose: () => {}, children: null });
      expect(effects).toHaveLength(1);
      const cleanup = effects.pop()?.();
      expect(typeof cleanup).toBe("function");
      return cleanup as Cleanup;
    };
    const closeDrawer = open("drawer");
    const closeSheet = open("sheet");
    const whileOpen = fakeDocument.documentElement.style.overflow;
    if (closeOrder === "drawer first") { closeDrawer(); closeSheet(); } else { closeSheet(); closeDrawer(); }
    return { whileOpen, afterClose: fakeDocument.documentElement.style.overflow, listenersLeft: listeners.size };
  } finally {
    if (before.document === undefined) delete scope.document; else scope.document = before.document;
    if (before.HTMLElement === undefined) delete scope.HTMLElement; else scope.HTMLElement = before.HTMLElement;
    vi.doUnmock("react");
    vi.resetModules();
  }
}

describe("the shared dialog's scroll lock, with the safety sheet over the Friends drawer", () => {
  it("guard: locks the page while both are open, and unlocks it when the sheet closes first", async () => {
    const result = await openDrawerThenSheet("sheet first");
    expect(result.whileOpen).toBe("hidden");
    expect(result.afterClose).toBe("");
    expect(result.listenersLeft).toBe(0);
  });

  it("unlocks the page when the drawer closes first or in the same commit (Back, See my reports, Talk it through with Alira)", async () => {
    const result = await openDrawerThenSheet("drawer first");
    expect(result.whileOpen).toBe("hidden");
    expect(result.afterClose).toBe("");
    expect(result.listenersLeft).toBe(0);
  });
});
