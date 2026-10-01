import { describe, expect, it, vi } from "vitest";
import {
  AGENT_EXERCISES,
  ALIRA_TOOL_NAMES,
  SURVEY_QUESTION_KEYS,
  aliraAgentTools,
  buildAliraSystemPrompt,
  echoableContent,
  readAgentMessages,
  type AgentBlock,
  type AgentMessage,
} from "@shared/alira-agent";
import {
  describePageState,
  matchOption,
  monthsAgo,
  routeLocally,
  runAgentTurn,
  surveySummary,
  withUserBlocks,
  type RouteContext,
} from "./alira-agent";
import { aliraAgentCopy } from "./alira-agent-copy";
import { concernStarter, onboardingQuestions, starterSets } from "./alira-onboarding";
import { aliraVoicePhrases } from "./alira-voice-phrases";
import { LAUNCH_EXERCISE_IDS } from "./exercise-engine/config";

const question = (key: string) => onboardingQuestions.find(q => q.k === key)!;
const midSurvey = (key = "side_affected"): RouteContext => ({ question: question(key), started: true, done: false, speaking: false });
const notStarted: RouteContext = { question: null, started: false, done: false, speaking: false };
const finished: RouteContext = { question: null, started: true, done: true, speaking: false };
const paused: RouteContext = { question: null, started: true, done: false, speaking: false };
const toolOf = (text: string, ctx: RouteContext = midSurvey()) => routeLocally(text, ctx)?.tool?.name ?? null;

describe("restarting the survey from the chat", () => {
  const requests = [
    "restart the survey",
    "Restart the survey.",
    "RESTART THE SURVEY",
    "restart survey",
    "re-start the survey",
    "restart",
    "Can we restart the questions?",
    "please restart the questionnaire",
    "I want to start over",
    "start again",
    "let's start from the beginning",
    "start the survey again",
    "redo the questions",
    "reset my answers",
    "clear my answers",
    "I'd like to answer the questions again",
    "go back to the first question",
    "restart the assessment",
  ];
  it.each(requests)("restarts on %j, wherever the patient is", text => {
    for (const ctx of [midSurvey(), midSurvey("main_goal"), notStarted, finished, paused]) {
      expect(routeLocally(text, ctx)).toEqual({ tool: { name: "restart_survey", input: {} } });
    }
  });
  it("does not restart when the patient says not to, or only asks about it", () => {
    for (const text of ["don't restart the survey", "I don't want to start over", "what happens if I restart the survey?", "would I lose my answers if I restart?"]) {
      expect(toolOf(text)).not.toBe("restart_survey");
    }
  });
  it("sends a restart of the movement check to the movement check, and leaves exercises alone", () => {
    expect(toolOf("restart the movement check")).toBe("start_movement_check");
    expect(toolOf("redo the camera check", finished)).toBe("start_movement_check");
    expect(toolOf("restart the exercise", finished)).not.toBe("restart_survey");
  });
});

