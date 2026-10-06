import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import type { CommunityMemory, CommunitySettings } from "@/lib/community-store";
import type { Profile } from "@/lib/profile";

// What the page reads in each test: the stored record and the profile (by default, a blank record
// and the default profile, as on a first visit).
const state = vi.hoisted(() => ({ memory: null as CommunityMemory | null, profile: null as Profile | null }));

vi.mock("@/components/RecoveryShell", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("@/lib/community-store", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/community-store")>();
  return { ...actual, useCommunity: () => state.memory ?? actual.blankCommunityMemory() };
});
vi.mock("@/lib/profile", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/profile")>();
  return { ...actual, useProfile: () => state.profile ?? actual.DEFAULT_PROFILE };
});

import { SettingsContext } from "@/components/settings-context";
import { blankCommunityMemory } from "@/lib/community-store";
import { DEFAULT_PROFILE } from "@/lib/profile";
import Community from "@/pages/Community";
import SettingsView from "./SettingsView";

// Midday on Tuesday 6 October 2026, so quiet time is not on while the tests run.
const NOW = new Date(2026, 9, 6, 12, 0).getTime();
const DAY = 86_400_000;
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterAll(() => { vi.useRealTimers(); });
afterEach(() => { state.memory = null; state.profile = null; });

const clean = (html: string) => html.replace(/ data-loc="[^"]*"/g, "");
const page = (path: string) => clean(renderToStaticMarkup(createElement(Router, { ssrPath: path, children: createElement(Community) })));
const view = () => clean(renderToStaticMarkup(createElement(Router, { ssrPath: "/community?space=settings", children: createElement(SettingsView, { name: "Zak" }) })));
/** The page inside the app, where the app's own Settings (with "Your profile") can be opened. */
const viewInApp = () => clean(renderToStaticMarkup(createElement(SettingsContext.Provider, { value: () => {}, children: createElement(Router, { ssrPath: "/community?space=settings", children: createElement(SettingsView, { name: "Zak" }) }) })));
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/\s+/g, " ");
/** Every opening tag of this kind that carries all of the given attributes. */
const tagsWith = (html: string, name: string, ...attributes: string[]) =>
  (html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? []).filter(tag => attributes.every(attribute => tag.includes(attribute)));
const tagWith = (html: string, name: string, ...attributes: string[]) => tagsWith(html, name, ...attributes).length > 0;
/** Whether the button with this text is pressed. */
const pressed = (html: string, label: string) => new RegExp(`<button[^>]*aria-pressed="true"[^>]*>${label}</button>`).test(html);
function withSettings(patch: Partial<CommunitySettings>, edit?: (memory: CommunityMemory) => void): CommunityMemory {
  const memory = blankCommunityMemory();
  memory.settings = { ...memory.settings, ...patch };
  edit?.(memory);
  return memory;
}

describe("Community settings (F5)", () => {
  it("opens under the community header, with five sections and How you appear open", () => {
    const html = page("/community?space=settings");
    const text = words(html);
    expect(html).toMatch(/<h2[^>]*data-view-heading[^>]*>Community settings<\/h2>/);
    expect(text).toContain("Only for My community. Changes save as you go.");
    const toggles = tagsWith(html, "button", 'class="cm-set-toggle"');
    expect(toggles).toHaveLength(5);
    expect(toggles.filter(tag => tag.includes('aria-expanded="true"'))).toHaveLength(1);
    for (const title of ["How you appear", "Friends and messages", "What you see", "Reading and listening", "Quiet times"]) expect(text).toContain(title);
    // Each heading controls its own panel; only the open one is shown.
    const panels = toggles.map(tag => tag.match(/aria-controls="([^"]+)"/)?.[1]);
    panels.forEach((id, index) => {
      const panel = tagsWith(html, "div", `id="${id}"`, 'role="region"', 'class="cm-set-panel"');
      expect(panel).toHaveLength(1);
      expect(panel[0].includes("hidden")).toBe(index !== 0);
    });
    expect(tagWith(html, "button", 'class="cm-set-toggle"', 'aria-expanded="true"')).toBe(true);
    // The dots are shown; a screen reader hears commas.
    expect(text).toContain("No town added · , online dot on · , drawn face");
    expect(text).toContain("Gentle mode on · , 2 hidden words");
    expect(text).toContain("Quiet from 9 pm to 8 am");
    expect(tagWith(html, "p", 'class="cm-set-saved-slot"', 'role="status"')).toBe(true);
  });

  it("shows every setting as it is stored: switches, choices, words and quiet time", () => {
    const html = view();
    const switches = tagsWith(html, "button", 'role="switch"');
    expect(switches).toHaveLength(6);
    expect(switches.filter(tag => tag.includes('aria-checked="true"'))).toHaveLength(5);
    for (const label of ["Drawn face", "Everyone", "Only friends", "Normal", "No break"]) expect(pressed(html, label)).toBe(true);
    for (const label of ["My photo", "No one", "Bigger", "1 week"]) expect(pressed(html, label)).toBe(false);
    expect(tagWith(html, "button", 'aria-label="Stop hiding hospital"')).toBe(true);
    expect(tagWith(html, "button", 'aria-label="Stop hiding falls"')).toBe(true);
    expect(words(html)).toContain("Add “money”");
    expect(tagWith(html, "button", 'class="cm-set-add"', 'aria-expanded="false"')).toBe(true);
    expect(tagWith(html, "button", 'aria-label="Earlier start"', 'aria-disabled="false"')).toBe(true);
    expect(tagWith(html, "button", 'aria-label="Later start"', 'aria-disabled="false"')).toBe(true);
    expect(html).toMatch(/<output[^>]*>9 pm<\/output>/);
    expect(words(html)).toContain("The Alerts badge stays quiet from 9 pm to 8 am");
  });

  it("links to the Friends drawer over this page, and to Safety", () => {
    const html = view();
    expect(tagWith(html, "a", 'class="cm-set-link"', 'href="/community?space=settings&amp;panel=friends"')).toBe(true);
    expect(words(html)).toContain("See requests you have sent and received");
    expect(tagWith(html, "a", 'class="cm-card cm-set-safety"', 'href="/community?space=safety"')).toBe(true);
    expect(words(html)).toContain("Safety and blocking Blocked people and your reports");
  });

  it("keeps the words true to what happens on this device", () => {
    const text = words(view());
    expect(text).not.toContain("Bristol");
    expect(text).toContain("Your profile doesn't have a town yet.");
    expect(text).toContain("Your device's own voice reads them.");
    expect(text).not.toMatch(/Alira reads|her voice/);
    expect(text).toContain("During a break, the Alerts badge stays quiet. Nothing is deleted.");
    expect(text).not.toMatch(/friends see|will be told|notified|Taking a break/i);
    expect(text).toContain("How others would see you");
    expect(text).toContain("What other members would see when they tap your name. Only friends could message you.");
  });
});

