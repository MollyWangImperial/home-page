import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Link } from "wouter";
import {
  FRIENDS_TABS,
  friendSuggestions,
  friendsTabLabels,
  members,
  people,
  pronounWords,
  settingsChoices,
  type FriendsTab,
  type IncomingRequestId,
  type MemberId,
  type PersonId,
} from "@/content/community-samples";
import {
  blockedList,
  communityHref,
  communityStore,
  daysAgoLabel,
  friendList,
  listNames,
  pendingRequestCount,
  relationship,
  sentList,
  useCommunity,
  type CommunityMemory,
  type OpenSafetyMenu,
} from "@/lib/community-store";
import CommunityDialog from "./dialog";
import { blockedRows, friendRows, friendsVisit, requestCards, sentRows, useFriendsVisit, type BlockedRow, type FriendRow, type FriendsVisit, type RequestCard, type SentRow } from "./friends-visit";
import { useStill } from "./hooks";
import { ChatIcon, CheckIcon, ClockIcon, CloseIcon, DotsIcon, EyeIcon, EyeOffIcon, HandIcon, NextIcon, PauseCircleIcon, SearchIcon, ShieldIcon, SlidersIcon } from "./icons";
import { Face, MemberFace, MyFace } from "./parts";
import { blockingFacts, unblockQuestion } from "./safety-model";

// F4: the Friends drawer. Requests for the person (For you), requests they sent, their friends,
// and the people they have blocked. Everything here is kept on this device: the people are
// examples, nobody is told about an answer, a cancelled request or a block, and a wave stays here.

export type FriendsDrawerProps = {
  /** The tab showing, from the address (`&tab=`). "requests" is "For you". */
  tab: FriendsTab;
  /** Shows another tab. It replaces the address, so the browser's Back button still closes the drawer. */
  onTab: (tab: FriendsTab) => void;
  /** Closes the drawer (Close button, Escape, the dimmed page). */
  onClose: () => void;
  /** Opens the hide, block or report sheet for someone (a friend's ··· button), over the drawer. */
  onPersonMenu: OpenSafetyMenu;
  /** Where the focus goes on closing if the button that opened the drawer has gone. Pass it to CommunityDialog. */
  fallbackFocus: () => HTMLElement | null | undefined;
  /** The person's first name. */
  name: string;
};

const DAY = 86_400_000;
const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
/** "She won't be told", "They won't be told". */
const theyWontBeTold = (who: MemberId) => `${capital(pronounWords[members[who].pronoun].subject)} won't be told.`;

type PanelProps = {
  memory: CommunityMemory;
  visit: FriendsVisit;
  /** Says what just happened, for anyone using a screen reader. */
  say: (words: string) => void;
  /** After this change, moves the focus to the element marked `data-fr-focus` with this key. */
  focusOn: (key: string) => void;
};

/* ---------------------------------------------------------------- For you */

/** The little burst on a request just accepted (left out when the device asks for less motion). */
const confetti = [
  { left: "20%", color: "#E8795A", dx: -40, dy: -50, delay: 0 },
  { left: "35%", color: "#F2C14E", dx: -10, dy: -70, delay: 0.05 },
  { left: "50%", color: "#2E7D5B", dx: 20, dy: -60, delay: 0.1 },
  { left: "65%", color: "#8CBFD9", dx: 40, dy: -55, delay: 0 },
  { left: "80%", color: "#B9A6D9", dx: 50, dy: -40, delay: 0.08 },
  { left: "45%", color: "#E8795A", dx: 10, dy: -80, delay: 0.12 },
];

type RequestActions = {
  onAccept: (who: IncomingRequestId) => void;
  onDecline: (who: IncomingRequestId) => void;
  onUndo: (who: IncomingRequestId) => void;
  onWave: (who: PersonId) => void;
};

