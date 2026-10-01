import { describe, expect, it } from "vitest";
import { EMPTY_TRANSCRIPT_POSITIONS, orderedTranscript, placeTranscriptCards } from "./alira-transcript";

const order = (messages: number[], positions: ReturnType<typeof placeTranscriptCards>, cards: string[]) =>
  orderedTranscript(messages, positions, cards).map(entry => `${entry.kind}:${entry.id}`);

describe("Alira cards in conversation order", () => {
  it.each(["exercise-rest", "plan-ready", "movement-check", "warm-up", "steps", "intro", "medal", "medal-next", "resume", "question-stroke_when-2", "plan-error-0"])("keeps %s before later patient messages and Alira replies", card => {
    const first = placeTranscriptCards(EMPTY_TRANSCRIPT_POSITIONS, [1, 2], [card]);
    const later = placeTranscriptCards(first, [1, 2, 3, 4, 5, 6], [card]);
    expect(order([1, 2, 3, 4, 5, 6], later, [card])).toEqual([
      "message:1", "message:2", `card:${card}`, "message:3", "message:4", "message:5", "message:6",
    ]);
  });

  it("inserts a new card after its own reply without moving earlier cards", () => {
    const first = placeTranscriptCards(EMPTY_TRANSCRIPT_POSITIONS, [1], ["movement-check"]);
    const next = placeTranscriptCards(first, [1, 2, 3], ["movement-check", "steps"]);
    expect(order([1, 2, 3, 4], next, ["movement-check", "steps"])).toEqual([
      "message:1", "card:movement-check", "message:2", "message:3", "card:steps", "message:4",
    ]);
  });

  it("resumes the same question at its original position after a side conversation", () => {
    const first = placeTranscriptCards(EMPTY_TRANSCRIPT_POSITIONS, [1, 2], ["question-a-2"]);
    const hidden = placeTranscriptCards(first, [1, 2, 3], []);
    expect(order([1, 2, 3], hidden, [])).toEqual(["message:1", "message:2", "message:3"]);
    const resumed = placeTranscriptCards(hidden, [1, 2, 3, 4], ["question-a-2"]);
    expect(order([1, 2, 3, 4], resumed, ["question-a-2"])).toEqual([
      "message:1", "message:2", "card:question-a-2", "message:3", "message:4",
    ]);
  });

  it("shows a newly asked question after its new message and removes answered options", () => {
    const first = placeTranscriptCards(EMPTY_TRANSCRIPT_POSITIONS, [1], ["question-a-1"]);
    const next = placeTranscriptCards(first, [1, 2, 3], ["question-b-3"]);
    const back = placeTranscriptCards(next, [1, 2, 3, 4, 5], ["question-a-5"]);
    expect(order([1, 2, 3, 4, 5], back, ["question-a-5"])).toEqual([
      "message:1", "message:2", "message:3", "message:4", "message:5", "card:question-a-5",
    ]);
  });

  it("retains the order of several cards shown together even if the current card list changes order", () => {
    const first = placeTranscriptCards(EMPTY_TRANSCRIPT_POSITIONS, [1], ["steps", "intro"]);
    const next = placeTranscriptCards(first, [1, 2], ["intro", "steps"]);
    expect(order([1, 2], next, ["intro", "steps"])).toEqual(["message:1", "card:steps", "card:intro", "message:2"]);
  });

  it("keeps a card shown before the first message before that message", () => {
    const first = placeTranscriptCards(EMPTY_TRANSCRIPT_POSITIONS, [], ["intro"]);
    const next = placeTranscriptCards(first, [1], ["intro"]);
    expect(order([1], next, ["intro"])).toEqual(["card:intro", "message:1"]);
  });

  it("clears anchors when the transcript is restarted, including reuse of the same card", () => {
    const first = placeTranscriptCards(EMPTY_TRANSCRIPT_POSITIONS, [1, 2], ["intro"]);
    const cleared = placeTranscriptCards(first, [], []);
    const replay = placeTranscriptCards(cleared, [5, 6], ["intro"]);
    expect(order([5, 6, 7], replay, ["intro"])).toEqual(["message:5", "message:6", "card:intro", "message:7"]);
  });

  it("handles an atomic replacement of the conversation", () => {
    const first = placeTranscriptCards(EMPTY_TRANSCRIPT_POSITIONS, [1, 2], ["plan-ready"]);
    const replacement = placeTranscriptCards(first, [5, 6], ["exercise-rest"]);
    expect(order([5, 6], replacement, ["exercise-rest"])).toEqual(["message:5", "message:6", "card:exercise-rest"]);
    expect(replacement.cards).toHaveLength(1);
  });

  it("does not change positions when card content or typing state changes", () => {
    const first = placeTranscriptCards(EMPTY_TRANSCRIPT_POSITIONS, [1], ["plan-ready"]);
    expect(placeTranscriptCards(first, [1], ["plan-ready"])).toBe(first);
  });
});
