import { useEffect, useRef, useState } from "react";
import { Activity, ArrowRight, Pause, Play } from "lucide-react";

export default function Landing() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      video.pause();
      setIsPlaying(false);
      return;
    }

    video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    return () => video.pause();
  }, []);

  async function toggleVideo() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      try {
        await video.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }

  return (
    <main className="rehyn-landing">
      <section className="hero-scene" aria-labelledby="hero-title">
        <video
          ref={videoRef}
          className="hero-footage"
          muted
          loop
          playsInline
          preload="metadata"
          poster="/manus-storage/rehyn-senior-couple-poster_460cac8a.jpg"
          aria-hidden="true"
        >
          <source src="/manus-storage/rehyn-senior-couple-hero_632dd71e.mp4" type="video/mp4" />
        </video>
        <div className="hero-shade" aria-hidden="true" />

        <header className="landing-header">
          <a className="landing-brand" href="#top" aria-label="Rehyn home">
            <span className="landing-brand-icon"><Activity size={23} strokeWidth={2.4} /></span>
            <span className="landing-brand-name">Rehyn</span>
          </a>
        </header>

        <div className="hero-copy" id="top">
          <h1 id="hero-title">Every small step<br />is worth seeing.</h1>
          <a className="hero-primary" href="/app">Open Rehyn <ArrowRight size={18} /></a>
        </div>

        <button className="video-toggle" type="button" onClick={toggleVideo} aria-label={isPlaying ? "Pause background video" : "Play background video"}>
          {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          <span>{isPlaying ? "Pause video" : "Play video"}</span>
        </button>

        <p className="hero-note">
          Footage: <a href="https://www.pexels.com/video/a-couple-exercising-at-home-6970144/" target="_blank" rel="noreferrer">Mikhail Nilov / Pexels</a> · Rehyn complements, not replaces, clinical care.
        </p>
      </section>
    </main>
  );
}