/** One request: waiting (Accept or Not now), just accepted (friends now, Wave hello), or "not now" with Undo. */
function RequestItem({ card, memory, cheer, onAccept, onDecline, onUndo, onWave }: { card: RequestCard; memory: CommunityMemory; cheer: boolean } & RequestActions) {
  const { request, state } = card;
  const who = request.who;
  const name = people[who].name;

  if (state === "accepted") {
    const waved = memory.waves.includes(who);
    return (
      <li className="cm-fr-accepted cm-pop">
        {cheer && (
          <span className="cm-fr-confetti-box" aria-hidden="true">
            {confetti.map((piece, index) => (
              <i key={index} className="cm-fr-confetti" style={{ left: piece.left, background: piece.color, animationDelay: `${piece.delay}s`, "--dx": `${piece.dx}px`, "--dy": `${piece.dy}px` } as CSSProperties} />
            ))}
          </span>
        )}
        <span className="cm-fr-pair" aria-hidden="true"><MyFace size={56} /><Face who={who} size={56} /></span>
        <div className="cm-fr-accepted-text">
          <h3 tabIndex={-1} data-fr-focus={`friends-${who}`}>{`You and ${name} are friends now`}</h3>
          <p>
            {waved ? "You waved hello." : "Say hello to start things off."}{" "}
            <button type="button" className="cm-fr-inline-undo" onClick={() => onUndo(who)}>Undo<span className="cm-sr">{` accepting ${name}'s request`}</span></button>
          </p>
        </div>
        <div className="cm-fr-accepted-actions">
          <button type="button" className={`cm-fr-wave ${waved ? "is-on" : ""}`} aria-disabled={waved || undefined} onClick={() => onWave(who)}>
            <HandIcon size={18} /><span>{waved ? "Waved" : "Wave hello"}</span><span className="cm-sr">{` to ${name}`}</span>
          </button>
        </div>
      </li>
    );
  }

  if (state === "declined") {
    return (
      <li className="cm-fr-declined cm-pop">
        <p tabIndex={-1} data-fr-focus={`later-${who}`}>{`You chose not now for ${name}. ${theyWontBeTold(who)}`}</p>
        <button type="button" className="cm-text-button cm-fr-undo" onClick={() => onUndo(who)}>Undo<span className="cm-sr">{`, and show ${name}'s request again`}</span></button>
      </li>
    );
  }

  // Friends in common, as things stand now (one of them may have been blocked since).
  const mutual = request.mutual.filter(id => relationship(memory, id) === "friend");
  const mutualText = mutual.length === request.mutual.length
    ? request.mutualText
    : `${listNames(mutual.map(id => people[id].name))} ${mutual.length === 1 ? "is a friend" : "are friends"} of yours`;
  return (
    <li className="cm-fr-card cm-fr-request">
      <div className="cm-fr-request-top">
        <Face who={who} size={62} />
        <div className="cm-fr-request-text">
          <h3 className="cm-fr-request-name" tabIndex={-1} data-fr-focus={`ask-${who}`}>{name} <span>wants to be friends</span></h3>
          <p className="cm-fr-sub">{request.where}</p>
          {mutual.length > 0 && (
            <p className="cm-fr-mutual">
              <span className="cm-fr-mutual-faces" aria-hidden="true">{mutual.map(id => <Face key={id} who={id} size={24} />)}</span>
              <span>{mutualText}</span>
            </p>
          )}
        </div>
      </div>
      {request.note && <p className="cm-fr-note"><span className="cm-sr">{`${name} says: `}</span>{`“${request.note}”`}</p>}
      <div className="cm-fr-request-actions">
        <button type="button" className="cm-fr-accept" onClick={() => onAccept(who)}><CheckIcon size={20} strokeWidth={2.2} /><span>Accept</span><span className="cm-sr">{` ${name}'s request`}</span></button>
        <button type="button" className="cm-fr-later" onClick={() => onDecline(who)}>Not now<span className="cm-sr">{` for ${name}`}</span></button>
      </div>
    </li>
  );
}

