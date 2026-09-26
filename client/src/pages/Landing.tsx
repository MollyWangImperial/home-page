import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Heart,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";

function EarlyAccessForm({ slot }: { slot: string }) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <div className="early-form-wrap">
      <form className="early-form" onSubmit={submit} aria-label="Early access interest form">
        <label className="sr-only" htmlFor={`early-access-${slot}`}>Email address</label>
        <input
          id={`early-access-${slot}`}
          type="email"
          autoComplete="email"
          placeholder="Your email address"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <button type="submit">Get early access <ArrowRight size={17} /></button>
      </form>
      {submitted ? (
        <p className="form-note form-feedback" role="status">Thanks for your interest. This preview form is not connected, so your email was not sent or saved.</p>
      ) : (
        <p className="form-note"><ShieldCheck size={14} /> Just your email. This preview does not store it.</p>
      )}
    </div>
  );
}

function ProductPreview() {
  return (
    <div className="product-preview" aria-label="Illustrative Rehyn session screen">
      <div className="preview-topline"><span className="preview-status"><i /> YOUR SESSION</span><span>Today</span></div>
      <div className="preview-welcome">Good morning,<br /><strong>Margaret</strong></div>
      <div className="preview-progress-row">
        <div><span className="preview-label">TODAY'S SESSION</span><strong>3 of 4 done</strong><span className="preview-muted">About 6 minutes left</span></div>
        <div className="progress-ring"><span>75%</span></div>
      </div>
      <div className="preview-divider" />
      <div className="preview-exercise"><span className="exercise-check"><CheckCircle2 size={17} /></span><span><b>Reach and return</b><small>Shoulder movement</small></span><span className="exercise-time">2 min</span></div>
      <div className="preview-exercise"><span className="exercise-check"><CheckCircle2 size={17} /></span><span><b>Wrist lifts</b><small>Gentle and steady</small></span><span className="exercise-time">2 min</span></div>
      <div className="preview-exercise"><span className="exercise-open"><Activity size={17} /></span><span><b>Grip and release</b><small>Next in your plan</small></span><ChevronRight size={17} className="exercise-arrow" /></div>
      <div className="preview-encouragement"><span className="encouragement-icon"><Heart size={16} /></span><span>Lovely control on that last set.<br /><b>One more to go.</b></span></div>
      <span className="preview-disclosure">ILLUSTRATIVE PRODUCT PREVIEW</span>
    </div>
  );
}

