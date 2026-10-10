import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useSearch } from "wouter";
import { groupQuickReplies, newConversation, people, type PersonId } from "@/content/community-samples";
import { canSee, clockLabel, communityHref, communityStore, leadsHere, messagesHref, shortWhen, useCommunity, type NoteDraft, type OpenSafetyMenu } from "@/lib/community-store";
import { myGroups } from "./group-model";
import { useMediaQuery, usePinnedToEnd, useVoiceNote, voiceSeconds } from "./hooks";
import { BackIcon, BellIcon, BellOffIcon, CalendarIcon, CloseIcon, HeartIcon, PauseCircleIcon, PenIcon, SearchIcon, SpeakerIcon, StopIcon } from "./icons";
import { allChats, chatById, dayLabel, friendsToMessage, groupsWith, mutualFriends, sendDirect, useChatVisit, type Chat, type ChatLine, type DirectChat, type GroupChat } from "./messages-model";
import { ChatInput, Cover, Face, MyMessage, TheirMessage, toneClass, TypingRow, VoiceNote } from "./parts";

// Messages: conversations with friends and groups, in three columns like a chat app: the list,
// the conversation, and who it is with. On a narrow screen the list and the conversation take
// turns. The friends' words are examples; what the person writes stays on this device.

type Filter = "all" | "unread" | "groups";
const FILTERS: { id: Filter; label: string }[] = [{ id: "all", label: "All" }, { id: "unread", label: "Unread" }, { id: "groups", label: "Groups" }];

/* --------------------------------------------------------- shared pieces */

/** A face with the green dot of someone online. */
export function OnlineFace({ who, size, online }: { who: PersonId; size: number; online: boolean }) {
  return (
    <span className="cm-dm-face" style={{ width: size, height: size }}>
      <Face who={who} size={size} />
      {online && <span className="cm-dm-online" aria-hidden="true" />}
    </span>
  );
}

const isTheirs = (line: ChatLine): line is Extract<ChatLine, { kind: "theirs" }> => line.kind === "theirs";

/** A conversation with a friend, a day at a time. Each line says who said it, for a screen reader. */
export function DirectLines({ chat, typing }: { chat: DirectChat; typing: boolean }) {
  const now = Date.now();
  const rows: ReactNode[] = [];
  let day = "";
  chat.lines.forEach(line => {
    const label = dayLabel(line.at, now);
    if (label !== day) {
      day = label;
      rows.push(<li key={`day-${label}`} className="cm-dm-day"><span>{label}</span></li>);
    }
    if (isTheirs(line)) {
      rows.push(
        <li key={line.id} className="cm-dm-line cm-msg-in">
          <div className={`cm-dm-bubble ${line.voice ? "has-voice" : ""}`}>
            <span className="cm-sr">{`${chat.name}: `}</span>
            {line.voice ? <VoiceNote words={line.text} seconds={line.voice.seconds} label={`${chat.name}'s voice message`} /> : <p>{line.text}</p>}
          </div>
          <span className="cm-dm-time">{clockLabel(line.at)}</span>
        </li>,
      );
      return;
    }
    rows.push(
      <li key={line.id} className="cm-dm-line is-mine cm-msg-in">
        <div className={`cm-dm-bubble ${line.note.photo ? "has-photo" : ""} ${line.note.voice ? "has-voice" : ""}`}>
          <span className="cm-sr">You: </span>
          {line.note.photo && <img src={line.note.photo} alt="Your photo" />}
          {line.note.voice ? <VoiceNote words={line.note.text} label="your voice note" mine /> : line.note.text && <p>{line.note.text}</p>}
        </div>
        <span className="cm-dm-time">
          {clockLabel(line.at)}
          {line.removable && <>{" · "}<button type="button" className="cm-dm-remove" onClick={() => communityStore.removeDirect(chat.id, line.id)}>Remove<span className="cm-sr"> your message</span></button></>}
        </span>
      </li>,
    );
  });
  return (
    <>
      <ol className="cm-dm-lines">
        {rows.length === 0 && <li className="cm-log-note">{`No messages yet. Say hello to ${chat.name}.`}</li>}
        {rows}
      </ol>
      {typing && <TypingRow who={chat.id} />}
    </>
  );
}

