import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { members, people, pronounWords, sampleGroups, type IncomingRequestId, type MemberId, type MessagesFrom, type PersonId, type PostsSeenBy, type RequestsFrom } from "@/content/community-samples";
import { communityHref, communityStore, daysAgoLabel, messagesHref, pendingRequestCount, useCommunity, type CommunityMemory, type CommunitySettings, type OpenSafetyMenu } from "@/lib/community-store";
import { blockedRows, friendRows, friendsVisit, requestCards, useFriendsVisit, type BlockedRow, type RequestCard } from "./friends-visit";
import { ChatIcon, CheckIcon, HandIcon, PauseCircleIcon, SearchIcon, ShieldIcon, UsersIcon } from "./icons";
import { OnlineFace } from "./Messages";
import { Face, MemberFace, MyFace } from "./parts";
import { unblockQuestion } from "./safety-model";

// Friends, as a tab of its own: requests waiting for an answer, the person's friends (to message or
// block), and, beside them, every choice about who can reach the person, in one place: who sees
// their posts, who can message them, who can ask to be friends, and what others see. Blocked
// people are listed under it, with a way to unblock. Everything stays on this device; nobody is told.

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const theyWontBeTold = (who: MemberId) => `${capital(pronounWords[members[who].pronoun].subject)} won't be told.`;
/** "In Garden gang with you", for a friend who shares a group with the person. */
const sharedGroup = (who: PersonId) => sampleGroups.find(group => group.faces.includes(who));

/* -------------------------------------------------------------- requests */

function RequestTile({ card, onAnswer, onUndo, onWave, waved }: { card: RequestCard; onAnswer: (who: IncomingRequestId, yes: boolean) => void; onUndo: (who: IncomingRequestId) => void; onWave: (who: PersonId) => void; waved: boolean }) {
  const { request, state } = card;
  const who = request.who;
  const name = people[who].name;
  const reason = capital(request.where.split(" · ")[1] ?? request.mutualText);
  if (state === "accepted") {
    return (
      <li className="cm-fp-request is-done cm-pop">
        <span className="cm-fr-pair" aria-hidden="true"><MyFace size={44} /><Face who={who} size={44} /></span>
        <p className="cm-fp-request-done" tabIndex={-1} data-fp-focus={`done-${who}`}>{`You and ${name} are friends now.`}</p>
        <div className="cm-fp-request-actions">
          <button type="button" className={`cm-fp-small ${waved ? "is-on" : ""}`} aria-disabled={waved || undefined} onClick={() => onWave(who)}><HandIcon size={16} /><span>{waved ? "Waved" : "Wave hello"}</span><span className="cm-sr">{` to ${name}`}</span></button>
          <button type="button" className="cm-text-button" onClick={() => onUndo(who)}>Undo<span className="cm-sr">{` accepting ${name}'s request`}</span></button>
        </div>
      </li>
    );
  }
  if (state === "declined") {
    return (
      <li className="cm-fp-request is-done cm-pop">
        <p className="cm-fp-request-done" tabIndex={-1} data-fp-focus={`done-${who}`}>{`You chose not now for ${name}. ${theyWontBeTold(who)}`}</p>
        <div className="cm-fp-request-actions">
          <button type="button" className="cm-text-button" onClick={() => onUndo(who)}>Undo<span className="cm-sr">{`, and show ${name}'s request again`}</span></button>
        </div>
      </li>
    );
  }
  return (
    <li className="cm-fp-request">
      <div className="cm-fp-request-who">
        <Face who={who} size={52} />
        <span className="cm-fp-text"><b tabIndex={-1} data-fp-focus={`ask-${who}`}>{name}</b><span>{people[who].town}</span></span>
      </div>
      <p className="cm-fp-reason"><UsersIcon size={16} /><span>{reason}</span></p>
      {request.note && <p className="cm-fp-note"><span className="cm-sr">{`${name} says: `}</span>{`“${request.note}”`}</p>}
      <div className="cm-fp-request-actions">
        <button type="button" className="cm-fp-accept" onClick={() => onAnswer(who, true)}>Accept<span className="cm-sr">{` ${name}'s request`}</span></button>
        <button type="button" className="cm-fp-later" onClick={() => onAnswer(who, false)}>Not now<span className="cm-sr">{` for ${name}`}</span></button>
      </div>
    </li>
  );
}

