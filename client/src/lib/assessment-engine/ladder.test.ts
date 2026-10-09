import { describe, expect, it } from "vitest";
import { Ladder, MAX_ATTEMPTS } from "./ladder";

describe("the levels ladder", () => {
  it("starts at the requested level, clamped and rounded", () => {
    expect(new Ladder(3, 2).step).toEqual({ type: "attempt", level: 2, assisted: false });
    expect(new Ladder(3, 7).step).toEqual({ type: "attempt", level: 2, assisted: false });
    expect(new Ladder(3, -1).step).toEqual({ type: "attempt", level: 0, assisted: false });
    expect(new Ladder(2, 0.6).step).toEqual({ type: "attempt", level: 1, assisted: false });
  });

  it("stops at the top when the top level is held from the start", () => {
    const ladder = new Ladder(3, 2);
    expect(ladder.record(true)).toEqual({ type: "done", stoppedBy: "top_reached" });
    expect(ladder.bestAlone()).toBe(2);
    expect(ladder.history).toEqual([{ level: 2, success: true, assisted: false }]);
  });

  it("climbs one level per success up to the top", () => {
    const ladder = new Ladder(3, 0);
    expect(ladder.record(true)).toEqual({ type: "attempt", level: 1, assisted: false });
    expect(ladder.record(true)).toEqual({ type: "attempt", level: 2, assisted: false });
    expect(ladder.record(true)).toEqual({ type: "done", stoppedBy: "top_reached" });
    expect(ladder.bestAlone()).toBe(2);
  });

  it("a failure at the top then a success one level down is a reversal", () => {
    const ladder = new Ladder(3, 2);
    expect(ladder.record(false)).toEqual({ type: "attempt", level: 1, assisted: false });
    expect(ladder.record(true)).toEqual({ type: "done", stoppedBy: "reversal" });
    expect(ladder.bestAlone()).toBe(1);
  });

  it("a climb then a failure is a reversal and keeps the level held", () => {
    const ladder = new Ladder(3, 0);
    ladder.record(true);
    expect(ladder.record(false)).toEqual({ type: "done", stoppedBy: "reversal" });
    expect(ladder.bestAlone()).toBe(0);
    expect(ladder.history.map(outcome => outcome.level)).toEqual([0, 1]);
  });

  it("a failure from the middle then a success at the lowest is a reversal", () => {
    const ladder = new Ladder(3, 1);
    expect(ladder.record(false)).toEqual({ type: "attempt", level: 0, assisted: false });
    expect(ladder.record(true)).toEqual({ type: "done", stoppedBy: "reversal" });
    expect(ladder.bestAlone()).toBe(0);
  });

  it("offers help once after the lowest level fails, then one assisted attempt ends the task", () => {
    const ladder = new Ladder(3, 2);
    ladder.record(false);
    ladder.record(false);
    expect(ladder.record(false)).toEqual({ type: "offer_help" });
    expect(ladder.step).toEqual({ type: "offer_help" });
    // Recording while help is offered changes nothing.
    expect(ladder.record(true)).toEqual({ type: "offer_help" });
    expect(ladder.answerHelp(true)).toEqual({ type: "attempt", level: 0, assisted: true });
    expect(ladder.record(true)).toEqual({ type: "done", stoppedBy: "lowest_failed" });
    expect(ladder.history[ladder.history.length - 1]).toEqual({ level: 0, success: true, assisted: true });
    // Held with help is not held alone.
    expect(ladder.bestAlone()).toBe(-1);
  });

  it("ends after the assisted attempt whether or not it is held", () => {
    const ladder = new Ladder(2, 0);
    expect(ladder.record(false)).toEqual({ type: "offer_help" });
    ladder.answerHelp(true);
    expect(ladder.record(false)).toEqual({ type: "done", stoppedBy: "lowest_failed" });
  });

  it("stops as help_declined when the patient says no to help", () => {
    const ladder = new Ladder(2, 0);
    ladder.record(false);
    expect(ladder.answerHelp(false)).toEqual({ type: "done", stoppedBy: "help_declined" });
    // Nothing more happens once done.
    expect(ladder.record(true)).toEqual({ type: "done", stoppedBy: "help_declined" });
    expect(ladder.answerHelp(true)).toEqual({ type: "done", stoppedBy: "help_declined" });
    expect(ladder.bestAlone()).toBe(-1);
  });

  it("ignores an answer to help that was never offered", () => {
    const ladder = new Ladder(3, 1);
    expect(ladder.answerHelp(true)).toEqual({ type: "attempt", level: 1, assisted: false });
  });

  it(`stops after ${MAX_ATTEMPTS} measured attempts`, () => {
    // Four successes up a five-level ladder never reach the top or reverse.
    const ladder = new Ladder(5, 0);
    for (let attempt = 0; attempt < MAX_ATTEMPTS - 1; attempt++) expect(ladder.record(true).type).toBe("attempt");
    expect(ladder.record(true)).toEqual({ type: "done", stoppedBy: "max_attempts" });
    expect(ladder.history).toHaveLength(MAX_ATTEMPTS);
    expect(ladder.bestAlone()).toBe(3);
  });

  it("a one-level ladder stops at the top or offers help", () => {
    expect(new Ladder(1, 0).record(true)).toEqual({ type: "done", stoppedBy: "top_reached" });
    expect(new Ladder(1, 0).record(false)).toEqual({ type: "offer_help" });
  });

  it("history is a copy", () => {
    const ladder = new Ladder(3, 0);
    ladder.record(true);
    ladder.history.push({ level: 9, success: true, assisted: false });
    expect(ladder.history).toHaveLength(1);
  });
});