/** The writing row for a friend, with replies that take one tap. `compact` is the little window's. */
export function DirectComposer({ chat, compact = false }: { chat: DirectChat; compact?: boolean }) {
  const memory = useCommunity();
  const [status, setStatus] = useState("");
  const quick = chat.conversation?.quickReplies ?? newConversation.quickReplies;
  const off = memory.settings.messagesFrom === "noOne";
  const send = (draft: NoteDraft) => {
    const note = sendDirect(memory, chat.id, draft);
    if (note) setStatus(`Sent to ${chat.name}: ${note.text || "your photo"}`);
  };
  return (
    <div className="cm-dm-foot">
      {off && (
        <p className="cm-dm-off">
          <PauseCircleIcon size={18} />
          <span>Messages to you are off, so friends can't write back. <Link className="cm-inline-link" href={communityHref("friends")}>Change who can message you</Link></span>
        </p>
      )}
      <div className="cm-dm-quick" role="group" aria-label={`Quick replies to ${chat.name}`}>
        {quick.map(words => <button key={words} type="button" className="cm-dm-chip" onClick={() => send({ text: words })}>{words}</button>)}
      </div>
      <ChatInput label={`Write to ${chat.name}`} placeholder={compact ? "Write a message" : `Write to ${chat.name}`} onSend={send} allowPhoto={!compact} sendText={compact ? undefined : "Send"} />
      <p className="cm-sr" role="status">{status}</p>
    </div>
  );
}

/** "Larger text": the community's text size, bigger or back to normal. */
function LargerText() {
  const on = useCommunity().settings.textSize === "bigger";
  return (
    <button type="button" className={`cm-dm-tool ${on ? "is-on" : ""}`} aria-pressed={on} onClick={() => communityStore.updateSettings({ textSize: on ? "normal" : "bigger" })}>
      <span className="cm-dm-aa" aria-hidden="true">Aa</span><span>Larger text</span>
    </button>
  );
}

/** "Read aloud": the device's own voice reads the newest lines from them. */
function ReadAloud({ chat }: { chat: DirectChat }) {
  const theirs = chat.lines.filter(isTheirs).slice(-3);
  const words = theirs.length ? `${chat.name} says: ${theirs.map(line => line.text).join(" ")}` : `There are no messages from ${chat.name} yet.`;
  const { playing, toggle } = useVoiceNote(words, voiceSeconds(words));
  return (
    <button type="button" className={`cm-dm-tool ${playing ? "is-on" : ""}`} aria-pressed={playing} onClick={toggle}>
      {playing ? <StopIcon size={14} /> : <SpeakerIcon size={16} />}<span>{playing ? "Stop reading" : "Read aloud"}</span>
    </button>
  );
}

/* --------------------------------------------------------------- the list */

function ChatRow({ chat, on }: { chat: Chat; on: boolean }) {
  const search = useSearch();
  const href = messagesHref(chat.id);
  return (
    <li>
      <Link className={`cm-dm-row ${on ? "is-on" : ""} ${chat.unread > 0 ? "is-unread" : ""}`} href={href} replace={leadsHere(href, search)} aria-current={on ? "page" : undefined}>
        {chat.kind === "direct" ? <OnlineFace who={chat.id} size={48} online={chat.online} /> : <Cover cover={chat.group.cover} className="cm-dm-cover" />}
        <span className="cm-dm-row-text">
          <span className="cm-dm-row-top"><b>{chat.name}</b><span className="cm-dm-when">{shortWhen(chat.lastAt)}</span></span>
          <span className="cm-dm-snippet">{chat.snippet}</span>
        </span>
        {chat.unread > 0 && <span className="cm-dm-dot" aria-hidden="true" />}
        <span className="cm-sr">{`${chat.unread > 0 ? `, ${chat.unread} unread` : ""}${chat.kind === "direct" && chat.muted ? ", notifications muted" : ""}`}</span>
      </Link>
    </li>
  );
}

/** "New": the person's friends, to write to one of them. */
function NewMessage({ id, onClose }: { id: string; onClose: () => void }) {
  const memory = useCommunity();
  const friends = friendsToMessage(memory);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
  return (
    <div className="cm-dm-new cm-pop" id={id} onKeyDown={onKeyDown}>
      <div className="cm-dm-new-head">
        <p>Write to a friend</p>
        <button type="button" className="cm-dm-icon" aria-label="Close the list of friends" onClick={onClose}><CloseIcon size={16} /></button>
      </div>
      {friends.length ? (
        <ul>
          {friends.map(who => (
            <li key={who}>
              <Link className="cm-dm-new-row" href={messagesHref(who)} onClick={onClose}><Face who={who} size={34} /><span>{people[who].name}</span></Link>
            </li>
          ))}
        </ul>
      ) : <p className="cm-plain-empty">No friends here yet. Add some in Friends.</p>}
    </div>
  );
}

