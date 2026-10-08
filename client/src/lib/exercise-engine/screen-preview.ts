import { EXERCISES, REPS_BY_RUNG, type Rung, type Side } from "./config";
import type { RepResult, Snapshot } from "./session";
import { NEXT_REP_COUNTDOWN_LINE } from "./spoken";

export const EXERCISE_PREVIEW_SCREENS = [
  { id: "intro", label: "Exercise introduction" },
  { id: "loading", label: "Opening camera screen" },
  { id: "setup", label: "1 · Set up" },
  { id: "demo-reach", label: "2 · Demonstration — reach" },
  { id: "demo-return", label: "2 · Demonstration — return to lap" },
  { id: "warm-waiting", label: "3 · Learn movement — listen first" },
  { id: "warm-reach", label: "3 · Learn movement — hold target" },
  { id: "warm-return", label: "3 · Learn movement — return to lap" },
  { id: "reps-reach", label: "4 · Scored repetition — hold target" },
  { id: "reps-return", label: "4 · Scored repetition — return to lap" },
  { id: "complete", label: "Repetition score and feedback" },
  { id: "countdown", label: "Next repetition countdown" },
  { id: "final-complete", label: "Final repetition score and feedback" },
  { id: "rescue", label: "5 · Easier target" },
  { id: "idle", label: "Pause / skip prompt" },
  { id: "results", label: "6 · Exercise summary" },
  { id: "redo", label: "Re-do exercise reminder" },
  { id: "error", label: "Camera error screen" },
] as const;

export type ExercisePreviewScreen = typeof EXERCISE_PREVIEW_SCREENS[number]["id"];

export function exercisePreviewScreen(value: string | null): ExercisePreviewScreen | null {
  return EXERCISE_PREVIEW_SCREENS.some(screen => screen.id === value) ? value as ExercisePreviewScreen : null;
}

