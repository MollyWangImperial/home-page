import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_RESET_BACKUP_KEY, createAccountResetStore } from "./account-reset";
import { loadHomeActionSnapshot, nextHomeAction } from "./home-next-action";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}
const original = {
  "rehyn.onboarding.answers": '{"side_affected":"left"}',
  "rehyn.alira.visit.v1": '{"started":true}',
  "rehyn.how-it-works.visit.v1": "1",
  "rehyn.assessment.latest": '{"id":"old","completedAt":"2026-10-01","planChatCompleted":true}',
  "rehyn.journey.start": "2026-10-01",
  "rehyn.journey.sessions": '{"2026-10-01":{"ex_reach":{"score":80}}}',
  "rehyn.journey.visits.v1": '["Progress","Journal"]',
  "rehyn.journal.v1": '{"pages":{}}',
  "rehyn.molly.chat.v1": '{"draft":"A question"}',
  "rehyn.alira.adaptation.v1": '{"v":1}',
  "rehyn.exerciseLab.sessions": '[{"score":80}]',
};
afterEach(() => vi.unstubAllGlobals());

describe("new-user account reset", () => {
  it("clears Rehyn's local and session state, keeps other app data, and restores onboarding as the next action", () => {
    const local = memoryStorage({ ...original, theme: "dark", "other.app": "keep" });
    const session = memoryStorage({ "rehyn.fromHome": "1", "other.session": "keep" });
    const reset = createAccountResetStore(() => ({ local, session }));
    vi.stubGlobal("localStorage", local);
    expect(reset.canUndo()).toBe(false);
    expect(reset.reset()).toBe(true);
    Object.keys(original).forEach(key => expect(local.getItem(key)).toBeNull());
    expect(session.getItem("rehyn.fromHome")).toBeNull();
    expect(local.getItem("theme")).toBe("dark");
    expect(local.getItem("other.app")).toBe("keep");
    expect(session.getItem("other.session")).toBe("keep");
    expect(nextHomeAction(loadHomeActionSnapshot()).kind).toBe("onboarding");
    expect(reset.canUndo()).toBe(true);
  });
  it("can undo after a reload, replacing fresh test progress with the exact previous account", () => {
    const local = memoryStorage(original);
    const session = memoryStorage({ "rehyn.fromHome": "1" });
    const first = createAccountResetStore(() => ({ local, session }));
    first.reset();
    local.setItem("rehyn.new.test.state", "discard");
    local.setItem("rehyn.assessment.latest", "new assessment");
    session.setItem("rehyn.new.navigation", "discard");
    const returning = createAccountResetStore(() => ({ local, session }));
    expect(returning.canUndo()).toBe(true);
    expect(returning.undo()).toBe(true);
    Object.entries(original).forEach(([key, value]) => expect(local.getItem(key)).toBe(value));
    expect(session.getItem("rehyn.fromHome")).toBe("1");
    expect(local.getItem("rehyn.new.test.state")).toBeNull();
    expect(session.getItem("rehyn.new.navigation")).toBeNull();
    expect(local.getItem(ACCOUNT_RESET_BACKUP_KEY)).toBeNull();
    expect(returning.canUndo()).toBe(false);
  });
  it("retains the original account through repeated fresh-account tests", () => {
    const local = memoryStorage(original);
    const session = memoryStorage();
    const reset = createAccountResetStore(() => ({ local, session }));
    reset.reset();
    const backup = local.getItem(ACCOUNT_RESET_BACKUP_KEY);
    local.setItem("rehyn.onboarding.answers", "new answers");
    expect(reset.reset()).toBe(true);
    expect(local.getItem(ACCOUNT_RESET_BACKUP_KEY)).toBe(backup);
    expect(reset.undo()).toBe(true);
    expect(local.getItem("rehyn.onboarding.answers")).toBe(original["rehyn.onboarding.answers"]);
  });
  it("does not remove anything if the backup cannot fit in storage", () => {
    const local = memoryStorage(original);
    local.setItem = () => { throw new Error("Quota"); };
    const remove = vi.spyOn(local, "removeItem");
    const reset = createAccountResetStore(() => ({ local, session: memoryStorage() }));
    expect(reset.reset()).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    Object.entries(original).forEach(([key, value]) => expect(local.getItem(key)).toBe(value));
  });
  it("rolls back a partially completed reset when a removal fails", () => {
    const local = memoryStorage(original);
    const remove = local.removeItem;
    let failed = false;
    local.removeItem = key => {
      if (!failed && key === "rehyn.assessment.latest") { failed = true; throw new Error("Blocked"); }
      remove(key);
    };
    const reset = createAccountResetStore(() => ({ local, session: memoryStorage() }));
    expect(reset.reset()).toBe(false);
    Object.entries(original).forEach(([key, value]) => expect(local.getItem(key)).toBe(value));
    expect(reset.canUndo()).toBe(false);
  });
  it("keeps the fresh account and its backup if undo fails part way through", () => {
    const local = memoryStorage(original);
    const session = memoryStorage();
    const reset = createAccountResetStore(() => ({ local, session }));
    reset.reset();
    local.setItem("rehyn.journal.v1", "fresh journal");
    const write = local.setItem;
    let failed = false;
    local.setItem = (key, value) => {
      if (!failed && key === "rehyn.assessment.latest") { failed = true; throw new Error("Quota"); }
      write(key, value);
    };
    expect(reset.undo()).toBe(false);
    expect(local.getItem("rehyn.journal.v1")).toBe("fresh journal");
    expect(local.getItem("rehyn.onboarding.answers")).toBeNull();
    expect(reset.canUndo()).toBe(true);
    expect(reset.undo()).toBe(true);
  });
  it.each(["{", '{"v":1,"local":[["other.app","changed"]],"session":[]}', '{"v":1,"local":[["rehyn.journal.v1",42]],"session":[]}'])("rejects malformed or out-of-scope backups without clearing data: %s", raw => {
    const local = memoryStorage({ ...original, [ACCOUNT_RESET_BACKUP_KEY]: raw });
    const reset = createAccountResetStore(() => ({ local, session: memoryStorage() }));
    expect(reset.canUndo()).toBe(false);
    expect(reset.undo()).toBe(false);
    expect(local.getItem("rehyn.assessment.latest")).toBe(original["rehyn.assessment.latest"]);
  });
  it("reports unavailable browser storage without starting a reset", () => {
    const reset = createAccountResetStore(() => { throw new Error("Blocked"); });
    expect(reset.canUndo()).toBe(false);
    expect(reset.reset()).toBe(false);
    expect(reset.undo()).toBe(false);
  });
});
