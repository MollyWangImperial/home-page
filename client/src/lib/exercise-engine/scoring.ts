// Clean rep = 100 x attainment x hold.
// Confirmed compensations give a fixed repetition score: one = 30, two or more = 15.
// Pure functions only, so the formula can be mirrored in Python (backend/exercise_scoring.py) later.
// The optional trailing parameters carry a session's tuning from Alira's learning (bounded in
// shared/alira-adaptation.ts); left out, every function uses the defaults below.

export const EXERCISE_SCORE_VERSION = "rehyn-exercise-score-6";

/** engineering default, needs clinician review */
export const SCORING = {
  /** Live attainment at or above this counts as "touched the target" (and below it as a miss for the rescue rule). */
  targetZone: 0.7,
  goodRepAttainment: 0.9,
  holdTouchedNotHeld: 0.8,
  oneCompensationScore: 30,
  multipleCompensationsScore: 15,
  assistedFactor: 0.5,
} as const;

export type RomTarget = { id: string; weight: number; target: number; start?: number };

/** Progress away from a learned starting angle. Missing/invalid ranges earn no credit. */
export function romAttainment(value: number | undefined, target: number, start = 0): number {
  const range = target - start;
  return value === undefined || !Number.isFinite(value) || !Number.isFinite(range) || range <= 0
    ? 0 : Math.min(1, Math.max(0, (value - start) / range));
}

/** Weighted mean of each metric's progress; a supplied starting angle earns no movement credit. */
export function attainment(roms: RomTarget[], achieved: Record<string, number | undefined>): number {
  const totalWeight = roms.reduce((sum, rom) => sum + rom.weight, 0);
  if (!totalWeight) return 0;
  const sum = roms.reduce((acc, rom) => {
    const value = achieved[rom.id];
    const part = romAttainment(value, rom.target, rom.start);
    return acc + rom.weight * part;
  }, 0);
  return sum / totalWeight;
}

export type HoldOutcome = "full" | "touched" | "none";

/** 1 if held for the full hold, 0.8 if touched but not held, 0 if never reached. */
export function holdFactor(outcome: HoldOutcome): number {
  return outcome === "full" ? 1 : outcome === "touched" ? SCORING.holdTouchedNotHeld : 0;
}

/**
 * Each confirmed compensation type counts once. Compensation scores are fixed points, not multipliers.
 * One compensation scores `oneCompensationScore` (30 unless tuned); two or more always score 15.
 */
export function repScore(att: number, outcome: HoldOutcome, compensations: number, oneCompensationScore: number = SCORING.oneCompensationScore): number {
  if (compensations >= 2) return SCORING.multipleCompensationsScore;
  if (compensations === 1) return oneCompensationScore;
  return Math.round(100 * att * holdFactor(outcome));
}

/** A good rep: attainment at least `goodShare` (0.9 unless tuned), full hold, no compensation. Feeds quality_reps. */
export function isGoodRep(att: number, outcome: HoldOutcome, compensations: number, goodShare: number = SCORING.goodRepAttainment): boolean {
  return att >= goodShare && outcome === "full" && compensations === 0;
}

/** A rep that misses the target: attainment below `zone` (0.7 unless tuned). Two in a row trigger the rescue rule. */
export function isMiss(att: number, zone: number = SCORING.targetZone): boolean {
  return att < zone;
}

/**
 * Session score: mean over the planned reps (warm rep excluded). Reps not attempted score 0, so stopping
 * early lowers the score honestly. Assisted sessions are multiplied by 0.5. null when nothing was attempted.
 */
export function sessionScore(scoredReps: number[], plannedReps: number, assisted = false): number | null {
  if (!scoredReps.length || plannedReps <= 0) return null;
  const total = scoredReps.reduce((sum, score) => sum + score, 0);
  const mean = total / Math.max(plannedReps, scoredReps.length);
  return Math.round(mean * (assisted ? SCORING.assistedFactor : 1));
}