describe("links that name a setting", () => {
  /** The title of the one section that is open. */
  const openSection = (html: string) => {
    const open: string[] = html.match(/<button[^>]*class="cm-set-toggle"[^>]*aria-expanded="true"[^>]*>[\s\S]*?class="cm-set-toggle-title"[^>]*>([^<]+)</g) ?? [];
    expect(open).toHaveLength(1);
    return open[0]?.match(/>([^<>]+)<$/)?.[1];
  };

  it("opens Community settings at the section the address names", () => {
    expect(openSection(page("/community?space=settings&section=appear"))).toBe("How you appear");
    expect(openSection(page("/community?space=settings&section=friends"))).toBe("Friends and messages");
    expect(openSection(page("/community?space=settings&section=see"))).toBe("What you see");
    expect(openSection(page("/community?space=settings&section=read"))).toBe("Reading and listening");
    expect(openSection(page("/community?space=settings&section=quiet"))).toBe("Quiet times");
    // An unknown section, or none, opens at the top as before.
    expect(openSection(page("/community?space=settings&section=secrets"))).toBe("How you appear");
    expect(openSection(page("/community?space=settings"))).toBe("How you appear");
  });

  it("names the section only on Community settings", () => {
    expect(page("/community?section=quiet")).not.toContain("cm-set-page");
  });
});

