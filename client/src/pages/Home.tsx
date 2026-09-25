import { useState } from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Hand,
  Heart,
  Home as HomeIcon,
  MessageCircle,
  Minus,
  Plus,
  ShieldCheck,
  Sun,
  TrendingUp,
  X,
} from "lucide-react";

type ModalName = "checkin" | "activity" | "help" | "warning" | "journey" | null;
type NavItem = "Home" | "My journey" | "Alira" | "My time";

const navItems: { name: NavItem; icon: typeof HomeIcon }[] = [
  { name: "Home", icon: HomeIcon },
  { name: "My journey", icon: BookOpen },
  { name: "Alira", icon: MessageCircle },
  { name: "My time", icon: Heart },
];

export default function Home() {
  const [modal, setModal] = useState<ModalName>(null);
  const [selectedFeeling, setSelectedFeeling] = useState("");
  const [checkinDone, setCheckinDone] = useState(false);
  const [activityDone, setActivityDone] = useState(false);
  const [largeText, setLargeText] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [activeNav, setActiveNav] = useState<NavItem>("Home");
  const [notice, setNotice] = useState("");

  function chooseNav(name: NavItem) {
    setActiveNav(name);
    if (name === "Alira") setModal("help");
    else if (name === "My journey") setModal("journey");
    else if (name === "My time") setNotice("Your quiet moment is ready whenever you are.");
    else setNotice("");
  }

  function finishCheckin() {
    if (!selectedFeeling) return;
    setCheckinDone(true);
    setModal(null);
    setNotice("Thank you for checking in. You can take today at your own pace.");
  }

  return (
    <div className={`app-shell ${largeText ? "large-text" : ""} ${highContrast ? "high-contrast" : ""}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <a className="brand-mark" href="#home" aria-label="Steady home" onClick={() => chooseNav("Home")}>
          <span className="brand-symbol"><Activity size={27} strokeWidth={2.4} /></span>
          <span className="brand-name">steady<span>steps</span></span>
        </a>
        <div className="nav-caption">YOUR SPACE</div>
        <nav className="primary-nav">
          {navItems.map(({ name, icon: Icon }) => (
            <button key={name} className={`nav-item ${activeNav === name ? "selected" : ""}`} onClick={() => chooseNav(name)} aria-current={activeNav === name ? "page" : undefined}>
              <Icon size={22} strokeWidth={2.1} /><span>{name}</span>
              {name === "Alira" && <span className="online-dot" aria-label="available" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="warning-link" onClick={() => setModal("warning")}><CircleHelp size={19} /><span>Warning signs</span><ChevronRight size={16} /></button>
        </div>
      </aside>

      <main className="main-area" id="home">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-symbol small"><Activity size={21} /></span><span>steady<span>steps</span></span></div>
          <div className="today-label">THURSDAY, 24 SEPTEMBER</div>
          <div className="top-actions">
            <button className={`utility-button ${largeText ? "toggled" : ""}`} aria-label={largeText ? "Use standard text size" : "Make text larger"} onClick={() => setLargeText(!largeText)} title="Text size"><span className="aa">A</span><Plus size={12} /></button>
            <button className={`utility-button ${highContrast ? "toggled" : ""}`} aria-label="Toggle stronger contrast" onClick={() => setHighContrast(!highContrast)} title="Stronger contrast"><Sun size={19} /></button>
            <button className="profile-chip" aria-label="Molly's profile" onClick={() => setNotice("Welcome back, Molly. Your settings are just as you left them.")}>M</button>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> YOUR RECOVERY SPACE</div>
              <h1>Good afternoon,<br className="mobile-break" /> Molly<span className="title-period">.</span></h1>
              <p className="welcome-copy">Your recovery, at a glance.</p>
            </div>
          </section>

          {notice && <div className="notice-banner" role="status"><CheckCircle2 size={21} /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss message"><X size={18} /></button></div>}

          <div className="dashboard-grid">
            <div className="primary-column">
              <section className="today-card" aria-labelledby="today-title">
                <div className="today-card-top">
                  <div className="today-overline"><span className="status-light" /> NEXT STEP</div>
                </div>
                <div className="today-card-layout">
                  <div className="today-card-copy">
                    <h2 id="today-title">A gentle start<br />for today.</h2>
                    <p className="today-description">Tell us how you’re feeling, and we’ll find a comfortable next step.</p>
                    <button className={`button-primary ${checkinDone ? "button-complete" : ""}`} onClick={() => setModal("checkin")}>
                      {checkinDone ? <><Check size={19} /> Check-in complete</> : <>Begin check-in <ArrowRight size={19} /></>}
                    </button>
                    <div className="time-note"><Clock3 size={16} /> About 1 minute</div>
                  </div>
                  <div className="illustration-panel" aria-label="A seedling growing, representing steady progress" role="img">
                    <img src="/manus-storage/recovery-tech-illustration_23810c9b.png" alt="" />

                  </div>
                </div>
                <div className="step-footer" aria-label="Step 1 of 3"><div className="step-track"><span className="step-filled" /></div><span className="step-number">STEP 1 OF 3</span></div>
              </section>

              <section className="recovery-section" aria-labelledby="recovery-title">
                <div className="section-heading-row"><h2 className="section-title" id="recovery-title">Your progress</h2><button className="text-link" onClick={() => setModal("journey")}>See details <ArrowRight size={17} /></button></div>
                <div className="recovery-cards">
                  <article className="recovery-card reach-card"><div className="recovery-card-head"><span className="recovery-icon"><TrendingUp size={20} /></span><span className="mini-status"><span /> Building</span></div><h3>Reaching</h3><div className="progress-track" role="progressbar" aria-label="Reaching practice" aria-valuemin={0} aria-valuemax={100} aria-valuenow={58}><span style={{ width: "58%" }} /></div></article>
                  <article className="recovery-card hand-card"><div className="recovery-card-head"><span className="recovery-icon"><Hand size={21} /></span><span className="mini-status"><span /> Building</span></div><h3>Hand control</h3><div className="progress-track" role="progressbar" aria-label="Hand control practice" aria-valuemin={0} aria-valuemax={100} aria-valuenow={44}><span style={{ width: "44%" }} /></div></article>
                  <article className="recovery-card walk-card"><div className="recovery-card-head"><span className="recovery-icon"><Activity size={21} /></span><span className="mini-status"><span /> Steady</span></div><h3>Moving about</h3><div className="progress-track" role="progressbar" aria-label="Moving about practice" aria-valuemin={0} aria-valuemax={100} aria-valuenow={72}><span style={{ width: "72%" }} /></div></article>
                </div>
              </section>
            </div>

            <aside className="side-column" aria-label="Your support">
              <section className="support-card">
                <div className="support-header"><div className="alira-avatar"><MessageCircle size={21} /></div><div><h2>Alira</h2><span className="availability"><i /> Available to help</span></div></div>
                <p>Questions about your plan? I can help.</p>
                <button className="support-button" onClick={() => setModal("help")}>Talk with Alira <ArrowRight size={17} /></button>
                <div className="support-trust"><ShieldCheck size={15} /> Your conversations stay private</div>
              </section>

              <section className="week-card">
                <div className="card-heading"><h2>This week</h2></div>
                <div className="week-days" aria-label="Practice completed Monday, Tuesday, and Wednesday. Today is Thursday."><div className="day-cell"><span>M</span><b className="day-done">✓</b></div><div className="day-cell"><span>T</span><b className="day-done">✓</b></div><div className="day-cell"><span>W</span><b className="day-done">✓</b></div><div className="day-cell today-day"><span>T</span><b>24</b></div><div className="day-cell"><span>F</span><b>25</b></div><div className="day-cell"><span>S</span><b>26</b></div><div className="day-cell"><span>S</span><b>27</b></div></div>
              </section>

              <section className="activity-card">
                <div className="activity-top"><span className="eyebrow small-eyebrow">OPTIONAL ACTIVITY</span><span className="activity-duration"><Clock3 size={14} /> 5 MIN</span></div>
                <div className="activity-visual"><span className="activity-icon"><Hand size={23} /></span></div>
                <h2>Hand stretch</h2><p>Try a slow, comfortable hand stretch.</p>
                <button className={`activity-button ${activityDone ? "activity-finished" : ""}`} onClick={() => setModal("activity")}>{activityDone ? <><CheckCircle2 size={17} /> Done for today</> : <>See the activity <ChevronRight size={18} /></>}</button>
              </section>
            </aside>
          </div>

          <footer className="page-footer"><span>This is a demo with sample information. It is not connected to care records.</span></footer>
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">{navItems.map(({ name, icon: Icon }) => <button key={name} className={activeNav === name ? "mobile-selected" : ""} onClick={() => chooseNav(name)}><Icon size={21} /><span>{name === "My journey" ? "Journey" : name === "My time" ? "My time" : name}</span></button>)}<button onClick={() => setModal("warning")}><CircleHelp size={21} /><span>Help</span></button></nav>

      {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
        <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
          <button className="dialog-close" onClick={() => setModal(null)} aria-label="Close dialog"><X size={21} /></button>
          {modal === "checkin" && <>
            <div className="dialog-eyebrow"><span className="live-pulse" /> STEP 1 OF 3</div>
            <div className="dialog-progress"><span /><i /><i /></div>
            <h2 id="dialog-title">How are you feeling today?</h2>
            <p className="dialog-subtitle">There’s no wrong answer. Take your time.</p>
            <div className="feeling-options" role="radiogroup" aria-label="How are you feeling?">{[{ value: "good", face: "☺", label: "Good" }, { value: "tired", face: "☻", label: "A little tired" }, { value: "unsure", face: "◡", label: "Not sure" }].map((item) => <button key={item.value} className={`feeling-option ${selectedFeeling === item.value ? "feeling-selected" : ""}`} role="radio" aria-checked={selectedFeeling === item.value} onClick={() => setSelectedFeeling(item.value)}><span>{item.face}</span><b>{item.label}</b>{selectedFeeling === item.value && <CheckCircle2 size={20} />}</button>)}</div>
            <button className="button-primary dialog-primary" disabled={!selectedFeeling} onClick={finishCheckin}>Continue <ArrowRight size={19} /></button>
            <button className="dialog-help-link" onClick={() => setModal("help")}>I’d like a little help</button>
          </>}
          {modal === "activity" && <>
            <div className="dialog-icon mint-icon"><Hand size={25} /></div><div className="dialog-eyebrow">A GENTLE PRACTICE · ABOUT 5 MINUTES</div><h2 id="dialog-title">Let’s try a hand stretch.</h2><p className="dialog-subtitle">Find a comfortable position. Move only in a way that feels safe and comfortable for you. Your care team’s advice comes first.</p>
            <div className="activity-instructions"><span>1</span><p>Rest your hand somewhere supported.</p><span>2</span><p>Slowly open and relax your fingers, if comfortable.</p><span>3</span><p>Pause whenever you need. There’s no need to rush.</p></div>
            <button className="button-primary dialog-primary" onClick={() => { setActivityDone(true); setModal(null); setNotice("Lovely work, Molly. Thank you for taking a moment for yourself."); }}>Finish practice <Check size={19} /></button><button className="dialog-help-link" onClick={() => setModal(null)}>Maybe another time</button>
          </>}
          {modal === "help" && <>
            <div className="dialog-icon dark-icon"><MessageCircle size={24} /></div><div className="dialog-eyebrow">YOUR FRIENDLY GUIDE</div><h2 id="dialog-title">Hi Molly, I’m here.</h2><p className="dialog-subtitle">You can take a breath, ask for help, or choose what would feel useful right now.</p><div className="help-choices"><button onClick={() => { setModal(null); setNotice("Remember, Molly: small steps are still progress. You’re doing your best."); }}><Heart size={20} /><span><b>I could use encouragement</b><small>A kind reminder for today</small></span><ChevronRight size={18} /></button><button onClick={() => { setModal(null); setNotice("Your hand practice is about 5 minutes. You can start whenever it feels right."); }}><CircleHelp size={20} /><span><b>Help me with my plan</b><small>See what’s next, without any rush</small></span><ChevronRight size={18} /></button><button onClick={() => setModal("warning")}><ShieldCheck size={20} /><span><b>I need urgent help</b><small>Find important safety information</small></span><ChevronRight size={18} /></button></div><p className="help-disclaimer">Alira is a friendly guide, not a medical professional.</p>
          </>}
          {modal === "warning" && <>
            <div className="dialog-icon warning-icon"><CircleHelp size={24} /></div><div className="dialog-eyebrow warning-text">IMPORTANT SAFETY INFORMATION</div><h2 id="dialog-title">Know the signs. Act fast.</h2><p className="dialog-subtitle">If someone may be having a stroke, call your local emergency number right away. Do not wait for symptoms to pass.</p><div className="warning-list"><p><b>Face:</b> Is one side drooping?</p><p><b>Arms:</b> Is one arm weak or numb?</p><p><b>Speech:</b> Is speech slurred or hard to understand?</p><p><b>Time:</b> Call emergency services immediately.</p></div><div className="emergency-note"><ShieldCheck size={18} /> This dashboard is not an emergency service.</div><button className="button-primary dialog-primary" onClick={() => setModal(null)}>I understand <Check size={18} /></button>
          </>}
          {modal === "journey" && <>
            <div className="dialog-icon mint-icon"><TrendingUp size={24} /></div><div className="dialog-eyebrow">YOUR JOURNEY, YOUR PACE</div><h2 id="dialog-title">Every bit counts.</h2><p className="dialog-subtitle">Here’s a gentle look at your week. These are practice moments, not a measure of your worth.</p><div className="journey-stats"><div><span>THIS WEEK</span><b>3 days</b><small>You made time for yourself</small></div><div><span>YOUR NEXT REVIEW</span><b>8 October</b><small>With your care team</small></div></div><div className="journey-note"><Heart size={19} /><span>Rest days are part of your recovery too.</span></div><button className="button-primary dialog-primary" onClick={() => setModal(null)}>Back to today <ArrowRight size={18} /></button>
          </>}
        </section>
      </div>}
    </div>
  );
}
