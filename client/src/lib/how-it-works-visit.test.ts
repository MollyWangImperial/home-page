import { describe, expect, it } from "vitest";
import { createHowItWorksVisitStore, HOW_IT_WORKS_VISIT_KEY } from "./how-it-works-visit";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("Questions about Alira's first greeting", () => {
  it("does not consume the first animation while rendering, then remembers across mounts and reloads", () => {
    const disk = memoryStorage();
    const first = createHowItWorksVisitStore(() => disk);
    expect(first.hasVisited()).toBe(false);
    expect(first.hasVisited()).toBe(false);
    first.remember();
    expect(createHowItWorksVisitStore(() => disk).hasVisited()).toBe(true);
    disk.removeItem(HOW_IT_WORKS_VISIT_KEY);
    expect(first.hasVisited()).toBe(false);
  });

  it("ignores malformed markers and does not change other browser data", () => {
    const disk = memoryStorage();
    const store = createHowItWorksVisitStore(() => disk);
    disk.setItem("other.app", "keep");
    for (const raw of ["", "false", "true", "{}", "null"]) {
      disk.setItem(HOW_IT_WORKS_VISIT_KEY, raw);
      expect(store.hasVisited()).toBe(false);
    }
    store.remember();
    expect(store.hasVisited()).toBe(true);
    expect(disk.getItem("other.app")).toBe("keep");
  });

  it("prevents replay during same-page tab changes even when storage is blocked or full", () => {
    for (const access of [
      () => { throw new Error("Blocked"); },
      () => ({ getItem: () => null, setItem: () => { throw new Error("Full"); } }),
    ]) {
      const store = createHowItWorksVisitStore(access);
      expect(store.hasVisited()).toBe(false);
      store.remember();
      expect(store.hasVisited()).toBe(true);
    }
  });
});
