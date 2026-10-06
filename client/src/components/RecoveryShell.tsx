import { type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { isOnboardingLocation } from "@/lib/welcome";
import { loadRememberedAssessment } from "@/lib/assessment";
import { journeyUnlocked } from "@/lib/journey";
import { fastCheckPath } from "@/lib/fast-check";
import { profileInitial, profileName, useProfile } from "@/lib/profile";
import { setDisplayPrefs, useDisplayPrefs } from "@/lib/display-prefs";
import { SettingsButton, useSettings } from "./AccountSettings";
import AccountResetControls from "./AccountResetControls";
import { administrativeControlsEnabled } from "@/lib/administrative-controls";
import HeartRateMark from "./HeartRateMark";
import PlanChangeReminder from "./PlanChangeReminder";
import {
  BookOpen,
  ChevronRight,
  CircleHelp,
  Heart,
  Home as HomeIcon,
  MessageCircle,
  LockKeyhole,
  Plus,
  Sun,
  Users,
} from "lucide-react";

type ViewName = "Home" | "Journey" | "Alira" | "My Time" | "My Community";

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
  { label: "My Community", href: "/community", icon: Users },
];
// The mobile bar's names, where the full names would not fit six across.
const mobileLabel: Partial<Record<ViewName, string>> = { "My Time": "My time", "My Community": "Community" };

export default function RecoveryShell({ active, children, dateLabel = "THURSDAY, 24 SEPTEMBER", className = "", onboarding = false }: RecoveryShellProps) {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const isNewUser = onboarding || isOnboardingLocation(location, search);
  const { largeText, strongContrast } = useDisplayPrefs();
  const setLargeText = (on: boolean) => setDisplayPrefs({ largeText: on });
  const setStrongContrast = (on: boolean) => setDisplayPrefs({ strongContrast: on });
  const openSettings = useSettings();
  const profile = useProfile();

  // The Journey opens once the first movement check has scores and Alira has designed the plan.
  const journeyLocked = !journeyUnlocked(loadRememberedAssessment());

  const go = (href: string) => setLocation(isNewUser && href === "/" ? "/welcome" : isNewUser && href === "/alira" ? "/alira?onboarding=1" : href);
  const openFastCheck = () => setLocation(fastCheckPath(location, search));
  const isLocked = (label: ViewName) => label === "Journey" ? journeyLocked : isNewUser && (label === "My Time" || label === "My Community");
  const navLabel = (label: ViewName) => journeyLocked && label === "Journey" ? "My journey" : isNewUser && label === "My Time" ? "My time" : label === "My Community" ? "My community" : label;

  return (
    <div className={`recovery-shell ${largeText ? "recovery-large-text" : ""} ${strongContrast ? "recovery-strong-contrast" : ""} ${className}`}>
      <aside className="recovery-sidebar" aria-label="Main navigation">
        <button className="recovery-brand" onClick={() => go("/")} aria-label="Go to home">
          <span className="recovery-brand-mark"><HeartRateMark size={25} /></span>
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
        <div className="recovery-sidebar-bottom"><button className="recovery-warning-link" onClick={openFastCheck}>
          <CircleHelp size={19} /><span>Warning signs</span><ChevronRight size={16} />
        </button><SettingsButton /></div>
      </aside>

      <main className="recovery-main">
        <header className="recovery-topbar">
          <div className="settings-mobile-brand-group"><SettingsButton mobile /><button className="recovery-mobile-brand" onClick={() => go("/")} aria-label="Rehyn home"><span><HeartRateMark size={19} /></span><b>Rehyn</b></button></div>
          <div className="recovery-date">{dateLabel}</div>
          <div className="recovery-top-actions">
            {administrativeControlsEnabled() && active === "Home" && <AccountResetControls />}
            <button className={`recovery-utility ${largeText ? "is-on" : ""}`} onClick={() => setLargeText(!largeText)} aria-label={largeText ? "Use standard text" : "Use larger text"} title="Larger text"><b>A</b><Plus size={11} /></button>
            <button className={`recovery-utility ${strongContrast ? "is-on" : ""}`} onClick={() => setStrongContrast(!strongContrast)} aria-label="Toggle stronger contrast" title="Stronger contrast"><Sun size={18} /></button>
            <button className="recovery-profile" aria-label={`${profileName(profile)}'s profile`} aria-haspopup="dialog" onClick={event => openSettings(event.currentTarget)}>{profile.photo ? <img src={profile.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} /> : profileInitial(profile)}</button>
          </div>
        </header>
        {children}
      </main>

      <nav className="recovery-mobile-nav" aria-label="Mobile navigation" style={{ gridTemplateColumns: `repeat(${navigation.length + 1}, minmax(0, 1fr))` }}>
        {navigation.map(({ label, href, icon: Icon }) => (
          <button key={label} className={active === label ? "is-active" : ""} onClick={() => { if (!isLocked(label)) go(href); }} aria-current={active === label ? "page" : undefined} aria-disabled={isLocked(label) || undefined} title={isLocked(label) ? "Available after your first assessment" : undefined}>
            <span className="recovery-mobile-icon"><Icon size={20} />{isLocked(label) && <LockKeyhole className="recovery-nav-lock" size={10} aria-label="Available after your first assessment" />}</span><span>{mobileLabel[label] ?? label}</span>
          </button>
        ))}
        <button className="recovery-help-mobile" onClick={openFastCheck}><CircleHelp size={20} /><span>Help</span></button>
      </nav>

      <PlanChangeReminder />
    </div>
  );
}
