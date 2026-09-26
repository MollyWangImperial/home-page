import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  Check,
  HeartHandshake,
  Pause,
  Play,
  Smartphone,
} from "lucide-react";

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
        <img
          className="hero-tripod"
          src="/manus-storage/rehyn-smartphone-tripod_969056e3.png"
          alt="A smartphone on a tripod, set up to film the home exercise"
        />

        <header className="landing-header">
          <a className="landing-brand" href="#top" aria-label="Rehyn home">
            <span className="landing-brand-icon"><Activity size={23} strokeWidth={2.4} /></span>
            <span>Reh<span>yn</span></span>
          </a>
          <nav className="landing-nav" aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#for-patients">For patients</a>
            <a href="#for-families">For families</a>
          </nav>
          <a className="landing-header-cta" href="/app">Open the app <ArrowRight size={16} /></a>
        </header>

        <div className="hero-copy" id="top">
          <p className="hero-kicker"><span />Recovery, together</p>
          <h1 id="hero-title">Every small step<br />is worth seeing.</h1>
          <p className="hero-subtitle">A calmer way to practise at home—with family close by.</p>
          <div className="hero-actions">
            <a className="hero-primary" href="#how-it-works">See how Rehyn works <ArrowRight size={18} /></a>
            <a className="hero-secondary" href="/app">Explore the app</a>
          </div>
        </div>

        <aside className="sample-progress" aria-label="Illustrative sample Rehyn progress preview">
          <div className="sample-progress-top">
            <span className="sample-phone-icon"><Smartphone size={16} /></span>
            <span className="sample-caption">A SAMPLE REHYN RECAP</span>
          </div>
          <div className="sample-progress-main">
            <div>
              <p className="sample-label">Today’s practice</p>
              <p className="sample-value">2 <span>small steps completed</span></p>
            </div>
            <div className="sample-ring" role="img" aria-label="Two of three sample steps complete"><span>2/3</span></div>
          </div>
          <div className="sample-step"><span className="sample-step-check"><Check size={12} /></span>Hand practice</div>
          <div className="sample-step"><span className="sample-step-check"><Check size={12} /></span>Gentle check-in</div>
        </aside>

        <button className="video-toggle" type="button" onClick={toggleVideo} aria-label={isPlaying ? "Pause background video" : "Play background video"}>
          {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          <span>{isPlaying ? "Pause video" : "Play video"}</span>
        </button>

        <a className="scroll-cue" href="#how-it-works" aria-label="Scroll to how Rehyn works">
          <span>SEE WHAT A SMALL STEP CAN LOOK LIKE</span><ArrowDown size={16} />
        </a>
        <span className="hero-disclosure">Illustrative stock footage · sample progress preview</span>
      </section>

      <section className="landing-explainer" id="how-it-works" aria-labelledby="explainer-title">
        <div className="explainer-heading">
          <p className="section-overline">A LITTLE MORE CLARITY</p>
          <h2 id="explainer-title">Make room for the next step.</h2>
          <p>Recovery looks different for everyone. Rehyn helps make the day feel a little easier to navigate.</p>
        </div>
        <div className="explainer-steps">
          <article className="explainer-step" id="for-patients">
            <span className="explainer-icon"><Activity size={21} /></span>
            <span className="step-index">01</span>
            <h3>Choose one thing</h3>
            <p>A clear, gentle place to begin—at your pace.</p>
          </article>
          <article className="explainer-step">
            <span className="explainer-icon"><Smartphone size={21} /></span>
            <span className="step-index">02</span>
            <h3>Practise together</h3>
            <p>Make at-home practice easier to share with someone you trust.</p>
          </article>
          <article className="explainer-step" id="for-families">
            <span className="explainer-icon"><HeartHandshake size={21} /></span>
            <span className="step-index">03</span>
            <h3>Notice the effort</h3>
            <p>See the small moments you’ve made time for.</p>
          </article>
        </div>
        <div className="landing-next-step">
          <div><span className="section-overline">READY WHEN YOU ARE</span><h2>Start with what feels possible.</h2></div>
          <a className="explainer-cta" href="/app">Explore the Rehyn app <ArrowRight size={18} /></a>
        </div>
        <footer className="landing-footer">
          <span>Rehyn is a recovery companion, not a replacement for care from your clinical team.</span>
          <span>Hero footage: <a href="https://www.pexels.com/video/a-couple-exercising-at-home-6970144/" target="_blank" rel="noreferrer">Mikhail Nilov via Pexels</a>. Stock footage and sample progress are illustrative; they do not depict a Rehyn patient or clinical outcome.</span>
        </footer>
      </section>
    </main>
  );
}
