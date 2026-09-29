export const aliraTopics = [
  {
    id: "question",
    title: "Ask a question",
    detail: "About exercises, tiredness or recovery",
    prompt:
      "Of course, Zak. What would you like to ask about your exercises, tiredness, or recovery?",
    placeholder: "What would you like to ask?",
    response:
      "Thank you for telling me, Zak. We can take this at a comfortable pace.",
  },
  {
    id: "concern",
    title: "Raise a concern",
    detail: "Something doesn’t feel right",
    prompt:
      "I’m here, Zak. What’s been worrying you, or feeling different? Take your time and tell me what’s on your mind.",
    placeholder: "Tell Alira what’s worrying you…",
    response:
      "Thank you for telling me, Zak. We can take this at a comfortable pace.",
  },
  {
    id: "encouragement",
    title: "Lift me up",
    detail: "Words to keep you going",
    prompt:
      "We can take a moment together, Zak. What has felt difficult today, and where could you use a little encouragement?",
    placeholder: "What has felt difficult today?",
    response:
      "I’m here with you. There is no need to rush what you want to say.",
  },
  {
    id: "feelings",
    title: "Talk it through",
    detail: "Share how you’re feeling",
    prompt:
      "I’m here with you, Zak. How are you feeling, and what would you like to talk through? You can start anywhere.",
    placeholder: "Share whatever is on your mind…",
    response:
      "I’m here with you. There is no need to rush what you want to say.",
  },
] as const;

export type AliraTopic = (typeof aliraTopics)[number];
