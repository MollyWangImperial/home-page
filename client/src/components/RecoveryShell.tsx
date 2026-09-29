import { useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { isOnboardingLocation } from "@/lib/welcome";
import { SettingsButton, useSettings } from "./AccountSettings";
import {
  Activity,
  BookOpen,
  ChevronRight,
  CircleHelp,
  Heart,
  Home as HomeIcon,
  MessageCircle,
  LockKeyhole,
  Plus,
  Sun,
  X,
} from "lucide-react";

type ViewName = "Home" | "Journey" | "Alira" | "My Time";

type RecoveryShellProps = {
  active: ViewName;
  children: ReactNode;
  dateLabel?: string;
  className?: string;
  onboarding?: boolean;
};

const navigation: { label: ViewName; href: string; icon: typeof HomeIcon }[] = [
  { label: "Home", href: "/", icon: HomeIcon },
  { label: "Journey", href: "/journey", icon: BookOpen },
  { label: "Alira", href: "/alira", icon: MessageCircle },
  { label: "My Time", href: "/my-time", icon: Heart },
];

export default function RecoveryShell({ active, children, dateLabel = "THURSDAY, 24 SEPTEMBER", className = "", onboarding = false }: RecoveryShellProps) {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const isNewUser = onboarding || isOnboardingLocation(location, search);
  const [largeText, setLargeText] = useState(false);
  const [strongContrast, setStrongContrast] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const openSettings = useSettings();

  const go = (href: string) => setLocation(isNewUser && href === "/" ? "/welcome" : isNewUser && href === "/alira" ? "/alira?onboarding=1" : href);
  const isLocked = (label: ViewName) => isNewUser && (label === "Journey" || label === "My Time");
  const navLabel = (label: ViewName) => isNewUser && label === "Journey" ? "My journey" : isNewUser && label === "My Time" ? "My time" : label;

  return (
    <div className={`recovery-shell ${largeText ? "recovery-large-text" : ""} ${strongContrast ? "recovery-strong-contrast" : ""} ${className}`}>
      <aside className="recovery-sidebar" aria-label="Main navigation">
        <button className="recovery-brand" onClick={() => go("/")} aria-label="Go to home">
          <span className="recovery-brand-mark"><Activity size={25} strokeWidth={2.35} /></span>
          <span className="recovery-brand-name">Rehyn</span>
        </button>
        <div className="recovery-nav-caption">YOUR SPACE</div>
        <nav className="recovery-nav">
          {navigation.map(({ label, href, icon: Icon }) => (
            <button key={label} className={`recovery-nav-link ${active === label ? "is-active" : ""}`} onClick={() => { if (!isLocked(label)) go(href); }} aria-current={active === label ? "page" : undefined} aria-disabled={isLocked(label) || undefined} title={isLocked(label) ? "Available after your first assessment" : undefined}>
              <Icon size={21} strokeWidth={2.1} />
              <span>{navLabel(label)}</span>
              {isLocked(label) && <LockKeyhole className="recovery-nav-lock" size={14} aria-label="Available after your first assessment" />}
              {label === "Alira" && <i className="recovery-online" aria-label="Alira is available" />}
            </button>
          ))}
        </nav>
        <div className="recovery-sidebar-bottom"><button className="recovery-warning-link" onClick={() => setShowWarning(true)}>
          <CircleHelp size={19} /><span>Warning signs</span><ChevronRight size={16} />
        </button><SettingsButton /></div>
      </aside>

      <main className="recovery-main">
        <header className="recovery-topbar">
          <div className="settings-mobile-brand-group"><SettingsButton mobile /><button className="recovery-mobile-brand" onClick={() => go("/")} aria-label="Rehyn home"><span><Activity size={19} /></span><b>Rehyn</b></button></div>
          <div className="recovery-date">{dateLabel}</div>
          <div className="recovery-top-actions">
            <button className={`recovery-utility ${largeText ? "is-on" : ""}`} onClick={() => setLargeText(!largeText)} aria-label={largeText ? "Use standard text" : "Use larger text"} title="Larger text"><b>A</b><Plus size={11} /></button>
            <button className={`recovery-utility ${strongContrast ? "is-on" : ""}`} onClick={() => setStrongContrast(!strongContrast)} aria-label="Toggle stronger contrast" title="Stronger contrast"><Sun size={18} /></button>
            <button className="recovery-profile" aria-label="Zak's profile" aria-haspopup="dialog" onClick={event => openSettings(event.currentTarget)}>Z</button>
          </div>
        </header>
        {children}
      </main>

      <nav className="recovery-mobile-nav" aria-label="Mobile navigation">
        {navigation.map(({ label, href, icon: Icon }) => (
          <button key={label} className={active === label ? "is-active" : ""} onClick={() => { if (!isLocked(label)) go(href); }} aria-current={active === label ? "page" : undefined} aria-disabled={isLocked(label) || undefined} title={isLocked(label) ? "Available after your first assessment" : undefined}>
            <span className="recovery-mobile-icon"><Icon size={20} />{isLocked(label) && <LockKeyhole className="recovery-nav-lock" size={10} aria-label="Available after your first assessment" />}</span><span>{label === "My Time" ? "My time" : label}</span>
          </button>
        ))}
        <button className="recovery-help-mobile" onClick={() => setShowWarning(true)}><CircleHelp size={20} /><span>Help</span></button>
      </nav>

      {showWarning && <div className="recovery-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowWarning(false); }}>
        <section className="recovery-safety-dialog" role="dialog" aria-modal="true" aria-labelledby="safety-title">
          <button className="recovery-dialog-close" onClick={() => setShowWarning(false)} aria-label="Close warning signs"><X size={20} /></button>
          <span className="recovery-dialog-icon"><CircleHelp size={23} /></span>
          <span className="recovery-overline">IMPORTANT SAFETY INFORMATION</span>
          <h2 id="safety-title">Know the signs. Act fast.</h2>
          <p>If someone may be having a stroke, call your local emergency number right away. Do not wait for symptoms to pass.</p>
          <div className="recovery-fast-list"><p><b>Face:</b> Is one side drooping?</p><p><b>Arms:</b> Is one arm weak or numb?</p><p><b>Speech:</b> Is speech slurred or hard to understand?</p><p><b>Time:</b> Call emergency services immediately.</p></div>
          <button className="recovery-primary-button" onClick={() => setShowWarning(false)}>I understand</button>
        </section>
      </div>}
    </div>
  );
}
