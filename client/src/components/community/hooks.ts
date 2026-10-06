import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

/** Whether a media query matches, kept up to date as it changes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((notify: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const media = window.matchMedia(query);
    media.addEventListener?.("change", notify);
    return () => media.removeEventListener?.("change", notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches, () => false);
}

/** The person has asked their device for less motion. */
export const useStill = () => useMediaQuery("(prefers-reduced-motion: reduce)");

/** setTimeout that is cleared when the component goes away. */
export function useLater() {
  const timers = useRef<number[]>([]);
  useEffect(() => () => { timers.current.forEach(timer => window.clearTimeout(timer)); timers.current = []; }, []);
  return useCallback((run: () => void, ms: number) => {
    const timer = window.setTimeout(() => {
      timers.current = timers.current.filter(other => other !== timer);
      run();
    }, ms);
    timers.current.push(timer);
  }, []);
}

/** A few hearts that float up and fade: warmth sent, or a seat taken. */
export type Burst = { id: string; left: number; dx: number; bg: string; fg: string };
const burstColours: [string, string][] = [["#FBE3DB", "#C8553A"], ["#FBEBC2", "#C99A1A"], ["#E9E2F4", "#7A68B0"], ["#E3EFE6", "#2E7D5B"]];

export function useBursts() {
  const still = useStill();
  const later = useLater();
  const seq = useRef(0);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const burst = useCallback(() => {
    if (still) return;
    const added: Burst[] = [];
    for (let i = 0; i < 3; i++) {
      const [bg, fg] = burstColours[(seq.current + i) % burstColours.length];
      added.push({ id: `b${seq.current++}`, left: Math.round(Math.random() * 26), dx: Math.round(Math.random() * 60 - 30), bg, fg });
    }
    const ids = added.map(item => item.id);
    setBursts(list => [...list, ...added].slice(-18));
    later(() => setBursts(list => list.filter(item => !ids.includes(item.id))), 2000);
  }, [still, later]);
  return { bursts, burst };
}

/**
 * Keeps a scrolling chat at its newest line as lines arrive, unless the reader has scrolled up
 * to read something, in which case it stays where they are.
 */
export function usePinnedToEnd<T extends HTMLElement>(change: unknown, shown: boolean) {
  const box = useRef<T>(null);
  const atEnd = useRef(true);
  const onScroll = useCallback(() => {
    const el = box.current;
    if (el && el.clientHeight > 0) atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
  }, []);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && shown && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [change, shown]);
  return { box, onScroll };
}

/* -------------------------------------------------------------- voice notes */

// One voice note plays at a time. The words are read by this device's own voice where it has
// one, so nothing is sent anywhere; without one, the note simply shows its progress.
let stopPlaying: (() => void) | null = null;

function speak(words: string, onEnd: () => void): (() => void) | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return null;
  try {
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    const local = voices.filter(voice => voice.localService);
    // Some voices are online services. If those are all there is, keep the words on the device.
    if (voices.length > 0 && local.length === 0) return null;
    const english = local.find(voice => voice.lang === "en-GB") ?? local.find(voice => voice.lang.toLowerCase().startsWith("en"));
    const line = new SpeechSynthesisUtterance(words);
    line.lang = "en-GB";
    line.rate = 0.9;
    if (english) line.voice = english;
    let over = false;
    const finish = () => { if (!over) { over = true; onEnd(); } };
    line.onend = finish;
    line.onerror = finish;
    synth.cancel();
    synth.speak(line);
    return () => {
      over = true;
      line.onend = null;
      line.onerror = null;
      try { synth.cancel(); } catch { /* already quiet */ }
    };
  } catch { return null; }
}

/** About how long the words take to say, for a voice note made from typed words. */
export function voiceSeconds(words: string): number {
  const count = words.split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.min(60, Math.round(count / 2.4)));
}

export function useVoiceNote(words: string, seconds: number) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => () => stopRef.current(), []);

  const toggle = useCallback(() => {
    if (playing) { stopRef.current(); return; }
    stopPlaying?.();
    const started = Date.now();
    const length = Math.max(1, seconds) * 1000;
    let spoken = false;
    let done = false;
    let cancelSpeech: (() => void) | null = null;
    const stop = () => {
      if (done) return;
      done = true;
      window.clearInterval(tick);
      cancelSpeech?.();
      setPlaying(false);
      setProgress(0);
      if (stopPlaying === stop) stopPlaying = null;
      stopRef.current = () => {};
    };
    const tick = window.setInterval(() => {
      const share = (Date.now() - started) / length;
      // While the device is still speaking, the bar waits just short of the end.
      setProgress(Math.min(spoken ? 0.97 : 1, share));
      if ((!spoken && share >= 1) || share >= 3) stop();
    }, 120);
    stopPlaying = stop;
    stopRef.current = stop;
    setPlaying(true);
    setProgress(0);
    cancelSpeech = speak(words, () => { spoken = false; stop(); });
    spoken = cancelSpeech !== null && !done;
  }, [playing, seconds, words]);

  return { playing, progress, toggle };
}
