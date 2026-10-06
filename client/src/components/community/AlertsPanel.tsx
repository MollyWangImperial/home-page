import { useEffect, useId, useState } from "react";
import { Link, useSearch } from "wouter";
import { sampleGroups, type AlertId, type CommunityAlert } from "@/content/community-samples";
import {
  alertsQuiet,
  communityHref,
  communityStore,
  hourLabel,
  leadsHere,
  onBreak,
  useCommunity,
  type AlertEntry,
  type CommunityMemory,
  type CommunityPlace,
} from "@/lib/community-store";
import { alertDetail, alertFace, alertLabel, alertLink, alertOutcome, breakEndLabel, newAlertIds, quietNote, shownAlerts } from "./alerts-helpers";
import CommunityDialog from "./dialog";
import { BellIcon, ChatIcon, CheckIcon, CloseIcon, MoonIcon, NextIcon, PauseCircleIcon, RingIcon, UsersIcon } from "./icons";
import { Cover, Face } from "./parts";

// Alerts: what is new in My community, each one a link to where it happened: a friend request
// opens the Friends drawer at For you, over the view the person is on; group news opens the
// group; the Sunday circle opens the circle. The toolbar's badge counts the alerts not seen yet.
// Opening this panel counts as seeing them, so the badge goes at once; the ones that were new
// stay marked "New" here until it closes. Quiet time and a break keep the badge quiet (the panel
// says why), and the alerts are still here when it opens. Nothing is sent anywhere.

export type AlertsPanelProps = {
  /** Closes the panel. Call it from each alert's link too. */
  onClose: () => void;
  /** The toolbar's Alerts button, which the panel drops down from. Pass it to CommunityDialog. */
  anchor: HTMLElement | null;
  /** The view the person is on, so a friend request opens the Friends drawer over it (`alertHref(alert, over)`). */
  over: CommunityPlace;
  /** Where the focus goes on closing if the Alerts button has gone. Pass it to CommunityDialog. */
  fallbackFocus: () => HTMLElement | null | undefined;
};

/** The picture beside an alert: the person it is about, the group's cover, or the Sunday circle. */
function AlertPicture({ alert, memory }: { alert: CommunityAlert; memory: CommunityMemory }) {
  const who = alertFace(memory, alert);
  if (alert.icon === "circle") {
    return <span className="cm-al-pic cm-al-pic-circle" aria-hidden="true"><RingIcon size={24} /></span>;
  }
  const target = alert.target;
  if (alert.icon === "group" && target.kind === "group") {
    const group = sampleGroups.find(item => item.id === target.group);
    return (
      <span className="cm-al-pic" aria-hidden="true">
        {group ? <Cover cover={group.cover} className="cm-al-cover" /> : <span className="cm-al-pic-plain"><ChatIcon size={22} /></span>}
        {who && <Face who={who} size={26} className="cm-al-pic-face" />}
      </span>
    );
  }
  return (
    <span className="cm-al-pic" aria-hidden="true">
      {who ? <Face who={who} size={48} /> : <span className="cm-al-pic-plain"><BellIcon size={22} /></span>}
      {alert.icon === "friend" && <span className="cm-al-pic-mark"><UsersIcon size={13} strokeWidth={2} /></span>}
    </span>
  );
}

type AlertRowProps = { entry: AlertEntry; isNew: boolean; memory: CommunityMemory; over: CommunityPlace; search: string; onClose: () => void };

/**
 * One alert: a link to where it happened, saying what has happened since if it has been dealt with.
 * An alert about the view already showing only closes the panel, without adding it to Back again.
 */
function AlertRow({ entry, isNew, memory, over, search, onClose }: AlertRowProps) {
  const { alert } = entry;
  const detail = alertDetail(memory, alert);
  const outcome = alertOutcome(memory, alert);
  const href = alertLink(memory, alert, over);
  return (
    <li>
      <Link className={`cm-al-row ${isNew ? "is-new" : ""}`} href={href} replace={leadsHere(href, search)} onClick={onClose} aria-label={alertLabel(alert, detail, isNew, outcome)}>
        <AlertPicture alert={alert} memory={memory} />
        <span className="cm-al-text">
          <span className="cm-al-title">{alert.title}</span>
          {detail && <span className="cm-al-detail">{detail}</span>}
          <span className="cm-al-meta">
            <span>{alert.when}</span>
            {outcome ? (
              <span className={`cm-al-outcome ${outcome.tone === "plain" ? "is-plain" : ""}`}>{outcome.tone === "ok" && <CheckIcon size={12} />}{outcome.label}</span>
            ) : isNew && <span className="cm-al-new">New</span>}
          </span>
        </span>
        <NextIcon size={18} className="cm-al-go" />
      </Link>
    </li>
  );
}

