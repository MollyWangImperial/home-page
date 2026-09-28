import voiceClips from "./alira-voice-clips.json";
import { aliraTopics } from "./alira-topics";

// Both the browser and server use the same allowlist. User replies are never TTS input.
export const aliraVoicePhrases: Record<string, string> = Object.fromEntries([
  ...Object.entries(voiceClips).map(([text, clip]) => [
    clip
      .split("/")
      .pop()!
      .replace(/\.wav$/, ""),
    text,
  ]),
  ...aliraTopics.map(topic => [`topic-${topic.id}`, topic.prompt]),
]);
