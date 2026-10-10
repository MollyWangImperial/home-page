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
/** The practice after the demonstration, which has already shown the movement. */
export const PRACTICE_LINE = "Your turn. One practice repetition, not scored.";
export const PRACTISE_AGAIN_LINE = "Let's practise once more.";
export const goodRepsLine = (good: number, planned: number) => `${cap(word(good))} of ${word(planned)} good reps.`;
/** units: how the measure is read out (degrees unless calibration.ts metricUnitName says otherwise, as for the pinch). */
export const bestLine = (label: string, degrees: number, units = "degrees") => `Your best ${label} was ${Math.round(degrees)} ${units}.`;
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
/** Seated Knee Extension's version: the whole seated body, head to feet, carries its posture checks. */
export const bodyInViewLine = (finalRep: boolean) =>
  `Keep your whole body, from your head to your feet, in view so I can check your posture${finalRep ? "." : " on the next repetition."}`;
/** Supported Arm Elevation's version when only its hand checks were missed (the body was in view). */
export const slideHandsInViewLine = (finalRep: boolean) =>
  `Keep both hands in view, one resting beside you and the other on your thigh or armrest, so I can check them${finalRep ? "." : " on the next repetition."}`;
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
  ex_ankle_dorsiflexion: {
    toe_lift: { review: "Lift your toes a little higher, keeping your heel down.", next: "On the next repetition, lift your toes a little higher, keeping your heel down." },
  },
  ex_lower_selective: {
    knee_extension: { review: "Straighten your knee a little more, as far as is comfortable.", next: "On the next repetition, straighten your knee a little more, as far as is comfortable." },
  },
  ex_wallslide: {
    shoulder_flexion: { review: "Move your arm a little further out from your shoulder, keeping your body upright.", next: "On the next repetition, move your arm a little further out from your shoulder, keeping your body upright." },
    slide_out: { review: "Move your hand a little further out toward the cup.", next: "On the next repetition, move your hand a little further out toward the cup." },
  },
  ex_pinch: {
    pinch_index: { review: "Bring your thumb a little closer to your first fingertip, tip to tip.", next: "On the next repetition, bring your thumb a little closer to your first fingertip, tip to tip." },
    pinch_middle: { review: "Bring your thumb a little closer to your middle fingertip, tip to tip.", next: "On the next repetition, bring your thumb a little closer to your middle fingertip, tip to tip." },
  },
};
