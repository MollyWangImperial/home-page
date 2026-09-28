import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Activity, ChevronRight, FileText, Settings, ShieldCheck, SlidersHorizontal, UserRound, X } from "lucide-react";
import { DATA_SECTIONS } from "@/content/data-permissions";
import { PRIVACY_INTRO, PRIVACY_SECTIONS, TERMS_INTRO, TERMS_SECTIONS, type LegalSection } from "@/content/legal-content";
import "./account-settings.css";

type SettingsView = "profile" | "privacy" | "data" | "terms";
const sections = [
  { id: "profile", label: "Your profile", icon: UserRound },
  { id: "privacy", label: "Privacy Notice", icon: ShieldCheck },
  { id: "data", label: "Data and permissions", icon: SlidersHorizontal },
  { id: "terms", label: "Terms of Use", icon: FileText },
] as const;

const SettingsContext = createContext<((opener: HTMLElement) => void) | null>(null);

export function useSettings() {
  const openSettings = useContext(SettingsContext);
  if (!openSettings) throw new Error("Settings must be used inside SettingsProvider");
  return openSettings;
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
  const title = sections.find(section => section.id === view)!.label;

  function openSettings(source: HTMLElement) {
    opener.current = source;
    setView("profile");
    setOpen(true);
  }

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
              <section key={view} id="account-settings-panel" className="account-settings-panel" aria-labelledby="account-settings-panel-title" tabIndex={0}>
                <h2 id="account-settings-panel-title">{title}</h2>
                {view === "profile" ? <ProfileInformation /> : view === "privacy" ? (
                  <SettingsDocument intro={PRIVACY_INTRO} sections={PRIVACY_SECTIONS} />
                ) : view === "terms" ? (
                  <SettingsDocument intro={TERMS_INTRO} sections={TERMS_SECTIONS} />
                ) : (
                  <SettingsDocument intro="How your information is used and the permissions Rehyn asks for." sections={DATA_SECTIONS} />
                )}
              </section>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </SettingsContext.Provider>
  );
}

function ProfileInformation() {
  return (
    <div className="settings-profile-content">
      <div className="settings-profile-identity">
        <span className="settings-profile-avatar" aria-hidden="true">M</span>
        <div><h3>Molly</h3><span className="settings-demo-label">Demo profile</span></div>
      </div>
      <section className="settings-profile-card" aria-labelledby="settings-details-title">
        <h3 id="settings-details-title">Personal information</h3>
        <dl><div><dt>Name</dt><dd>Molly</dd></div><div><dt>Email address</dt><dd className="settings-empty-value">Not provided</dd></div></dl>
      </section>
      <section className="settings-profile-card" aria-labelledby="settings-care-title">
        <h3 id="settings-care-title">Your support</h3>
        <div className="settings-support-person"><span aria-hidden="true">PT</span><div><b>Dr. Jack</b><p>Your physiotherapist</p></div></div>
        <div className="settings-support-person"><span className="settings-alira-mark" aria-hidden="true"><Activity size={21} /></span><div><b>Alira</b><p>Your recovery companion</p></div></div>
      </section>
    </div>
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
