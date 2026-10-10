// The movement check's spoken hand-overs around each task's demonstration (DemoReel), so the patient knows what comes
// next: before the demonstration (the first task also says that every task starts this way), and as it ends, just
// before the task itself. A plain module (no CSS or app imports), so the voice tooling can read the lines too.

import type { AssessmentTaskId } from "./types";

/** Said before a task's demonstration (`index`: the task's place in the check); the narration then names the task. */
export function demoLeadLine(index: number): string {
  return index === 0 ? "Before each task, I'll show you a short demonstration. Just watch for now." : "First, a short demonstration. Just watch.";
}

/** Said as the demonstration ends, before its task starts (walking goes on to its own screen, with no circle). */
export const yourTurnLine = (taskId: AssessmentTaskId) =>
  taskId === "L6" ? "Now it's your turn. Follow the steps on the next screen." : "Now it's your turn. Follow my voice and the circle.";
