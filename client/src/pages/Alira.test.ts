import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Alira from "./Alira";
import { ALIRA_VISIT_KEY } from "@/lib/alira-visit";
import { ONBOARDING_STORAGE_KEY, onboardingCopy, onboardingQuestions, onboardingVoicePhrases } from "@/lib/alira-onboarding";
import { learningToday, WARM_REP_KEY } from "@/lib/alira-learning-store";
import { aliraVoicePhrases } from "@/lib/alira-voice-phrases";
import { rememberAssessment, rememberAssessmentPlan } from "@/lib/assessment";
import { ASSESSMENT_PLAN_READY_MESSAGE } from "@/lib/assessment-plan";
import { SAMPLE_ASSESSMENT } from "@/lib/journey-demo";
import { launchablePlan, recordExerciseResult } from "@/lib/journey";
import { PROFILE_KEY } from "@/lib/profile";
import { aliraChatContext, aliraChatStore } from "@/lib/alira-chat-history";

const route = vi.hoisted(() => ({ search: "onboarding=1" }));
vi.mock("wouter", () => ({ useLocation: () => ["/alira", vi.fn()], useSearch: () => route.search }));
vi.mock("@/components/RecoveryShell", () => ({ default: ({ children }: { children: unknown }) => children }));

beforeEach(() => {
  route.search = "onboarding=1";
  // The existing route/copy checks use the accessible reduced-motion presentation.
  vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Alira arrival and reduced-motion content", () => {
  it.each([{}, { stroke_when: "1_3m" }])("does not let a stale completed chat skip unanswered survey questions: %j", answers => {
    route.search = "onboarding=1&from=home";
    localStorage.setItem(ALIRA_VISIT_KEY, JSON.stringify({ started: true }));
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(answers));
    aliraChatStore.save("survey", {
      messages: [{ id: 1, from: "Alira", text: onboardingCopy.done }, { id: 2, from: "Alira", text: onboardingCopy.warmUpInvite }],
      presentation: { chips: "none", started: true, done: true, qi: -1, showQ: false, showDone: true, showSteps: false,
        paused: false, sel: [], otherOpen: false, otherText: "", draft: "" },
      positions: { firstMessage: 1, cards: [{ id: "warm-up", afterMessage: 2 }] },
      scrollTop: 0, warmUpDay: null, planFailed: false, planError: "",
    });
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain(onboardingQuestions[Object.keys(answers).length].t);
    expect(html).not.toContain(onboardingCopy.warmUpCard.title);
    expect(html).not.toContain("That&#x27;s everything for this part");
  });
  it("restores a delivered plan conversation immediately, including later messages and the original card position", () => {
    route.search = "";
    const stored = rememberAssessmentPlan(rememberAssessment(SAMPLE_ASSESSMENT)!, SAMPLE_ASSESSMENT, true)!;
    const context = aliraChatContext({ assessment: stored, completion: null, day: "2026-10-01" });
    aliraChatStore.save(context, {
      messages: [
        { id: 1, from: "Alira", text: "Well done—your test assessment is complete!", localOnly: true },
        { id: 2, from: "Alira", text: ASSESSMENT_PLAN_READY_MESSAGE },
        { id: 7, from: "you", text: "Can my carer help?" },
        { id: 10, from: "Alira", text: "Yes, you can do this together." },
      ],
      presentation: { chips: "none", started: true, done: true, qi: -1, showQ: false, showDone: false, showSteps: false,
        paused: false, sel: [], otherOpen: false, otherText: "", draft: "My next question" },
      positions: { firstMessage: 1, cards: [{ id: "plan-ready", afterMessage: 2 }] },
      scrollTop: 50, warmUpDay: null, planFailed: false, planError: "",
    });
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain("Can my carer help?");
    expect(html).toContain("Yes, you can do this together.");
    expect(html).toContain('value="My next question"');
    expect(html).not.toContain("Alira is typing");
    expect(html).not.toContain('class="ao-ch"');
    expect(html.indexOf('class="ao-done ao-plan-card"')).toBeLessThan(html.indexOf("Can my carer help?"));
  });
  it("starts exercise completion with waiting dots and withholds its messages and buttons until delivered", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    route.search = "from=exercise&exercise=ex_reach";
    rememberAssessmentPlan(rememberAssessment(SAMPLE_ASSESSMENT)!, SAMPLE_ASSESSMENT, true);
    recordExerciseResult("ex_reach", 75);
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain("Alira is typing");
    expect(html).toContain("ao-dots");
    expect(html).not.toContain("Before the day slips by");
    expect(html).not.toContain("Play a little in My Time");
  });
  it("stages the first entrance without the header assessment card", () => {
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain('data-entrance-motion="staged"');
    expect(html).not.toContain("ao-status-card");
  });

  it("shows the full welcome and all modules immediately on a return visit", () => {
    localStorage.setItem(ALIRA_VISIT_KEY, JSON.stringify({ started: false }));
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain('data-entrance-motion="static"');
    expect(html).toContain('class="ao-chat ao-reveal in"');
    expect(html).toContain("Hi Zak, I&#x27;m Alira.");
    expect(html).toContain("Before we plan anything");
    expect(html).not.toContain('class="ao-ch"');
    expect(html).not.toContain("ao-status-card");
  });

  it("shows the first question immediately when returning from Home", () => {
    route.search += "&from=home";
    localStorage.setItem(ALIRA_VISIT_KEY, JSON.stringify({ started: false }));
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain(onboardingQuestions[0].t);
    expect(html).toContain("Less than a month ago");
    expect(html).not.toContain("ao-status-card");
  });

  it("resumes the next unanswered question without typing", () => {
    localStorage.setItem(ALIRA_VISIT_KEY, JSON.stringify({ started: true }));
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ stroke_when: "1_3m" }));
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain(onboardingQuestions[1].t);
    expect(html).toContain("Left side");
    expect(html).not.toContain('class="ao-ch"');
    expect(html).not.toContain("ao-status-card");
  });

  // All twelve answered with an arm that moves (the first option alone, "Not at all", is the carer-led route).
  const answerAll = (arm_hand_movement = "fairly_well") => {
    localStorage.setItem(ALIRA_VISIT_KEY, JSON.stringify({ started: true }));
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ ...Object.fromEntries(onboardingQuestions.map(q => [q.k, q.o[0].v])), arm_hand_movement }));
  };
  const asHtml = (text: string) => text.replaceAll("'", "&#x27;");

  it("invites a warm-up after all twelve questions when there has been none today", () => {
    answerAll();
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain(asHtml(onboardingCopy.done));
    expect(html).toContain(asHtml(onboardingCopy.warmUpInvite));
    expect(html).toContain(onboardingCopy.warmUpCard.title);
    expect(html).toContain("Let&#x27;s warm up together");
    expect(html).toContain("Maybe later");
    expect(html).toContain('class="ao-done-art ao-warm-art"');
    expect(html).toContain("Finish assessment with random scores");
    expect(html).not.toContain("Your movement check");
    expect(html).not.toContain("Start now");
    expect(html).not.toContain("ao-status-card");
  });

  it("keeps the movement-check action in the conversation once today's warm-up was skipped", () => {
    answerAll();
    localStorage.setItem(WARM_REP_KEY, JSON.stringify({ v: 1, records: [], skips: [{ day: learningToday(), gate: "survey_end", at: new Date().toISOString() }] }));
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain("Your movement check");
    expect(html).toContain('class="ao-done-art"');
    expect(html).not.toContain("ao-done-ping");
    expect(html).toContain("Start now");
    expect(html).toContain("Finish assessment with random scores");
    expect(html).not.toContain(onboardingCopy.warmUpCard.title);
    expect(html).not.toContain(asHtml(onboardingCopy.warmUpInvite));
    expect(html).not.toContain("Open in the Rehyn app instead");
    expect(html).not.toContain("Answer the questions again");
    expect(html).not.toContain("ao-status-card");
  });

  it("goes straight to the movement check once today's warm-up is done", () => {
    answerAll();
    const warmUp = { id: "w1", day: learningToday(), at: new Date().toISOString(), source: "survey_end", side: "right", simulated: true, rest: { shoulderFlexion: 12, elbowExtension: 105 }, reaches: [] };
    localStorage.setItem(WARM_REP_KEY, JSON.stringify({ v: 1, records: [warmUp], skips: [] }));
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain("Start now");
    expect(html).not.toContain(onboardingCopy.warmUpCard.title);
  });

  it("does not offer the warm-up on the carer-led route", () => {
    answerAll("none");
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain("Your movement check");
    expect(html).toContain("Start now");
    expect(html).not.toContain(onboardingCopy.warmUpCard.title);
    expect(html).not.toContain(asHtml(onboardingCopy.warmUpInvite));
  });

  it("returns from the warm-up with a personal-plan invitation and waits for the patient to start the movement check", () => {
    answerAll();
    route.search += "&from=warm-up";
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain(asHtml(onboardingCopy.afterWarmUp));
    expect(html).toContain("Let&#x27;s do the movement check");
    expect(html).toContain("Your movement check");
    expect(html).not.toContain(asHtml(onboardingCopy.done));
    expect(html).not.toContain(asHtml(onboardingCopy.warmUpInvite));
    expect(html).not.toContain('data-entrance-motion="staged"');
    expect(aliraVoicePhrases["onboarding-afterWarmUp"]).toBe(onboardingCopy.afterWarmUp);
  });

  it("does not replay onboarding while responding to a newly completed assessment", () => {
    rememberAssessment({ preview_only: true, metrics: { function_score: { areas: { upper_limb: { display_score: 75 } }, tasks: [] } } });
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain('data-entrance-motion="static"');
    expect(html).not.toContain("Before we plan anything");
    expect(html).not.toContain("Start now");
    expect(html).not.toContain("View my exercises");
    expect(html).not.toContain("ao-plan-card");
  });

  it("keeps the prepared plan available when the patient returns", () => {
    const report = { preview_only: true, testing_random: true, metrics: { function_score: { display_total: 75, areas: { upper_limb: { display_score: 75 } }, tasks: [] } }, rehab_plan: [] };
    rememberAssessmentPlan(rememberAssessment(report)!, report, true);
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain("Your exercise plan is ready");
    expect(html).toContain(asHtml(ASSESSMENT_PLAN_READY_MESSAGE));
    expect(html).toContain("View my exercises");
    const card = html.split('class="ao-done ao-plan-card"')[1]?.split('class="ao-composer-area"')[0];
    expect(card).toBeDefined();
    expect(card).not.toMatch(/<p(?:\s|>)/);
    expect(card).not.toContain("Arm 75/100");
    expect(card).not.toContain("Random test scores");
    expect(html).not.toContain("A next step shaped by your movements");
    expect(html).not.toContain("Start now");
  });

  it("waits for the readiness conversation even when the assessment already includes a plan", () => {
    const report = { preview_only: true, metrics: { function_score: { display_total: 75, areas: { upper_limb: { display_score: 75 } }, tasks: [] } }, rehab_plan: [] };
    rememberAssessment(report);
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).not.toContain("ao-plan-card");
    expect(html).not.toContain("View my exercises");
  });

  it("starts a fresh home onboarding entry without showing an older plan", () => {
    route.search += "&from=home";
    const report = { preview_only: true, metrics: { function_score: { display_total: 50, areas: {}, tasks: [] } }, rehab_plan: [] };
    rememberAssessmentPlan(rememberAssessment(report)!, report, true);
    expect(renderToStaticMarkup(createElement(Alira))).not.toContain("View my exercises");
  });

  it("welcomes a completed exercise with rest and journal or My Time choices", () => {
    route.search = "from=exercise&exercise=ex_reach";
    const assessment = rememberAssessmentPlan(rememberAssessment(SAMPLE_ASSESSMENT)!, SAMPLE_ASSESSMENT, true);
    recordExerciseResult("ex_reach", 75);
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: "Alex", preferredName: "Ali" }));
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain("Congratulations, Ali");
    expect(html).toContain("Graded Forward Reach");
    expect(html).toContain("good rest");
    expect(html).toContain("Keep a little note in my journal");
    expect(html).toContain("Play a little in My Time");
    expect(html).not.toContain("test assessment is complete");
    expect(html).not.toContain("random test marks");
    expect(html).not.toContain("ao-plan-card");
    expect(launchablePlan(assessment).map(exercise => exercise.id)).toEqual(["ex_reach"]);
  });

  it("returns to the rest invitation after today's full session without replaying assessment messages", () => {
    route.search = "";
    const assessment = rememberAssessmentPlan(rememberAssessment(SAMPLE_ASSESSMENT)!, SAMPLE_ASSESSMENT, true);
    for (const exercise of launchablePlan(assessment)) recordExerciseResult(exercise.id, 80);
    const html = renderToStaticMarkup(createElement(Alira));
    expect(html).toContain("today’s exercises");
    expect(html).toContain("A little time for you");
    expect(html).not.toContain(ASSESSMENT_PLAN_READY_MESSAGE);
    expect(html).not.toContain("test assessment is complete");
  });
});

describe("the warm-up invitation's words", () => {
  const spoken = [onboardingCopy.warmUpInvite, onboardingCopy.warmUpSkip];

  it("registers what Alira says for read-aloud, and not the card's labels", () => {
    expect(Object.keys(onboardingVoicePhrases).filter(id => id.startsWith("onboarding-warmUp"))).toEqual(["onboarding-warmUpInvite", "onboarding-warmUpSkip"]);
    expect(aliraVoicePhrases["onboarding-warmUpInvite"]).toBe(onboardingCopy.warmUpInvite);
    expect(aliraVoicePhrases["onboarding-warmUpSkip"]).toBe(onboardingCopy.warmUpSkip);
  });

  it("invites without pressure: no figures, no failing, no dashes", () => {
    for (const text of [...spoken, ...Object.values(onboardingCopy.warmUpCard)]) {
      expect(text).not.toMatch(/\d|\bfail|[–—]|\b(he|him|his)\b/i);
    }
  });
});
