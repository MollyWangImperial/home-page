export type SpeechState = {
  activeId: string | null;
  speaking: boolean;
  error: string;
};
export const silentSpeech: SpeechState = {
  activeId: null,
  speaking: false,
  error: "",
};

// Keep playback tied to actual speech events, including stop, errors and late callbacks.
export function createAliraSpeech(
  synth: SpeechSynthesis | null,
  makeUtterance: (text: string) => SpeechSynthesisUtterance,
  onChange: (state: SpeechState) => void,
  makeAudio?: (text: string) => HTMLAudioElement | null
) {
  let active: SpeechSynthesisUtterance | null = null;
  let activeAudio: HTMLAudioElement | null = null;
  let activeId: string | null = null;
  let startTimer: ReturnType<typeof setTimeout> | null = null;

  const clearStartTimer = () => {
    if (startTimer !== null) clearTimeout(startTimer);
    startTimer = null;
  };
  const stop = (notify = true) => {
    clearStartTimer();
    const wasActive = active !== null;
    active = null;
    activeId = null;
    const audio = activeAudio;
    activeAudio = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (wasActive) synth?.cancel();
    if (notify) onChange(silentSpeech);
  };

  return {
    stop,
    play(id: string, text: string) {
      if (activeId === id) {
        stop();
        return;
      }
      stop();
      const voices =
        synth
          ?.getVoices()
          .filter(
            voice => voice.localService && /^en(?:-|_|$)/i.test(voice.lang)
          ) ?? [];
      const voice =
        voices.find(voice => voice.lang.toLowerCase() === "en-gb") ?? voices[0];
      if (!synth || !voice) {
        const audio = makeAudio?.(text);
        if (audio) {
          activeAudio = audio;
          activeId = id;
          const fail = () => {
            if (activeAudio !== audio) return;
            stop(false);
            onChange({
              ...silentSpeech,
              error: "That audio couldn’t play. You can try listening again.",
            });
          };
          audio.onplaying = () => {
            if (activeAudio !== audio) return;
            clearStartTimer();
            onChange({ activeId: id, speaking: true, error: "" });
          };
          audio.onended = () => {
            if (activeAudio === audio) stop();
          };
          audio.onerror = fail;
          onChange({ activeId: id, speaking: false, error: "" });
          startTimer = setTimeout(fail, 5000);
          audio.play().catch(fail);
          return;
        }
        onChange({
          ...silentSpeech,
          error:
            "Voice isn’t available in this browser. You can still read every message here.",
        });
        return;
      }
      const utterance = makeUtterance(text);
      active = utterance;
      activeId = id;
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = 0.92;
      utterance.onstart = () => {
        if (active !== utterance) return;
        clearStartTimer();
        onChange({ activeId: id, speaking: true, error: "" });
      };
      utterance.onend = () => {
        if (active === utterance) {
          clearStartTimer();
          active = null;
          activeId = null;
          onChange(silentSpeech);
        }
      };
      utterance.onerror = () => {
        if (active !== utterance) return;
        stop(false);
        onChange({
          ...silentSpeech,
          error: "That audio couldn’t play. You can try listening again.",
        });
      };
      onChange({ activeId: id, speaking: false, error: "" });
      startTimer = setTimeout(() => {
        if (active !== utterance) return;
        stop(false);
        onChange({
          ...silentSpeech,
          error:
            "Audio didn’t start. Try listening again, or keep reading below.",
        });
      }, 5000);
      try {
        synth.speak(utterance);
      } catch {
        utterance.onerror?.(new Event("error") as SpeechSynthesisErrorEvent);
      }
    },
  };
}
