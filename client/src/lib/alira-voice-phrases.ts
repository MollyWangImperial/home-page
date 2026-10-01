import voiceClips from "./alira-voice-clips.json";
import { aliraTopics } from "./alira-topics";
import { guidedAliraPhrases } from "./alira-guided-start";
import { onboardingVoicePhrases } from "./alira-onboarding";
import { aliraAgentCopy } from "./alira-agent-copy";
import { aliraSpokenLines } from "./alira-spoken-lines";
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
  ...Object.entries(aliraAgentCopy).map(([id, text]) => [`agent-${id}`, text]),
  ...Object.entries(aliraSpokenLines),
]);