export default function Landing() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePlayback = () => {
      if (preference.matches) videoRef.current?.pause();
      else void videoRef.current?.play().catch(() => undefined);
    };
    updatePlayback();
    preference.addEventListener?.("change", updatePlayback);
    return () => preference.removeEventListener?.("change", updatePlayback);
  }, []);

  return (
    <div className="landing-shell">
      <header className="landing-header">
        <a href="#top" className="landing-brand" aria-label="Rehyn home"><span className="landing-brand-icon"><Activity size={19} strokeWidth={2.2} /></span><span>Rehyn</span></a>
        <nav className="landing-nav" aria-label="Main navigation">
          <a href="#how">How it works</a>
          <a href="#alira">Alira</a>
          <a href="#clinicians">For clinicians</a>
          <a href="#faq">FAQ</a>
        </nav>
        <a className="header-cta" href="#join">Get early access <ArrowRight size={15} /></a>
      </header>

      <main>
        <section className="landing-hero" id="top" aria-labelledby="landing-title">
          <video
            ref={videoRef}
            className="landing-hero-video"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster="/manus-storage/rehyn-senior-couple-poster_10b43688.jpg"
            aria-hidden="true"
          >
            <source src="/manus-storage/rehyn-senior-couple-hero_318cc964.mp4" type="video/mp4" />
          </video>
          <div className="landing-hero-overlay" />
          <div className="landing-hero-inner">
            <div className="hero-copy-block">
              <div className="hero-announcement"><span className="announcement-dot" /> Early access now open</div>
              <h1 id="landing-title">Stroke recovery,<br /><span>continued at home.</span></h1>
              <p className="hero-description">Rehyn turns a phone camera into a daily rehabilitation partner. Guided sessions, measured progress, and a care team that can see it all.</p>
              <EarlyAccessForm slot="hero" />
              <a className="hero-secondary-link" href="#how">See how Rehyn works <ArrowRight size={16} /></a>
            </div>
            <div className="hero-preview-wrap"><ProductPreview /></div>
          </div>
          <div className="hero-bottom-note"><span><Clock3 size={14} /> At home, at your own pace</span><span className="hero-note-divider" /><span>Made to work with your care team</span></div>
          <a className="scroll-cue" href="#impact" aria-label="Scroll to learn more"><ChevronDown size={19} /></a>
        </section>

        <section className="impact-strip" id="impact" aria-label="Stroke facts">
          <div className="impact-item"><strong>1.4 million</strong><span>stroke survivors live in the UK</span></div>
          <div className="impact-item"><strong>100,000</strong><span>people have a stroke each year in the UK</span></div>
          <div className="impact-item"><strong>3 hours a day</strong><span>total therapy described in UK stroke guidelines*</span></div>
          <p className="impact-source">*Therapy time is individual. Rehyn does not replace clinician advice. Figures: <a href="https://www.stroke.org.uk/stroke/statistics" target="_blank" rel="noreferrer">Stroke Association</a> and <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC12033436/" target="_blank" rel="noreferrer">UK stroke guideline review</a>.</p>
        </section>

        <section className="landing-section how-section" id="how">
          <div className="section-intro">
            <div className="section-kicker"><span /> A little structure, every day</div>
            <h2>Three steps.<br /><em>Every day.</em></h2>
            <p>No wearables or special equipment. Just a phone, a few minutes, and a plan that learns from every session.</p>
          </div>
          <div className="steps-grid">
            <article className="step-card"><div className="step-visual record-visual"><div className="mini-phone"><div className="mini-camera"><span /><i /><i /><i /><b /></div><div className="mini-phone-base" /></div></div><div className="step-label">STEP 1</div><h3>Record</h3><p>Prop up a phone, or ask a family member to hold it, and follow the session.</p></article>
            <article className="step-card"><div className="step-visual measure-visual"><div className="measure-line"><i /><i /><i /><b>Movement<br />captured</b></div><div className="measure-points"><span /><span /><span /><span /></div></div><div className="step-label">STEP 2</div><h3>Measure</h3><p>Rehyn’s AI recognises movement and range of motion during exercises.</p></article>
            <article className="step-card"><div className="step-visual progress-visual"><div className="chart-axis"><i /><i /><i /><i /><i /><b /></div><TrendingUp size={27} /></div><div className="step-label">STEP 3</div><h3>Progress</h3><p>Your progress map adapts to today, and progress is shared with the care team.</p></article>
          </div>
        </section>

        <section className="alira-section" id="alira">
          <div className="alira-story">
            <div className="section-kicker"><span /> Meet Alira</div>
            <h2>A calm, expert voice<br />in every session.</h2>
            <p>Alira guides each exercise, offers feedback as you move, and passes anything important to your care team—always in simple, clear language.</p>
            <ul className="alira-benefits"><li><CheckCircle2 size={17} /> Clear spoken guidance, one step at a time</li><li><CheckCircle2 size={17} /> Encouragement that responds to how you feel</li><li><CheckCircle2 size={17} /> Notes shared with your clinician</li></ul>
            <a className="quiet-link" href="#join">Get to know Rehyn <ArrowRight size={16} /></a>
          </div>
          <div className="alira-chat-card">
            <div className="chat-top"><span className="chat-avatar"><Sparkles size={16} /></span><span><b>Alira</b><small>Here to support you</small></span><i className="chat-presence" /></div>
            <div className="chat-bubble chat-bubble-left">Good morning, Margaret. Today we’ll start with reach and return. Move only when you’re ready.</div>
            <div className="chat-bubble chat-bubble-right">My shoulder feels a little tight.</div>
            <div className="chat-bubble chat-bubble-left">Thanks for telling me. We’ll keep today’s reach comfortable, and I’ll make a note for your therapist.</div>
            <div className="chat-safe-note"><ShieldCheck size={14} /> Alira is a guide, not a medical professional.</div>
          </div>
        </section>

        <section className="clinician-section" id="clinicians">
          <div className="clinician-preview" aria-label="Illustrative patient progress preview">
            <div className="clinician-preview-head"><div><span>PATIENT OVERVIEW</span><b>Last 6 weeks · Margaret</b></div><span className="on-track-pill"><i /> On track</span></div>
            <div className="clinician-stats"><div><span>Sessions</span><b>12</b><small>completed</small></div><div><span>Plan followed</span><b>81%</b><small>this month</small></div><div><span>Range gained</span><b>+18°</b><small>shoulder</small></div></div>
            <div className="chart-wrap"><div className="chart-y-labels"><span>100</span><span>75</span><span>50</span><span>25</span></div><div className="progress-chart"><div className="chart-gridlines"><i /><i /><i /><i /></div><svg viewBox="0 0 500 140" preserveAspectRatio="none" aria-label="Illustrative progress trending upward"><path d="M0,118 C48,106 57,111 95,96 S153,82 190,91 S251,58 294,72 S347,41 385,54 S443,22 500,14" fill="none" stroke="#48785f" strokeWidth="4" strokeLinecap="round"/><path d="M0,118 C48,106 57,111 95,96 S153,82 190,91 S251,58 294,72 S347,41 385,54 S443,22 500,14 V140 H0Z" fill="url(#progress-fill)" opacity=".19"/><defs><linearGradient id="progress-fill" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#4b7d62"/><stop offset="1" stopColor="#4b7d62" stopOpacity="0"/></linearGradient></defs></svg></div></div>
            <div className="chart-months"><span>WEEK 1</span><span>WEEK 2</span><span>WEEK 3</span><span>WEEK 4</span><span>WEEK 5</span><span>WEEK 6</span></div>
            <div className="illustrative-label">Illustrative example</div>
          </div>
          <div className="clinician-copy"><div className="section-kicker"><span /> For clinicians</div><h2>See the weeks<br /><em>between appointments.</em></h2><p>Every home session is logged and measured, so each review starts with objective details—not guesswork.</p><a className="quiet-link" href="#join">Register your interest <ArrowRight size={16} /></a></div>
        </section>

        <section className="who-section">
          <div className="who-heading"><div className="section-kicker"><span /> Support around you</div><h2>Built for everyone<br />in the recovery.</h2></div>
          <div className="audience-grid"><article><span className="audience-icon"><Activity size={20} /></span><h3>Stroke survivors</h3><p>A daily plan built around your movement, guided at your pace in your own home.</p></article><article><span className="audience-icon"><Heart size={20} /></span><h3>Families and carers</h3><p>A simple way to help hold the phone, follow along, and see how progress feels.</p></article><article><span className="audience-icon"><ShieldCheck size={20} /></span><h3>Hospitals and care homes</h3><p>Extend rehabilitation beyond the ward with objective data from home sessions.</p></article></div>
          <a className="center-cta" href="#join">Get early access <ArrowRight size={16} /></a>
        </section>

        <section className="faq-section" id="faq">
          <div className="faq-intro"><div className="section-kicker"><span /> Good to know</div><h2>Questions,<br />answered.</h2><p>Anything else? Write to us at <a href="mailto:hello@rehyn.com">hello@rehyn.com</a>.</p></div>
          <div className="faq-list">
            <details><summary>Does Rehyn replace my therapist?<ChevronDown size={18} /></summary><p>No. Rehyn is designed to support rehabilitation between appointments—not replace your therapist, medical advice, or care plan.</p></details>
            <details><summary>Do I need special equipment?<ChevronDown size={18} /></summary><p>No special wearables are needed. A smartphone camera can guide the session; a family member can help position the phone if needed.</p></details>
            <details><summary>Who can see my information?<ChevronDown size={18} /></summary><p>Your information is intended to be shared with the care team you choose. Exact data and privacy settings will be explained before you use the service.</p></details>
            <details><summary>When will early access begin?<ChevronDown size={18} /></summary><p>We’re preparing an early-access programme. Join the interest list to hear when places become available.</p></details>
            <details><summary>Can my hospital or care home use Rehyn?<ChevronDown size={18} /></summary><p>We’d love to hear from clinicians, hospitals, and care homes interested in piloting home-supported recovery.</p></details>
          </div>
        </section>

        <section className="final-join" id="join">
          <div className="final-join-glow" />
          <div className="section-kicker"><span /> A more supported way forward</div>
          <h2>Be first to use Rehyn.</h2>
          <p>Join the early-access list for stroke survivors, families, clinicians, and care providers.</p>
          <EarlyAccessForm slot="footer" />
        </section>
      </main>

      <footer className="landing-footer">
        <div className="footer-brand"><a href="#top" className="landing-brand"><span className="landing-brand-icon"><Activity size={18} /></span><span>Rehyn</span></a><span>Stroke recovery, continued at home.</span></div>
        <div className="footer-links"><a href="#how">How it works</a><a href="#alira">Alira</a><a href="#clinicians">For clinicians</a><a href="#faq">FAQ</a><a href="mailto:hello@rehyn.com">Contact</a></div>
        <p className="footer-disclaimer">Rehyn is a rehabilitation support tool, not a substitute for professional medical advice or emergency services. Follow the plan from your clinician. If you think someone is having a stroke, call emergency services now.</p>
        <div className="footer-bottom"><span>© 2026 Rehyn. All rights reserved.</span><span>Privacy · Terms</span></div>
      </footer>
    </div>
  );
}
