import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { createCommunityStore, type CommunityMemory } from "@/lib/community-store";
import CircleView from "./Circle";
import FeedView from "./Feed";
import GroupsView from "./Groups";
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
    expect(text).toContain("8 here");
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