function ForYouTab({ memory, visit, say, focusOn }: PanelProps) {
  const still = useStill();
  // Requests accepted while this tab has been showing: their card celebrates, once.
  const [cheered, setCheered] = useState<IncomingRequestId[]>([]);
  // People asked from "People you may know" while this tab has been showing keep their row, so the
  // same button can take the request back.
  const [asked, setAsked] = useState<PersonId[]>([]);
  const suggestId = useId();
  const cards = requestCards(memory, visit);
  const waiting = cards.filter(card => card.state === "pending").length;
  const suggestions = friendSuggestions.filter(({ who }) => {
    const status = relationship(memory, who);
    return status === "none" || (status === "sent" && asked.includes(who));
  });

  const actions: RequestActions = {
    onAccept: who => {
      friendsVisit.answered(who);
      communityStore.acceptRequest(who);
      setCheered(list => (list.includes(who) ? list : [...list, who]));
      focusOn(`friends-${who}`);
    },
    onDecline: who => {
      friendsVisit.answered(who);
      communityStore.declineRequest(who);
      focusOn(`later-${who}`);
    },
    onUndo: who => {
      communityStore.undoAnswer(who);
      setCheered(list => list.filter(item => item !== who));
      focusOn(`ask-${who}`);
    },
    onWave: who => {
      if (memory.waves.includes(who)) return;
      communityStore.wave(who);
      say(`You waved hello to ${people[who].name}.`);
    },
  };
  const ask = (who: PersonId) => {
    const name = people[who].name;
    if (relationship(memory, who) === "sent") {
      communityStore.cancelRequest(who);
      say(`Request to ${name} cancelled. ${theyWontBeTold(who)}`);
    } else {
      communityStore.requestFriend(who);
      setAsked(list => (list.includes(who) ? list : [...list, who]));
      say(`Request sent to ${name}. You'll find it in Sent.`);
    }
  };

  return (
    <>
      {memory.settings.requestsFrom === "noOne" && (
        <p className="cm-fr-off"><PauseCircleIcon size={20} /><span>New friend requests are off. You chose “No one” in Community settings.</span></p>
      )}
      {cards.length > 0 && (
        <ul className="cm-fr-list">
          {cards.map(card => (
            <RequestItem key={`${card.request.who}-${card.state}`} card={card} memory={memory} cheer={!still && card.state === "accepted" && cheered.includes(card.request.who)} {...actions} />
          ))}
        </ul>
      )}
      {waiting === 0 && <p className="cm-fr-caught-up cm-pop"><CheckIcon size={20} strokeWidth={2.2} /><span>All caught up. No requests waiting.</span></p>}
      {suggestions.length > 0 && (
        <div className="cm-fr-suggest">
          <h3 id={suggestId} className="cm-fr-overline is-rust">People you may know</h3>
          <ul className="cm-fr-people" aria-labelledby={suggestId}>
            {suggestions.map(({ who, why }) => {
              const on = relationship(memory, who) === "sent";
              const name = people[who].name;
              return (
                <li key={who} className="cm-fr-person">
                  <Face who={who} size={48} />
                  <span className="cm-fr-person-text"><b>{name}</b><span>{why}</span></span>
                  <button type="button" className={`cm-fr-add ${on ? "is-on" : ""}`} onClick={() => ask(who)}>
                    {on ? "Request sent" : "Add friend"}<span className="cm-sr">{on ? ` to ${name}. Press to cancel it` : ` (${name})`}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------- Sent */

function SentTab({ memory, visit, say, focusOn }: PanelProps) {
  const rows = sentRows(memory, visit);
  const now = Date.now();
  const cancel = (row: SentRow) => {
    friendsVisit.cancelled(row.who, row.at);
    communityStore.cancelRequest(row.who);
    say(`Request to ${people[row.who].name} cancelled. ${theyWontBeTold(row.who)}`);
    focusOn(`sent-${row.who}`);
  };
  // Undo puts the request back as it was, sent at the same time.
  const undo = (row: SentRow) => {
    communityStore.requestFriend(row.who, row.at);
    friendsVisit.resent(row.who);
    say(`Your request to ${people[row.who].name} is waiting again.`);
    focusOn(`sent-${row.who}`);
  };
  return (
    <>
      {rows.length === 0 ? (
        <p className="cm-fr-empty">No requests waiting for a yes.</p>
      ) : (
        <ul className="cm-fr-list cm-fr-sent-list">
          {rows.map(row => {
            const name = people[row.who].name;
            const when = row.cancelled ? "Request cancelled" : `Sent ${daysAgoLabel(row.at, now)}${now - row.at >= 7 * DAY ? " · still waiting" : ""}`;
            return (
              <li key={row.who} className={`cm-fr-card cm-fr-sent ${row.cancelled ? "is-cancelled" : ""}`}>
                <Face who={row.who} size={52} />
                <span className="cm-fr-person-text"><b>{name}</b><span className="cm-fr-when"><ClockIcon size={16} /><span>{when}</span></span></span>
                <button type="button" className={`cm-fr-pill ${row.cancelled ? "is-undo" : ""}`} data-fr-focus={`sent-${row.who}`} onClick={() => (row.cancelled ? undo(row) : cancel(row))}>
                  {row.cancelled ? "Undo" : "Cancel"}<span className="cm-sr">{row.cancelled ? `: keep your request to ${name}` : ` your request to ${name}`}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="cm-fr-hint"><EyeIcon size={20} /><span>Requests stay here until they say yes. If you cancel one, they are not told.</span></p>
    </>
  );
}

/* ---------------------------------------------------------------- Friends */

function FriendItem({ row, waved, onWave, onUnblock, onPersonMenu }: { row: FriendRow; waved: boolean; onWave: (who: PersonId) => void; onUnblock: (who: PersonId) => void; onPersonMenu: OpenSafetyMenu }) {
  const name = people[row.who].name;
  const blocked = row.blockedAt !== null;
  const status = row.blockedAt !== null ? `Blocked ${daysAgoLabel(row.blockedAt)}` : `${row.status}${row.muted ? " · posts hidden" : ""}`;
  const tone = blocked || row.isNew ? "is-rust" : row.online ? "is-online" : "";
  return (
    <li className={`cm-fr-friend ${blocked ? "is-blocked" : ""}`}>
      <span className="cm-fr-face-wrap">
        <Face who={row.who} size={50} />
        {row.online && !blocked && <span className="cm-fr-online" aria-hidden="true" />}
      </span>
      <span className="cm-fr-person-text"><b>{name}</b><span className={tone}>{status}</span></span>
      <span className="cm-fr-friend-actions">
        {blocked ? (
          <button key="undo" type="button" className="cm-fr-pill is-undo" onClick={() => onUnblock(row.who)}>Undo<span className="cm-sr">{`, and unblock ${name}`}</span></button>
        ) : (
          <button key="wave" type="button" className={`cm-fr-wave ${waved ? "is-on" : ""}`} aria-disabled={waved || undefined} onClick={() => onWave(row.who)}>
            <HandIcon size={18} /><span>{waved ? "Waved" : "Wave"}</span><span className="cm-sr">{` to ${name}`}</span>
          </button>
        )}
        <button type="button" className="cm-fr-more" aria-label={`More options for ${name}`} aria-haspopup="dialog" data-fr-focus={`more-${row.who}`}
          onClick={event => onPersonMenu({ who: row.who, postId: null }, event.currentTarget)}>
          <DotsIcon size={22} />
        </button>
      </span>
    </li>
  );
}

function FriendListTab({ memory, say, focusOn, onPersonMenu }: PanelProps & { onPersonMenu: OpenSafetyMenu }) {
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const rows = friendRows(memory);
  const words = query.trim().toLowerCase();
  const shown = words ? rows.filter(row => people[row.who].name.toLowerCase().includes(words)) : rows;
  const wave = (who: PersonId) => {
    if (memory.waves.includes(who)) return;
    communityStore.wave(who);
    say(`You waved to ${people[who].name}.`);
  };
  const unblock = (who: PersonId) => {
    communityStore.unblock(who);
    say(`${people[who].name} is unblocked.`);
    focusOn(`more-${who}`);
  };
  // Escape clears the words first. With none left, it closes the drawer as usual.
  const onFindKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); }
  };
  return (
    <>
      <div className="cm-fr-find">
        <label className="cm-fr-find-label">
          <SearchIcon size={20} />
          <span className="cm-sr">Find a friend</span>
          <input ref={field} type="search" value={query} maxLength={40} placeholder="Find a friend" autoComplete="off" spellCheck={false} onChange={event => setQuery(event.target.value)} onKeyDown={onFindKey} />
        </label>
        {query && <button type="button" className="cm-fr-clear" aria-label="Clear the search" onClick={() => { setQuery(""); field.current?.focus(); }}><CloseIcon size={16} /></button>}
      </div>
      <p className="cm-sr" role="status">{words ? (shown.length === 0 ? "No friends found" : `${shown.length} ${shown.length === 1 ? "friend" : "friends"} found`) : ""}</p>
      {shown.length > 0 ? (
        <ul className="cm-fr-list cm-fr-friends">
          {shown.map(row => <FriendItem key={row.who} row={row} waved={memory.waves.includes(row.who)} onWave={wave} onUnblock={unblock} onPersonMenu={onPersonMenu} />)}
        </ul>
      ) : (
        <p className="cm-fr-empty">{words ? `No friends match “${query.trim()}”.` : "No friends here yet. Try People you may know, in For you."}</p>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- Blocked */

function BlockedTab({ memory, visit, say, focusOn }: PanelProps) {
  // Whose "Unblock?" question is showing. Unblocking takes a second yes; blocking again doesn't.
  const [asking, setAsking] = useState<MemberId | null>(null);
  const explainId = useId();
  const confirmId = useId();
  const rows = blockedRows(memory, visit);
  // Said the same way as in the hide, block or report sheet.
  const [cantSee, cantAsk, notTold] = blockingFacts(null);
  const ask = (who: MemberId) => { setAsking(who); focusOn(`question-${who}`); };
  const keep = (who: MemberId) => { setAsking(null); focusOn(`unblock-${who}`); };
  const unblock = (row: BlockedRow) => {
    friendsVisit.unblocked(row.who, row.at);
    communityStore.unblock(row.who);
    setAsking(null);
    say(`${members[row.who].name} is unblocked.`);
    focusOn(`reblock-${row.who}`);
  };
  // Undo blocks them again from when they were first blocked.
  const reblock = (row: BlockedRow) => {
    communityStore.block(row.who, row.at);
    friendsVisit.reblocked(row.who);
    say(`${members[row.who].name} is blocked again.`);
    focusOn(`unblock-${row.who}`);
  };
  return (
    <>
      {rows.length === 0 ? (
        <p className="cm-fr-empty">You haven't blocked anyone.</p>
      ) : (
        <ul className="cm-fr-list">
          {rows.map(row => {
            const member = members[row.who];
            const open = asking === row.who && !row.unblocked;
            const boxId = `${confirmId}-${row.who}`;
            // While "Unblock?" is showing, Escape answers "Keep blocked" and leaves the drawer open.
            const onKeyDown = open ? (event: KeyboardEvent<HTMLLIElement>) => { if (event.key === "Escape") { event.preventDefault(); keep(row.who); } } : undefined;
            return (
              <li key={row.who} className="cm-fr-card cm-fr-blocked" onKeyDown={onKeyDown}>
                <div className="cm-fr-blocked-row">
                  <MemberFace who={row.who} size={54} />
                  <span className="cm-fr-person-text"><b>{member.name}</b><span>{row.unblocked ? "Unblocked just now" : `Blocked ${daysAgoLabel(row.at)}`}</span></span>
                  {row.unblocked ? (
                    <button key="undo" type="button" className="cm-fr-pill is-undo" data-fr-focus={`reblock-${row.who}`} onClick={() => reblock(row)}>
                      Undo<span className="cm-sr">{`, and block ${member.name} again`}</span>
                    </button>
                  ) : (
                    <button key="unblock" type="button" className="cm-fr-pill" data-fr-focus={`unblock-${row.who}`} aria-expanded={open} aria-controls={open ? boxId : undefined}
                      onClick={() => (open ? keep(row.who) : ask(row.who))}>
                      Unblock<span className="cm-sr">{` ${member.name}`}</span>
                    </button>
                  )}
                </div>
                {open && (
                  <div className="cm-fr-confirm cm-pop" id={boxId} role="group" aria-labelledby={`${boxId}-question`}>
                    <p id={`${boxId}-question`} tabIndex={-1} data-fr-focus={`question-${row.who}`}>{unblockQuestion(row.who)}</p>
                    <div className="cm-fr-confirm-actions">
                      <button type="button" className="cm-fr-yes" onClick={() => unblock(row)}>Yes, unblock<span className="cm-sr">{` ${member.name}`}</span></button>
                      <button type="button" className="cm-fr-keep" onClick={() => keep(row.who)}>Keep blocked</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="cm-fr-explain">
        <h3 id={explainId} className="cm-fr-overline">What blocking does</h3>
        <ul aria-labelledby={explainId}>
          <li><span className="cm-fr-tile is-mint" aria-hidden="true"><EyeOffIcon size={20} /></span><span>{cantSee}</span></li>
          <li><span className="cm-fr-tile is-blue" aria-hidden="true"><ChatIcon size={20} /></span><span>{cantAsk}</span></li>
          <li><span className="cm-fr-tile is-gold" aria-hidden="true"><ShieldIcon size={20} /></span><span>{notTold}</span></li>
        </ul>
      </div>
      {/* Like every link out of the drawer, it needs no onClose: the new address closes the drawer. */}
      <Link className="cm-fr-safety" href={communityHref("safety")}>
        <span className="cm-fr-safety-icon" aria-hidden="true"><ShieldIcon size={22} /></span>
        <span className="cm-fr-safety-text"><b>Safety</b><span>Your reports, and the people and posts you've hidden or blocked</span></span>
        <NextIcon size={20} />
      </Link>
    </>
  );
}

/* ----------------------------------------------------------------- drawer */

export default function FriendsDrawer({ tab, onTab, onClose, onPersonMenu, fallbackFocus }: FriendsDrawerProps) {
  const memory = useCommunity();
  const visit = useFriendsVisit();
  const titleId = useId();
  const tabsId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [said, setSaid] = useState("");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const friends = friendList(memory).length;
  const waiting = pendingRequestCount(memory);
  const counts: Record<FriendsTab, number> = { requests: waiting, sent: sentList(memory).length, friends, blocked: blockedList(memory).length };
  const requestsFrom = settingsChoices.requestsFrom.find(choice => choice.id === memory.settings.requestsFrom)?.label ?? "Everyone";
  const tabId = (item: FriendsTab) => `${tabsId}-${item}`;
  const panelId = `${tabsId}-panel`;
  const line = `${friends} friend${friends === 1 ? "" : "s"} · ${waiting === 0 ? "no requests waiting" : waiting === 1 ? "1 request waiting for you" : `${waiting} requests waiting for you`}`;

  // When a row changes into something else (a request answered, an "Unblock?" question shown), the
  // focus moves to what took its place rather than being lost.
  useLayoutEffect(() => {
    if (focusKey === null) return;
    setFocusKey(null);
    panel.current?.querySelector<HTMLElement>(`[data-fr-focus="${focusKey}"]`)?.focus();
  }, [focusKey]);

  const choose = (item: FriendsTab) => { if (item !== tab) onTab(item); };
  // The arrow keys, Home and End move between the tabs, and each tab shows as it gets the focus.
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, item: FriendsTab) => {
    const at = FRIENDS_TABS.indexOf(item);
    const last = FRIENDS_TABS.length - 1;
    const to = event.key === "ArrowRight" ? (at === last ? 0 : at + 1)
      : event.key === "ArrowLeft" ? (at === 0 ? last : at - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : -1;
    if (to < 0) return;
    event.preventDefault();
    const next = FRIENDS_TABS[to];
    document.getElementById(tabId(next))?.focus();
    choose(next);
  };

  const shared: PanelProps = { memory, visit, say: setSaid, focusOn: setFocusKey };

  return (
    <CommunityDialog kind="drawer" labelledBy={titleId} onClose={onClose} fallbackFocus={fallbackFocus} className="cm-fr-drawer">
      <div className="cm-dialog-head">
        <div className="cm-dialog-titles">
          <h2 id={titleId} className="cm-dialog-title" tabIndex={-1}>Friends</h2>
          <p>{line}</p>
        </div>
        <button type="button" className="cm-dialog-close" aria-label="Close" onClick={onClose}><CloseIcon size={22} /></button>
      </div>

      <div className="cm-segments cm-fr-tabs" role="tablist" aria-label="Friends and requests">
        {FRIENDS_TABS.map(item => {
          const on = tab === item;
          const count = counts[item];
          return (
            <button key={item} id={tabId(item)} type="button" role="tab" className="cm-segment" aria-selected={on} aria-controls={panelId} tabIndex={on ? 0 : -1}
              onClick={() => choose(item)} onKeyDown={event => onTabKey(event, item)}>
              <span className="cm-fr-tab-label">{friendsTabLabels[item]}</span>
              <span className={`cm-segment-count ${item === "requests" && count > 0 ? "is-waiting" : ""}`} aria-hidden="true">{count}</span>
              <span className="cm-sr">{item === "requests" ? `, ${count} waiting` : `, ${count}`}</span>
            </button>
          );
        })}
      </div>

      {/* The panel takes the focus itself unless it starts with something that can (the Friends tab's search box). */}
      <div ref={panel} className="cm-fr-panel" id={panelId} role="tabpanel" aria-labelledby={tabId(tab)} tabIndex={tab === "friends" ? undefined : 0}>
        {/* Keyed by the tab, so each tab slides in as it opens. */}
        <div key={tab} className={`cm-fr-step is-${tab}`}>
          {tab === "requests" && <ForYouTab {...shared} />}
          {tab === "sent" && <SentTab {...shared} />}
          {tab === "friends" && <FriendListTab {...shared} onPersonMenu={onPersonMenu} />}
          {tab === "blocked" && <BlockedTab {...shared} />}
        </div>
      </div>

      {/* A link to another page needs no onClose: the new address has no drawer in it, and Back brings it back.
          It opens Community settings at "Friends and messages", where this choice is made. */}
      <Link className="cm-dialog-foot-link cm-fr-foot" href={communityHref("settings", null, { section: "friends" })}>
        <SlidersIcon size={22} /><span><b>Who can send you requests:</b> {requestsFrom}</span><span className="cm-dialog-foot-action">Change</span>
      </Link>
      <p className="cm-sr" role="status">{said}</p>
    </CommunityDialog>
  );
}
