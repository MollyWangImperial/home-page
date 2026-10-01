import { afterEach, describe, expect, it, vi } from "vitest";
import {
  affectedSideFrom,
  answerLabel,
  applicableQuestions,
  fillRandomAnswers,
  loadOnboardingAnswers,
  onboardingQuestions,
  onboardingVoicePhrases,
  saveOnboardingAnswers,
} from "./alira-onboarding";
import {
  appAssessmentUrl,
  buildRunnerUrl,
  companionTaskPlan,
  getAssessmentBase,
  parseRunnerMessage,
} from "./assessment";
import { aliraVoicePhrases } from "./alira-voice-phrases";

afterEach(() => vi.unstubAllGlobals());

describe("Alira's twelve onboarding questions", () => {
  it("asks the twelve questions from the approved design, each with fixed choices", () => {
    expect(onboardingQuestions).toHaveLength(12);
    expect(applicableQuestions({})).toEqual([...Array(12).keys()]);
    for (const q of onboardingQuestions) {
      expect(q.o.length).toBeGreaterThanOrEqual(3);
      expect(new Set(q.o.map(o => o.v)).size).toBe(q.o.length);
    }
    expect(onboardingQuestions.at(-1)?.other).toBe("other");
  });
  it("labels answers, including a typed 'something else'", () => {
    const goal = onboardingQuestions.find(q => q.k === "main_goal")!;
    expect(answerLabel(goal, "dressing")).toBe("Dressing myself");
    expect(answerLabel(goal, "other", "Play the piano")).toBe("Play the piano");
    expect(answerLabel(goal, undefined)).toBe("");
  });
  it("fills every remaining question at random for the administrative control, keeping real answers", () => {
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const plan = companionTaskPlan(fillRandomAnswers({ arm_hand_movement: "none", get_around: "wheelchair" }, () => r));
      expect(plan.taskIds).toEqual(["T1", "T3", "H4", "H3", "L6"]);
    }
    const filled = fillRandomAnswers({ side_affected: "left" }, () => 0.42);
    expect(filled.side_affected).toBe("left");
    for (const q of onboardingQuestions) {
      const value = filled[q.k];
      expect(q.o.some(o => o.v === value)).toBe(true);
      expect(value).not.toBe(q.other);
    }
  });
  it("sends the affected side to the movement check and falls back to the runner default", () => {
    expect(affectedSideFrom({ side_affected: "left" })).toBe("left");
    expect(affectedSideFrom({ side_affected: "right" })).toBe("right");
    expect(affectedSideFrom({ side_affected: "both" })).toBe("right");
    expect(affectedSideFrom({})).toBe("right");
  });
  it("keeps answers on this device and ignores anything it does not recognise", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    expect(saveOnboardingAnswers({ stroke_when: "1_3m", main_goal_other: "Garden" })).toBe(true);
    values.set("rehyn.onboarding.answers", JSON.stringify({ stroke_when: "1_3m", surprise: { nested: true }, falls: 3 }));
    expect(loadOnboardingAnswers()).toEqual({ stroke_when: "1_3m", falls: 3 });
    values.set("rehyn.onboarding.answers", "not json");
    expect(loadOnboardingAnswers()).toEqual({});
  });
  it("registers every fixed Alira line for read-aloud", () => {
    for (const q of onboardingQuestions) expect(aliraVoicePhrases[`onboarding-q-${q.k}`]).toBe(q.t);
    for (const [id, text] of Object.entries(onboardingVoicePhrases)) expect(aliraVoicePhrases[id]).toBe(text);
  });
});

describe("movement check connection", () => {
  it("accepts HTTPS anywhere and plain HTTP only on localhost", () => {
    expect(getAssessmentBase("https://rehyn.onrender.com/")).toBe("https://rehyn.onrender.com");
    expect(getAssessmentBase("http://localhost:8001")).toBe("http://localhost:8001");
    expect(getAssessmentBase("http://127.0.0.1:8001/api")).toBe("http://127.0.0.1:8001");
    for (const value of ["http://example.com", "https://user:pass@example.com", "javascript:alert(1)", "", undefined]) {
      expect(getAssessmentBase(value)).toBe("https://rehyn.onrender.com");
      expect(getAssessmentBase(value, true)).toBe("http://localhost:8001");
    }
  });
  it("opens the initial package in the app's pose runner with the patient's side", () => {
    expect(buildRunnerUrl("http://localhost:8001", { affectedSide: "left" })).toBe(
      "http://localhost:8001/api/pose/runner?package=initial&ladder=1&task_ids=T1%2CT3%2CH4%2CH3%2CL6&start_rung=%7B%22T1%22%3A%22r160%22%2C%22T3%22%3A%22mouth%22%7D&helper=ask&affected_side=left&voice_guidance=1&local_preview=1"
    );
    expect(buildRunnerUrl("https://rehyn.onrender.com", { affectedSide: "right", voiceGuidance: false })).toContain("affected_side=right&voice_guidance=0");
    expect(buildRunnerUrl("https://rehyn.onrender.com", { affectedSide: "right" })).not.toContain("local_preview");
    expect(appAssessmentUrl("https://rehyn.onrender.com")).toBe("https://rehyn.onrender.com/task-intro?mode=initial");
  });
  it("reads only well-formed runner messages", () => {
    expect(parseRunnerMessage(JSON.stringify({ type: "task_complete", task_id: "T1" }))).toMatchObject({ type: "task_complete" });
    expect(parseRunnerMessage({ type: "exit" })).toEqual({ type: "exit" });
    for (const value of ["nope", "{}", { type: 3 }, null, [], 42]) expect(parseRunnerMessage(value)).toBeNull();
  });
});