describe("understanding other requests", () => {
  it("puts safety first", () => {
    for (const text of ["I think I'm having a stroke", "my face is suddenly drooping", "I have chest pain", "call an ambulance", "I've just fallen and can't get up"]) {
      expect(routeLocally(text, midSurvey())).toEqual({ tool: { name: "show_warning_signs", input: {} }, say: aliraAgentCopy.emergency });
    }
    expect(routeLocally("I want to die", notStarted)).toEqual({ say: aliraAgentCopy.crisis });
    // Describing the stroke they already had is an answer, not an emergency.
    expect(routeLocally("I had a stroke 3 months ago", midSurvey("stroke_when"))?.tool).toEqual({
      name: "answer_current_question",
      input: { values: ["1_3m"], other_text: null },
    });
    expect(routeLocally("my arm is weak", midSurvey("arm_hand_movement"))?.say).toBeUndefined();
  });

  it("moves around the questions", () => {
    expect(toolOf("go back")).toBe("go_back_one_question");
    expect(toolOf("previous question")).toBe("go_back_one_question");
    expect(toolOf("skip this one")).toBe("skip_current_question");
    expect(toolOf("pause")).toBe("pause_survey");
    expect(toolOf("can we continue later")).toBe("pause_survey");
    expect(toolOf("carry on", paused)).toBe("continue_survey");
    expect(toolOf("let's start", notStarted)).toBe("continue_survey");
    expect(toolOf("yes", notStarted)).toBe("continue_survey");
    expect(toolOf("where were we", paused)).toBe("continue_survey");
    expect(routeLocally("change my answer about falls", finished)?.tool).toEqual({ name: "go_to_question", input: { question_key: "falls" } });
    expect(routeLocally("I'm tired", midSurvey())).toEqual({ tool: { name: "pause_survey", input: {} }, say: starterSets[2][1].a });
    // "yes" is not an answer to a question it does not fit.
    expect(routeLocally("yes", midSurvey("falls"))).toBeNull();
  });

  it("uses the rest of the app", () => {
    expect(routeLocally("take me home", finished)?.tool).toEqual({ name: "open_page", input: { page: "home" } });
    expect(routeLocally("open my journal", finished)?.tool).toEqual({ name: "open_page", input: { page: "journal" } });
    expect(routeLocally("show me my medals", finished)?.tool).toEqual({ name: "open_page", input: { page: "medals" } });
    expect(routeLocally("I want to do some breathing for 5 minutes", finished)?.tool).toEqual({ name: "open_my_time", input: { activity: "breathing", minutes: 5 } });
    expect(routeLocally("can I play the memory game", finished)?.tool).toEqual({ name: "open_my_time", input: { activity: "memory_game", minutes: null } });
    expect(routeLocally("open the knee exercise", finished)?.tool).toEqual({ name: "open_exercise", input: { exercise_id: "ex_lower_selective", level: null, side: null } });
    expect(routeLocally("open settings", finished)?.tool).toEqual({ name: "open_settings", input: { section: "profile" } });
    expect(routeLocally("show me the privacy notice", finished)?.tool).toEqual({ name: "open_settings", input: { section: "privacy" } });
    expect(routeLocally("make the text bigger", finished)?.tool).toEqual({ name: "set_display", input: { larger_text: true, stronger_contrast: null } });
    expect(routeLocally("the text is too big", finished)?.tool).toEqual({ name: "set_display", input: { larger_text: false, stronger_contrast: null } });
    expect(routeLocally("more contrast please", finished)?.tool).toEqual({ name: "set_display", input: { larger_text: null, stronger_contrast: true } });
    expect(toolOf("show me the warning signs", finished)).toBe("show_warning_signs");
    expect(toolOf("read that aloud")).toBe("read_aloud");
    expect(toolOf("stop", { ...finished, speaking: true })).toBe("stop_reading");
    expect(toolOf("let's do the movement check", finished)).toBe("start_movement_check");
    expect(routeLocally("administrative control", midSurvey())).toEqual({ admin: true });
    expect(routeLocally("what can you do?", finished)).toEqual({ say: aliraAgentCopy.help });
    // "sounds good" is agreement, not a request for calming sounds; "my foot hurts" is not an exercise.
    expect(toolOf("sounds good", finished)).toBeNull();
    expect(toolOf("my foot hurts", finished)).toBeNull();
  });

  it("answers the questions people often ask in Alira's approved words", () => {
    expect(routeLocally("What is Rehyn?", notStarted)).toEqual({ say: starterSets[0][0].a });
    expect(routeLocally("how long does it take?", notStarted)).toEqual({ say: starterSets[1][1].a });
    expect(routeLocally("why do you need my camera?", notStarted)).toEqual({ say: starterSets[2][0].a });
    expect(routeLocally("can my wife help me?", notStarted)).toEqual({ say: starterSets[1][0].a });
    expect(routeLocally("I'm worried about my arm", finished)).toEqual({ say: concernStarter.a });
    expect(routeLocally("How does the assessment work?", notStarted)?.tool?.name).toBe("show_assessment_steps");
  });

  it("names only real tools, with exactly the inputs each one declares", () => {
    const samples = [
      "restart the survey", "go back", "skip", "pause", "carry on", "left", "take me home", "open my journal",
      "breathing", "open the knee exercise", "open settings", "make the text bigger", "more contrast", "warning signs",
      "read that aloud", "start the movement check", "change my answer about falls", "stop reading",
    ];
    for (const text of samples) {
      for (const ctx of [midSurvey(), finished, paused]) {
        const tool = routeLocally(text, ctx)?.tool;
        if (!tool) continue;
        const definition = aliraAgentTools.find(t => t.name === tool.name);
        expect(definition, text).toBeDefined();
        expect(Object.keys(tool.input).sort()).toEqual([...definition!.input_schema.required].sort());
      }
    }
  });
});

