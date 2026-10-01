import { aliraVoicePhrases } from "./alira-voice-phrases";

export type SpeechState = {
  activeId: string | null;
  speaking: boolean;
  loading: boolean;
  error: string;
};
export const silentSpeech: SpeechState = {
  activeId: null,
  speaking: false,
  loading: false,
  error: "",
};

class PlaybackError extends Error {}

/** The registered ID of one of Alira's fixed lines; anything else has none. */
export function aliraPhraseId(text: string): string | undefined {
  return Object.entries(aliraVoicePhrases).find(
    ([, phrase]) => phrase === text
  )?.[0];
}

export async function fetchAliraVoice(
  text: string,
  signal: AbortSignal
): Promise<Blob> {
  // A fixed line is requested by its ID (it may already be recorded); anything else Alira wrote,
  // such as a reply or her assessment congratulations, is read in her voice by /api/alira/speak.
  const phraseId = aliraPhraseId(text);
  const response = await fetch(phraseId ? "/api/alira/voice" : "/api/alira/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(phraseId ? { phraseId } : { text }),
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const messages: Record<string, string> = {
      VOICE_NOT_CONFIGURED:
        "Alira’s voice isn’t connected yet. You can still read every message here.",
      VOICE_ACCESS_DENIED:
        "Alira’s voice connection needs attention. Please try again later.",
      VOICE_BUSY: "Alira’s voice is busy. Please try again in a moment.",
      VOICE_UNAVAILABLE:
        "Alira’s voice can’t read this message right now. You can still read it here.",
    };
    throw new PlaybackError(
      messages[data.code] ??
        "Alira’s voice is temporarily unavailable. Please try again shortly."
    );
  }
  if (!response.headers.get("content-type")?.startsWith("audio/")) {
    throw new PlaybackError("Alira’s voice couldn’t load. Please try again.");
  }
  const audio = await response.blob();
  if (!audio.size)
    throw new PlaybackError("Alira’s voice couldn’t load. Please try again.");
  return audio;
}

// The avatar follows actual playback events; loading or cancelled requests never speak.
export function createAliraSpeech(
  onChange: (state: SpeechState) => void,
  {
    requestAudio = fetchAliraVoice,
    makeAudio = (url: string) => new Audio(url),
    createUrl = (blob: Blob) => URL.createObjectURL(blob),
    revokeUrl = (url: string) => URL.revokeObjectURL(url),
  } = {}
) {
  let generation = 0;
  let activeId: string | null = null;
  let activeAudio: HTMLAudioElement | null = null;
  let activeUrl: string | null = null;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cache = new Map<string, Blob>();

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const stop = (notify = true) => {
    generation += 1;
    clearTimer();
    controller?.abort();
    controller = null;
    activeId = null;
    const audio = activeAudio;
    activeAudio = null;
    if (audio) {
      audio.onplaying = audio.onwaiting = audio.onended = audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (activeUrl) revokeUrl(activeUrl);
    activeUrl = null;
    if (notify) onChange(silentSpeech);
  };

  return {
    stop,
    /**
     * Plays a line in Alira's voice. When her voice can't (no recording, no credits, offline),
     * `fallback` runs instead of showing an error, so the caller can use the device voice.
     */
    async play(id: string, text: string, fallback?: () => void) {
      if (activeId === id) {
        stop();
        return;
      }
      stop(false);
      const attempt = generation;
      activeId = id;
      controller = new AbortController();
      const signal = controller.signal;
      const fail = (
        message = "That audio couldn’t play. You can try listening again."
      ) => {
        if (attempt !== generation) return;
        stop(false);
        if (fallback) {
          fallback();
          return;
        }
        onChange({ ...silentSpeech, error: message });
      };
      const waiting = () => {
        if (attempt !== generation) return;
        clearTimer();
        onChange({ activeId: id, speaking: false, loading: true, error: "" });
        timer = setTimeout(
          () => fail("Alira’s voice took too long to load. Please try again."),
          30000
        );
      };
      waiting();
      try {
        let blob = cache.get(text);
        if (!blob) blob = await requestAudio(text, signal);
        if (attempt !== generation || signal.aborted) return;
        cache.set(text, blob);
        if (cache.size > 24) cache.delete(cache.keys().next().value!);
        activeUrl = createUrl(blob);
        const audio = makeAudio(activeUrl);
        activeAudio = audio;
        audio.onplaying = () => {
          if (attempt !== generation) return;
          clearTimer();
          onChange({ activeId: id, speaking: true, loading: false, error: "" });
        };
        audio.onwaiting = waiting;
        audio.onended = () => {
          if (attempt === generation) stop();
        };
        audio.onerror = () => fail();
        await audio.play();
      } catch (error) {
        fail(error instanceof PlaybackError ? error.message : undefined);
      }
    },
  };
}
