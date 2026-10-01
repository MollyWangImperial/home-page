import { useEffect, useState } from "react";
import { Bookmark, Check, RefreshCw, Volume2, VolumeX } from "lucide-react";
import { dayNumber, myTimeStore } from "@/lib/my-time";
import { startAmbience } from "@/lib/my-time-audio";
import PostcardArt, { postcards, type PostcardId } from "./PostcardArt";

const find = (id: string) => postcards.find(postcard => postcard.id === id);

// One illustrated postcard a day, with a short note from Alira on the back and the sound of the
// place. Kept cards go in an album and can be looked at again.
export default function DailyPostcard({ active }: { active: boolean }) {
  const [today] = useState(() => dayNumber(new Date()));
  const todays = postcards[today % postcards.length];
  const tomorrows = postcards[(today + 1) % postcards.length];
  const [shownId, setShownId] = useState<PostcardId>(todays.id);
  const [back, setBack] = useState(false);
  const [listening, setListening] = useState(false);
  const [kept, setKept] = useState(() => myTimeStore.load().kept);
  const shown = find(shownId) ?? todays;
  const isKept = kept.includes(shown.id);
  const album = kept.map(find).filter((postcard): postcard is NonNullable<typeof postcard> => !!postcard);

  useEffect(() => {
    if (!active || !listening) return;
    return startAmbience(shown.sound);
  }, [active, listening, shown.sound]);

  const show = (id: PostcardId) => {
    setShownId(id);
    setBack(false);
  };

  return <section className="mt-card postcard-card" aria-labelledby="postcard-title">
    <div className="postcard-side">
      <div className="postcard-tilt">
        <button type="button" className={`postcard-flip ${back ? "is-back" : ""}`} onClick={() => setBack(!back)} aria-label={back ? `Postcard, written side: ${shown.note} Touch to see the picture.` : `Postcard: ${shown.title}. Touch to turn it over.`}>
          <span className="postcard-front"><PostcardArt id={shown.id} /></span>
          <span className="postcard-back" aria-hidden="true">
            <span className="postcard-note"><span>{shown.note}</span><em>Alira</em></span>
            <span className="postcard-address">
              <svg viewBox="0 0 60 72" fill="none"><rect x="2" y="2" width="56" height="68" rx="2" fill="#dfede5" stroke="#8fb39b" strokeWidth="2" strokeDasharray="4 3" /><g transform="translate(30 36)"><ellipse rx="5" ry="15" fill="#e6a9ae" /><ellipse rx="5" ry="15" fill="#edbcc0" transform="rotate(45)" /><ellipse rx="5" ry="15" fill="#e6a9ae" transform="rotate(90)" /><ellipse rx="5" ry="15" fill="#edbcc0" transform="rotate(135)" /><circle r="5" fill="#f1cf7a" /></g></svg>
              <span><b>{shown.title}</b><i /><i /><i /></span>
            </span>
          </span>
        </button>
      </div>
      <div className="postcard-actions">
        <button type="button" className="postcard-turn" onClick={() => setBack(!back)}><RefreshCw size={16} />{back ? "See the picture" : "Turn it over"}</button>
        <button type="button" className={listening ? "is-on" : ""} aria-pressed={listening} onClick={() => setListening(!listening)}>{listening ? <VolumeX size={16} /> : <Volume2 size={16} />}{listening ? "Quiet again" : "Hear this place"}</button>
        <button type="button" className={isKept ? "is-on" : ""} aria-pressed={isKept} onClick={() => setKept(myTimeStore.toggleKept(shown.id))}>{isKept ? <Check size={16} /> : <Bookmark size={16} />}{isKept ? "In your album" : "Keep it"}</button>
      </div>
    </div>
    <div className="mt-copy">
      <div>
        <h2 id="postcard-title">A postcard from somewhere quiet.</h2>
        <p>A new place arrives each morning. Turn it over to read the note, listen to how it sounds there, and keep the ones you love.</p>
      </div>
      <div className="postcard-album">
        {album.length > 0 && <div className="postcard-thumbs">
          {album.map(postcard => <button key={postcard.id} type="button" className={postcard.id === shown.id ? "is-selected" : ""} onClick={() => show(postcard.id)} aria-label={`Look at ${postcard.title}`}><PostcardArt id={postcard.id} /></button>)}
        </div>}
        <b role="status">{album.length === 0 ? "Your album is empty for now" : `${album.length} ${album.length === 1 ? "postcard" : "postcards"} in your album`}</b>
        <span>{shown.id === todays.id ? `Tomorrow: ${tomorrows.teaser}.` : <button type="button" className="postcard-today" onClick={() => show(todays.id)}>Back to today's postcard</button>}</span>
      </div>
    </div>
  </section>;
}
