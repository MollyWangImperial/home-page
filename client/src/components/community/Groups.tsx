import { useEffect, useId, useState } from "react";
import { Link, useLocation } from "wouter";
import { groupQuickReplies, inviteFriends, people, suggestedGroups, type GroupMessage, type PersonId, type SuggestedGroupId } from "@/content/community-samples";
import { canSee, communityHref, communityStore, isBlocked, listNames, useCommunity, type NoteDraft, type OwnNote } from "@/lib/community-store";
import { lastLine, myGroups, type GroupModel } from "./group-model";
import { useBursts, usePinnedToEnd } from "./hooks";
import { CheckIcon, HeartIcon, PlusIcon } from "./icons";
import { ChatInput, Cover, Face, FloatingHearts, LiveDot, MyFace, MyMessage, TheirMessage, toneClass, TypingRow } from "./parts";

const nameOf = (who: PersonId) => people[who].name;

type LogLine =
  | { kind: "theirs"; at: number; message: GroupMessage }
  | { kind: "mine"; at: number; note: OwnNote }
  | { kind: "hello"; at: number; text: string };

/** "This week: a photo of something growing" becomes "A photo of something growing", under "This week's group challenge". */
const challengeWords = (text: string) => { const words = text.replace(/^This week:\s*/i, ""); return words.charAt(0).toUpperCase() + words.slice(1); };

