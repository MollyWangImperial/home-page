import type { Voice } from "./session";

export type RunnerVoice = Voice & {
  setMuted(muted: boolean): void;
  onSay: (text: string) => void;
  onAvailability: (available: boolean) => void;
};

const readingMs = (text: string) => 600 + text.length * 52;
const isEnglish = (voice: SpeechSynthesisVoice) => /^en(?:[-_]|$)/i.test(voice.lang.trim());

export function pickEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter(isEnglish);
  const preferred = (voice: SpeechSynthesisVoice) => /sonia|libby|samantha|google uk english female|aria|jenny|zira/i.test(voice.name);
  return english.find(voice => /^en[-_]gb$/i.test(voice.lang) && preferred(voice))
    ?? english.find(preferred) ?? english.find(voice => /^en[-_]gb$/i.test(voice.lang)) ?? english[0] ?? null;
}

/**
 * Always assign an explicit English voice; never fall back to the computer's default voice.
 * `alira: true` asks for Alira's ElevenLabs voice first. `aliraOnly` keeps that voice throughout
 * Graded Forward Reach; captions remain visible if its saved audio cannot play.
 */
export function createVoice(options: { alira?: boolean; aliraOnly?: boolean } = {}): RunnerVoice {
  const synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
  let muted = false;
  let busyUntil = 0;
  let generation = 0;
  let loading = false;
  let active = 0;
  let selected: SpeechSynthesisVoice | null = null;
  let queue: string[] = [];
  let triedBrowserVoices = false;
  let cancelAudio: (() => void) | null = null;
  const aliraUnavailable = !(options.alira || options.aliraOnly) || typeof fetch !== "function";
  const requests = new Set<AbortController>();

  // Prepare the next instruction while the current one plays; the server caches repeated lines.
  const fetchClips = (lines: string[], provider?: "alira") => Promise.all(lines.map(async text => {
    const controller = new AbortController();
    requests.add(controller);
    try {
      const response = await fetch("/api/exercise-voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(provider ? { text, provider } : { text }), signal: controller.signal });
      if (!response.ok || !/^en(?:-|$)/i.test(response.headers.get("X-Exercise-Language") ?? "")) throw new Error("English audio unavailable.");
      if (provider === "alira" && (response.headers.get("X-Exercise-Voice") !== "Alira" || response.headers.get("X-Exercise-Voice-Provider") !== "elevenlabs")) throw new Error("Alira audio unavailable.");
      return response.blob();
    } finally { requests.delete(controller); }
  }));

  const playClips = async (clips: Blob[], run: number) => {
    for (const blob of clips) {
      if (run !== generation || muted) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      try {
        await new Promise<void>((resolve, reject) => {
          cancelAudio = () => { audio.pause(); resolve(); };
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error("English audio could not play."));
          void audio.play().then(() => { if (run === generation) api.onAvailability(true); }).catch(reject);
        });
      } finally { cancelAudio = null; audio.pause(); URL.revokeObjectURL(url); }
    }
  };

  const localAudio = async (lines: string[], run: number) => playClips(await fetchClips(lines), run);

  // Reach uses saved Alira audio throughout. Optional Alira callers can fall back to an English
  // device voice; aliraOnly callers keep captions when a clip is unavailable.
  const flush = async () => {
    if (loading || muted) return;
    loading = true;
    const run = generation;
    // While a device voice is still mid-sentence, keep using it so two voices never overlap.
    if (!aliraUnavailable && active === 0) {
      const lines = queue;
      queue = [];
      let clips: Blob[] | null = null;
      try { clips = await fetchClips(lines, "alira"); } catch { clips = null; }
      if (run !== generation) return;
      if (clips) {
        try { await playClips(clips, run); } catch { if (run === generation) api.onAvailability(false); }
        if (run === generation) { busyUntil = performance.now(); loading = false; if (queue.length) void flush(); }
        return;
      }
      if (options.aliraOnly) {
        api.onAvailability(false);
        loading = false;
        if (queue.length) void flush();
        return;
      }
      // Optional Alira speech (for example, the warm-up) can still use an English device voice.
      queue = [...lines, ...queue];
    }
    if (options.aliraOnly) {
      queue = [];
      loading = false;
      api.onAvailability(false);
      return;
    }
    void deviceFlush(run);
  };

  const deviceFlush = async (run: number) => {
    selected = selected ?? (synth ? pickEnglishVoice(synth.getVoices()) : null);
    // Chromium often returns an empty voice list immediately after the page opens.
    for (let attempt = 0; synth && !selected && !triedBrowserVoices && attempt < 30 && run === generation; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      selected = pickEnglishVoice(synth.getVoices());
    }
    if (run !== generation) return;
    triedBrowserVoices = true;
    const lines = queue;
    queue = [];
    if (!selected || !synth) {
      try { await localAudio(lines, run); if (run === generation) busyUntil = performance.now(); }
      catch { if (run === generation) api.onAvailability(false); }
      if (run === generation) { loading = false; if (queue.length) void flush(); }
      return;
    }
    loading = false;
    api.onAvailability(true);
    for (const text of lines) {
      for (const sentence of text.split(/(?<=[.!?])\s+/)) {
        if (!sentence.trim()) continue;
        const utterance = new SpeechSynthesisUtterance(sentence);
        utterance.voice = selected;
        utterance.lang = selected.lang.replace("_", "-");
        utterance.rate = 0.95;
        utterance.pitch = 1;
        active++;
        const finished = () => { if (run === generation) active = Math.max(0, active - 1); };
        utterance.onend = finished;
        utterance.onerror = finished;
        synth.speak(utterance);
      }
    }
  };

  const cancel = () => {
    generation++;
    loading = false;
    active = 0;
    queue = [];
    requests.forEach(request => request.abort());
    requests.clear();
    cancelAudio?.();
    cancelAudio = null;
    synth?.cancel();
  };
  const api: RunnerVoice = {
    onSay: () => {},
    onAvailability: () => {},
    setMuted(value) { muted = value; if (value) cancel(); },
    say(text) {
      api.onSay(text);
      busyUntil = Math.max(busyUntil, performance.now()) + readingMs(text);
      if (muted) return;
      queue.push(text);
      void flush();
    },
    busy(t) {
      if (muted) return t < busyUntil;
      if (loading || queue.length > 0) return true;
      if (!selected || !synth) return t < busyUntil;
      return loading || queue.length > 0 || active > 0 || synth.speaking || synth.pending;
    },
    stop() { cancel(); busyUntil = 0; },
  };
  return api;
}
