import type { RefObject } from "react";
import { Link, useSearch } from "wouter";
import {
  alertsQuiet,
  communityHref,
  friendsHref,
  hourLabel,
  inQuietHours,
  leadsHere,
  pendingRequestCount,
  placeOf,
  unreadCount,
  unseenAlertCount,
  useCommunity,
  type CommunitySpace,
  type CommunityView,
} from "@/lib/community-store";
import { BellIcon, SearchIcon, ShieldIcon, SlidersIcon, UsersIcon } from "./icons";
import { LiveDot } from "./parts";

/**
 * The tab row on every view: the feed, and the three spaces beside it. Settings and Safety leave
 * every tab unpressed. A tab for the view already showing doesn't add it to Back again.
 */
function SpaceTabs({ space, here, unread }: { space: CommunitySpace; here: number; unread: number }) {
  const search = useSearch();
  const tab = (target: CommunitySpace) => ({
    href: communityHref(target),
    replace: leadsHere(communityHref(target), search),
    className: `cm-tab ${space === target ? "is-active" : ""}`,
    "aria-current": space === target ? ("page" as const) : undefined,
  });
  return (
    <nav className="cm-tabs" aria-label="Community spaces">
      <Link {...tab("feed")}>Feed</Link>
      <Link {...tab("lounge")}>
        <LiveDot /><span>The lounge</span>{" "}<span className="cm-tab-note cm-tab-note-rust">{here} in</span>
      </Link>
      <Link {...tab("circle")}>
        <LiveDot tone="amber" /><span>Sunday circle</span>{" "}<span className="cm-tab-note cm-tab-note-amber">open</span>
      </Link>
      <Link {...tab("groups")}>
        <span>My groups</span>
        {unread > 0 && space !== "groups" && <span className="cm-badge"><span aria-hidden="true">{unread}</span><span className="cm-sr">{`, ${unread} unread`}</span></span>}
      </Link>
    </nav>
  );
}

/** A small count on a toolbar button. The button's own label says it in words. */
const ToolBadge = ({ count }: { count: number }) => (count > 0 ? <span className="cm-tool-badge cm-pop" aria-hidden="true">{count}</span> : null);

export type CommunityHeaderProps = {
  view: CommunityView;
  /** How many are in the lounge, for its tab. */
  here: number;
  findOpen: boolean;
  alertsOpen: boolean;
  onFind: () => void;
  onAlerts: () => void;
  findButton: RefObject<HTMLButtonElement | null>;
  alertsButton: RefObject<HTMLButtonElement | null>;
};

/**
 * The community header from the F4 to F6 designs: the three-circle mark beside "My community",
 * a toolbar of labelled buttons (Find, Alerts, Friends, Safety, Settings) and the tab row.
 * Find and Alerts open panels on this page; Friends opens the drawer over the current view;
 * Safety and Settings are pages of their own. Each one that opens a page is a link.
 */
export default function CommunityHeader({ view, here, findOpen, alertsOpen, onFind, onAlerts, findButton, alertsButton }: CommunityHeaderProps) {
  const memory = useCommunity();
  const search = useSearch();
  const settings = memory.settings;
  const requests = pendingRequestCount(memory);
  const fresh = unseenAlertCount(memory);
  const quiet = alertsQuiet(settings);
  const alertsLabel = quiet
    ? `Alerts, quiet ${inQuietHours(settings) ? `until ${hourLabel(settings.quietUntil)}` : "during your break"}`
    : `Alerts, ${fresh > 0 ? `${fresh} new` : "nothing new"}`;
  const friendsOpen = view.panel === "friends";
  const tool = (on: boolean) => `cm-tool ${on ? "is-on" : ""}`;

  return (
    <header className="cm-head">
      <div className="cm-head-row">
        <div className="cm-brand">
          <span className="cm-mark" aria-hidden="true"><i /><i /><i /></span>
          <h1 className="cm-title" tabIndex={-1} data-page-heading>My community</h1>
        </div>
        <div className="cm-tools" role="group" aria-label="Community tools">
          <button ref={findButton} type="button" className={tool(findOpen)} aria-label="Find people or groups" aria-haspopup="dialog" aria-expanded={findOpen} onClick={onFind} data-cm-tool="find">
            <span className="cm-tool-icon"><SearchIcon size={22} /></span><span className="cm-tool-label">Find</span>
          </button>
          <button ref={alertsButton} type="button" className={tool(alertsOpen)} aria-label={alertsLabel} aria-haspopup="dialog" aria-expanded={alertsOpen} onClick={onAlerts} data-cm-tool="alerts">
            <span className="cm-tool-icon"><BellIcon size={22} />{!quiet && <ToolBadge count={fresh} />}</span><span className="cm-tool-label">Alerts</span>
          </button>
          <Link href={friendsHref(null, placeOf(view))} className={tool(friendsOpen)} aria-label={`Friends and requests${requests > 0 ? `, ${requests} waiting` : ""}`} aria-haspopup="dialog" data-cm-tool="friends">
            <span className="cm-tool-icon"><UsersIcon size={22} /><ToolBadge count={requests} /></span><span className="cm-tool-label">Friends</span>
          </Link>
          <Link href={communityHref("safety")} replace={leadsHere(communityHref("safety"), search)} className={tool(view.space === "safety")} aria-label="Safety" aria-current={view.space === "safety" ? "page" : undefined} data-cm-tool="safety">
            <span className="cm-tool-icon"><ShieldIcon size={22} /></span><span className="cm-tool-label">Safety</span>
          </Link>
          <Link href={communityHref("settings")} replace={leadsHere(communityHref("settings"), search)} className={tool(view.space === "settings")} aria-label="Community settings" aria-current={view.space === "settings" ? "page" : undefined} data-cm-tool="settings">
            <span className="cm-tool-icon"><SlidersIcon size={22} /></span><span className="cm-tool-label">Settings</span>
          </Link>
        </div>
      </div>
      <SpaceTabs space={view.space} here={here} unread={unreadCount(memory)} />
    </header>
  );
}