describe("answers typed in words", () => {
  const answer = (key: string, text: string) => matchOption(question(key), text)?.values ?? null;
  it("matches everyday words to the answer they mean", () => {
    expect(answer("side_affected", "left")).toEqual(["left"]);
    expect(answer("side_affected", "My left side.")).toEqual(["left"]);
    expect(answer("side_affected", "left and right")).toEqual(["both"]);
    expect(answer("side_affected", "I don't know")).toEqual(["unsure"]);
    expect(answer("arm_hand_movement", "not at all")).toEqual(["none"]);
    expect(answer("arm_hand_movement", "yes but it gets tired quickly")).toEqual(["tires"]);
    expect(answer("get_around", "I use a walking stick")).toEqual(["frame_stick"]);
    expect(answer("falls", "no")).toEqual(["no"]);
    expect(answer("falls", "twice")).toEqual(["more"]);
    expect(answer("mood", "not good")).toEqual(["low"]);
    expect(answer("mood", "pretty good")).toEqual(["good"]);
    expect(answer("help_at_home", "my wife and a carer")).toEqual(["both"]);
    expect(answer("exercise_place", "sitting down")).toEqual(["chair"]);
    expect(answer("main_goal", "getting dressed")).toEqual(["dressing"]);
  });
  it("works out when the stroke happened", () => {
    expect(answer("stroke_when", "less than a month ago")).toEqual(["lt_1m"]);
    expect(answer("stroke_when", "three weeks ago")).toEqual(["lt_1m"]);
    expect(answer("stroke_when", "6 weeks")).toEqual(["1_3m"]);
    expect(answer("stroke_when", "3 months ago")).toEqual(["1_3m"]);
    expect(answer("stroke_when", "four months ago")).toEqual(["3_6m"]);
    expect(answer("stroke_when", "more than 6 months")).toEqual(["gt_6m"]);
    expect(answer("stroke_when", "about 2 years ago")).toEqual(["gt_6m"]);
    expect(monthsAgo("no dates here")).toBeNull();
  });
  it("leaves unclear words and questions to the patient", () => {
    expect(answer("arm_hand_movement", "yes")).toBeNull();
    expect(answer("arm_hand_movement", "a little but it gets tired")).toBeNull();
    expect(answer("side_affected", "which side do you mean?")).toBeNull();
    expect(answer("arm_hand_movement", "what do you mean by fairly well")).toBeNull();
    expect(answer("main_goal", "go out for a walk")).toBeNull();
  });
  it("keeps a goal in the patient's own words", () => {
    expect(matchOption(question("main_goal"), "I'd like to play the piano again")).toEqual({ values: ["other"], otherText: "I'd like to play the piano again" });
  });
});

