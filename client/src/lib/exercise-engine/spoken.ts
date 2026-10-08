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
/** Said as each scored repetition's 3-2-1 countdown starts (recorded once in Alira's voice). */
export const NEXT_REP_COUNTDOWN_LINE = "The next repetition starts in three seconds.";
export const goodRepsLine = (good: number, planned: number) => `${cap(word(good))} of ${word(planned)} good reps.`;
export const bestLine = (label: string, degrees: number) => `Your best ${label} was ${Math.round(degrees)} degrees.`;
export const finishedLevelLine = (rung: number) => `You finished at level ${rung} of 3.`;

/** Advice after a repetition: "Move a little further through elbow bend on your next repetition." */
export const moveFurtherLine = (romLabel: string, finalRep: boolean) =>
  `Move a little further through ${romLabel.toLowerCase()}${finalRep ? "." : " on your next repetition."}`;
export const keepInViewLine = (finalRep: boolean) =>
  `Keep your face and both shoulders in view so I can check your posture${finalRep ? "." : " on the next repetition."}`;
/** Hand opening's version: the hand in the shaded area leaves the face and both shoulders in view. */
export const handInViewLine = (finalRep: boolean) =>
  `Keep your hand in the shaded area, clear of your face and shoulders, so I can check your posture${finalRep ? "." : " on the next repetition."}`;
/** The grasp's version when only the hand's own checks were missed (the body was in view). */
export const graspHandInViewLine = (finalRep: boolean) =>
  `Keep your hand in view while you hold and carry the cup so I can check it${finalRep ? "." : " on the next repetition."}`;
export const reachedTargetsLine = (finalRep: boolean) =>
  finalRep ? "You reached the movement targets with a smooth movement." : "You reached the movement targets. Keep the same smooth movement on your next repetition.";
export const finalRepAdvice = (say: string) => say.replace("On the next repetition, try", "Try").replace(" on the next try", "");
export const ELBOW_ADVICE = "Straighten your elbow a little more as you reach toward the circle.";
export const SHOULDER_ADVICE = "Lift your arm a little more from your shoulder, keeping your chest upright.";
/** Hand-to-mouth's versions of the two angle hints: elbow bend and shoulder lift toward the mouth circle. */
export const MOUTH_ELBOW_ADVICE = "Bend your elbow a little more to bring the cup all the way to your mouth.";
export const MOUTH_SHOULDER_ADVICE = "Lift your elbow a little more from your shoulder, keeping your head up.";
export const CLOSER_TARGET_LINE = "The next target will be a little closer.";

/** Per-angle hints spoken after a repetition, worded for each seated movement. */
export const ANGLE_ADVICE: Record<string, Record<string, { review: string; next: string }>> = {
  ex_reach: {
    elbow_extension: { review: ELBOW_ADVICE, next: "On the next repetition, straighten your elbow a little more as you reach toward the circle." },
    shoulder_flexion: { review: SHOULDER_ADVICE, next: "On the next repetition, lift your arm a little more from your shoulder while keeping your chest upright." },
  },
  ex_h2m: {
    elbow_flexion: { review: MOUTH_ELBOW_ADVICE, next: "On the next repetition, bend your elbow a little more to bring the cup all the way to your mouth." },
    shoulder_flexion: { review: MOUTH_SHOULDER_ADVICE, next: "On the next repetition, lift your elbow a little more from your shoulder while keeping your head up." },
  },
  ex_handopen: {
    finger_extension: { review: "Open your fingers a little wider, out to the ring.", next: "On the next repetition, open your fingers a little wider, out to the ring." },
  },
  ex_grasp: {
    elbow_extension: { review: "Straighten your elbow a little more as you reach for the cup.", next: "On the next repetition, straighten your elbow a little more as you reach for the cup." },
    shoulder_flexion: { review: "Lift your arm a little more from your shoulder as you reach for the cup.", next: "On the next repetition, lift your arm a little more from your shoulder as you reach for the cup." },
    finger_extension: { review: "Open your hand a little wider as you reach for the cup.", next: "On the next repetition, open your hand a little wider as you reach for the cup." },
    carry_across: { review: "Carry the cup a little further across your body.", next: "On the next repetition, carry the cup a little further across your body." },
  },
};
