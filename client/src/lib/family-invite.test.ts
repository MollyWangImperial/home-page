import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inviteCopy, loadInviteStore, nextInvite, reachedMoments, recordInvite, type InviteFacts, type InviteMoment } from "./family-invite";

let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) });
});
afterEach(() => vi.unstubAllGlobals());

const facts = (over: Partial<InviteFacts> = {}): InviteFacts => ({ today: "2026-10-01", sessions: 0, streak: 0, wins: 0, daysSinceStart: 0, improvedOnReassessment: false, ...over });
const calm = { sharing: false, hardDay: false };

describe("when Alira invites the patient to share with family", () => {
  it("asks first when the plan is ready, and keeps showing it until answered that day", () => {
    expect(nextInvite(facts(), calm)).toBe("plan_ready");
    recordInvite("plan_ready", "2026-10-01", "shown");
    expect(nextInvite(facts(), calm)).toBe("plan_ready");
  });

  it("never asks while sharing is on, on a hard day, or after 'Please don't ask me again'", () => {
    expect(nextInvite(facts(), { sharing: true, hardDay: false })).toBeNull();
    expect(nextInvite(facts(), { sharing: false, hardDay: true })).toBeNull();
    recordInvite("plan_ready", "2026-10-01", "never");
    expect(nextInvite(facts({ today: "2026-12-01", sessions: 30, streak: 10, wins: 4, daysSinceStart: 60, improvedOnReassessment: true }), calm)).toBeNull();
  });

  it("waits three days after 'Not now', then asks at the next moment worth sharing", () => {
    recordInvite("plan_ready", "2026-10-01", "later");
    expect(nextInvite(facts({ today: "2026-10-02", sessions: 1 }), calm)).toBeNull();
    expect(nextInvite(facts({ today: "2026-10-04", sessions: 3, streak: 3 }), calm)).toBe("streak_3");
  });

  it("asks once per moment and at most five times in all", () => {
    const moments: InviteMoment[] = ["plan_ready", "first_session", "first_win", "streak_3", "week_one"];
    moments.forEach((moment, i) => recordInvite(moment, `2026-10-${String(1 + i * 4).padStart(2, "0")}`, "later"));
    expect(loadInviteStore().asks).toHaveLength(5);
    expect(nextInvite(facts({ today: "2026-11-30", sessions: 40, improvedOnReassessment: true }), calm)).toBeNull();
  });

  it("prefers the most meaningful moment", () => {
    expect(reachedMoments(facts({ sessions: 5, streak: 3, wins: 1, daysSinceStart: 7, improvedOnReassessment: true }))).toEqual(["plan_ready", "first_session", "first_win", "streak_3", "week_one", "reassessment_up"]);
    expect(nextInvite(facts({ sessions: 5, streak: 3, wins: 1, daysSinceStart: 7, improvedOnReassessment: true }), calm)).toBe("reassessment_up");
  });

  it("invites warmly, without numbers, guilt or pressure", () => {
    for (const moment of ["plan_ready", "first_session", "first_win", "streak_3", "week_one", "reassessment_up"] as InviteMoment[]) {
      const copy = inviteCopy(moment, "Zak");
      const words = `${copy.title} ${copy.message} ${copy.share}`;
      expect(words).not.toMatch(/regret|miss out|disappoint|should|must|fail|—/i);
      expect(words).not.toMatch(/\d/);
    }
  });
});