function Requests({ memory, say, focusOn }: { memory: CommunityMemory; say: (words: string) => void; focusOn: (key: string) => void }) {
  const visit = useFriendsVisit();
  const titleId = useId();
  const cards = requestCards(memory, visit);
  const waiting = pendingRequestCount(memory);
  const answer = (who: IncomingRequestId, yes: boolean) => {
    friendsVisit.answered(who);
    if (yes) communityStore.acceptRequest(who); else communityStore.declineRequest(who);
    say(yes ? `You and ${people[who].name} are friends now.` : `Not now for ${people[who].name}. ${theyWontBeTold(who)}`);
    focusOn(`done-${who}`);
  };
  const undo = (who: IncomingRequestId) => { communityStore.undoAnswer(who); say(`${people[who].name}'s request is waiting again.`); focusOn(`ask-${who}`); };
  const wave = (who: PersonId) => { if (!memory.waves.includes(who)) { communityStore.wave(who); say(`You waved hello to ${people[who].name}.`); } };
  return (
    <section className="cm-card cm-fp-card" aria-labelledby={titleId}>
      <div className="cm-fp-card-head">
        <h3 id={titleId} className="cm-fp-title" tabIndex={-1} data-view-heading>Friend requests</h3>
        <span className="cm-fp-aside">{waiting === 0 ? "None waiting" : `${waiting} waiting`}</span>
      </div>
      {memory.settings.requestsFrom === "noOne" && <p className="cm-fr-off"><PauseCircleIcon size={20} /><span>New friend requests are off. You chose “No one” under Your privacy.</span></p>}
      {cards.length > 0 && (
        <ul className="cm-fp-requests">
          {cards.map(card => <RequestTile key={`${card.request.who}-${card.state}`} card={card} onAnswer={answer} onUndo={undo} onWave={wave} waved={memory.waves.includes(card.request.who)} />)}
        </ul>
      )}
      {waiting === 0 && <p className="cm-fr-caught-up"><CheckIcon size={20} strokeWidth={2.2} /><span>All caught up. No requests waiting.</span></p>}
    </section>
  );
}

/* --------------------------------------------------------------- friends */

