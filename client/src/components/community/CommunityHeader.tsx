import type { RefObject } from "react";
import { Link, useSearch } from "wouter";
import {
  alertsQuiet,
  communityHref,
  friendList,
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
import { myGroups } from "./group-model";
import { BellIcon, SearchIcon, ShieldIcon, SlidersIcon, UsersIcon } from "./icons";
import { unreadMessages } from "./messages-model";
import { LiveDot } from "./parts";

/** A count on a tab. The tab's own words say it too, for a screen reader. */
const TabBadge = ({ count, what }: { count: number; what: string }) => (count > 0 ? <span className="cm-badge"><span aria-hidden="true">{count}</span><span className="cm-sr">{`, ${count} ${what}`}</span></span> : null);

/**
 * The tab row on every view: the feed, the lounge, the Sunday circle, groups, messages and friends.
 * Settings and Safety leave every tab unpressed. A tab for the view already showing doesn't add it
 * to Back again.
 */
function SpaceTabs({ space, here }: { space: CommunitySpace; here: number }) {
  const search = useSearch();
  const memory = useCommunity();
  const unread = unreadCount(memory);
  const messages = unreadMessages(memory);
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
        <LiveDot /><span>The lounge</span>{" "}<span className="cm-tab-note cm-tab-note-rust">{here} here</span>
      </Link>
      <Link {...tab("circle")}>
        <span>Sunday circle</span>{" "}<span className="cm-tab-note cm-tab-note-gold">Live now</span>
      </Link>
      <Link {...tab("groups")}>
        <span>Groups</span>
        {space !== "groups" && <TabBadge count={unread} what="unread" />}
      </Link>
      <Link {...tab("messages")}>
        <span>Messages</span>
        <TabBadge count={messages} what="unread" />
      </Link>
      <Link {...tab("friends")}>Friends</Link>
    </nav>
  );
}

/** A small count on a toolbar button. The button's own label says it in words. */
const ToolBadge = ({ count }: { count: number }) => (count > 0 ? <span className="cm-tool-badge cm-pop" aria-hidden="true">{count}</span> : null);

/** The line drawn faintly across the header: hills, or a pulse, rising out of the tab row. */
function HeaderArt() {
  return (
    <svg className="cm-head-art" viewBox="0 0 1200 260" preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false">
      <path d="M0 172H600L700 38 812 252 884 92 952 172H1200" vectorEffect="non-scaling-stroke" />
      <path d="M560 172 700 38" vectorEffect="non-scaling-stroke" opacity=".5" />
    </svg>
  );
}

export type CommunityHeaderProps = {
  view: CommunityView;
  /** How many are in the lounge, for its tab and the line under the title. */
  here: number;
  findOpen: boolean;
  alertsOpen: boolean;
  onFind: () => void;
  onAlerts: () => void;
  findButton: RefObject<HTMLButtonElement | null>;
  alertsButton: RefObject<HTMLButtonElement | null>;
};

/**
 * The community header: a deep green band with "My community", how many friends, groups and people
 * in the lounge there are, a toolbar of labelled buttons (Search, Alerts, Friends, Safety, Settings)
 * and the tab row. Search and Alerts open panels on this page; Friends opens the drawer over the
 * current view; Safety and Settings are pages of their own. Each one that opens a page is a link.
 */
export default function CommunityHeader({ view, here, findOpen, alertsOpen, onFind, onAlerts, findButton, alertsButton }: CommunityHeaderProps) {
  const memory = useCommunity();
  const search = useSearch();
  const settings = memory.settings;
  const requests = pendingRequestCount(memory);
  const fresh = unseenAlertCount(memory);
  const quiet = alertsQuiet(settings);
  const friends = friendList(memory).length;
  const groups = myGroups(memory).length;
  const alertsLabel = quiet
    ? `Alerts, quiet ${inQuietHours(settings) ? `until ${hourLabel(settings.quietUntil)}` : "during your break"}`
    : `Alerts, ${fresh > 0 ? `${fresh} new` : "nothing new"}`;
  const friendsOpen = view.panel === "friends";
  const tool = (on: boolean) => `cm-tool ${on ? "is-on" : ""}`;

  return (
    <header className="cm-head">
      <HeaderArt />
      <div className="cm-head-row">
        <div className="cm-head-titles">
          <h1 className="cm-title" tabIndex={-1} data-page-heading>My community</h1>
          <p className="cm-head-sub">{`${friends} ${friends === 1 ? "friend" : "friends"} · ${groups} ${groups === 1 ? "group" : "groups"} · ${here} people in the lounge now`}</p>
        </div>
        <div className="cm-tools" role="group" aria-label="Community tools">
          <button ref={findButton} type="button" className={tool(findOpen)} aria-label="Search people or groups" aria-haspopup="dialog" aria-expanded={findOpen} onClick={onFind} data-cm-tool="find">
            <span className="cm-tool-icon"><SearchIcon size={20} /></span><span className="cm-tool-label">Search</span>
          </button>
          <button ref={alertsButton} type="button" className={tool(alertsOpen)} aria-label={alertsLabel} aria-haspopup="dialog" aria-expanded={alertsOpen} onClick={onAlerts} data-cm-tool="alerts">
            <span className="cm-tool-icon"><BellIcon size={20} />{!quiet && <ToolBadge count={fresh} />}</span><span className="cm-tool-label">Alerts</span>
          </button>
          <Link href={friendsHref(null, placeOf(view))} className={tool(friendsOpen)} aria-label={`Friends and requests${requests > 0 ? `, ${requests} waiting` : ""}`} aria-haspopup="dialog" data-cm-tool="friends">
            <span className="cm-tool-icon"><UsersIcon size={20} /><ToolBadge count={requests} /></span><span className="cm-tool-label">Friends</span>
          </Link>
          <Link href={communityHref("safety")} replace={leadsHere(communityHref("safety"), search)} className={tool(view.space === "safety")} aria-label="Safety" aria-current={view.space === "safety" ? "page" : undefined} data-cm-tool="safety">
            <span className="cm-tool-icon"><ShieldIcon size={20} /></span><span className="cm-tool-label">Safety</span>
          </Link>
          <Link href={communityHref("settings")} replace={leadsHere(communityHref("settings"), search)} className={tool(view.space === "settings")} aria-label="Community settings" aria-current={view.space === "settings" ? "page" : undefined} data-cm-tool="settings">
            <span className="cm-tool-icon"><SlidersIcon size={20} /></span><span className="cm-tool-label">Settings</span>
          </Link>
        </div>
      </div>
      <SpaceTabs space={view.space} here={here} />
    </header>
  );
}