/* -------------------------------------------------- who it is with */

function PersonPanel({ chat, onPersonMenu }: { chat: DirectChat; onPersonMenu: OpenSafetyMenu }) {
  const memory = useCommunity();
  const titleId = useId();
  const who = chat.id;
  const shared = groupsWith(who);
  const groups = myGroups(memory).filter(group => shared.includes(group.id));
  const mutual = mutualFriends(memory, who);
  const conversation = chat.conversation;
  const mutualText = mutual.length === 0 ? "" : mutual.length === 1 ? people[mutual[0]].name : `${people[mutual[0]].name} and ${mutual.length - 1} ${mutual.length === 2 ? "other" : "others"}`;
  return (
    <aside className="cm-dm-side" aria-labelledby={titleId}>
      <div className="cm-dm-banner" style={{ background: people[who].tint }} aria-hidden="true">
        <svg viewBox="0 0 300 100" preserveAspectRatio="none" focusable="false"><path d="M0 70H120L150 22 178 88 198 52 214 70H300" /></svg>
      </div>
      <span className="cm-dm-big"><OnlineFace who={who} size={96} online={chat.online} /></span>
      <h3 id={titleId} className="cm-dm-side-name">{chat.name}</h3>
      <p className="cm-dm-side-line">{`${people[who].town} · ${chat.status}`}</p>
      <div className="cm-dm-facts">
        <p className="cm-dm-label">About</p>
        <p className="cm-dm-about">{conversation?.about ?? people[who].about}</p>
        {conversation && (
          <>
            <hr />
            <p className="cm-dm-label">Member of Rehyn since</p>
            <p className="cm-dm-fact"><CalendarIcon size={16} /><span>{conversation.memberSince}</span></p>
            <p className="cm-dm-label">Friends since</p>
            <p className="cm-dm-fact"><HeartIcon size={16} /><span>{conversation.friendsSince}</span></p>
          </>
        )}
        {(groups.length > 0 || mutual.length > 0) && <hr />}
        {groups.length > 0 && (
          <>
            <p className="cm-dm-label">Mutual groups</p>
            <ul className="cm-dm-groups">
              {groups.map(group => <li key={group.id}><Link className="cm-dm-group" href={communityHref("groups", group.id)}>{group.name}</Link></li>)}
            </ul>
          </>
        )}
        {mutual.length > 0 && (
          <>
            <p className="cm-dm-label">Mutual friends</p>
            <p className="cm-dm-mutual"><span className="cm-face-stack" aria-hidden="true">{mutual.map(friend => <Face key={friend} who={friend} size={30} />)}</span><span>{mutualText}</span></p>
          </>
        )}
      </div>
      <button type="button" className={`cm-dm-side-button ${chat.muted ? "is-on" : ""}`} aria-pressed={chat.muted} onClick={() => communityStore.toggleChatMuted(who)}>
        {chat.muted ? <BellOffIcon size={18} /> : <BellIcon size={18} />}<span>{chat.muted ? "Notifications muted" : "Mute notifications"}</span>
      </button>
      <button type="button" className="cm-dm-side-button is-rust" aria-haspopup="dialog" onClick={event => onPersonMenu({ who, postId: null }, event.currentTarget)}>
        Block or report<span className="cm-sr">{` ${chat.name}`}</span>
      </button>
    </aside>
  );
}

function GroupPanel({ chat }: { chat: GroupChat }) {
  const memory = useCommunity();
  const titleId = useId();
  const group = chat.group;
  const faces = group.faces.filter(who => canSee(memory, who));
  return (
    <aside className="cm-dm-side" aria-labelledby={titleId}>
      <Cover cover={group.cover} className="cm-dm-banner" iconSize={44} />
      <h3 id={titleId} className="cm-dm-side-name is-group">{group.name}</h3>
      <p className="cm-dm-side-line">{group.online > 0 ? `${group.meta} · ${group.online} online` : group.meta}</p>
      <div className="cm-dm-facts">
        <p className="cm-dm-label">About</p>
        <p className="cm-dm-about">{group.about}</p>
        {faces.length > 0 && (
          <>
            <hr />
            <p className="cm-dm-label">Members you know</p>
            <p className="cm-dm-mutual"><span className="cm-face-stack" aria-hidden="true">{faces.map(who => <Face key={who} who={who} size={30} />)}</span><span>{faces.map(who => people[who].name).join(", ")}</span></p>
          </>
        )}
      </div>
      <Link className="cm-dm-side-button" href={communityHref("groups", group.id)}>Open the group page</Link>
    </aside>
  );
}

