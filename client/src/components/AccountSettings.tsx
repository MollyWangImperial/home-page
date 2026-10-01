import { useContext, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronRight, Dumbbell, FileText, MessagesSquare, Sparkles, Sprout, Settings, ShieldCheck, SlidersHorizontal, UserRound, X } from "lucide-react";
import { useLocation } from "wouter";
import { DATA_SECTIONS } from "@/content/data-permissions";
import { PRIVACY_INTRO, PRIVACY_SECTIONS, TERMS_INTRO, TERMS_SECTIONS, type LegalSection } from "@/content/legal-content";
import { ExerciseLabPanel } from "./ExerciseLab";
import { MollyProgressPanel } from "./MollyProgress";
import { HowItWorksPanel } from "./HowItWorks";
import { AliraLearningPanel } from "./AliraLearning";
import { AliraLearningConsent } from "./AliraLearningConsent";
import { ProfileInformation } from "./ProfileInformation";
import { SettingsContext, type OpenSettings, type SettingsView } from "./settings-context";
import "./account-settings.css";

export type { SettingsView } from "./settings-context";
const sections = [
  { id: "profile", label: "Your profile", icon: UserRound },
  { id: "exercise", label: "Exercise engine (for Molly only)", icon: Dumbbell },
  { id: "molly", label: "For Zak: Molly's Progress", title: "Molly's Progress", icon: Sprout },
  { id: "howitworks", label: "For Zak: How Alira works", title: "Questions about Alira", icon: MessagesSquare },
  { id: "learning", label: "Alira's Learning", icon: Sparkles },
  { id: "privacy", label: "Privacy Notice", icon: ShieldCheck },
  { id: "data", label: "Data and permissions", icon: SlidersHorizontal },
  { id: "terms", label: "Terms of Use", icon: FileText },
] as const;

export function useSettings() {
  const openSettings = useContext(SettingsContext);
  if (!openSettings) throw new Error("Settings must be used inside SettingsProvider");
  return openSettings;
}

/** For pages that can also render on their own (Alira, in tests): null outside SettingsProvider. */
export function useOptionalSettings(): OpenSettings | null {
  return useContext(SettingsContext);
}

export function SettingsButton({ mobile = false }: { mobile?: boolean }) {
  const openSettings = useSettings();
  return (
    <button className={`settings-launcher ${mobile ? "settings-launcher-mobile" : "settings-launcher-sidebar"}`} aria-label="Open settings" aria-haspopup="dialog" title="Settings" onClick={event => openSettings(event.currentTarget)}>
      <Settings size={21} aria-hidden="true" />
      {!mobile && <><span>Settings</span><ChevronRight size={16} aria-hidden="true" /></>}
    </button>
  );
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<SettingsView>("profile");
  const opener = useRef<HTMLElement | null>(null);
  const [, navigate] = useLocation();
  const section = sections.find(section => section.id === view)!;
  const title = "title" in section ? section.title : section.label;

  const openSettings: OpenSettings = (source, nextView = "profile") => {
    opener.current = source;
    setView(nextView);
    setOpen(true);
  };

  return (
    <SettingsContext.Provider value={openSettings}>
      {children}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="account-settings-backdrop" />
          <Dialog.Content className="account-settings-dialog" aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus(); }}>
            <header className="account-settings-header">
              <span className="account-settings-mark"><Settings size={22} aria-hidden="true" /></span>
              <Dialog.Title>Settings</Dialog.Title>
              <Dialog.Close className="account-settings-close" aria-label="Close settings"><X size={21} /></Dialog.Close>
            </header>
            <div className="account-settings-layout">
              <nav className="account-settings-nav" aria-label="Settings sections">
                {sections.map(({ id, label, icon: Icon }) => (
                  <button key={id} aria-pressed={view === id} aria-controls="account-settings-panel" onClick={() => setView(id)}>
                    <Icon size={19} aria-hidden="true" /><span>{label}</span><ChevronRight size={15} aria-hidden="true" />
                  </button>
                ))}
              </nav>
              <section key={view} id="account-settings-panel" className={`account-settings-panel${view === "molly" || view === "howitworks" || view === "learning" ? " account-settings-panel-chat" : ""}`} aria-labelledby="account-settings-panel-title" tabIndex={0}>
                <h2 id="account-settings-panel-title">{title}</h2>
                {view === "profile" ? <ProfileInformation /> : view === "exercise" ? (
                  <ExerciseLabPanel onLaunch={path => { setOpen(false); navigate(path); }} />
                ) : view === "molly" ? (
                  <MollyProgressPanel onOpenExercises={() => setView("exercise")} />
                ) : view === "howitworks" ? (
                  <HowItWorksPanel />
                ) : view === "learning" ? (
                  <AliraLearningPanel onOpenData={() => setView("data")} />
                ) : view === "privacy" ? (
                  <SettingsDocument intro={PRIVACY_INTRO} sections={PRIVACY_SECTIONS} />
                ) : view === "terms" ? (
                  <SettingsDocument intro={TERMS_INTRO} sections={TERMS_SECTIONS} />
                ) : (
                  <>
                    <AliraLearningConsent />
                    <SettingsDocument intro="How your information is used and the permissions Rehyn asks for." sections={DATA_SECTIONS} />
                  </>
                )}
              </section>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </SettingsContext.Provider>
  );
}

function SettingsDocument({ intro, sections }: { intro: string; sections: LegalSection[] }) {
  const headings = useRef<(HTMLHeadingElement | null)[]>([]);
  return (
    <article className="settings-document">
      <p className="settings-document-intro">{intro}</p>
      <label className="settings-section-jump">Jump to a section
        <select defaultValue="" onChange={event => {
          const heading = headings.current[Number(event.currentTarget.value)];
          heading?.scrollIntoView({ block: "start" });
          heading?.focus({ preventScroll: true });
        }}>
          <option value="" disabled>Choose a section</option>
          {sections.map((section, index) => <option key={section.title} value={index}>{section.title}</option>)}
        </select>
      </label>
      {sections.map((section, index) => (
        <section className="settings-document-section" key={section.title}>
          <h3 tabIndex={-1} ref={element => { headings.current[index] = element; }}>{section.title}</h3>
          {section.paragraphs.map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
          {section.bullets && <ul>{section.bullets.map(bullet => <li key={bullet}>{bullet}</li>)}</ul>}
        </section>
      ))}
    </article>
  );
}
