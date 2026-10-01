import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_RESET_BACKUP_KEY, createAccountResetStore } from "./account-reset";
import { loadOnboardingAnswers, onboardingQuestions } from "./alira-onboarding";
import { loadHomeActionSnapshot, nextHomeAction } from "./home-next-action";
import { initializeReviewAccount, REVIEW_ACCOUNT_KEY, REVIEW_ACCOUNT_VERSION, REVIEW_ORIGIN } from "./review-account";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
afterEach(() => vi.unstubAllGlobals());

describe("Render review account baseline", () => {
  it("starts with no survey, assessment, exercise, journal, consent or chat activity and retains a recoverable backup", () => {
    const answers = JSON.stringify(Object.fromEntries(onboardingQuestions.map(q => [q.k, q.o[0].v])));
    const old = { "rehyn.onboarding.answers": answers, "rehyn.alira.visit.v1": '{"started":true}',
      "rehyn.assessment.latest": '{"id":"old","planChatCompleted":true}', "rehyn.journey.sessions": '{"old":{}}',
      "rehyn.journal.v1": '{"pages":{}}', "rehyn.alira.consent.v1": '{"results":true}',
      "rehyn.alira.chat.v1:survey": '{"messages":["done"]}', "rehyn.mytime.v1": '{"tried":["pond"]}' };
    const local = storage({ ...old, theme: "light", unrelated: "keep" });
    const session = storage({ "rehyn.fromHome": "1", unrelated: "keep" });
    vi.stubGlobal("localStorage", local);
    expect(initializeReviewAccount(REVIEW_ORIGIN, () => ({ local, session }))).toBe(true);
    expect(loadOnboardingAnswers()).toEqual({});
    expect(nextHomeAction(loadHomeActionSnapshot()).kind).toBe("onboarding");
    Object.keys(old).forEach(key => expect(local.getItem(key)).toBeNull());
    expect(session.getItem("rehyn.fromHome")).toBeNull();
    expect(local.getItem("theme")).toBe("light");
    expect(session.getItem("unrelated")).toBe("keep");
    expect(local.getItem(REVIEW_ACCOUNT_KEY)).toBe(REVIEW_ACCOUNT_VERSION);
    expect(local.getItem(ACCOUNT_RESET_BACKUP_KEY)).toContain(answers.replaceAll('"', '\\"'));
    expect(createAccountResetStore(() => ({ local, session })).undo()).toBe(true);
    expect(local.getItem("rehyn.onboarding.answers")).toBe(answers);
    expect(local.getItem(REVIEW_ACCOUNT_KEY)).toBe(REVIEW_ACCOUNT_VERSION);
  });
  it("preserves newly answered questions and progress across reloads and later visits", () => {
    const local = storage(), session = storage();
    const access = () => ({ local, session });
    expect(initializeReviewAccount(REVIEW_ORIGIN, access)).toBe(true);
    local.setItem("rehyn.onboarding.answers", '{"stroke_when":"1_3m"}');
    local.setItem("rehyn.journal.v1", "new journal");
    expect(initializeReviewAccount(REVIEW_ORIGIN, access)).toBe(false);
    expect(local.getItem("rehyn.onboarding.answers")).toBe('{"stroke_when":"1_3m"}');
    expect(local.getItem("rehyn.journal.v1")).toBe("new journal");
  });
  it.each(["http://127.0.0.1:3002", "http://localhost:3002", "https://another.onrender.com"])("leaves %s untouched", origin => {
    const access = vi.fn();
    expect(initializeReviewAccount(origin, access)).toBe(false);
    expect(access).not.toHaveBeenCalled();
  });
  it("does not remove account data when the marker or backup cannot be saved", () => {
    for (const rejected of [REVIEW_ACCOUNT_KEY, ACCOUNT_RESET_BACKUP_KEY]) {
      const local = storage({ "rehyn.onboarding.answers": "old answers" }), session = storage();
      const write = local.setItem;
      local.setItem = (key, value) => { if (key === rejected) throw new Error("Quota"); write(key, value); };
      expect(initializeReviewAccount(REVIEW_ORIGIN, () => ({ local, session }))).toBe(false);
      expect(local.getItem("rehyn.onboarding.answers")).toBe("old answers");
      expect(local.getItem(REVIEW_ACCOUNT_KEY)).toBeNull();
    }
  });
  it("tolerates blocked browser storage", () => {
    expect(initializeReviewAccount(REVIEW_ORIGIN, () => { throw new Error("Blocked"); })).toBe(false);
  });
});
