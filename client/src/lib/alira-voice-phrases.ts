import voiceClips from "./alira-voice-clips.json";
import { aliraTopics } from "./alira-topics";
import { guidedAliraPhrases } from "./alira-guided-start";
import { onboardingVoicePhrases } from "./alira-onboarding";
import { PATIENT_NAME } from "./home-stage";

// Both the browser and server use the same allowlist. User replies are never TTS input.
export const aliraVoicePhrases: Record<string, string> = Object.fromEntries([
  ...Object.entries(voiceClips).map(([text, clip]) => [
    clip
      .split("/")
      .pop()!
      .replace(/\.wav$/, ""),
    text.replaceAll("Molly", PATIENT_NAME),
  ]),
  ...aliraTopics.map(topic => [`topic-${topic.id}`, topic.prompt]),
  ...Object.entries(guidedAliraPhrases).map(([id, text]) => [
    `guided-${id}`,
    text,
  ]),
  ...Object.entries(onboardingVoicePhrases),
]);