describe("what Claude is told", () => {
  it("describes the screen without the patient's answers", () => {
    const state = describePageState({
      answers: { stroke_when: "1_3m" }, qi: 1, started: true, done: false, paused: false, newUser: true,
      medal: null, movementCheckDoneOn: null, largeText: false, strongContrast: true,
    });
    expect(state).toContain("1 of 12 answered");
    expect(state).toContain('question 2 of 12 (side_affected) "Which side of your body has been affected?"');
    expect(state).toContain('left = "Left side"');
    expect(state).toContain("stronger contrast on");
    expect(state).not.toContain("1_3m");
    expect(describePageState({ answers: {}, qi: -1, started: false, done: false, paused: false, newUser: false, medal: null, movementCheckDoneOn: null, largeText: false, strongContrast: false }))
      .toContain("not started");
  });
  it("lists saved answers in words when asked for them", () => {
    const summary = JSON.parse(surveySummary({ side_affected: "left", main_goal: "other", main_goal_other: "Gardening" }));
    expect(summary.answered).toBe(2);
    expect(summary.questions.find((q: { question_key: string }) => q.question_key === "side_affected").answer).toBe("Left side");
    expect(summary.questions.find((q: { question_key: string }) => q.question_key === "main_goal").answer).toBe("Gardening");
  });
  it("has tools for every question and launch exercise, in the strict form the API needs", () => {
    expect([...SURVEY_QUESTION_KEYS]).toEqual(onboardingQuestions.map(q => q.k));
    expect(AGENT_EXERCISES.map(e => e.id)).toEqual([...LAUNCH_EXERCISE_IDS]);
    expect(new Set(ALIRA_TOOL_NAMES).size).toBe(aliraAgentTools.length);
    for (const tool of aliraAgentTools) {
      expect(tool.strict).toBe(true);
      expect(tool.input_schema.additionalProperties).toBe(false);
      expect(tool.input_schema.required).toEqual(Object.keys(tool.input_schema.properties));
      expect(JSON.stringify(tool)).not.toMatch(/minLength|maxLength|minimum|maximum|"type":\[/);
    }
  });
  it("tells Claude to restart the survey when asked, and gives the approved answers", () => {
    const prompt = buildAliraSystemPrompt({ patientName: "Zak", faq: [...starterSets.flat(), concernStarter] });
    expect(prompt).toContain("call restart_survey");
    expect(prompt).toContain(starterSets[1][1].a);
    expect(prompt).toContain(concernStarter.a);
    expect(prompt).not.toMatch(/\b(he|him|his)\b/);
  });
  it("registers every fixed line for read-aloud", () => {
    for (const [id, text] of Object.entries(aliraAgentCopy)) expect(aliraVoicePhrases[`agent-${id}`]).toBe(text);
  });
});

describe("the conversation sent to the server", () => {
  const user = (text: string): AgentMessage => ({ role: "user", content: [{ type: "text", text }] });
  it("accepts a well-formed conversation and rebuilds it from known fields", () => {
    const read = readAgentMessages([
      { role: "user", content: "Hello", extra: 1 },
      { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "t1", name: "restart_survey", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "Restarted." }] },
    ]);
    expect(read).toEqual({
      ok: true,
      messages: [
        user("Hello"),
        { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "t1", name: "restart_survey", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "Restarted." }] },
      ],
    });
  });
  it("refuses anything else", () => {
    const bad: unknown[] = [
      [],
      [{ role: "assistant", content: "Hi" }],
      [user("a"), user("b")],
      [user("a"), { role: "assistant", content: "b" }],
      [{ role: "user", content: [{ type: "image", source: {} }] }],
      [{ role: "user", content: [{ type: "tool_use", id: "x", name: "restart_survey", input: {} }] }],
      [user("a"), { role: "assistant", content: [{ type: "tool_use", id: "x", name: "delete_everything", input: {} }] }, user("b")],
      [user("x".repeat(5000))],
      Array.from({ length: 61 }, (_, i) => (i % 2 ? { role: "assistant", content: "b" } : user("a"))),
    ];
    for (const value of bad) expect(readAgentMessages(value).ok).toBe(false);
  });
  it("drops what a declined model wrote before a fallback took over", () => {
    expect(
      echoableContent([
        { type: "thinking", thinking: "", signature: "declined" },
        { type: "text", text: "Partial" },
        { type: "tool_use", id: "old", name: "restart_survey", input: {} },
        { type: "fallback", from: { model: "a" }, to: { model: "b" } },
        { type: "thinking", thinking: "", signature: "kept" },
        { type: "text", text: "Here we go.", citations: null },
        { type: "tool_use", id: "new", name: "continue_survey", input: {}, caller: { type: "direct" } },
        { type: "server_tool_use", id: "s", name: "web_search", input: {} },
      ])
    ).toEqual([
      { type: "text", text: "Partial" },
      { type: "thinking", thinking: "", signature: "kept" },
      { type: "text", text: "Here we go." },
      { type: "tool_use", id: "new", name: "continue_survey", input: {} },
    ]);
  });
  it("joins the patient's next message to trailing tool results", () => {
    const results: AgentMessage = { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] };
    expect(withUserBlocks([user("a"), { role: "assistant", content: [{ type: "text", text: "b" }] }, results], [{ type: "text", text: "c" }]).at(-1)).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }, { type: "text", text: "c" }],
    });
  });
});