function Challenge({ group }: { group: GroupModel }) {
  const joined = useCommunity().challenges.includes(group.id);
  const { done: base, total, text } = group.challenge;
  const done = Math.min(total, base + (joined ? 1 : 0));
  return (
    <div className="cm-challenge">
      <span className="cm-challenge-count" aria-hidden="true">{done}</span>
      <div className="cm-challenge-body">
        <p className="cm-overline cm-overline-gold">This week's group challenge</p>
        <p className="cm-challenge-text">{challengeWords(text)}</p>
        <div className="cm-progress-row">
          <span className="cm-progress" role="progressbar" aria-label="Done this week" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={`${done} of ${total}`}>
            <span className="cm-progress-fill" style={{ width: `${Math.round((done * 100) / total)}%` }} />
          </span>
          <span className="cm-progress-text" aria-hidden="true">{done} of {total} done</span>
        </div>
      </div>
      <button type="button" className={`cm-challenge-join ${joined ? "is-on" : ""}`} aria-pressed={joined} onClick={() => communityStore.toggleChallenge(group.id)}>
        {joined ? <><CheckIcon size={14} />You're in</> : "Join in"}<span className="cm-sr">{joined ? ", tap to leave the challenge" : " the challenge"}</span>
      </button>
    </div>
  );
}

/**
 * "+ Invite a friend": the example friends who could come along (never anyone blocked). Nothing is
 * sent anywhere.
 */
function InvitePanel({ group, id, invited, onToggle }: { group: GroupModel; id: string; invited: PersonId[]; onToggle: (who: PersonId) => void }) {
  const memory = useCommunity();
  const candidates = (group.kind === "started" ? inviteFriends : inviteFriends.filter(who => !group.faces.includes(who))).filter(who => !isBlocked(memory, who));
  return (
    <div className="cm-invite-panel cm-pop" id={id}>
      <p className="cm-invite-note">These are example friends, so nothing is sent.</p>
      {candidates.length ? (
        <ul>
          {candidates.map(who => {
            const on = invited.includes(who);
            return (
              <li key={who}>
                <Face who={who} size={36} />
                <span className="cm-invite-name">{nameOf(who)}</span>
                <button type="button" className={`cm-remind ${on ? "is-on" : ""}`} onClick={() => onToggle(who)}>
                  {on ? "Invited" : "Invite"}<span className="cm-sr">{` ${nameOf(who)}`}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="cm-invite-note">Everyone you know here is already in this group.</p>}
    </div>
  );
}

/**
 * F3: my groups. Switch groups, clear unread badges, join the weekly challenge, join suggested groups.
 * Messages from people the person has blocked or hidden are left out.
 */
export default function GroupsView({ active, requested }: { active: boolean; requested: string | null }) {
  const memory = useCommunity();
  const shown = (who: PersonId) => canSee(memory, who);
  // Blocked people are out of sight: not in the face stacks, the invites or the names.
  const inSight = (who: PersonId) => !isBlocked(memory, who);
  const [, navigate] = useLocation();
  const groups = myGroups(memory);
  const selected = groups.find(group => group.id === requested) ?? groups.find(group => group.id === "garden") ?? groups[0];
  const [delivered, setDelivered] = useState<Record<string, number>>({});
  const [typing, setTyping] = useState<{ group: string; who: PersonId } | null>(null);
  const [invites, setInvites] = useState<Record<string, PersonId[]>>({});
  const [inviting, setInviting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [sentNote, setSentNote] = useState("");
  const { bursts, burst } = useBursts();
  const panelId = useId();

  const own = memory.messages[selected.id] ?? [];
  const deliveredAt = delivered[selected.id];
  const log: LogLine[] = [
    ...selected.messages.filter(message => shown(message.who)).map(message => ({ kind: "theirs" as const, at: 0, message })),
    ...(selected.started?.hello ? [{ kind: "hello" as const, at: selected.started.createdAt, text: selected.started.hello }] : []),
    ...own.map(note => ({ kind: "mine" as const, at: note.createdAt, note })),
    ...(deliveredAt !== undefined && selected.incoming && shown(selected.incoming.who) ? [{ kind: "theirs" as const, at: deliveredAt, message: selected.incoming }] : []),
  ].sort((a, b) => a.at - b.at);
  const writing = typing && typing.group === selected.id && shown(typing.who) ? typing.who : null;
  const { box, onScroll } = usePinnedToEnd<HTMLDivElement>(`${selected.id}:${log.length}:${writing ?? ""}`, active);

  // Opening a group clears its unread badge.
  useEffect(() => { if (active && selected.unread > 0) communityStore.markRead(selected.id); }, [active, selected.id, selected.unread]);
  useEffect(() => { setInviting(false); setClosing(false); }, [selected.id]);
  // While a group is open, one more message arrives: first "is writing", then the message.
  useEffect(() => {
    const incoming = selected.incoming;
    if (!active || !incoming || delivered[selected.id] !== undefined) return;
    const timer = window.setTimeout(() => {
      if (typing?.group !== selected.id) setTyping({ group: selected.id, who: incoming.who });
      else { setTyping(null); setDelivered(list => ({ ...list, [selected.id]: Date.now() })); }
    }, 2400);
    return () => window.clearTimeout(timer);
  }, [active, selected.id, selected.incoming, typing, delivered]);

  const send = (draft: NoteDraft) => {
    const note = communityStore.addMessage(selected.id, draft);
    if (note) setSentNote(`Sent: ${note.text || "your photo"}`);
  };
  const started = selected.started;
  const invited = (started ? started.friends : invites[selected.id] ?? []).filter(inSight);
  const toggleInvite = (who: PersonId) => {
    if (started) communityStore.toggleGroupFriend(started.id, who);
    else setInvites(list => {
      const current = list[selected.id] ?? [];
      return { ...list, [selected.id]: current.includes(who) ? current.filter(other => other !== who) : [...current, who] };
    });
  };
  const close = () => {
    if (!started) return;
    communityStore.closeGroup(started.id);
    navigate(communityHref("groups"), { replace: true });
  };

  const side = (
    <div className="cm-side">
      <section className="cm-card cm-side-card cm-group-list" aria-labelledby="cm-group-list-title">
        <h3 className="cm-side-title" id="cm-group-list-title">Your groups</h3>
        <ul>
          {groups.map(group => {
            const on = group.id === selected.id;
            const unread = on ? 0 : group.unread;
            return (
              <li key={group.id}>
                <Link className={`cm-group-pick ${on ? "is-on" : ""}`} href={communityHref("groups", group.id)} aria-current={on ? "page" : undefined}>
                  <span className="cm-cover-wrap">
                    <Cover cover={group.cover} className="cm-cover-thumb" />
                    {group.active && <span className="cm-cover-live cm-live" aria-hidden="true" />}
                  </span>
                  <span className="cm-group-text"><b>{group.name}</b><span>{lastLine(group, memory, delivered[group.id] ?? null, nameOf, shown)}</span></span>
                  {unread > 0 && <span className="cm-badge cm-pop"><span aria-hidden="true">{unread}</span><span className="cm-sr">{`, ${unread} unread`}</span></span>}
                </Link>
              </li>
            );
          })}
        </ul>
        <Link className="cm-start-link" href={communityHref("start")}><PlusIcon size={18} /><span>Start a group</span></Link>
      </section>

      <section className="cm-card cm-side-card" aria-labelledby="cm-suggest-title">
        <h3 className="cm-overline cm-overline-rust" id="cm-suggest-title">Groups you might like</h3>
        <ul className="cm-suggestions">
          {suggestedGroups.map(group => {
            const on = memory.joined.includes(group.id as SuggestedGroupId);
            return (
              <li key={group.id}>
                <Cover cover={group.cover} className="cm-cover-thumb" />
                <span className="cm-group-text">
                  <b>{group.name}</b>
                  {on ? <Link className="cm-inline-link" href={communityHref("groups", group.id)}>Welcome! Say hello</Link> : <span>{group.why}</span>}
                </span>
                <button type="button" className={`cm-join ${on ? "is-on cm-pop" : ""}`} onClick={() => { communityStore.toggleJoined(group.id as SuggestedGroupId); if (!on) burst(); }}>
                  {on ? "Joined" : "Join"}<span className="cm-sr">{` ${group.name}`}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );

  return (
    <div className="cm-layout cm-groups">
      {side}
      <section className="cm-card cm-chat cm-group" aria-labelledby="cm-group-title">
        <Cover cover={selected.cover} className="cm-group-band" iconSize={56} />
        <header className="cm-group-head">
          <Cover cover={selected.cover} className="cm-group-tile" iconSize={34} />
          <div className="cm-group-titles">
            <h2 id="cm-group-title" tabIndex={-1} data-view-heading>{selected.name}</h2>
            <p className="cm-group-meta">
              <span>{selected.meta}</span>
              {selected.online > 0 && <><LiveDot tone="green" className="cm-meta-dot" /><span className="cm-online">{selected.online} online</span></>}
              <span className="cm-face-stack cm-group-faces" aria-hidden="true">
                {started && <MyFace size={28} />}
                {selected.faces.filter(inSight).slice(0, 4).map(who => <Face key={who} who={who} size={28} />)}
              </span>
            </p>
          </div>
          <span className="cm-group-actions">
            <button type="button" className={`cm-invite ${!started && invited.length ? "is-on" : ""}`} aria-expanded={inviting} aria-controls={inviting ? panelId : undefined} onClick={() => setInviting(!inviting)}>
              {!started && invited.length ? `${invited.length} invited` : "+ Invite a friend"}
            </button>
            <span className="cm-joined-pill"><CheckIcon size={14} />{started ? "Yours" : "Joined"}</span>
          </span>
        </header>
        <p className="cm-group-about">{selected.about}</p>
        {inviting && <InvitePanel group={selected} id={panelId} invited={invited} onToggle={toggleInvite} />}
        {started && (
          <div className="cm-started-bar">
            {closing ? (
              <span className="cm-confirm" role="group" aria-label={`Close ${started.name}?`}>
                <span>{`Close ${started.name}? It will be removed from this device.`}</span>
                <button type="button" className="cm-btn cm-btn-small cm-btn-rust" onClick={close}>Close it</button>
                <button type="button" className="cm-btn cm-btn-small cm-btn-quiet" onClick={() => setClosing(false)}>Keep it</button>
              </span>
            ) : (
              <>
                <span>{invited.length ? `You started this group with ${listNames(invited.map(nameOf))}.` : "You started this group."}</span>
                <button type="button" className="cm-text-button" onClick={() => setClosing(true)}>Close group</button>
              </>
            )}
          </div>
        )}
        <Challenge group={selected} />
        <div className="cm-chat-log" ref={box} onScroll={onScroll} role="log" aria-live="off" aria-label={`Messages in ${selected.name}`} tabIndex={0}>
          <div className="cm-chat-fade" aria-hidden="true" />
          <ol className="cm-messages">
            {log.length === 0 && <li className="cm-log-note">It's just you here for now. Say the first hello.</li>}
            {log.map(line => line.kind === "theirs"
              ? <TheirMessage key={line.message.id} message={line.message} heartKey={`group:${selected.id}:${line.message.id}`} />
              : line.kind === "hello"
                ? <MyMessage key="hello" note={{ text: line.text, photo: null, voice: false }} onRemove={() => started && communityStore.setGroupHello(started.id, null)} />
                : <MyMessage key={line.note.id} note={line.note} onRemove={() => communityStore.removeMessage(selected.id, line.note.id)} />)}
          </ol>
          {writing && <TypingRow who={writing} />}
        </div>
        <FloatingHearts bursts={bursts} className="cm-hearts-chat" />
        <div className="cm-chat-foot">
          <div className="cm-quick-row" role="group" aria-label="Quick replies">
            {groupQuickReplies.map(reply => <button key={reply.label} type="button" className={`cm-quick ${toneClass(reply.tone)}`} onClick={() => send({ text: reply.text })}>{reply.label}</button>)}
            <button type="button" className="cm-love" aria-label="Send a heart" onClick={burst}><HeartIcon size={22} fill="currentColor" strokeWidth={1.6} /></button>
          </div>
          <ChatInput label="Message the group" placeholder="Message the group" onSend={send} allowPhoto sendText="Send" />
          <p className="cm-sr" role="status">{sentNote}</p>
        </div>
      </section>
    </div>
  );
}
