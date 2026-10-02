import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { story } from "@/content/my-time-story";
import { myTimeStore, type StoryPlace } from "@/lib/my-time";

const lastChapter = story.chapters.length - 1;
const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const partsLabel = `A STORY IN ${(NUMBER_WORDS[story.chapters.length] ?? String(story.chapters.length)).toUpperCase()} PARTS`;

/** A saved place from an older, longer story still lands somewhere that exists. */
function settle(place: StoryPlace): StoryPlace {
  const chapter = Math.min(place.chapter, lastChapter);
  return { chapter, sentence: Math.min(place.sentence, story.chapters[chapter].sentences.length - 1) };
}

// One sentence in Alira's voice, kept for this visit so replaying or pausing doesn't ask again.
const aliraSentences = new Map<string, Promise<Blob>>();
function fetchAliraSentence(text: string): Promise<Blob> {
  let request = aliraSentences.get(text);
  if (!request) {
    request = fetch("/api/alira/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) })
      .then(response => {
        if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/")) throw new Error("Alira's voice is unavailable.");
        return response.blob();
      });
    aliraSentences.set(text, request);
    request.catch(() => aliraSentences.delete(text));
  }
  return request;
}

function minutes(sentences: string[]) {
  const words = sentences.join(" ").split(/\s+/).length;
  const count = Math.max(1, Math.round(words / 110));
  return `About ${count} ${count === 1 ? "minute" : "minutes"}`;
}

function Cover() {
  return <div className="story-cover">
    <svg viewBox="0 0 230 340" fill="none" aria-hidden="true">
      <rect x="22" y="14" width="194" height="312" rx="6" stroke="#e9d29a" strokeOpacity=".55" strokeWidth="1.5" />
      <g fill="#e9d29a"><circle className="story-star" cx="54" cy="52" r="1.8" /><circle className="story-star story-star-late" cx="182" cy="44" r="1.5" /><circle cx="86" cy="34" r="1.3" /><circle className="story-star" cx="196" cy="96" r="1.6" /><circle cx="44" cy="104" r="1.3" /></g>
      <path className="story-beam" d="M125 82 216 54V112Z" fill="#f1cf7a" />
      <path className="story-beam story-beam-late" d="M119 82 22 60V106Z" fill="#f1cf7a" />
      <path d="M110 70h24v24h-24Z" fill="#f1cf7a" /><path d="M106 70h32l-16-14Z" fill="#b86b4d" />
      <path d="M108 94h28l8 96h-44Z" fill="#fff6ea" />
      <path d="M106.4 114h31.2l1.4 18h-34ZM103.2 152h37.6l1.4 18h-40.4Z" fill="#b86b4d" />
      <path d="M22 204C60 176 96 178 122 190 150 178 190 180 216 204V240H22Z" fill="#3f7460" />
      <g stroke="#9cc7a2" strokeWidth="2" strokeLinecap="round"><path d="M48 214v-12M48 204c-5-1-7-5-6-8 5 1 7 4 6 8ZM70 208v-12M70 198c5-1 7-5 6-8-5 1-7 4-6 8ZM164 208v-12M164 198c-5-1-7-5-6-8 5 1 7 4 6 8ZM188 214v-12M188 204c5-1 7-5 6-8-5 1-7 4-6 8Z" /></g>
    </svg>
    <div><b>{story.title}</b><span>{partsLabel}</span></div>
  </div>;
}

// A short story in chapters, read aloud a sentence at a time with the words lit as they are read.
// The place is remembered, so the next visit carries on from where this one stopped.
export default function StoryTime({ active }: { active: boolean }) {
  const [place, setPlace] = useState(() => settle(myTimeStore.load().story));
  const [playing, setPlaying] = useState(false);
  const [slow, setSlow] = useState(false);
  const [large, setLarge] = useState(false);
  const [note, setNote] = useState("");
  const [canSpeak] = useState(() => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
  const page = useRef<HTMLParagraphElement>(null);
  const current = useRef<HTMLSpanElement>(null);
  const chapter = story.chapters[place.chapter];
  const atVeryEnd = place.chapter === lastChapter && place.sentence === chapter.sentences.length - 1;

  // Leaving for another activity stops the reading; it never carries on unseen.
  useEffect(() => { if (!active) setPlaying(false); }, [active]);

  // Alira reads the story in her own voice; the device voice reads a sentence only when hers can't.
  useEffect(() => {
    if (!playing || !active) return;
    const sentences = story.chapters[place.chapter].sentences;
    const text = sentences[place.sentence];
    let left = false;
    let audio: HTMLAudioElement | null = null;
    let url: string | null = null;
    const finished = () => {
      if (left) return;
      if (place.sentence < sentences.length - 1) { setPlace({ chapter: place.chapter, sentence: place.sentence + 1 }); return; }
      setPlaying(false);
      if (place.chapter < lastChapter) {
        setPlace({ chapter: place.chapter + 1, sentence: 0 });
        setNote("That is the end of the chapter. The next one is ready when you are.");
      } else setNote("The end. You can start it again whenever you like.");
    };
    const withDevice = () => {
      if (left) return;
      if (!canSpeak) { setPlaying(false); setNote("Reading aloud did not start on this device. The story is here to read."); return; }
      const line = new SpeechSynthesisUtterance(text);
      line.lang = "en-GB";
      line.rate = slow ? 0.72 : 0.9;
      line.onend = finished;
      line.onerror = () => {
        if (left) return;
        setPlaying(false);
        setNote("Reading aloud did not start on this device. The story is here to read.");
      };
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
    const next = sentences[place.sentence + 1];
    if (next) void fetchAliraSentence(next).catch(() => {});
    return () => {
      left = true;
      if (audio) { audio.onended = audio.onerror = null; audio.pause(); }
      if (url) URL.revokeObjectURL(url);
      if (canSpeak) window.speechSynthesis.cancel();
    };
  }, [playing, active, canSpeak, place.chapter, place.sentence, slow]);

  useEffect(() => { myTimeStore.saveStoryPlace(place); }, [place]);

  // Keeps the sentence being read in view inside the page, without moving the whole screen.
  useEffect(() => {
    const box = page.current;
    const line = current.current;
    if (!box || !line) return;
    const top = line.offsetTop - box.offsetTop - box.clientHeight / 3;
    box.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [place.chapter, place.sentence]);

  const open = (index: number) => {
    setPlace({ chapter: index, sentence: 0 });
    setNote("");
  };
  const toggle = () => {
    setNote("");
    if (!playing && atVeryEnd) setPlace({ chapter: place.chapter, sentence: 0 });
    setPlaying(!playing);
  };

  return <section className="mt-card story-card" aria-labelledby="story-title">
    <Cover />
    <div className="mt-copy">
      <div>
        <h2 id="story-title">A chapter before you rest.</h2>
          <p>A few minutes of a story written by Alira, read aloud, that picks up where you stopped. Close your eyes, or follow the words.</p>
      </div>
      <div className="story-reader">
        <div className="story-now">
          {canSpeak && <button type="button" className="story-play" onClick={toggle} aria-label={playing ? "Pause the reading" : `Read chapter ${place.chapter + 1} aloud`}>{playing ? <Pause size={22} /> : <Play size={22} />}</button>}
          <div><b>Chapter {place.chapter + 1} · {chapter.title}</b><span>{minutes(chapter.sentences)}</span></div>
          <div className={`story-voice ${playing ? "is-speaking" : ""}`} aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
        </div>
        <p ref={page} className={`story-page ${large ? "is-large" : ""}`} tabIndex={0} aria-label={`Chapter ${place.chapter + 1}, ${chapter.title}`}>
          {chapter.sentences.map((sentence, index) => <span key={index} ref={index === place.sentence ? current : undefined} className={index === place.sentence ? "is-current" : index < place.sentence ? "is-read" : ""}>{sentence} </span>)}
        </p>
        <p className="story-note" role="status">{note || (!canSpeak ? "Reading aloud is not available in this browser. The story is here to read." : "")}</p>
      </div>
      <div className="story-foot">
        <div className="story-chapters">
          <div role="group" aria-label="Chapters">
            {story.chapters.map((item, index) => <button key={index} type="button" className={index === place.chapter ? "is-current" : index < place.chapter ? "is-read" : ""} aria-current={index === place.chapter ? "true" : undefined} aria-label={`Chapter ${index + 1}, ${item.title}`} onClick={() => open(index)}><i /></button>)}
          </div>
          <b>Chapter {place.chapter + 1} of {story.chapters.length}</b>
        </div>
        <div className="story-options">
          <button type="button" className={slow ? "is-on" : ""} aria-pressed={slow} onClick={() => setSlow(!slow)}>Slower voice</button>
          <button type="button" className={large ? "is-on" : ""} aria-pressed={large} onClick={() => setLarge(!large)}>Larger words</button>
          {(place.chapter > 0 || place.sentence > 0) && <button type="button" onClick={() => { setPlaying(false); open(0); }}><RotateCcw size={14} />From the beginning</button>}
        </div>
      </div>
    </div>
  </section>;
}