describe("Alira's thinking loop", () => {
  const reply = (content: unknown[], stop_reason = "end_turn", status = 200) =>
    new Response(JSON.stringify(status === 200 ? { content, stop_reason } : content[0]), { status, headers: { "Content-Type": "application/json" } });
  const said: AgentBlock[] = [{ type: "text", text: "<page_state>...</page_state>" }, { type: "text", text: "restart the survey" }];

  it("runs Claude's tools on the page and sends the results back, keeping thinking unchanged", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "opaque-signature" };
    const request = vi
      .fn()
      .mockResolvedValueOnce(reply([thinking, { type: "tool_use", id: "t1", name: "restart_survey", input: {} }], "tool_use"))
      .mockResolvedValueOnce(reply([{ type: "text", text: "All cleared. Here's the first question." }]));
    const execute = vi.fn(() => ({ content: "Restarted." }));
    const turn = await runAgentTurn({ history: [], user: said, execute, request: request as unknown as typeof fetch });
    expect(execute).toHaveBeenCalledWith({ id: "t1", name: "restart_survey", input: {} });
    expect(turn.texts).toEqual(["All cleared. Here's the first question."]);
    expect(turn.history.map(m => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    const second = JSON.parse(request.mock.calls[1][1].body);
    expect(second.messages[1].content[0]).toEqual(thinking);
    expect(second.messages[2].content).toEqual([{ type: "tool_result", tool_use_id: "t1", content: "Restarted." }]);
    expect(request.mock.calls[0][0]).toBe("/api/alira/agent");
  });

  it("never runs a tool call that was cut off, and forgets a declined message", async () => {
    const execute = vi.fn(() => ({ content: "ok" }));
    const cut = await runAgentTurn({
      history: [],
      user: said,
      execute,
      request: (async () => reply([{ type: "tool_use", id: "t", name: "restart_survey", input: {} }], "max_tokens")) as unknown as typeof fetch,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(cut.history).toEqual([{ role: "user", content: said }]);
    const refused = await runAgentTurn({
      history: cut.history,
      user: said,
      execute,
      request: (async () => reply([], "refusal")) as unknown as typeof fetch,
    });
    expect(refused).toEqual({ history: [], texts: [], stopReason: "refusal" });
  });

  it("starts the conversation afresh once if the API cannot use it", async () => {
    const earlier: AgentMessage[] = [{ role: "user", content: [{ type: "text", text: "hi" }] }, { role: "assistant", content: [{ type: "text", text: "hello" }] }];
    const request = vi
      .fn()
      .mockResolvedValueOnce(reply([{ code: "AGENT_CONVERSATION_REJECTED", error: "afresh" }], "", 409))
      .mockResolvedValueOnce(reply([{ type: "text", text: "Done." }]));
    const turn = await runAgentTurn({ history: earlier, user: said, execute: () => ({ content: "" }), request: request as unknown as typeof fetch });
    expect(JSON.parse(request.mock.calls[1][1].body).messages).toEqual([{ role: "user", content: said }]);
    expect(turn.texts).toEqual(["Done."]);
  });

  it("stops after the step limit with every tool call answered", async () => {
    let n = 0;
    const request = vi.fn(async () => reply([{ type: "tool_use", id: `t${n++}`, name: "get_survey_answers", input: {} }], "tool_use"));
    const turn = await runAgentTurn({ history: [], user: said, execute: () => ({ content: "{}" }), request: request as unknown as typeof fetch, maxSteps: 3 });
    expect(request).toHaveBeenCalledTimes(3);
    expect(turn.stopReason).toBe("max_steps");
    expect(turn.history.at(-1)?.role).toBe("user");
    expect(readAgentMessages(withUserBlocks(turn.history, said)).ok).toBe(true);
  });

  it("passes errors on", async () => {
    await expect(
      runAgentTurn({ history: [], user: said, execute: () => ({ content: "" }), request: (async () => reply([{ code: "AGENT_BUSY", error: "busy" }], "", 429)) as unknown as typeof fetch })
    ).rejects.toMatchObject({ code: "AGENT_BUSY", status: 429 });
  });
});
