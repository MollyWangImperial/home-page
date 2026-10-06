import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import RecoveryShell from "@/components/RecoveryShell";
import AlertsPanel from "@/components/community/AlertsPanel";
import CircleView from "@/components/community/Circle";
import CommunityHeader from "@/components/community/CommunityHeader";
import FeedView from "@/components/community/Feed";
import FindPanel from "@/components/community/FindPanel";
import FriendsDrawer from "@/components/community/FriendsDrawer";
import GroupsView from "@/components/community/Groups";
import { BackIcon } from "@/components/community/icons";
import LoungeView from "@/components/community/Lounge";
import PostMenu from "@/components/community/PostMenu";
import SafetyView from "@/components/community/SafetyView";
import SettingsView from "@/components/community/SettingsView";
import StartGroupView from "@/components/community/StartGroup";
import { lounge, type FriendsTab } from "@/content/community-samples";
import { communityHref, communityViewFromQuery, firstName, placeOf, useCommunity, type CommunitySpace, type SafetyTarget } from "@/lib/community-store";
import { fastCheckPath } from "@/lib/fast-check";
import { profileName, useProfile } from "@/lib/profile";
import { todayLabel } from "./Welcome";
import "./community.css";
import "./community-spaces.css";
import "./community-start.css";
import "./community-friends.css";
import "./community-settings.css";
import "./community-safety.css";
import "./community-alerts.css";

