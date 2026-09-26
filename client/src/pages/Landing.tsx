import { useEffect, useRef, useState, type FormEvent } from "react";
import { Activity, ArrowRight, Check, Heart, Users, Sparkles } from "lucide-react";

export default function Landing() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [submitted, setSubmitted] = useState(false);

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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <main className="rehyn-landing rehyn-story">
      <section className="hero-scene story-hero" aria-labelledby="hero-title" id="top">
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

        <header className="landing-header story-header">
          <a className="landing-brand" href="#top" aria-label="Rehyn home">
            <span className="landing-brand-icon"><Activity size={23} strokeWidth={2.4} /></span>
            <span className="landing-brand-name">Rehyn</span>
          </a>
          <nav className="story-nav" aria-label="Main navigation">
            <a href="#how-it-helps">How it helps</a>
            <a href="#families">For families</a>
            <a className="story-nav-cta" href="#signup">Get early access <ArrowRight size={15} /></a>
          </nav>
        </header>

        <div className="hero-copy story-hero-copy">
          <p className="hero-eyebrow">A recovery companion for home</p>
          <h1 id="hero-title">Every small step<br />is worth seeing at home.</h1>
          <p className="hero-subtitle">Simple practice, shared encouragement, and progress you can notice together.</p>
          <a className="hero-primary" href="#signup">Get early access <ArrowRight size={18} /></a>
          <span className="hero-invite-note">For people rebuilding after stroke—and the family beside them.</span>
        </div>

        <p className="hero-note">
          Footage: <a href="https://www.pexels.com/video/a-couple-exercising-at-home-6970144/" target="_blank" rel="noreferrer">Mikhail Nilov / Pexels</a> · Rehyn complements, not replaces, clinical care.
        </p>
      </section>

      <section className="story-section story-intro" id="how-it-helps">
        <div className="story-wrap">
          <div className="story-intro-head">
            <p className="section-kicker">A little more confidence at home</p>
            <h2>Recovery is personal.<br /><em>Practice can feel simpler.</em></h2>
          </div>
          <div className="story-intro-side">
            <p>Rehyn is being designed to make everyday recovery practice feel easier to start, easier to follow, and easier to share with the people who care.</p>
            <a className="text-cta" href="#what-you-get">See what early access includes <ArrowRight size={17} /></a>
          </div>
        </div>

        <div className="story-wrap story-steps">
          <article className="step-card">
            <span className="step-index">01</span>
            <div className="step-card-icon"><Sparkles size={22} /></div>
            <h3>Choose one small step</h3>
            <p>Find a clear, manageable practice to work into your day.</p>
          </article>
          <article className="step-card">
            <span className="step-index">02</span>
            <div className="step-card-icon"><Heart size={22} /></div>
            <h3>Practice with support</h3>
            <p>Bring a family member into the routine for encouragement.</p>
          </article>
          <article className="step-card">
            <span className="step-index">03</span>
            <div className="step-card-icon"><Activity size={22} /></div>
            <h3>Notice the effort</h3>
            <p>Keep track of the work you’re putting in, one day at a time.</p>
          </article>
        </div>
      </section>

      <section className="story-section story-preview" id="what-you-get">
        <div className="story-wrap preview-layout">
          <div className="preview-copy">
            <p className="section-kicker">A clearer view of progress</p>
            <h2>Every practice session<br />counts toward <em>your story.</em></h2>
            <p>Rehyn brings your home practice and progress into one friendly place—so it’s easier to reflect, keep going, and share a win with someone close.</p>
            <ul className="preview-checklist">
              <li><Check size={18} /> Simple activities to explore at home</li>
              <li><Check size={18} /> A gentle record of practice over time</li>
              <li><Check size={18} /> Progress that’s easier to talk about together</li>
            </ul>
            <a className="text-cta" href="#signup">Get a first look at Rehyn <ArrowRight size={17} /></a>
          </div>

          <div className="progress-demo" aria-label="Example of a Rehyn progress view">
            <div className="demo-topline">
              <div>
                <span className="demo-label">YOUR WEEK</span>
                <h3>Showing up matters.</h3>
              </div>
              <span className="demo-spark"><Sparkles size={19} /></span>
            </div>
            <div className="demo-week" aria-label="Example practice activity for seven days">
              {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
                <div className="demo-day" key={`${day}-${index}`}>
                  <span>{day}</span>
                  <b className={index < 4 ? "is-done" : ""}>{index < 4 ? <Check size={16} /> : "·"}</b>
                </div>
              ))}
            </div>
            <div className="demo-progress-row">
              <div className="demo-progress-ring"><span>4</span><small>days</small></div>
              <div className="demo-progress-copy">
                <strong>A steady rhythm</strong>
                <span>Small steps add up over time.</span>
                <div className="demo-progress-bar"><i /></div>
              </div>
            </div>
            <div className="demo-note"><Heart size={17} /><span>Celebrate the effort—not just the outcome.</span></div>
            <p className="demo-disclaimer">Illustrative preview. Final features may change.</p>
          </div>
        </div>
      </section>

      <section className="story-section story-families" id="families">
        <div className="story-wrap">
          <div className="families-heading">
            <p className="section-kicker">Made for the people doing this together</p>
            <h2>One journey.<br /><em>Support for both sides.</em></h2>
          </div>
          <div className="family-cards">
            <article className="family-card patient-card">
              <span className="family-icon"><Activity size={23} /></span>
              <p className="family-label">FOR PEOPLE IN RECOVERY</p>
              <h3>A practice that feels within reach.</h3>
              <p>Clear steps and a calm place to recognize the work you’ve already done.</p>
            </article>
            <article className="family-card caregiver-card">
              <span className="family-icon"><Users size={23} /></span>
              <p className="family-label">FOR FAMILY &amp; CAREGIVERS</p>
              <h3>A way to be part of the progress.</h3>
              <p>Encouragement and shared moments—without taking over the person’s recovery.</p>
            </article>
          </div>
          <div className="family-cta-row">
            <p>Curious what Rehyn could look like for your family?</p>
            <a className="story-button story-button-light" href="#signup">Explore early access <ArrowRight size={17} /></a>
          </div>
        </div>
      </section>

      <section className="story-section story-signup" id="signup">
        <div className="story-wrap signup-layout">
          <div className="signup-copy">
            <p className="section-kicker">Be part of the first look</p>
            <h2>See what a little support<br />can make <em>possible.</em></h2>
            <p>Sign up for updates about Rehyn’s early access: a first look at home-practice tools, a simple progress view, and ideas for bringing family encouragement into the routine.</p>
            <div className="signup-benefit-list">
              <span><Check size={17} /> Early product updates</span>
              <span><Check size={17} /> A preview of the Rehyn experience</span>
              <span><Check size={17} /> No medical details needed</span>
            </div>
          </div>

          <form className="signup-form" onSubmit={handleSubmit}>
            <div className="form-heading">
              <span className="form-icon"><Heart size={20} /></span>
              <div><h3>Get early access updates</h3><p>A few details to get started.</p></div>
            </div>
            <label htmlFor="signup-email">Email address</label>
            <input id="signup-email" name="email" type="email" placeholder="you@example.com" autoComplete="email" required onChange={() => setSubmitted(false)} />
            <label htmlFor="signup-role">I’m interested as</label>
            <select id="signup-role" name="role" defaultValue="">
              <option value="" disabled>Choose one (optional)</option>
              <option value="recovering">Someone in recovery</option>
              <option value="family">A family member or caregiver</option>
              <option value="professional">A health professional</option>
              <option value="other">Just curious</option>
            </select>
            <button className="story-button story-button-primary" type="submit">Request early access <ArrowRight size={17} /></button>
            {submitted && <p className="form-feedback" role="status">Thanks for your interest. This website preview doesn’t send or store your details yet.</p>}
            <p className="form-privacy">Prototype form only—your information stays in this page and is not submitted.</p>
          </form>
        </div>
      </section>

      <footer className="story-footer">
        <div className="story-wrap footer-content">
          <a className="footer-brand" href="#top"><span className="footer-brand-mark"><Activity size={18} /></span> Rehyn</a>
          <p>Small steps. Shared support.</p>
          <span>Rehyn complements, not replaces, clinical care.</span>
        </div>
      </footer>
    </main>
  );
}
