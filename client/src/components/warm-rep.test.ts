import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { learningToday, loadConsent, loadConsentRecord, recordWarmRepSkip, saveConsent, saveWarmRep } from "@/lib/alira-learning-store";
import { ONBOARDING_STORAGE_KEY } from "@/lib/alira-onboarding";
import { simulatedWarmRep } from "@/lib/warm-rep";
import WarmUp from "@/pages/WarmUp";
import { WarmRep, warmRepFrameFrom } from "./WarmRep";
import { WarmRepGate } from "./WarmRepGate";

const learning = vi.hoisted(() => ({ running: false }));
const route = vi.hoisted(() => ({ search: "" }));

vi.mock("wouter", async () => {
  const { createElement: element } = await import("react");
  return {
    useLocation: () => ["/", () => undefined],
    useSearch: () => route.search,
    Link: ({ href, className, children }: { href: string; className?: string; children?: ReactNode }) => element("a", { href, className }, children),
  };
});
vi.mock("@/lib/alira-learning-client", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/alira-learning-client")>()),
  learningRunning: () => learning.running,
}));

let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  learning.running = false;
  route.search = "";
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

/** The words a reader sees: artwork and tags removed, entities decoded. */
const text = (html: string) => html
  .replace(/<svg[\s\S]*?<\/svg>/g, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ")
  .trim();
const noop = () => undefined;
const intro = () => renderToStaticMarkup(createElement(WarmRep, { source: "survey_end", side: "right", onDone: noop, onSkip: noop }));
const today = () => simulatedWarmRep({ side: "right", source: "survey_end", day: learningToday() });

describe("the warm-up invitation", () => {
  it("invites gently, with no numbers, no score talk and no em dashes", () => {
    saveConsent({ movement: true });
    const html = intro();
    const words = text(html);
    expect(words).toContain("Today's starting line");
    expect(words).toContain("Two gentle reaches, as far as feels comfortable. There's no score and no wrong answer. It shows me where today begins, so everything after starts in the right place for you.");
    expect(words).toContain("About a minute, sitting in a steady chair.");
    expect(words).toContain("Let's warm up");
    expect(words).not.toContain("Maybe later");
    expect(words).not.toContain("A one-minute warm-up");
    expect(words).not.toContain("With your head, arm and lap in the camera's view.");
    expect(renderToStaticMarkup(createElement(WarmRep, { source: "pre_exercise", side: "right", onDone: noop, onSkip: noop }))).toContain("Skip for today");
    expect(words).not.toMatch(/\d/);
    expect(words).not.toMatch(/fail|pass/i);
    expect(html).not.toContain("—");
    // The camera opens only after "Let's warm up".
    expect(html).not.toContain("<video");
    // Learning preferences are managed in settings.
    expect(words).not.toContain("May Alira learn from this?");
  });

  it.each([undefined, { movement: true, camera: false }, { movement: false, camera: true }])("uses saved learning choices without asking again (%j)", saved => {
    if (saved) saveConsent(saved);
    const consent = loadConsent();
    const record = loadConsentRecord();
    const html = intro();
    const words = text(html);
    expect(words).not.toContain("May Alira learn from this?");
    expect(html).not.toContain('type="checkbox"');
    expect(loadConsent()).toEqual(consent);
    expect(loadConsentRecord()).toEqual(record);
  });

  it("still renders when storage is blocked", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(text(intro())).toContain("Today's starting line");
  });
});

describe("the warm-up gate", () => {
  const page = () => createElement("p", null, "The page opens here");
  const gate = (place: "pre_assessment" | "pre_exercise" = "pre_assessment") =>
    renderToStaticMarkup(createElement(WarmRepGate, { gate: place, children: createElement(page) }));

  it("offers the warm-up first and keeps the page closed until it passes", () => {
    const words = text(gate());
    expect(words).toContain("Today's starting line");
    expect(words).not.toContain("The page opens here");
  });

  it("opens the page straight away once today's warm-up is done, or was skipped at this gate", () => {
    saveWarmRep(today());
    expect(gate()).toBe("<p>The page opens here</p>");
    expect(gate("pre_exercise")).toBe("<p>The page opens here</p>");
    values.clear();
    recordWarmRepSkip("pre_exercise");
    expect(gate("pre_exercise")).toBe("<p>The page opens here</p>");
    // Skipping before an exercise still offers it before the movement check.
    expect(text(gate("pre_assessment"))).toContain("Today's starting line");
  });

  it("does not offer a reach check when the arm does not move yet", () => {
    values.set(ONBOARDING_STORAGE_KEY, JSON.stringify({ arm_hand_movement: "none" }));
    expect(gate()).toBe("<p>The page opens here</p>");
  });

  it("waits for Alira's learning in progress, with a way to start now", () => {
    saveWarmRep(today());
    learning.running = true;
    const words = text(gate());
    expect(words).toContain("Alira is getting things ready for you…");
    expect(words).toContain("Start now");
    expect(words).not.toContain("The page opens here");
  });
});

describe("the warm-up page", () => {
  it("offers the warm-up and keeps the way back in onboarding", () => {
    route.search = "gate=survey_end&next=%2Fassessment%3Fonboarding%3D1";
    const html = renderToStaticMarkup(createElement(WarmUp));
    expect(html).toContain("href=\"/alira?onboarding=1\"");
    expect(text(html)).toContain("Back to Alira");
    expect(text(html)).toContain("Today's starting line");
  });
});

describe("frames from the camera", () => {
  const point = (x: number, y: number, z = 0) => ({ x, y, z, visibility: 0.99 });
  function pose(wrist = point(0.42, 0.68)) {
    const landmarks = Array.from({ length: 33 }, () => point(0.5, 0.5));
    const world = Array.from({ length: 33 }, () => point(0, 0));
    Object.assign(landmarks, { 0: point(0.5, 0.2), 11: point(0.6, 0.35), 12: point(0.4, 0.35), 13: point(0.62, 0.5), 14: point(0.38, 0.5), 15: point(0.58, 0.68), 16: wrist, 23: point(0.58, 0.7), 24: point(0.42, 0.7) });
    Object.assign(world, { 11: point(0.15, -0.5), 12: point(-0.15, -0.5), 13: point(0.17, -0.25), 14: point(-0.17, -0.25), 15: point(0.14, -0.02, -0.1), 16: point(-0.14, -0.02, -0.1), 23: point(0.1, 0), 24: point(-0.1, 0), 25: point(0.1, 0.05, -0.4), 26: point(-0.1, 0.05, -0.4) });
    return { landmarks, world };
  }

  it("reads the affected arm, the lap and, once the rest is known, compensation", () => {
    const { frame, geo } = warmRepFrameFrom(pose(), "right", null, 100);
    expect(frame).toMatchObject({ t: 100, visible: true, lapReady: true, wristY: 0.68, shoulderY: 0.35 });
    expect(frame.shoulderFlexion).toBeGreaterThan(0);
    expect(frame.shoulderFlexion).toBeLessThan(30);
    expect(frame.elbowExtension).toBeGreaterThan(120);
    expect(frame.trunkLeanDeg).toBeUndefined();
    expect(geo).not.toBeNull();
    const reaching = warmRepFrameFrom(pose(point(0.42, 0.3)), "right", geo, 200).frame;
    expect(reaching).toMatchObject({ visible: true, lapReady: false, wristY: 0.3 });
    expect(reaching.lapMissing).toBeTruthy();
    expect(reaching.trunkLeanDeg).toBeCloseTo(0, 5);
    expect(warmRepFrameFrom(null, "right", null, 300).frame).toMatchObject({ visible: false, lapReady: false });
  });
});
