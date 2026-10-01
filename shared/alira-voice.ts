// Alira has one voice. Everything that speaks as Alira reads its voice from here: the Alira
// page, the voice pack in server/voice-pack, and (mirrored in its own settings) the Rehyn
// backend that runs the movement assessment and the exercises. See ALIRA_VOICE.md.
//
// To change her voice, change `voiceId` here, mirror it in the backend's ELEVENLABS_VOICE_ID,
// and run `pnpm voice:bake` so every line is spoken by the new voice.
export const ALIRA_VOICE = {
  /**
   * The ElevenLabs voice, designed for Rehyn: a British woman in her early thirties with a soft,
   * modern southern English accent. Warm and bright, with a smile you can hear, like a favourite
   * physiotherapist who has become a trusted friend. Never breathy. Saved as "Alira" in the
   * ElevenLabs workspace that owns ELEVENLABS_API_KEY.
   */
  name: "Alira",
  voiceId: "WeMiVLMEQeVXN5PFqfo3",
  modelId: "eleven_multilingual_v2",
  outputFormat: "mp3_44100_128",
  /**
   * How she delivers a line. A little more stability headroom and expressive warmth (style) than
   * a narrator, so she sounds close and personal, and a steady, unhurried pace for patients who
   * may process speech more slowly after a stroke. Keep these fixed so she is the same person
   * on every page, in the assessment and in every exercise.
   */
  settings: {
    stability: 0.45,
    similarity_boost: 0.8,
    style: 0.3,
    use_speaker_boost: true,
    speed: 0.95,
  },
} as const;
