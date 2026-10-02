import { EXERCISES } from "./exercise-engine/config";
import { WARM_REP_LINES } from "./warm-rep-lines";
import {
  CLOSER_TARGET_LINE, ELBOW_ADVICE, finalRepAdvice, finishedLevelLine, goodRepsLine, keepInViewLine, MAX_SPOKEN_REPS,
  moveFurtherLine, reachedTargetsLine, repCompleteLine, repsAheadLine, repScoreLine, SHOULDER_ADVICE,
} from "./exercise-engine/spoken";

// Fixed lines Alira says outside her own page: the daily exercises, the warm-up repetition and the
// emergency FAST check. They join her registered phrases so `pnpm voice:bake` records them in her
// voice. Sentences built from numbers (rep counts, scores, levels) are listed in every version, so
// they are recorded too; only "your best reach was 58 degrees" is spoken live.

const sessionLines = [
  "The next repetition starts in three seconds.",
  "Now watch the demonstration on the right. I will show you how to do the movement. Just watch; nothing is scored.",
  "Now one practice repetition. It is not scored. Reach to the circle and hold while I learn your movement, then return to your lap.",
  "Now one practice repetition. It is not scored. Bring your hand to the mouth circle and hold while I learn your movement, then return to your lap.",
  "Now one practice repetition. It is not scored, and it helps me learn your starting position.",
  "Do you want to skip this one for today?",
  "Let's bring the target a little closer.",
  "On the next repetition, lift your arm a little more from your shoulder while keeping your chest upright.",
  "No problem, we will skip this one for today.",
  "Only redo this exercise if you have enough energy and do not feel fatigued. If you feel tired, rest for now.",
];

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const numberLines = [
  ...range(1, MAX_SPOKEN_REPS).flatMap(n => [repCompleteLine(n), repsAheadLine(n)]),
  ...range(0, 100).map(repScoreLine),
  ...range(1, MAX_SPOKEN_REPS).flatMap(planned => range(0, planned).map(good => goodRepsLine(good, planned))),
  ...range(1, 3).map(finishedLevelLine),
];
const adviceLines = [
  ELBOW_ADVICE,
  SHOULDER_ADVICE,
  CLOSER_TARGET_LINE,
  ...[true, false].flatMap(finalRep => [keepInViewLine(finalRep), reachedTargetsLine(finalRep)]),
  ...Object.values(EXERCISES).flatMap(exercise => [
    ...exercise.romSteps.flatMap(rom => [moveFurtherLine(rom.label, true), moveFurtherLine(rom.label, false)]),
    ...exercise.feedback.map(rule => finalRepAdvice(rule.say)),
  ]),
];

const linesOf = (exercise: (typeof EXERCISES)[string]) => [
  exercise.setupVoice,
  exercise.calibrationInstruction,
  ...exercise.cycle.flatMap(step => [step.voice, `${step.caption}.`]),
  ...exercise.feedback.map(rule => rule.say),
  exercise.praise,
];
const exerciseLines = Object.values(EXERCISES).flatMap(linesOf);

// Graded Forward Reach is the everyday exercise and already speaks in Alira's voice, so everything
// it can say is recorded with her lines: its own wording plus the shared session and number lines.
const reach = EXERCISES.ex_reach;
const reachLines = [
  ...linesOf(reach),
  ...sessionLines,
  ...numberLines,
  ELBOW_ADVICE,
  SHOULDER_ADVICE,
  CLOSER_TARGET_LINE,
  ...[true, false].flatMap(finalRep => [keepInViewLine(finalRep), reachedTargetsLine(finalRep)]),
  ...reach.romSteps.flatMap(rom => [moveFurtherLine(rom.label, true), moveFurtherLine(rom.label, false)]),
  ...reach.feedback.map(rule => finalRepAdvice(rule.say)),
];

// The FAST check's phrase is fixed in fast-check-runtime.js ("The sky is blue today").
const fastLines = [
  "Face. Please smile and hold while I compare both sides.",
  "Arms. Please raise both arms and keep them there while I watch for one arm drifting down.",
  "Speech. Please repeat: The sky is blue today.",
  "Please repeat: The sky is blue today.",
  "Demo only. The app is simulating a 999 call. No emergency call has been placed. In a real emergency, call 999 immediately.",
];

/** A short stable ID for a line, so a recorded clip keeps its name while the wording is unchanged. */
function lineId(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

const unique = (lines: string[]) => Array.from(new Set(lines.map(line => line.trim()).filter(Boolean)));
const reachSet = new Set(unique(reachLines));

export const aliraSpokenLines: Record<string, string> = Object.fromEntries([
  ...unique(fastLines).map(text => [`fast-${lineId(text)}`, text]),
  // The warm-up speaks in Alira's voice now, so its lines are recorded with hers, not with the exercises.
  ...unique(Object.values(WARM_REP_LINES)).map(text => [`warmup-${lineId(text)}`, text]),
  ...unique(reachLines).map(text => [`reach-${lineId(text)}`, text]),
  ...unique([...exerciseLines, ...adviceLines]).filter(text => !reachSet.has(text)).map(text => [`exercise-${lineId(text)}`, text]),
]);
