// The levels ladder of a camera task (pure): which level each attempt is at, and when the task stops.
// Success goes up a level, failure down one; a change of direction stops (the best level is then known). A failure at
// the easiest level offers one try with help. Engineering defaults, to be reviewed by a clinician.

import type { StopReason } from "./types";

/** At most this many measured attempts per task (the try-out is not one). */
export const MAX_ATTEMPTS = 4;

export type LadderStep =
  | { type: "attempt"; level: number; assisted: boolean }
  | { type: "offer_help" }
  | { type: "done"; stoppedBy: StopReason };

export class Ladder {
  private outcomes: { level: number; success: boolean; assisted: boolean }[] = [];
  private level: number;
  private offered = false;
  private state: LadderStep;

  /** levels: how many (2 or 3); start: the level index to try first (clamped). */
  constructor(private readonly levels: number, start: number) {
    this.level = Math.max(0, Math.min(levels - 1, Math.round(start)));
    this.state = { type: "attempt", level: this.level, assisted: false };
  }

  /** What happens now: an attempt (at a level, maybe with help), the offer of help, or done. */
  get step(): LadderStep { return this.state; }
  get history() { return [...this.outcomes]; }

  /** The attempt the ladder asked for has ended: held (success) or not. */
  record(success: boolean): LadderStep {
    if (this.state.type !== "attempt") return this.state;
    const assisted = this.state.assisted;
    this.outcomes.push({ level: this.state.level, success, assisted });
    if (assisted) return (this.state = { type: "done", stoppedBy: "lowest_failed" });
    const before = this.outcomes.slice(0, -1).filter(outcome => !outcome.assisted);
    if (success ? before.some(outcome => !outcome.success) : before.some(outcome => outcome.success)) return (this.state = { type: "done", stoppedBy: "reversal" });
    if (success && this.state.level >= this.levels - 1) return (this.state = { type: "done", stoppedBy: "top_reached" });
    if (!success && this.state.level <= 0) {
      if (this.offered) return (this.state = { type: "done", stoppedBy: "lowest_failed" });
      this.offered = true;
      return (this.state = { type: "offer_help" });
    }
    if (this.outcomes.length >= MAX_ATTEMPTS) return (this.state = { type: "done", stoppedBy: "max_attempts" });
    this.level += success ? 1 : -1;
    return (this.state = { type: "attempt", level: this.level, assisted: false });
  }

  /** The patient's answer to the offer of help: one more try at the easiest level with help, or stop. */
  answerHelp(yes: boolean): LadderStep {
    if (this.state.type !== "offer_help") return this.state;
    return (this.state = yes ? { type: "attempt", level: 0, assisted: true } : { type: "done", stoppedBy: "help_declined" });
  }

  /** The best level held without help (−1 when none). */
  bestAlone(): number {
    return this.outcomes.filter(outcome => outcome.success && !outcome.assisted).reduce((best, outcome) => Math.max(best, outcome.level), -1);
  }
}