/** Display fixtures only: no session, camera, voice, storage or recorder is started. */
export function exerciseScreenPreview(screen: ExercisePreviewScreen, rung: Rung, side: Side, exerciseId = "ex_reach") {
  const cfg = EXERCISES[exerciseId];
  const planned = REPS_BY_RUNG[rung];
  const hand = cfg.id === "ex_handopen";
  const targets: Record<string, number> = cfg.id === "ex_h2m" ? { elbow_flexion: 85, shoulder_flexion: 40 } : hand ? { finger_extension: 165 } : { shoulder_flexion: 40, elbow_extension: 129 };
  const startingAngles: Record<string, number> = cfg.id === "ex_h2m" ? { elbow_flexion: 25, shoulder_flexion: 8 } : hand ? { finger_extension: 120 } : { shoulder_flexion: 8, elbow_extension: 100 };
  const lean = cfg.compensations[0].id;
  const reps: RepResult[] = Array.from({ length: planned }, (_, index) => {
    const compensations = index === 1 ? [lean] : index === 2 ? [lean, "shoulder_hike"] : [];
    return { index: index + 1, rung, attainment: 1, hold: "full", compensations, score: compensations.length === 2 ? 15 : compensations.length === 1 ? 30 : 100, good: !compensations.length, peaks: { ...targets }, startingAngles: { ...startingAngles }, targets: { ...targets }, unmeasured: [] };
  });
  const phase = screen === "setup" ? "setup" : screen.startsWith("demo") ? "demo" : screen.startsWith("warm") ? "warm" : screen === "results" || screen === "redo" ? "done" : "reps";
  const returning = screen.endsWith("return");
  const waiting = screen.endsWith("waiting");
  const complete = screen === "complete" || screen === "final-complete";
  const final = screen === "final-complete" || phase === "done";
  const scored = phase === "reps" || phase === "done";
  const advice = [cfg.feedback.find(rule => rule.comp === lean)!.say, cfg.feedback.find(rule => rule.comp === "shoulder_hike")!.say];
  const snapshot: Snapshot = {
    phase, beat: phase === "setup" ? 1 : phase === "demo" ? 2 : phase === "warm" ? 3 : phase === "done" ? 6 : 4,
    rung, rungStart: rung, repIndex: phase === "warm" ? 0 : final ? planned : 2, repsPlanned: planned,
    stepIndex: returning ? 1 : 0, stepCount: 2, caption: cfg.cycle[returning ? 1 : 0].caption, kind: returning ? "return" : hand ? "open" : "reach",
    liveAttainment: 0.78, inZone: !waiting, targetArmed: !waiting && phase !== "setup", holdProgress: waiting ? 0 : 0.48,
    prompt: screen === "setup" ? hand ? `Hold your ${side} hand up beside your shoulder with your palm facing the camera.` : `Bring your ${side} hand into view and rest it on your lap.` : "",
    idlePrompt: screen === "idle", rescued: screen === "rescue", arrow: screen === "rescue" ? lean : null,
    feedback: screen === "rescue" ? "Let's bring the target a little closer." : "",
    reps: final ? reps : complete || screen === "countdown" ? reps.slice(0, 3) : scored ? [reps[0]] : [],
    demoProgress: returning ? 0.75 : 0.35, demoReady: phase === "demo", demoStepIndex: returning ? 1 : 0, demoStepElapsedMs: 1350,
    calibrationProgress: 0.55, targetsReady: scored, startingAngles,
    record: phase === "done" ? {
      engine: "screen-preview", exercise_id: cfg.id, rung_start: rung, rung_end: rung, reps_planned: planned,
      repetition_scores: reps.map(rep => rep.score), quality_reps: reps.filter(rep => rep.good).length, best_attainment: 1, best_value: cfg.id === "ex_h2m" ? 85 : hand ? 165 : 40, best_label: cfg.id === "ex_h2m" ? "elbow bend" : hand ? "finger opening" : "reach",
      compensation_counts: { [lean]: 2, shoulder_hike: 1 }, hold_pass_count: planned, not_attempted: false, assisted: false, chair_back: false,
      score: Math.round(reps.reduce((sum, rep) => sum + rep.score, 0) / planned), wrap: "", finished_at: "screen-preview",
    } : null,
    paused: false, review: complete ? "complete" : screen === "countdown" ? "countdown" : null,
    reviewAdvice: final ? ["You reached the movement targets. Keep that smooth, steady movement."] : advice,
    countdownProgress: 0.5,
  };
  const bodyChecks = (hand ? [
    { id: "nose", label: "Face" },
    { id: "shoulder", label: `${side === "right" ? "Right" : "Left"} shoulder` },
    { id: "shoulderOther", label: "Other shoulder" },
    { id: "wrist", label: `${side === "right" ? "Right" : "Left"} hand, palm to camera` },
  ] : [
    { id: "nose", label: "Face" },
    { id: "shoulder", label: `${side === "right" ? "Right" : "Left"} shoulder` },
    { id: "shoulderOther", label: "Other shoulder" },
    { id: "elbow", label: `${side === "right" ? "Right" : "Left"} elbow` },
    { id: "wrist", label: `${side === "right" ? "Right" : "Left"} hand` },
    { id: "hip", label: "Top of thigh" },
  ]).map(check => ({ ...check, visible: check.id !== "wrist", progress: check.id === "wrist" ? 0.2 : 1, hint: hand ? `Hold your ${side} hand up beside your shoulder with your palm facing the camera.` : `Bring your ${side} hand into view.` }));
  return {
    snapshot,
    // Scored repetitions are not instructed again: only their countdown speaks.
    said: phase === "setup" ? cfg.calibrationInstruction : phase === "demo" ? `${snapshot.caption}.` : screen === "countdown" ? NEXT_REP_COUNTDOWN_LINE : scored ? "" : returning ? cfg.cycle[1].voice : cfg.cycle[0].voice,
    bodyChecks,
    live: {
      roms: cfg.romSteps.map(rom => ({ label: rom.label, value: returning ? startingAngles[rom.id as keyof typeof targets] : targets[rom.id as keyof typeof targets], target: targets[rom.id as keyof typeof targets], start: startingAngles[rom.id as keyof typeof targets], unit: "°" })),
      comps: cfg.compensations.map(comp => ({ label: comp.label, value: screen === "rescue" && comp.id === lean ? 1.25 : 0.25, limit: 1 })),
    },
  };
}
