// Alira's first conversation: twelve short questions asked one at a time inside the chat,
// then the movement check. The copy and question order come from the approved design canvas.

export type OnboardingOption = { v: string; l: string };
export type OnboardingAnswerValue = string | string[] | number | undefined;
export type OnboardingAnswers = Record<string, OnboardingAnswerValue>;
export type OnboardingQuestion = {
  k: string;
  s: string;
  t: string;
  type: "single" | "multi";
  o: OnboardingOption[];
  /** The option value that asks for a typed answer instead of a fixed label. */
  other?: string;
  /** Where the typed answer is stored. */
  otherKey?: string;
  optional?: boolean;
  when?: (answers: OnboardingAnswers) => boolean;
};

export const onboardingQuestions: OnboardingQuestion[] = [
  { k: "stroke_when", s: "Your stroke", t: "Roughly when did your stroke happen?", type: "single", o: [
    { v: "lt_1m", l: "Less than a month ago" }, { v: "1_3m", l: "1 to 3 months ago" }, { v: "3_6m", l: "3 to 6 months ago" }, { v: "gt_6m", l: "More than 6 months ago" } ] },
  { k: "side_affected", s: "Your stroke", t: "Which side of your body has been affected?", type: "single", o: [
    { v: "left", l: "Left side" }, { v: "right", l: "Right side" }, { v: "both", l: "Both sides" }, { v: "unsure", l: "I'm not sure" } ] },
  { k: "arm_hand_movement", s: "Moving", t: "Can you move your affected arm and hand on your own?", type: "single", o: [
    { v: "none", l: "Not at all" }, { v: "little_help", l: "A little, with help" }, { v: "tires", l: "Yes, but it tires quickly" }, { v: "fairly_well", l: "Yes, fairly well" } ] },
  { k: "get_around", s: "Moving", t: "How do you usually get around at home?", type: "single", o: [
    { v: "wheelchair", l: "In a wheelchair" }, { v: "frame_stick", l: "With a frame or stick" }, { v: "person", l: "Holding someone's arm" }, { v: "own", l: "On my own" } ] },
  { k: "falls", s: "Moving", t: "Have you had a fall in the last month?", type: "single", o: [
    { v: "no", l: "No" }, { v: "once", l: "Once" }, { v: "more", l: "More than once" } ] },
  { k: "stiffness", s: "Moving", t: "Does your affected arm or leg feel stiff or tight?", type: "single", o: [
    { v: "not_really", l: "Not really" }, { v: "sometimes", l: "Sometimes" }, { v: "most", l: "Most of the time" } ] },
  { k: "speech", s: "Speaking and feeling", t: "Do you have trouble finding words or speaking?", type: "single", o: [
    { v: "no", l: "No" }, { v: "sometimes", l: "Sometimes" }, { v: "often", l: "Often" } ] },
  { k: "swallowing", s: "Speaking and feeling", t: "Any trouble swallowing food or drink?", type: "single", o: [
    { v: "no", l: "No" }, { v: "sometimes", l: "Sometimes" }, { v: "special_diet", l: "Yes, I'm on a special diet" } ] },
  { k: "mood", s: "Speaking and feeling", t: "How has your mood been this week?", type: "single", o: [
    { v: "good", l: "Mostly good" }, { v: "up_down", l: "Up and down" }, { v: "low", l: "Low most days" } ] },
  { k: "help_at_home", s: "Home and goals", t: "Does anyone help you with everyday tasks?", type: "single", o: [
    { v: "own", l: "I manage on my own" }, { v: "family", l: "A family member helps" }, { v: "carer", l: "A carer helps" }, { v: "both", l: "Both" } ] },
  { k: "exercise_place", s: "Home and goals", t: "Where will you do most of your exercises?", type: "single", o: [
    { v: "chair", l: "Sitting in a chair" }, { v: "standing", l: "Standing with support" }, { v: "bed", l: "In bed" }, { v: "varies", l: "It varies" } ] },
  { k: "main_goal", s: "Home and goals", t: "What would you most like to get back to?", type: "single", other: "other", otherKey: "main_goal_other", o: [
    { v: "eating", l: "Eating and drinking without help" }, { v: "dressing", l: "Dressing myself" }, { v: "walking_house", l: "Walking around the house" }, { v: "going_out", l: "Going out and about" }, { v: "other", l: "Something else" } ] },
];

