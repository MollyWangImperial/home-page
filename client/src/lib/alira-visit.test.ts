import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Alira's first-visit entrance", () => {
  it("does not mark a visit during render initialization", async () => {
    const { loadAliraVisit } = await import("./alira-visit");
    expect(loadAliraVisit()).toBeNull();
    expect(loadAliraVisit()).toBeNull();
  });

  it("remembers the first visit across app restarts, without a daily reset", async () => {
    const first = await import("./alira-visit");
    first.rememberAliraVisit(false);
    vi.resetModules();
    const reopened = await import("./alira-visit");
    expect(reopened.loadAliraVisit()).toEqual({ started: false });
  });

  it("remembers that questions have started even before the first answer", async () => {
    const { rememberAliraVisit, loadAliraVisit } = await import("./alira-visit");
    rememberAliraVisit(true);
    rememberAliraVisit(false);
    expect(loadAliraVisit()).toEqual({ started: true });
  });

  it.each(["broken", "null", "{}", '{"started":"yes"}'])("tolerates invalid stored values (%s)", async raw => {
    const { ALIRA_VISIT_KEY, loadAliraVisit } = await import("./alira-visit");
    localStorage.setItem(ALIRA_VISIT_KEY, raw);
    expect(loadAliraVisit()).toBeNull();
  });

  it("falls back to memory when storage is blocked", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("Blocked"); },
      setItem: () => { throw new Error("Blocked"); },
    });
    const { loadAliraVisit, rememberAliraVisit } = await import("./alira-visit");
    rememberAliraVisit(true);
    expect(loadAliraVisit()).toEqual({ started: true });
  });
});
