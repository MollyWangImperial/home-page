import { describe, expect, it } from "vitest";
import type { AssessmentTaskId } from "./types";
import { demoLeadLine, yourTurnLine } from "./demo-lines";

const ALL: AssessmentTaskId[] = ["T1", "T3", "H4", "H3", "L6"];

describe("the demonstration's spoken hand-overs", () => {
  it("says before the first demonstration that every task starts with one (the narration names the task)", () => {
    expect(demoLeadLine(0)).toBe("Before each task, I'll show you a short demonstration. Just watch for now.");
  });

  it("keeps the later ones short, as the runner has just named the next task", () => {
    for (const index of [1, 2, 4]) expect(demoLeadLine(index)).toBe("First, a short demonstration. Just watch.");
  });

  it("says the task is next once the demonstration ends; walking has no circle", () => {
    for (const id of ALL) expect(yourTurnLine(id)).toMatch(/^Now it's your turn\. /);
    expect(yourTurnLine("T1")).toBe("Now it's your turn. Follow my voice and the circle.");
    expect(yourTurnLine("L6")).not.toContain("circle");
  });
});