export default function AlertsPanel({ onClose, anchor, over, fallbackFocus }: AlertsPanelProps) {
  const memory = useCommunity();
  const search = useSearch();
  const titleId = useId();
  const newHeadingId = useId();
  const earlierHeadingId = useId();
  // The alerts that were new when the panel opened. Taken once, so they stay marked "New" while
  // the panel is open even though they are marked as seen straight away (and React's double
  // start in development can't lose them).
  const [fresh] = useState<AlertId[]>(() => newAlertIds(memory));
  // Opening the panel counts as seeing them: the badge on the Alerts button goes.
  useEffect(() => { communityStore.markAlertsSeen(fresh); }, [fresh]);

  const entries = shownAlerts(memory);
  const newOnes = entries.filter(entry => fresh.includes(entry.alert.id));
  const earlier = entries.filter(entry => !fresh.includes(entry.alert.id));
  const settings = memory.settings;
  const quiet = alertsQuiet(settings) ? quietNote(settings) : null;
  const breakUntil = onBreak(settings) ? settings.breakUntil : null;
  // "Change" opens Community settings at Quiet times, where quiet time and breaks are set.
  const quietHref = communityHref("settings", null, { section: "quiet" });
  const rows = (list: AlertEntry[], isNew: boolean) => (
    <ul className="cm-al-list">
      {list.map(entry => <AlertRow key={entry.alert.id} entry={entry} isNew={isNew} memory={memory} over={over} search={search} onClose={onClose} />)}
    </ul>
  );

  return (
    <CommunityDialog kind="panel" labelledBy={titleId} onClose={onClose} anchor={anchor} fallbackFocus={fallbackFocus} className="cm-al-panel">
      <div className="cm-dialog-head">
        <span className="cm-round-icon cm-round-icon-small" aria-hidden="true"><BellIcon size={22} /></span>
        <div className="cm-dialog-titles">
          <h2 id={titleId} className="cm-dialog-title cm-dialog-title-small" tabIndex={-1}>Alerts</h2>
          <p>{newOnes.length ? `${newOnes.length} new` : "Nothing new"}</p>
        </div>
        <button type="button" className="cm-dialog-close" aria-label="Close" onClick={onClose}><CloseIcon size={22} /></button>
      </div>

      {quiet && (
        <p className="cm-al-quiet">
          {breakUntil !== null ? <PauseCircleIcon size={20} /> : <MoonIcon size={20} />}
          <span>{quiet}</span>
        </p>
      )}

      <section className="cm-al-section" aria-labelledby={newHeadingId}>
        <h3 id={newHeadingId} className="cm-overline cm-overline-rust">New</h3>
        {newOnes.length > 0 ? rows(newOnes, true) : (
          <p className="cm-al-caught"><CheckIcon size={18} /><span>All caught up. Nothing new since you last looked.</span></p>
        )}
      </section>

      {earlier.length > 0 && (
        <section className="cm-al-section" aria-labelledby={earlierHeadingId}>
          <h3 id={earlierHeadingId} className="cm-overline">Earlier</h3>
          {rows(earlier, false)}
        </section>
      )}

      {/* When the badge stays quiet, and a way to change it. The panel closes as Settings opens. */}
      <Link className="cm-dialog-foot-link cm-al-foot" href={quietHref} replace={leadsHere(quietHref, search)} onClick={onClose}>
        {breakUntil !== null ? <PauseCircleIcon size={22} /> : <MoonIcon size={22} />}
        <span>
          {breakUntil !== null
            ? <><b>On a break</b> until {breakEndLabel(breakUntil)}</>
            : <><b>Quiet time:</b> {hourLabel(settings.quietFrom)} to {hourLabel(settings.quietUntil)}</>}
        </span>
        <span className="cm-dialog-foot-action">Change</span>
      </Link>
    </CommunityDialog>
  );
}
