// The sentences Alira speaks during an exercise that are built from numbers. Each is kept to one
// short sentence with a fixed set of versions (rep 1 to 15, scores 0 to 100, levels 1 to 3), so
// every version can be recorded once in her voice instead of generated live each time.
// alira-spoken-lines.ts lists them all from the same builders.

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export const word = (n: number) => WORDS[n] ?? String(n);
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The most repetitions a session is planned with; versions up to this are recorded. */
export const MAX_SPOKEN_REPS = 15;

export const repCompleteLine = (rep: number) => `Repetition ${rep} complete.`;
export const repScoreLine = (score: number) => `Your score is ${score} out of 100.`;
export const repsAheadLine = (planned: number) => `Good. Now ${word(planned)} repetitions.`;
export const goodRepsLine = (good: number, planned: number) => `${cap(word(good))} of ${word(planned)} good reps.`;
export const bestLine = (label: string, degrees: number) => `Your best ${label} was ${Math.round(degrees)} degrees.`;
export const finishedLevelLine = (rung: number) => `You finished at level ${rung} of 3.`;

/** Advice after a repetition: "Move a little further through elbow bend on your next repetition." */
export const moveFurtherLine = (romLabel: string, finalRep: boolean) =>
  `Move a little further through ${romLabel.toLowerCase()}${finalRep ? "." : " on your next repetition."}`;
export const keepInViewLine = (finalRep: boolean) =>
  `Keep your face and both shoulders in view so I can check your posture${finalRep ? "." : " on the next repetition."}`;
export const reachedTargetsLine = (finalRep: boolean) =>
  finalRep ? "You reached the movement targets with a smooth movement." : "You reached the movement targets. Keep the same smooth movement on your next repetition.";
export const finalRepAdvice = (say: string) => say.replace("On the next repetition, try", "Try").replace(" on the next try", "");
export const ELBOW_ADVICE = "Straighten your elbow a little more as you reach toward the circle.";
export const SHOULDER_ADVICE = "Lift your arm a little more from your shoulder, keeping your chest upright.";
export const CLOSER_TARGET_LINE = "The next target will be a little closer.";