// My community: a feed where everybody posts, with the lounge, the Sunday circle and the person's
// groups beside it, and a toolbar to find people, see alerts, friends, safety and settings. It is
// a preview: the people in it are examples, and nothing leaves the device.
// The address says which view is open, so every button that opens a page is a link and Back works:
//   /community                           the feed
//   /community?space=lounge              the lounge
//   /community?space=circle              the Sunday circle
//   /community?space=groups&group=walk   my groups, with one open
//   /community?space=start               start a group
//   /community?space=settings            community settings (&section=quiet opens a section)
//   /community?space=safety              safety: reports, blocked and hidden people
//   ...&panel=friends&tab=sent           the Friends drawer, open over any of these
// Find, Alerts and the hide, block or report sheet (a post's ··· button) open on the page itself.
export default function Community() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const view = communityViewFromQuery(search);
  const profile = useProfile();
  const name = firstName(profileName(profile));
  const memory = useCommunity();
  const [here, setHere] = useState(lounge.here);
  // A space stays as it was left once it has been opened in this visit.
  const [visited, setVisited] = useState<CommunitySpace[]>(() => [view.space]);
  const [findOpen, setFindOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [menu, setMenu] = useState<{ target: SafetyTarget; opener: HTMLElement } | null>(null);
  const page = useRef<HTMLDivElement>(null);
  const findButton = useRef<HTMLButtonElement>(null);
  const alertsButton = useRef<HTMLButtonElement>(null);
  const firstView = useRef(true);
  const lastSpace = useRef(view.space);
  const viewNow = useRef(view);
  viewNow.current = view;
  const friendsOpen = view.panel === "friends";
  const overlayOpen = friendsOpen || findOpen || alertsOpen || menu !== null;
  const overlayWasOpen = useRef(overlayOpen);
  // Whether the drawer was opened during this visit, so closing it can step Back rather than add a page.
  const friendsOpenedHere = useRef(false);
  const lastPanel = useRef(view.panel);
  const isOpen = (space: CommunitySpace) => space === view.space || visited.includes(space);

  useEffect(() => { setVisited(list => (list.includes(view.space) ? list : [...list, view.space])); }, [view.space]);

  // Each new space starts at the top of the page; another group brings its chat into view. If what
  // was pressed has gone from sight (or was in a drawer or panel that has closed), the focus moves
  // to the new view's heading, so a keyboard or screen reader carries on from there.
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    const root = page.current;
    if (!root) return;
    if (lastSpace.current !== view.space) window.scrollTo({ top: 0, behavior: "instant" });
    else {
      const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      root.querySelector<HTMLElement>(`[data-space="${view.space}"] .cm-chat`)?.scrollIntoView({ block: "nearest", behavior: still ? "instant" : "smooth" });
    }
    lastSpace.current = view.space;
    const focused = document.activeElement as HTMLElement | null;
    if (overlayWasOpen.current || !focused || focused === document.body || !root.contains(focused) || focused.closest("[hidden]")) {
      const heading = root.querySelector<HTMLElement>(`[data-space="${view.space}"] [data-view-heading]`) ?? root.querySelector<HTMLElement>("[data-page-heading]");
      heading?.focus({ preventScroll: true });
    }
  }, [view.space, view.group]);

  // After the effect above, so it can tell that a drawer or panel was open before this change.
  useEffect(() => { overlayWasOpen.current = overlayOpen; });

  useEffect(() => {
    if (view.panel === "friends" && lastPanel.current !== "friends") friendsOpenedHere.current = true;
    if (view.panel !== "friends") friendsOpenedHere.current = false;
    lastPanel.current = view.panel;
  }, [view.panel]);

  // A new address (a link, or the browser's Back button) closes the panels and the sheet.
  useEffect(() => { setFindOpen(false); setAlertsOpen(false); setMenu(null); }, [search]);

  /** The heading of the view showing now: where the focus goes when what opened a dialog has gone. */
  const headingNow = useCallback(() => {
    const root = page.current;
    return root?.querySelector<HTMLElement>(`[data-space="${viewNow.current.space}"] [data-view-heading]`) ?? root?.querySelector<HTMLElement>("[data-page-heading]") ?? null;
  }, []);
  const friendsButton = useCallback(() => page.current?.querySelector<HTMLElement>('[data-cm-tool="friends"]') ?? headingNow(), [headingNow]);

  const closeFriends = useCallback(() => {
    const current = viewNow.current;
    if (friendsOpenedHere.current && window.history.length > 1) window.history.back();
    else navigate(communityHref(current.space, current.group), { replace: true });
  }, [navigate]);
  const showTab = useCallback((tab: FriendsTab) => {
    const current = viewNow.current;
    navigate(communityHref(current.space, current.group, { panel: "friends", tab }), { replace: true });
  }, [navigate]);
  const openMenu = useCallback((target: SafetyTarget, opener: HTMLElement) => setMenu({ target, opener }), []);

  const textSize = memory.settings.textSize === "normal" ? "" : `cm-text-${memory.settings.textSize}`;

  return (
    <RecoveryShell active="My Community" dateLabel={todayLabel()} className="cm-shell">
      <div ref={page} className={`recovery-page cm-page cm-view-${view.space} ${textSize}`}>
        {view.space !== "start" && (
          <CommunityHeader
            view={view}
            here={here}
            findOpen={findOpen}
            alertsOpen={alertsOpen}
            onFind={() => { setAlertsOpen(false); setFindOpen(true); }}
            onAlerts={() => { setFindOpen(false); setAlertsOpen(true); }}
            findButton={findButton}
            alertsButton={alertsButton}
          />
        )}

        {isOpen("feed") && <div className="cm-space" data-space="feed" hidden={view.space !== "feed"}><FeedView name={name} here={here} onMore={openMenu} openPostId={menu?.target.postId ?? null} /></div>}
        {isOpen("lounge") && <div className="cm-space" data-space="lounge" hidden={view.space !== "lounge"}><LoungeView active={view.space === "lounge"} here={here} onHere={setHere} /></div>}
        {isOpen("circle") && <div className="cm-space" data-space="circle" hidden={view.space !== "circle"}><CircleView active={view.space === "circle"} name={name} /></div>}
        {isOpen("groups") && <div className="cm-space" data-space="groups" hidden={view.space !== "groups"}><GroupsView active={view.space === "groups"} requested={view.group} /></div>}
        {isOpen("settings") && <div className="cm-space" data-space="settings" hidden={view.space !== "settings"}><SettingsView name={name} section={view.section ?? null} /></div>}
        {isOpen("safety") && <div className="cm-space" data-space="safety" hidden={view.space !== "safety"}><SafetyView name={name} warningSignsHref={fastCheckPath(location, search)} onPersonMenu={openMenu} /></div>}
        {isOpen("start") && (
          <div className="cm-space" data-space="start" hidden={view.space !== "start"}>
            <header className="cm-start-head">
              <Link className="cm-back" href={communityHref()}><BackIcon size={18} /><span>My community</span></Link>
              <h1 className="cm-title" tabIndex={-1} data-view-heading>Start a group</h1>
              <p className="cm-start-intro">A little corner for your people: a chat, photos, and a name you choose.</p>
            </header>
            <StartGroupView name={name} />
          </div>
        )}
      </div>

      {/* Drawers, sheets and panels sit outside the page, over everything. The newest one is on top. */}
      <div className={`cm-layer ${textSize}`}>
        {friendsOpen && <FriendsDrawer tab={view.tab ?? "requests"} onTab={showTab} onClose={closeFriends} onPersonMenu={openMenu} fallbackFocus={friendsButton} name={name} />}
        {findOpen && <FindPanel onClose={() => setFindOpen(false)} anchor={findButton.current} over={placeOf(view)} fallbackFocus={headingNow} />}
        {alertsOpen && <AlertsPanel onClose={() => setAlertsOpen(false)} anchor={alertsButton.current} over={placeOf(view)} fallbackFocus={headingNow} />}
        {menu && <PostMenu target={menu.target} name={name} onClose={() => setMenu(null)} returnFocus={menu.opener} fallbackFocus={headingNow} />}
      </div>
    </RecoveryShell>
  );
}