/** Answers that clear every other choice in a multi-select question. */
export const exclusiveAnswers = ["none", "not_sure", "unsure"];

/** A short word from Alira after certain questions, keyed by the question just answered. */
export const onboardingAcks: Record<string, string> = {
  get_around: "Four down, Zak. You're doing really well.",
  swallowing: "Two-thirds there. Nearly done.",
};

export const onboardingCopy = {
  intro1:
    "Hi Zak, I'm Alira. I'm here to help with your recovery. I'll ask how you're doing, suggest gentle movements that fit you, and keep track of how things change over time.",
  intro2:
    "Before we plan anything, I'd like to get to know you a little. It takes about 15 minutes, and we can pause whenever you like. Shall we start?",
  start: "Lovely. I'll ask one thing at a time, twelve short questions. Just tap the answer that fits best.",
  how: "Three short parts: a few questions about you, some gentle movements in front of your camera, and what you'd like to get back to. About 15 minutes all together, and you can pause any time.",
  notNow: "Of course. I'll be right here whenever you're ready. The card at the top will take you straight in.",
  done: "That's everything for this part, Zak. Thank you, that took real effort. Next, let's see how you move.",
  noted: "Thank you, I've noted that. Let's keep going.",
  keepInMind:
    "Thank you for telling me. I'll keep that in mind as we go. Shall we start with a few questions about you?",
  adminPrefix: "Test mode: I have answered all",
  welcomeHome:
    "Hi Zak, I'm Alira. Shall we start with a few simple questions about you? There are no wrong answers, and we can pause whenever you like.",
  placeholders: [
    "Type a message to Alira",
    "Ask me anything, for example: what happens in the assessment?",
    "Or just tell me how you're feeling today",
  ],
} as const;

export type Starter = { q: string; a: string };

/** Starter questions rotate in sets; "Raise a concern" stays pinned at the bottom of every set. */
export const starterSets: Starter[][] = [
  [
    { q: "What is Rehyn?", a: "Rehyn is a home recovery companion for people who've had a stroke. I set you gentle daily movements, notice how you're doing, and adjust the plan as you change." },
    { q: "How does the assessment work?", a: "Three short parts: a few questions about you, some gentle movements in front of your camera, and what you'd like to get back to. About 15 minutes, and you can pause any time." },
    { q: "Talk it through", a: "I'm listening. Tell me how things have been for you lately." },
  ],
  [
    { q: "Can I do this with my carer?", a: "Yes. A family member or carer can sit with you, help you get set up, and answer alongside you." },
    { q: "How long does it take?", a: "About 15 minutes the first time, and you can stop halfway. Everyday sessions are shorter, around 5 to 10 minutes." },
    { q: "Do I need to stand up?", a: "No. Everything can be done sitting down. If standing becomes part of your plan later, it will only be with support." },
  ],
  [
    { q: "Why do you need my camera?", a: "So I can see how you move, like how far your arm reaches and how steady you are, instead of guessing from your answers alone." },
    { q: "What if I get tired halfway?", a: "Then we stop. Your answers are saved, and I'll pick up where we left off whenever you come back." },
    { q: "What happens after the questions?", a: "I'll guide you through a short movement check with your camera, then build your first week of gentle movements from what I've learned." },
  ],
];

export const concernStarter: Starter = {
  q: "Raise a concern",
  a: "Tell me what's worrying you. If anything feels sudden or wrong, like a change in your face, an arm or your speech, please get help first and come back to me after.",
};

