import { useEffect, useRef } from "react";
import { Activity, ArrowRight } from "lucide-react";

export default function Landing() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      video.pause();
      return;
    }

    void video.play().catch(() => undefined);
    return () => video.pause();
  }, []);

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
          <h1 id="hero-title">Every small step<br />is worth seeing at home.</h1>
          <a className="hero-primary" href="/app">Open Rehyn <ArrowRight size={18} /></a>
        </div>

        <p className="hero-note">
          Footage: <a href="https://www.pexels.com/video/a-couple-exercising-at-home-6970144/" target="_blank" rel="noreferrer">Mikhail Nilov / Pexels</a> · Rehyn complements, not replaces, clinical care.
        </p>
      </section>
    </main>
  );
}
