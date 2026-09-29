// Fixed preview copy is shared with the server's speech allowlist.
export const guidedAliraPhrases = {
  welcome:
    "Hi Zak, I'm Alira. I'm here to help with your recovery. I'll ask how you're doing, suggest gentle movements that fit you, and keep track of how things change over time.",
  invitation:
    "Before we plan anything, I'd like to get to know you a little. It takes about 15 minutes, and we can pause whenever you like. Shall we start?",
  about:
    "Rehyn is your recovery companion. Alira helps you understand your next steps, talk about how you're feeling, and make space for your goals. Your first assessment helps establish your starting point.",
  assessment:
    "There are three parts: a few questions about you, a camera-guided look at how you move, and your own recovery goals. Allow about 15 minutes. You can pause at any point. Select Start with Alira when you're ready.",
  concern:
    "I'm here, Zak. What's been worrying you, or feeling different? If something feels sudden or wrong, get help first. You can use See the warning signs below.",
  feelings:
    "I'm here with you, Zak. How are you feeling, and what would you like to talk through? You can start anywhere.",
  pause:
    "Of course. There's no rush. We can just talk for now. When you're ready, choose Start with Alira to begin.",
  reply:
    "Thank you for telling me, Zak. We can take this at a comfortable pace.",
} as const;

export const guidedAliraTopics = [
  {
    id: "about",
    title: "What is Rehyn?",
    detail: "What to expect, and how Alira helps",
    response: guidedAliraPhrases.about,
  },
  {
    id: "assessment",
    title: "How does the assessment work?",
    detail: "What I'll ask, and how the camera is used",
    response: guidedAliraPhrases.assessment,
  },
  {
    id: "concern",
    title: "Raise a concern",
    detail: "Something doesn't feel right",
    response: guidedAliraPhrases.concern,
  },
  {
    id: "feelings",
    title: "Talk it through",
    detail: "Share how you're feeling",
    response: guidedAliraPhrases.feelings,
  },
] as const;
