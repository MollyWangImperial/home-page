import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASSESSMENT_RESULT_KEY, loadRememberedAssessment, rememberAssessment, rememberAssessmentPlan, type AssessmentReport } from "./assessment";
import { ASSESSMENT_PLAN_READY_MESSAGE, assessmentCompletionMessages, assessmentCongratulations, pauseAssessmentChat, planExerciseUrl, randomAssessment, requestAssessmentPlan, runAssessmentConversation, scoreSummary } from "./assessment-plan";

const report: AssessmentReport = { preview_only: true, assessment_package: "initial", task_results: [{ task_id: "T1", steps: [], metrics: { motion_data: ["private frames"], ladder: { attempts: [] } } }],
  metrics: { function_score: { display_total: 75, areas: { arm: { display_score: 75 }, hand: { display_score: null } }, tasks: [] } } };
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("assessment to Alira plan handoff", () => {
  it("opens the selected exercise with its assigned target, dose and affected side", () => {
    const url = new URL(planExerciseUrl({ id: "ex_h2m", name: "Hand to mouth", description: "", sets: 3, reps: 8, frequency: "Daily", difficulty: "easy", target_rung: "chest" }, "left"));
    expect(url.pathname).toBe("/api/rehab/runner");
    expect(Object.fromEntries(url.searchParams)).toEqual({ exercise_id: "ex_h2m", reps: "8", difficulty: "easy", affected_side: "left", target_rung: "chest" });
  });
  it("retains local scores without an account ID and excludes recorded motion frames", () => {
    const saved = rememberAssessment(report)!;
    expect(saved.id).toMatch(/^preview-/);
    expect(loadRememberedAssessment()?.report?.metrics).toEqual(report.metrics);
    expect(localStorage.getItem(ASSESSMENT_RESULT_KEY)).not.toContain("private frames");
    const updated = rememberAssessmentPlan(saved, { ...report, rehab_plan: [] });
    expect(updated.completedAt).toBe(saved.completedAt);
  });
  it("keeps old saved ID records compatible", () => {
    localStorage.setItem(ASSESSMENT_RESULT_KEY, JSON.stringify({ id: "old", completedAt: "2026-09-30" }));
    expect(loadRememberedAssessment()?.id).toBe("old");
    expect(rememberAssessment({})).toBeNull();
    expect(rememberAssessment({ id: "old-result-without-scores" })?.report).toBeUndefined();
  });
  it("uses measured area marks and never turns an unmeasured area into zero", () => {
    expect(scoreSummary(report)).toBe("Arm 75/100");
    expect(assessmentCongratulations(report)).toContain("Well done");
    expect(assessmentCongratulations({ ...report, testing_random: true })).not.toMatch(/random|75\/100/);
    expect(scoreSummary({ metrics: { function_score: { display_total: 75, tasks: [], areas: { upper_limb: { display_score: 75 } } } } })).toBe("Arm 75/100");
    expect(scoreSummary({ metrics: { function_score: { display_total: 80, tasks: [], areas: { lower_limb: { display_score: 80 } } } } })).toBe("Walking 80/100");
  });
  it("reuses a real stored plan without an anonymous API call", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const saved = rememberAssessment({ ...report, id: "real", preview_only: false, rehab_plan: [] })!;
    expect((await requestAssessmentPlan(saved, {})).rehab_plan).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reports failures rather than inventing a ready plan", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(requestAssessmentPlan(rememberAssessment(report)!, {})).rejects.toThrow("couldn’t prepare");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => report }));
    await expect(requestAssessmentPlan(rememberAssessment(report)!, {})).rejects.toThrow("incomplete");
  });
  it("only permits random completion in the local development preview", async () => {
    vi.stubEnv("DEV", false);
    await expect(randomAssessment({})).rejects.toThrow("local testing preview only");
  });

  it("uses the survey-assigned tasks for random testing and keeps omitted areas unmeasured", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_ASSESSMENT_BASE", "http://localhost:8001");
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...report, testing_random: true }) });
    vi.stubGlobal("fetch", fetch);
    await randomAssessment({ arm_hand_movement: "none", get_around: "own" });
    expect(JSON.parse(fetch.mock.calls[0][1].body).assigned_task_ids).toEqual(["L6"]);
    await expect(randomAssessment({ arm_hand_movement: "none", get_around: "wheelchair" })).rejects.toThrow("supported movement");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not enable random testing against a hosted assessment service", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_ASSESSMENT_BASE", "https://rehyn.onrender.com");
    await expect(randomAssessment({})).rejects.toThrow("local testing preview only");
  });

  it("reveals congratulations, marks, and designing in order and waits for the real plan", async () => {
    const copy = assessmentCompletionMessages(report);
    expect(copy.ready).toMatch(/^Congratulations, you've unlocked Journey!/);
    expect(copy.ready).toContain("Tap View my exercises below");
    const lines: string[] = [];
    const controller = new AbortController();
    let finishLine!: () => void;
    let finishPlan!: (value: AssessmentReport) => void;
    const preparePlan = vi.fn(() => new Promise<AssessmentReport>(resolve => { finishPlan = resolve; }));
    const flow = runAssessmentConversation(report, { showMessage: text => { lines.push(text); return new Promise<void>(resolve => { finishLine = resolve; }); }, preparePlan }, controller.signal);
    expect(lines).toEqual([copy.congratulations]);
    expect(preparePlan).not.toHaveBeenCalled();
    finishLine(); await vi.waitFor(() => expect(lines).toHaveLength(2));
    expect(lines[1]).toBe(copy.marks);
    expect(preparePlan).not.toHaveBeenCalled();
    finishLine(); await vi.waitFor(() => expect(lines).toHaveLength(3));
    expect(lines[2]).toBe(copy.designing);
    expect(preparePlan).toHaveBeenCalledOnce();
    finishLine(); await Promise.resolve();
    expect(lines).not.toContain(copy.ready);
    finishPlan({ ...report, rehab_plan: [] });
    await vi.waitFor(() => expect(lines).toHaveLength(4));
    expect(lines[3]).toBe(copy.ready);
    let settled = false; void flow.then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    finishLine(); await flow;
    expect(settled).toBe(true);
  });

  it("never announces readiness after a planning failure", async () => {
    const lines: string[] = [];
    await expect(runAssessmentConversation(report, { showMessage: async text => { lines.push(text); }, preparePlan: async () => { throw new Error("service unavailable"); } }, new AbortController().signal)).rejects.toThrow("service unavailable");
    expect(lines).not.toContain(assessmentCompletionMessages(report).ready);
  });

  it("does not deliver random marks while retaining the original scores for plan preparation", async () => {
    const testing = { ...report, testing_random: true };
    const lines: string[] = [];
    const preparePlan = vi.fn(async () => ({ ...testing, rehab_plan: [] }));
    const result = await runAssessmentConversation(testing, { showMessage: async text => { lines.push(text); }, preparePlan }, new AbortController().signal);
    expect(lines).toEqual([assessmentCompletionMessages(testing).congratulations, assessmentCompletionMessages(testing).designing, ASSESSMENT_PLAN_READY_MESSAGE]);
    expect(lines.join(" ")).not.toMatch(/random (test )?(marks|scores)|75\/100/);
    expect(result.metrics).toEqual(report.metrics);
    expect(preparePlan).toHaveBeenCalledOnce();
    expect(assessmentCompletionMessages(testing).marks).toBeNull();
  });

  it("shows waiting after the design message and keeps it until a slow plan arrives", async () => {
    vi.useFakeTimers();
    const copy = assessmentCompletionMessages(report);
    const events: (string | boolean)[] = [];
    let finishPlan!: (value: AssessmentReport) => void;
    let finishDesign!: () => void;
    const flow = runAssessmentConversation(report, {
      showMessage: async text => {
        events.push(text);
        if (text === copy.designing) await new Promise<void>(resolve => { finishDesign = resolve; });
      },
      preparePlan: () => new Promise(resolve => { finishPlan = resolve; }),
      onPlanWaiting: waiting => { events.push(waiting); },
    }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([copy.congratulations, copy.marks, copy.designing]);
    finishDesign();
    await vi.advanceTimersByTimeAsync(3000);
    expect(events).toEqual([copy.congratulations, copy.marks, copy.designing, true]);
    finishPlan({ ...report, rehab_plan: [] });
    await flow;
    expect(events.slice(-2)).toEqual([false, copy.ready]);
  });

  it("keeps waiting visible for three seconds even when the plan is already available", async () => {
    vi.useFakeTimers();
    const copy = assessmentCompletionMessages(report);
    const events: (string | boolean)[] = [];
    const flow = runAssessmentConversation(report, {
      showMessage: async text => { events.push(text); },
      preparePlan: async () => ({ ...report, rehab_plan: [] }),
      onPlanWaiting: waiting => { events.push(waiting); },
    }, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2999);
    expect(events.at(-1)).toBe(true);
    expect(events).not.toContain(copy.ready);
    await vi.advanceTimersByTimeAsync(1);
    await flow;
    expect(events.slice(-2)).toEqual([false, copy.ready]);
  });

  it("clears the waiting indicator on failure without announcing a ready plan", async () => {
    vi.useFakeTimers();
    const events: (string | boolean)[] = [];
    const flow = runAssessmentConversation(report, {
      showMessage: async text => { events.push(text); },
      preparePlan: async () => { throw new Error("service unavailable"); },
      onPlanWaiting: waiting => { events.push(waiting); },
    }, new AbortController().signal);
    const failure = expect(flow).rejects.toThrow("service unavailable");
    await vi.advanceTimersByTimeAsync(3000);
    await failure;
    expect(events.slice(-2)).toEqual([true, false]);
    expect(events).not.toContain(assessmentCompletionMessages(report).ready);
  });

  it("clears the waiting indicator and timer when the patient leaves", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const events: (string | boolean)[] = [];
    const flow = runAssessmentConversation(report, {
      showMessage: async text => { events.push(text); },
      preparePlan: async () => ({ ...report, rehab_plan: [] }),
      onPlanWaiting: waiting => { events.push(waiting); },
    }, controller.signal);
    const cancellation = expect(flow).rejects.toBe("page-left");
    await vi.advanceTimersByTimeAsync(0);
    expect(events.at(-1)).toBe(true);
    controller.abort("page-left");
    await cancellation;
    expect(events.at(-1)).toBe(false);
    expect(events).not.toContain(assessmentCompletionMessages(report).ready);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels pending conversation timers when the patient leaves", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pause = pauseAssessmentChat(3000, controller.signal);
    controller.abort("page-left");
    await expect(pause).rejects.toBe("page-left");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("remembers that the chat has finished without changing the assessment date", () => {
    const saved = rememberAssessment(report)!;
    const updated = rememberAssessmentPlan(saved, { ...report, rehab_plan: [] }, true);
    expect(updated.completedAt).toBe(saved.completedAt);
    expect(loadRememberedAssessment()?.planChatCompleted).toBe(true);
    expect(rememberAssessment({ ...report })?.planChatCompleted).not.toBe(true);
  });
});