/** Indices of the questions that apply given the answers so far. */
export function applicableQuestions(answers: OnboardingAnswers = {}): number[] {
  const out: number[] = [];
  onboardingQuestions.forEach((q, i) => {
    if (!q.when || q.when(answers)) out.push(i);
  });
  return out;
}

export function answerLabel(q: OnboardingQuestion, value: OnboardingAnswerValue, otherText = ""): string {
  if (value === undefined || value === null) return "";
  const values = Array.isArray(value) ? value : [String(value)];
  return q.o
    .filter(o => values.includes(o.v))
    .map(o => (q.other && o.v === q.other && otherText ? otherText : o.l))
    .join(", ");
}

/** Test control: answer every unanswered question at random. Existing answers are kept. */
export function fillRandomAnswers(answers: OnboardingAnswers = {}, random = Math.random): OnboardingAnswers {
  const next: OnboardingAnswers = { ...answers };
  for (const q of onboardingQuestions) {
    if (next[q.k] !== undefined && next[q.k] !== null) continue;
    const options = q.o.filter(o => !(q.other && o.v === q.other));
    if (q.type === "multi") {
      const plain = options.filter(o => !exclusiveAnswers.includes(o.v));
      const count = Math.max(1, Math.floor(random() * Math.min(3, plain.length)) + 1);
      next[q.k] = plain
        .slice()
        .sort(() => random() - 0.5)
        .slice(0, count)
        .map(o => o.v);
    } else {
      next[q.k] = options[Math.floor(random() * options.length)].v;
    }
  }
  return next;
}

/** The side the movement check should measure. "Both" and "not sure" fall back to the runner's default. */
export function affectedSideFrom(answers: OnboardingAnswers = {}): "left" | "right" {
  return answers.side_affected === "left" ? "left" : "right";
}

export const ONBOARDING_STORAGE_KEY = "rehyn.onboarding.answers";
/** Set by the home page when the patient says yes there, so Alira goes straight to the questions. */
export const FROM_HOME_KEY = "rehyn.fromHome";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Answers are kept on this device so the conversation can pause and resume. */
export function loadOnboardingAnswers(): OnboardingAnswers {
  try {
    const raw = storage()?.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const known = new Set(onboardingQuestions.flatMap(q => [q.k, q.otherKey ?? ""]));
    const out: OnboardingAnswers = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!known.has(key)) continue;
      if (typeof value === "string" || typeof value === "number") out[key] = value;
      else if (Array.isArray(value) && value.every(item => typeof item === "string")) out[key] = value as string[];
    }
    return out;
  } catch {
    return {};
  }
}

export function saveOnboardingAnswers(answers: OnboardingAnswers): boolean {
  try {
    storage()?.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(answers));
    return true;
  } catch {
    return false;
  }
}

export function clearOnboardingAnswers(): void {
  try {
    storage()?.removeItem(ONBOARDING_STORAGE_KEY);
  } catch {
    /* Storage can be blocked; the conversation still works for this visit. */
  }
}

/** Fixed Alira copy that may be read aloud. Personal replies never enter the speech provider. */
export const onboardingVoicePhrases: Record<string, string> = Object.fromEntries([
  ...Object.entries(onboardingCopy)
    .filter(([, text]) => typeof text === "string")
    .map(([id, text]) => [`onboarding-${id}`, text as string]),
  ...onboardingCopy.placeholders.map((text, i) => [`onboarding-placeholder-${i}`, text]),
  ...onboardingQuestions.map(q => [`onboarding-q-${q.k}`, q.t]),
  ...Object.entries(onboardingAcks).map(([k, text]) => [`onboarding-ack-${k}`, text]),
  ...starterSets.flatMap((set, i) => set.map((st, j) => [`onboarding-starter-${i}-${j}`, st.a])),
  ["onboarding-starter-concern", concernStarter.a],
]);
