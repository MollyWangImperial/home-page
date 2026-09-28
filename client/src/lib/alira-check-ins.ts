export type CheckInAnswer = {
  id: string;
  label: string;
  message: string;
  response: string;
  followUp: string;
};

export const checkInAnswers = {
  good: {
    id: "good",
    label: "Feeling good",
    message: "I’m feeling good today.",
    response:
      "That’s lovely to hear, Molly. What has made today feel good? I’d love to hear about it.",
    followUp: "You were feeling good at your last check-in. How are you today?",
  },
  tired: {
    id: "tired",
    label: "A little tired",
    message: "I’m feeling a little tired today.",
    response:
      "Thank you for telling me, Molly. Would you like to talk about what has felt tiring, or just have a quiet moment?",
    followUp:
      "You mentioned feeling a little tired last time. How are you feeling now?",
  },
  talk: {
    id: "talk",
    label: "Let’s talk",
    message: "I’d like to talk about how I’m feeling.",
    response:
      "Of course, Molly. What’s been on your mind? You can start wherever feels comfortable.",
    followUp: "Would you like to pick up our conversation, Molly?",
  },
  steady: {
    id: "steady",
    label: "Fairly steady",
    message: "My energy feels fairly steady today.",
    response:
      "Thank you for checking in, Molly. What would you like to make space for today?",
    followUp:
      "Your energy felt steady at your last check-in. How does today feel?",
  },
  unsure: {
    id: "unsure",
    label: "Not sure yet",
    message: "I’m not sure how my energy feels yet.",
    response:
      "That’s okay, Molly. You don’t have to find the right words straight away. Is there anything you’d like to talk about?",
    followUp:
      "How are you feeling today, Molly? There’s no need to have it all figured out.",
  },
  practiced: {
    id: "practiced",
    label: "I practised",
    message: "A small win for me: I practised today.",
    response:
      "You made time to practise, Molly. That’s a moment worth recognising. What felt good about it?",
    followUp:
      "You shared a win about practising last time. What are you proud of today?",
  },
  tried: {
    id: "tried",
    label: "I tried again",
    message: "My small win is that I tried again.",
    response:
      "Trying again took something, Molly. I’m glad you shared that. What helped you give it another go?",
    followUp:
      "Last time, your small win was trying again. What would you like to celebrate today?",
  },
  company: {
    id: "company",
    label: "Some company",
    message: "I’d like a little company.",
    response:
      "We can have a gentle chat, Molly. What’s one thing you noticed today — something you saw, heard, or enjoyed?",
    followUp: "Would a little company feel good today, Molly?",
  },
} satisfies Record<string, CheckInAnswer>;

export const checkInQuestions = [
  {
    id: "feeling",
    text: "How are you feeling today, Molly?",
    answers: [checkInAnswers.good, checkInAnswers.tired, checkInAnswers.talk],
  },
  {
    id: "energy",
    text: "How is your energy feeling today?",
    answers: [
      checkInAnswers.steady,
      checkInAnswers.tired,
      checkInAnswers.unsure,
    ],
  },
  {
    id: "win",
    text: "What’s one small win you’re proud of?",
    answers: [
      checkInAnswers.practiced,
      checkInAnswers.tried,
      checkInAnswers.talk,
    ],
  },
  {
    id: "conversation",
    text: "Is there anything you’d like to talk through?",
    answers: [
      checkInAnswers.talk,
      checkInAnswers.company,
      checkInAnswers.unsure,
    ],
  },
];

export const CHECK_IN_STORAGE_KEY = "rehyn.alira.last-check-in.v1";
export type RememberedCheckIn = {
  answerId: keyof typeof checkInAnswers;
  recordedAt: number;
};

export function parseRememberedCheckIn(
  raw: string | null,
  now = Date.now()
): RememberedCheckIn | null {
  try {
    const value = JSON.parse(raw ?? "null");
    if (
      !value ||
      !Object.hasOwn(checkInAnswers, value.answerId) ||
      typeof value.recordedAt !== "number" ||
      !Number.isFinite(value.recordedAt) ||
      value.recordedAt > now ||
      now - value.recordedAt > 30 * 24 * 60 * 60 * 1000
    )
      return null;
    return { answerId: value.answerId, recordedAt: value.recordedAt };
  } catch {
    return null;
  }
}

export function loadRememberedCheckIn(): RememberedCheckIn | null {
  try {
    return parseRememberedCheckIn(localStorage.getItem(CHECK_IN_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function rememberCheckIn(
  answer: CheckInAnswer
): RememberedCheckIn | null {
  const memory = { answerId: answer.id, recordedAt: Date.now() };
  try {
    localStorage.setItem(CHECK_IN_STORAGE_KEY, JSON.stringify(memory));
    return parseRememberedCheckIn(JSON.stringify(memory));
  } catch {
    return null;
  }
}

export function forgetCheckIn() {
  try {
    localStorage.removeItem(CHECK_IN_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