/* -------------------------------------------------------- conversations */

function GroupConversation({ chat, headingProps, back }: { chat: GroupChat; headingProps: Record<string, unknown>; back: ReactNode }) {
  const memory = useCommunity();
  const group = chat.group;
  const [status, setStatus] = useState("");
  const own = memory.messages[group.id] ?? [];
  const lines = [
    ...group.messages.filter(message => canSee(memory, message.who)).map(message => ({ at: 0, node: <TheirMessage key={message.id} message={message} heartKey={`group:${group.id}:${message.id}`} /> })),
    ...(group.started?.hello ? [{ at: group.started.createdAt, node: <MyMessage key="hello" note={{ text: group.started.hello, photo: null, voice: false }} /> }] : []),
    ...own.map(note => ({ at: note.createdAt, node: <MyMessage key={note.id} note={note} onRemove={() => communityStore.removeMessage(group.id, note.id)} /> })),
  ].sort((a, b) => a.at - b.at);
  const { box, onScroll } = usePinnedToEnd<HTMLDivElement>(`${group.id}:${lines.length}`, true);
  const send = (draft: NoteDraft) => {
    const note = communityStore.addMessage(group.id, draft);
    if (note) setStatus(`Sent: ${note.text || "your photo"}`);
  };
  return (
    <section className="cm-dm-main" aria-label={`Messages in ${group.name}`}>
      <header className="cm-dm-head">
        {back}
        <Cover cover={group.cover} className="cm-dm-head-cover" />
        <div className="cm-dm-head-text">
          <h2 {...headingProps}>{group.name}</h2>
          <p>{group.online > 0 ? `${group.online} online now` : group.meta}</p>
        </div>
        <div className="cm-dm-tools"><LargerText /></div>
      </header>
      <div className="cm-dm-log" ref={box} onScroll={onScroll} role="log" aria-live="off" aria-label={`Messages in ${group.name}`} tabIndex={0}>
        <ol className="cm-messages">
          {lines.length === 0 && <li className="cm-log-note">It's just you here for now. Say the first hello.</li>}
          {lines.map(line => line.node)}
        </ol>
      </div>
      <div className="cm-dm-foot">
        <div className="cm-dm-quick" role="group" aria-label="Quick replies">
          {groupQuickReplies.map(reply => <button key={reply.label} type="button" className={`cm-dm-chip ${toneClass(reply.tone)}`} onClick={() => send({ text: reply.text })}>{reply.label}</button>)}
        </div>
        <ChatInput label={`Message ${group.name}`} placeholder={`Write to ${group.name}`} onSend={send} allowPhoto sendText="Send" />
        <p className="cm-sr" role="status">{status}</p>
      </div>
    </section>
  );
}

function DirectConversation({ chat, headingProps, back, active }: { chat: DirectChat; headingProps: Record<string, unknown>; back: ReactNode; active: boolean }) {
  const visit = useChatVisit();
  const typing = visit.typing === chat.id;
  const { box, onScroll } = usePinnedToEnd<HTMLDivElement>(`${chat.id}:${chat.lines.length}:${typing}`, active);
  return (
    <section className="cm-dm-main" aria-label={`Messages with ${chat.name}`}>
      <header className="cm-dm-head">
        {back}
        <OnlineFace who={chat.id} size={56} online={chat.online} />
        <div className="cm-dm-head-text">
          <h2 {...headingProps}>{chat.name}</h2>
          <p>{chat.status}</p>
        </div>
        <div className="cm-dm-tools"><LargerText /><ReadAloud chat={chat} /></div>
      </header>
      <div className="cm-dm-log" ref={box} onScroll={onScroll} role="log" aria-live="off" aria-label={`Messages with ${chat.name}`} tabIndex={0}>
        <DirectLines chat={chat} typing={typing} />
      </div>
      <DirectComposer chat={chat} />
    </section>
  );
}

/* ------------------------------------------------------------------- view */

/**
 * The Messages tab. `chat` is the conversation the address names; on a wide screen the newest one
 * opens when it names none. Opening a conversation reads what was waiting in it. `onPersonMenu`
 * opens the hide, block or report sheet ("Block or report").
 */
export default function MessagesView({ active, chat: requested, onPersonMenu }: { active: boolean; chat: string | null; onPersonMenu: OpenSafetyMenu }) {
  const memory = useCommunity();
  const visit = useChatVisit();
  const single = useMediaQuery("(max-width: 1020px)");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const newId = useId();
  const chats = allChats(memory, visit);
  const named = chatById(memory, requested, visit);
  const selected = named ?? (single ? null : chats[0] ?? null);
  const words = query.trim().toLowerCase();
  const listed = chats.filter(chat => (filter === "all" || (filter === "unread" ? chat.unread > 0 : chat.kind === "group"))
    && (!words || chat.name.toLowerCase().includes(words) || chat.snippet.toLowerCase().includes(words)));
  const showChat = !!selected && (!single || !!named);

  // Opening a conversation reads it: the friend's unread lines, or the group's badge.
  useEffect(() => {
    if (!active || !showChat || !selected || selected.unread === 0) return;
    if (selected.kind === "direct") communityStore.markChatRead(selected.id);
    else communityStore.markRead(selected.id);
  }, [active, showChat, selected?.kind, selected?.id, selected?.unread]);

  // The view's heading, where the focus goes as the view opens: the conversation's name when only it shows.
  const heading = { tabIndex: -1, ...(single && showChat ? { "data-view-heading": true } : {}) };
  const back = single ? <Link className="cm-dm-back" href={messagesHref()} aria-label="All messages"><BackIcon size={20} /></Link> : null;
  const empty = filter === "unread" ? "You're all caught up." : filter === "groups" ? "No groups yet." : "No messages yet.";

  return (
    <div className={`cm-dm cm-card ${single ? "is-single" : ""} ${showChat ? "has-chat" : ""}`}>
      <section className="cm-dm-list" aria-labelledby="cm-dm-title">
        <div className="cm-dm-list-head">
          <h2 id="cm-dm-title" tabIndex={-1} {...(single && showChat ? {} : { "data-view-heading": true })}>Messages</h2>
          <button type="button" className="cm-dm-new-button" aria-expanded={picking} aria-controls={picking ? newId : undefined} onClick={() => setPicking(!picking)}><PenIcon size={16} /><span>New</span><span className="cm-sr"> message</span></button>
        </div>
        {picking && <NewMessage id={newId} onClose={() => setPicking(false)} />}
        <label className="cm-dm-search">
          <SearchIcon size={18} />
          <span className="cm-sr">Search messages</span>
          <input type="search" value={query} maxLength={40} placeholder="Search messages" autoComplete="off" spellCheck={false} onChange={event => setQuery(event.target.value)}
            onKeyDown={event => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } }} />
        </label>
        <div className="cm-segments cm-dm-filters" role="group" aria-label="Show">
          {FILTERS.map(item => <button key={item.id} type="button" className="cm-segment" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}
        </div>
        <p className="cm-sr" role="status">{words ? `${listed.length} ${listed.length === 1 ? "conversation" : "conversations"} found` : ""}</p>
        <ul className="cm-dm-rows" aria-label="Conversations">
          {listed.map(chat => <ChatRow key={chat.id} chat={chat} on={showChat && chat.id === selected?.id} />)}
        </ul>
        {listed.length === 0 && <p className="cm-plain-empty cm-dm-empty">{words ? `Nothing matches “${query.trim()}”.` : empty}</p>}
      </section>

      {showChat && selected && (selected.kind === "direct"
        ? <DirectConversation key={selected.id} chat={selected} headingProps={heading} back={back} active={active} />
        : <GroupConversation key={selected.id} chat={selected} headingProps={heading} back={back} />)}
      {showChat && selected && (selected.kind === "direct" ? <PersonPanel chat={selected} onPersonMenu={onPersonMenu} /> : <GroupPanel chat={selected} />)}
      {!showChat && !single && <p className="cm-dm-none">Choose a conversation, or press New to write to a friend.</p>}
    </div>
  );
}
