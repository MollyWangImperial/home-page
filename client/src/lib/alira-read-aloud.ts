import { useEffect, useState } from "react";

// Reading a page aloud, one sentence at a time, so the sentence being read can be lit on the page.
// Alira reads in her own voice (the same /api/alira/speak the bedtime story uses); the device's
// voice reads a sentence only when hers can't, and if neither can the page is simply there to read.

/** Splits a paragraph into the sentences it is read in. A closing quote stays with its sentence. */
export function splitSentences(text: string): string[] {
  const found = text.match(/[^.!?]+[.!?]+["”’)]*|[^.!?]+$/g) ?? [];
  return found.map(sentence => sentence.trim()).filter(Boolean);
}

// One sentence in Alira's voice, kept for this visit so replaying or pausing doesn't ask again.
const spoken = new Map<string, Promise<Blob>>();
function fetchAliraSentence(text: string): Promise<Blob> {
  let request = spoken.get(text);
  if (!request) {
    request = fetch("/api/alira/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) })
      .then(response => {
        if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/")) throw new Error("Alira's voice is unavailable.");
        return response.blob();
      });
    spoken.set(text, request);
    request.catch(() => spoken.delete(text));
  }
  return request;
}

export type ReadAloud = {
  /** The sentence being read, or the one it is paused on; -1 before it starts and after it ends. */
  index: number;
  playing: boolean;
  slow: boolean;
  /** Something to tell the reader: it finished, or it could not start. */
  note: string;
  /** The whole page has been read; cleared when listening starts again. */
  done: boolean;
  toggle: () => void;
  setSlow: (slow: boolean) => void;
};

/**
 * Reads `lines` aloud in order. Pass the same array for the same page (memoise it): a new array
 * is a new page, and the reading starts over. `active` false stops it, for when the page is hidden.
 */
export function useReadAloud(lines: string[], active: boolean): ReadAloud {
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [slow, setSlow] = useState(false);
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  const [canSpeak] = useState(() => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window);

  useEffect(() => { if (!active) setPlaying(false); }, [active]);
  useEffect(() => {
    setPlaying(false);
    setIndex(-1);
    setNote("");
    setDone(false);
  }, [lines]);

  useEffect(() => {
    if (!playing || !active) return;
    const text = lines[index];
    if (text === undefined) { setPlaying(false); return; }
    let left = false;
    let audio: HTMLAudioElement | null = null;
    let url: string | null = null;
    const finished = () => {
      if (left) return;
      if (index < lines.length - 1) { setIndex(index + 1); return; }
      setPlaying(false);
      setIndex(-1);
      setDone(true);
      setNote("That is the end. Listen again whenever you like.");
    };
    const unavailable = () => {
      if (left) return;
      setPlaying(false);
      setNote("Reading aloud did not start on this device. The words are here to read.");
    };
    const withDevice = () => {
      if (left) return;
      if (!canSpeak) { unavailable(); return; }
      const line = new SpeechSynthesisUtterance(text);
      line.lang = "en-GB";
      line.rate = slow ? 0.72 : 0.9;
      line.onend = finished;
      line.onerror = unavailable;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(line);
    };
    void fetchAliraSentence(text).then(blob => {
      if (left) return;
      url = URL.createObjectURL(blob);
      audio = new Audio(url);
      audio.playbackRate = slow ? 0.8 : 1;
      audio.onended = finished;
      audio.onerror = withDevice;
      return audio.play();
    }).catch(withDevice);
    // The next sentence is fetched while this one plays, so there is no pause between them.
    const next = lines[index + 1];
    if (next) void fetchAliraSentence(next).catch(() => {});
    return () => {
      left = true;
      if (audio) { audio.onended = audio.onerror = null; audio.pause(); }
      if (url) URL.revokeObjectURL(url);
      if (canSpeak) window.speechSynthesis.cancel();
    };
  }, [playing, active, canSpeak, index, slow, lines]);

  const toggle = () => {
    setNote("");
    setDone(false);
    if (!playing && index < 0) setIndex(0);
    setPlaying(!playing);
  };
  return { index, playing, slow, note, done, toggle, setSlow };
}
