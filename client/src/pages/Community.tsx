import { useEffect, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import RecoveryShell from "@/components/RecoveryShell";
import CircleView from "@/components/community/Circle";
import CommunitySearch from "@/components/community/CommunitySearch";
import FeedView from "@/components/community/Feed";
import GroupsView from "@/components/community/Groups";
import { BackIcon } from "@/components/community/icons";
import LoungeView from "@/components/community/Lounge";
import { LiveDot } from "@/components/community/parts";
import StartGroupView from "@/components/community/StartGroup";
import { lounge } from "@/content/community-samples";
import { communityHref, communityViewFromQuery, firstName, unreadCount, useCommunity, type CommunitySpace } from "@/lib/community-store";
import { profileName, useProfile } from "@/lib/profile";
import { todayLabel } from "./Welcome";
import "./community.css";
import "./community-spaces.css";
import "./community-start.css";

/** The tab row on every view: the feed, and the three spaces beside it. */
function SpaceTabs({ space, here, unread }: { space: CommunitySpace; here: number; unread: number }) {
  const tab = (target: CommunitySpace) => ({ className: `cm-tab ${space === target ? "is-active" : ""}`, "aria-current": space === target ? ("page" as const) : undefined });
  return (
    <nav className="cm-tabs" aria-label="Community spaces">
      <Link href={communityHref()} {...tab("feed")}>Feed</Link>
      <Link href={communityHref("lounge")} {...tab("lounge")}>
        <LiveDot /><span>The lounge</span>{" "}<span className="cm-tab-note cm-tab-note-rust">{here} in</span>
      </Link>
      <Link href={communityHref("circle")} {...tab("circle")}>
        <LiveDot tone="amber" /><span>Sunday circle</span>{" "}<span className="cm-tab-note cm-tab-note-amber">open</span>
      </Link>
      <Link href={communityHref("groups")} {...tab("groups")}>
        <span>My groups</span>
        {unread > 0 && space !== "groups" && <span className="cm-badge"><span aria-hidden="true">{unread}</span><span className="cm-sr">{`, ${unread} unread`}</span></span>}
      </Link>
    </nav>
  );
}

// My community: a feed where everybody posts, with the lounge, the Sunday circle and the person's
// groups beside it. It is a preview: the people in it are examples, and nothing leaves the device.
// The address says which view is open, so every button is a link and the back button works:
//   /community                           the feed
//   /community?space=lounge              the lounge
//   /community?space=circle              the Sunday circle
//   /community?space=groups&group=walk   my groups, with one open
//   /community?space=start               start a group
export default function Community() {
  const search = useSearch();
  const view = communityViewFromQuery(search);
  const profile = useProfile();
  const name = firstName(profileName(profile));
  const memory = useCommunity();
  const [here, setHere] = useState(lounge.here);
  // A space stays as it was left once it has been opened in this visit.
  const [visited, setVisited] = useState<CommunitySpace[]>(() => [view.space]);
  const page = useRef<HTMLDivElement>(null);
  const firstView = useRef(true);
  const lastSpace = useRef(view.space);
  const isOpen = (space: CommunitySpace) => space === view.space || visited.includes(space);

  useEffect(() => { setVisited(list => (list.includes(view.space) ? list : [...list, view.space])); }, [view.space]);

  // Each new space starts at the top of the page; another group brings its chat into view. If what
  // was pressed has gone from sight, the focus moves to the new view's heading, so a keyboard or
  // screen reader carries on from there.
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
    if (!focused || focused === document.body || !root.contains(focused) || focused.closest("[hidden]")) {
      const heading = root.querySelector<HTMLElement>(`[data-space="${view.space}"] [data-view-heading]`) ?? root.querySelector<HTMLElement>("[data-page-heading]");
      heading?.focus({ preventScroll: true });
    }
  }, [view.space, view.group]);

  return (
    <RecoveryShell active="My Community" dateLabel={todayLabel()}>
      <div ref={page} className={`recovery-page cm-page cm-view-${view.space}`}>
        {view.space !== "start" && (
          <header className="cm-head">
            <div className="cm-head-row">
              <h1 className="cm-title" tabIndex={-1} data-page-heading>My community</h1>
              <CommunitySearch />
            </div>
            <SpaceTabs space={view.space} here={here} unread={unreadCount(memory)} />
          </header>
        )}

        {isOpen("feed") && <div className="cm-space" data-space="feed" hidden={view.space !== "feed"}><FeedView name={name} here={here} /></div>}
        {isOpen("lounge") && <div className="cm-space" data-space="lounge" hidden={view.space !== "lounge"}><LoungeView active={view.space === "lounge"} here={here} onHere={setHere} /></div>}
        {isOpen("circle") && <div className="cm-space" data-space="circle" hidden={view.space !== "circle"}><CircleView active={view.space === "circle"} name={name} /></div>}
        {isOpen("groups") && <div className="cm-space" data-space="groups" hidden={view.space !== "groups"}><GroupsView active={view.space === "groups"} requested={view.group} /></div>}
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
    </RecoveryShell>
  );
}