describe("the live preview of the person's card", () => {
  it("is tagged as the person's card, and what it offers are labels, not buttons", () => {
    const html = view();
    const card = html.slice(html.indexOf('class="cm-card cm-set-card"'), html.indexOf('class="cm-card cm-set-sample"'));
    expect(card).toContain('<span class="cm-set-card-tag">Your card</span>');
    expect(card).not.toMatch(/<(button|a)\b/);
    expect(tagWith(card, "span", 'class="cm-set-pill cm-set-pill-add"')).toBe(true);
  });

  it("starts with the drawn face, the online dot, groups and friends, and the two buttons", () => {
    const html = view();
    const text = words(html);
    expect(text).toContain("Zak");
    expect(text).toContain("In 4 groups · 3 friends");
    expect(text).toContain("Add friend");
    expect(text).toContain("Message (friends only)");
    expect(tagWith(html, "span", "cm-set-online")).toBe(true);
    expect(text).toContain("Your drawn face, with a green dot for online.");
    expect(text).toContain("Sample post at this size Margaret First tomatoes off the windowsill!");
  });

  it("shows the town from the profile, only while Show my town is on", () => {
    state.profile = { ...DEFAULT_PROFILE, city: "Leeds" };
    const shown = words(view());
    expect(shown).toContain("Leeds · In 4 groups · 3 friends");
    expect(shown).toContain("Puts “Leeds” under your name on your card");
    expect(shown).toContain("Town shown");
    state.memory = withSettings({ showTown: false });
    const hidden = words(view());
    expect(hidden).not.toContain("Leeds · In 4 groups");
    expect(hidden).toContain("Town hidden");
  });

  it("follows who can ask, who can message, the online dot and the picture", () => {
    state.memory = withSettings({ requestsFrom: "noOne", messagesFrom: "friendsAndGroups", showOnline: false, picture: "initial" });
    const html = view();
    const text = words(html);
    expect(text).toContain("Not taking requests");
    expect(text).toContain("New requests are off. Requests already waiting stay in Friends.");
    expect(text).not.toContain("(friends only)");
    expect(text).not.toContain("Only friends could message you");
    expect(tagWith(html, "span", "cm-set-online")).toBe(false);
    expect(html).toMatch(/<span class="cm-face cm-face-initial cm-pop"[^>]*>Z<\/span>/);
    expect(pressed(html, "Initial")).toBe(true);
    expect(text).toContain("Your initial, Z.");
  });

  it("says when My photo has no photo to show yet, and shows the profile photo once there is one", () => {
    state.memory = withSettings({ picture: "photo" });
    const text = words(view());
    expect(text).toContain("You haven't added a photo yet, so your initial shows.");
    expect(text).toContain("Your initial, Z, with a green dot for online.");
    state.profile = { ...DEFAULT_PROFILE, photo: "data:image/png;base64,iVBORw0KGgo=" };
    const html = view();
    expect(words(html)).toContain("The photo from your profile.");
    expect(words(html)).toContain("Your photo, with a green dot for online.");
    expect(html).toContain('background-image:url(&quot;data:image/png;base64,iVBORw0KGgo=&quot;)');
  });

  it("offers the person's profile for the town and photo, keeping the same button once they are added", () => {
    expect(words(view())).not.toContain("Add your town");
    state.memory = withSettings({ picture: "photo" });
    const empty = viewInApp();
    expect(tagsWith(empty, "button", 'class="cm-text-button cm-set-profile-button"', 'aria-haspopup="dialog"')).toHaveLength(2);
    expect(words(empty)).toContain("Add your town in your profile");
    expect(words(empty)).toContain("Add a photo in your profile");
    state.profile = { ...DEFAULT_PROFILE, city: "Leeds", photo: "data:image/png;base64,iVBORw0KGgo=" };
    const filled = words(viewInApp());
    expect(filled).toContain("Change your town in your profile");
    expect(filled).toContain("Change your photo in your profile");
  });

  it("counts friends and groups as they change", () => {
    state.memory = withSettings({}, memory => { memory.answers = { joan: "accepted" }; memory.joined = ["knit"]; });
    expect(words(view())).toContain("In 5 groups · 4 friends");
  });

  it("takes the sample post from someone the person still sees", () => {
    state.memory = withSettings({}, memory => { memory.blocks = { margaret: NOW }; });
    expect(words(view())).toContain("Sample post at this size Joan Buttoned my own cardigan");
  });
});

describe("the other settings as they are stored", () => {
  it("presses the chosen text size", () => {
    state.memory = withSettings({ textSize: "bigger", readAloud: true });
    const html = view();
    expect(pressed(html, "Bigger")).toBe(true);
    expect(words(html)).toContain("Read aloud on · , bigger text");
  });

  it("stops quiet time at 11 pm and at 7 pm", () => {
    state.memory = withSettings({ quietFrom: 23 });
    const late = view();
    expect(late).toMatch(/<output[^>]*>11 pm<\/output>/);
    expect(tagWith(late, "button", 'aria-label="Later start"', 'aria-disabled="true"')).toBe(true);
    expect(tagWith(late, "button", 'aria-label="Earlier start"', 'aria-disabled="false"')).toBe(true);
    expect(words(late)).toContain("The Alerts badge stays quiet from 11 pm to 8 am");
    state.memory = withSettings({ quietFrom: 19 });
    expect(tagWith(view(), "button", 'aria-label="Earlier start"', 'aria-disabled="true"')).toBe(true);
  });

  it("shows a break while it lasts, and no break once it has ended", () => {
    state.memory = withSettings({ breakChoice: "week", breakUntil: NOW + 7 * DAY });
    const on = view();
    expect(pressed(on, "1 week")).toBe(true);
    expect(words(on)).toContain("The Alerts badge stays quiet until Tuesday 13 October. Nothing is deleted.");
    expect(words(on)).toContain("on a break until 13 October");
    state.memory = withSettings({ breakChoice: "day", breakUntil: NOW - 1000 });
    expect(pressed(view(), "No break")).toBe(true);
  });

  it("offers a starting word back once it is taken off, and stops adding at 20 words", () => {
    state.memory = withSettings({ hiddenWords: ["money", "cure", "politics", "hospital"] });
    expect(words(view())).toContain("Add “falls”");
    state.memory = withSettings({ hiddenWords: Array.from({ length: 20 }, (_, index) => `word${index}`) });
    const full = view();
    expect(tagWith(full, "button", 'class="cm-set-add"')).toBe(false);
    expect(words(full)).toContain("You're hiding 20 words, the most you can. Remove one to add another.");
    state.memory = withSettings({ hiddenWords: [] });
    const none = words(view());
    expect(none).toContain("no hidden words");
    expect(none).toContain("Add “money”");
  });
});