function MyFriends({ memory, say, focusOn, onPersonMenu }: { memory: CommunityMemory; say: (words: string) => void; focusOn: (key: string) => void; onPersonMenu: OpenSafetyMenu }) {
  const [query, setQuery] = useState("");
  const titleId = useId();
  const rows = friendRows(memory);
  const words = query.trim().toLowerCase();
  const shown = words ? rows.filter(row => people[row.who].name.toLowerCase().includes(words)) : rows;
  const friends = rows.filter(row => row.blockedAt === null).length;
  const unblock = (who: PersonId) => { communityStore.unblock(who); say(`${people[who].name} is unblocked.`); focusOn(`block-${who}`); };
  const onFindKey = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } };
  return (
    <section className="cm-card cm-fp-card" aria-labelledby={titleId}>
      <div className="cm-fp-card-head">
        <h3 id={titleId} className="cm-fp-title">My friends <span className="cm-fp-count">{friends}</span></h3>
        <label className="cm-fp-search">
          <SearchIcon size={16} />
          <span className="cm-sr">Search your friends</span>
          <input type="search" value={query} maxLength={40} placeholder="Search your friends" autoComplete="off" spellCheck={false} onChange={event => setQuery(event.target.value)} onKeyDown={onFindKey} />
        </label>
      </div>
      <p className="cm-sr" role="status">{words ? (shown.length === 0 ? "No friends found" : `${shown.length} ${shown.length === 1 ? "friend" : "friends"} found`) : ""}</p>
      {shown.length > 0 ? (
        <ul className="cm-fp-friends">
          {shown.map(row => {
            const name = people[row.who].name;
            const group = sharedGroup(row.who);
            const blocked = row.blockedAt !== null;
            const line = blocked
              ? `Blocked ${daysAgoLabel(row.blockedAt ?? Date.now())}`
              : `${people[row.who].town} · ${row.isNew ? "New friend" : group ? `In ${group.name} with you` : row.status}${row.muted ? " · posts hidden" : ""}`;
            return (
              <li key={row.who} className={`cm-fp-friend ${blocked ? "is-blocked" : ""}`}>
                <OnlineFace who={row.who} size={44} online={row.online && !blocked} />
                <span className="cm-fp-text"><b>{name}</b><span>{line}</span></span>
                <span className="cm-fp-friend-actions">
                  {blocked ? (
                    <button type="button" className="cm-fp-small" data-fp-focus={`block-${row.who}`} onClick={() => unblock(row.who)}>Undo<span className="cm-sr">{`, and unblock ${name}`}</span></button>
                  ) : (
                    <>
                      <Link className="cm-fp-small" href={messagesHref(row.who)}><ChatIcon size={16} /><span>Message</span><span className="cm-sr">{` ${name}`}</span></Link>
                      <button type="button" className="cm-fp-small is-rust" data-fp-focus={`block-${row.who}`} aria-haspopup="dialog" onClick={event => onPersonMenu({ who: row.who, postId: null }, event.currentTarget, "block")}>Block<span className="cm-sr">{` ${name}`}</span></button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="cm-plain-empty">{words ? `No friends match “${query.trim()}”.` : "No friends here yet. Accept a request, or say hello in the lounge."}</p>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- privacy */

const POST_CHOICES: { id: PostsSeenBy; label: string }[] = [{ id: "friends", label: "Friends" }, { id: "everyone", label: "Everyone" }, { id: "onlyMe", label: "Only me" }];
const MESSAGE_CHOICES: { id: MessagesFrom; label: string }[] = [{ id: "friends", label: "Friends" }, { id: "friendsAndGroups", label: "Groups too" }, { id: "noOne", label: "No one" }];
const REQUEST_CHOICES: { id: RequestsFrom; label: string }[] = [{ id: "everyone", label: "Everyone" }, { id: "friendsOfFriends", label: "Friends of friends" }, { id: "noOne", label: "No one" }];

/** What each choice means, said under it. */
const meaning = {
  postsSeenBy: { friends: "Only your friends see what you share.", everyone: "Everyone in My community sees what you share.", onlyMe: "What you share stays with you." } as Record<PostsSeenBy, string>,
  messagesFrom: { friends: "Only your friends can message you.", friendsAndGroups: "Friends, and people in your groups, can message you.", noOne: "No one can message you." } as Record<MessagesFrom, string>,
  requestsFrom: { everyone: "Anyone can ask to be your friend.", friendsOfFriends: "Only friends of your friends can ask.", noOne: "No one can send you a friend request." } as Record<RequestsFrom, string>,
};

function Choices<T extends string>({ label, options, value, onPick, note }: { label: string; options: { id: T; label: string }[]; value: T; onPick: (id: T) => void; note: string }) {
  const labelId = useId();
  const noteId = useId();
  return (
    <div className="cm-fp-choice">
      <span className="cm-fp-choice-name" id={labelId}>{label}</span>
      <div className="cm-segments cm-fp-segments" role="group" aria-labelledby={labelId} aria-describedby={noteId}>
        {options.map(option => <button key={option.id} type="button" className="cm-segment" aria-pressed={value === option.id} onClick={() => onPick(option.id)}>{option.label}</button>)}
      </div>
      <span className="cm-fp-choice-note" id={noteId}>{note}</span>
    </div>
  );
}

function Switch({ label, hint, on, onFlip }: { label: string; hint: string; on: boolean; onFlip: () => void }) {
  const labelId = useId();
  const hintId = useId();
  return (
    <div className="cm-fp-switch">
      <span className="cm-fp-switch-text"><b id={labelId}>{label}</b><span id={hintId}>{hint}</span></span>
      <button type="button" role="switch" className="cm-switch" aria-checked={on} aria-labelledby={labelId} aria-describedby={hintId} onClick={onFlip}><span /></button>
    </div>
  );
}

function Privacy({ settings, say }: { settings: CommunitySettings; say: (words: string) => void }) {
  const titleId = useId();
  const update = (patch: Partial<CommunitySettings>, words: string) => { communityStore.updateSettings(patch); say(`Saved. ${words}`); };
  return (
    <section className="cm-card cm-fp-card cm-fp-privacy" aria-labelledby={titleId}>
      <h3 id={titleId} className="cm-fp-title">Your privacy</h3>
      <Choices label="Who sees my posts by default" options={POST_CHOICES} value={settings.postsSeenBy} note={meaning.postsSeenBy[settings.postsSeenBy]}
        onPick={postsSeenBy => update({ postsSeenBy }, meaning.postsSeenBy[postsSeenBy])} />
      <Choices label="Who can message me" options={MESSAGE_CHOICES} value={settings.messagesFrom} note={meaning.messagesFrom[settings.messagesFrom]}
        onPick={messagesFrom => update({ messagesFrom }, meaning.messagesFrom[messagesFrom])} />
      <Choices label="Who can ask to be friends" options={REQUEST_CHOICES} value={settings.requestsFrom} note={meaning.requestsFrom[settings.requestsFrom]}
        onPick={requestsFrom => update({ requestsFrom }, meaning.requestsFrom[requestsFrom])} />
      <Switch label="Show my town on posts" hint="For example, Leeds" on={settings.showTown}
        onFlip={() => update({ showTown: !settings.showTown }, settings.showTown ? "Your town is hidden." : "Your town shows on your posts.")} />
      <Switch label="Show when I'm online" hint="A green dot beside your name" on={settings.showOnline}
        onFlip={() => update({ showOnline: !settings.showOnline }, settings.showOnline ? "Nobody sees when you're online." : "Friends see a green dot when you're online.")} />
      <Link className="cm-fp-more" href={communityHref("settings", null, { section: "friends" })}>More in Community settings</Link>
    </section>
  );
}

/* --------------------------------------------------------------- blocked */

function Blocked({ memory, say, focusOn }: { memory: CommunityMemory; say: (words: string) => void; focusOn: (key: string) => void }) {
  const visit = useFriendsVisit();
  const [asking, setAsking] = useState<MemberId | null>(null);
  const titleId = useId();
  const rows = blockedRows(memory, visit);
  const blocked = rows.filter(row => !row.unblocked).length;
  const unblock = (row: BlockedRow) => {
    friendsVisit.unblocked(row.who, row.at);
    communityStore.unblock(row.who);
    setAsking(null);
    say(`${members[row.who].name} is unblocked.`);
    focusOn(`reblock-${row.who}`);
  };
  const reblock = (row: BlockedRow) => {
    communityStore.block(row.who, row.at);
    friendsVisit.reblocked(row.who);
    say(`${members[row.who].name} is blocked again.`);
    focusOn(`unblock-${row.who}`);
  };
  return (
    <section className="cm-card cm-fp-card" aria-labelledby={titleId}>
      <div className="cm-fp-card-head">
        <h3 id={titleId} className="cm-fp-title">Blocked</h3>
        <span className="cm-fp-aside">{`${blocked} blocked`}</span>
      </div>
      {rows.length > 0 && (
        <ul className="cm-fp-blocked">
          {rows.map(row => {
            const name = members[row.who].name;
            const open = asking === row.who && !row.unblocked;
            return (
              <li key={row.who} onKeyDown={open ? event => { if (event.key === "Escape") { event.preventDefault(); setAsking(null); focusOn(`unblock-${row.who}`); } } : undefined}>
                <div className="cm-fp-blocked-row">
                  <MemberFace who={row.who} size={38} />
                  <span className="cm-fp-text"><b>{name}</b><span>{row.unblocked ? "Unblocked just now" : `Blocked ${daysAgoLabel(row.at)}`}</span></span>
                  {row.unblocked
                    ? <button type="button" className="cm-fp-small" data-fp-focus={`reblock-${row.who}`} onClick={() => reblock(row)}>Undo<span className="cm-sr">{`, and block ${name} again`}</span></button>
                    : <button type="button" className="cm-fp-small" data-fp-focus={`unblock-${row.who}`} aria-expanded={open} onClick={() => { setAsking(open ? null : row.who); if (!open) focusOn(`question-${row.who}`); }}>Unblock<span className="cm-sr">{` ${name}`}</span></button>}
                </div>
                {open && (
                  <div className="cm-fp-confirm cm-pop" role="group" aria-label={`Unblock ${name}?`}>
                    <p tabIndex={-1} data-fp-focus={`question-${row.who}`}>{unblockQuestion(row.who)}</p>
                    <span className="cm-fp-confirm-actions">
                      <button type="button" className="cm-fp-accept" onClick={() => unblock(row)}>Yes, unblock<span className="cm-sr">{` ${name}`}</span></button>
                      <button type="button" className="cm-fp-later" onClick={() => { setAsking(null); focusOn(`unblock-${row.who}`); }}>Keep blocked</button>
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="cm-fp-small-print">{rows.length === 0 ? "You haven't blocked anyone. " : ""}People you block are never told. You can unblock them at any time.</p>
    </section>
  );
}

/* ------------------------------------------------------------------ page */

/**
 * The Friends tab. `onPersonMenu` opens the hide, block or report sheet (a friend's Block button
 * opens it at "Block them?").
 */
export default function FriendsPage({ onPersonMenu }: { onPersonMenu: OpenSafetyMenu }) {
  const memory = useCommunity();
  const page = useRef<HTMLDivElement>(null);
  const [said, setSaid] = useState("");
  const [focusKey, setFocusKey] = useState<string | null>(null);

  // When a row changes into something else (a request answered, someone unblocked), the focus moves
  // to what took its place rather than being lost.
  useLayoutEffect(() => {
    if (focusKey === null) return;
    setFocusKey(null);
    page.current?.querySelector<HTMLElement>(`[data-fp-focus="${focusKey}"]`)?.focus();
  }, [focusKey]);

  const shared = { memory, say: setSaid, focusOn: setFocusKey };
  const safety: ReactNode = (
    <section className="cm-fp-safety" aria-labelledby="cm-fp-safety-title">
      <p className="cm-fp-overline">Safety centre</p>
      <h3 id="cm-fp-safety-title">Something doesn't feel right?</h3>
      <p>Report any post, message or person from the three dots beside it, or Block or report beside a message. You never have to explain why, and they are never told.</p>
      <Link className="cm-fp-gold" href={communityHref("safety")}><ShieldIcon size={18} /><span>Read our community guidelines</span></Link>
    </section>
  );

  return (
    <div ref={page} className="cm-layout cm-fp">
      <div className="cm-lane">
        <h2 className="cm-sr">Friends</h2>
        <Requests {...shared} />
        <MyFriends {...shared} onPersonMenu={onPersonMenu} />
      </div>
      <aside className="cm-side" aria-label="Privacy and blocking">
        <Privacy settings={memory.settings} say={setSaid} />
        <Blocked {...shared} />
        {safety}
      </aside>
      <p className="cm-sr" role="status">{said}</p>
    </div>
  );
}
