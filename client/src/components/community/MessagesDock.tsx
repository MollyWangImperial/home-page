import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "wouter";
import type { PersonId } from "@/content/community-samples";
import { alertsQuiet, communityStore, messagesHref, shortWhen, useCommunity, type CommunitySpace } from "@/lib/community-store";
import { usePinnedToEnd } from "./hooks";
import { BackIcon, ChevronDownIcon, ChevronUpIcon } from "./icons";
import { DirectComposer, DirectLines, OnlineFace } from "./Messages";
import { chatById, directChats, useChatVisit } from "./messages-model";
import { Face } from "./parts";

/**
 * The little Messages window at the bottom of each community page. It shows itself when a friend's
 * message is waiting, with who it is from and the start of it; opened, it is a small chat (or the
 * list of conversations), so a reply needs no trip to the Messages tab. It stays out of the way on
 * Messages itself, while a group is being started, and (until it is opened) during quiet time.
 */
export default function MessagesDock({ space }: { space: CommunitySpace }) {
  const memory = useCommunity();
  const visit = useChatVisit();
  const [open, setOpen] = useState(false);
  // Once opened in this visit, it stays, so it can be opened again after everything is read.
  const [used, setUsed] = useState(false);
  const [chatId, setChatId] = useState<PersonId | null>(null);
  const bar = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const panelId = useId();
  const chats = directChats(memory, visit);
  // Conversations waiting to be read, as the Messages tab counts them.
  const waiting = chats.filter(chat => chat.unread > 0 && !chat.muted);
  const unread = waiting.length;
  const found = chatId ? chatById(memory, chatId, visit) : null;
  const chat = found?.kind === "direct" ? found : null;
  const typing = !!chat && visit.typing === chat.id;
  const away = space === "messages" || space === "start";
  const { box, onScroll } = usePinnedToEnd<HTMLDivElement>(`${chat?.id ?? ""}:${chat?.lines.length ?? 0}:${typing}`, open && !!chat);

  useEffect(() => { if (away) setOpen(false); }, [away]);
  // A conversation open in the window is being read.
  useEffect(() => { if (open && chat && chat.unread > 0) communityStore.markChatRead(chat.id); }, [open, chat?.id, chat?.unread]);
  // Whatever the window shows next, its heading takes the focus, so a keyboard carries on from there.
  useEffect(() => { if (open) window.requestAnimationFrame(() => heading.current?.focus()); }, [open, chatId]);

  if (away || (!open && !used && (unread === 0 || alertsQuiet(memory.settings)))) return null;

  const expand = () => { setChatId(waiting[0]?.id ?? null); setOpen(true); setUsed(true); };
  const collapse = () => { setOpen(false); window.requestAnimationFrame(() => bar.current?.focus()); };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => { if (event.key === "Escape") { event.preventDefault(); collapse(); } };
  const newest = waiting[0] ?? null;

  if (!open) {
    const faces = (waiting.length ? waiting : chats).slice(0, 2);
    return (
      <button ref={bar} type="button" className="cm-dock-bar cm-rise" aria-expanded={false} aria-controls={panelId} onClick={expand}>
        <span className="cm-face-stack cm-dock-faces" aria-hidden="true">{faces.map(item => <Face key={item.id} who={item.id} size={34} />)}</span>
        <span className="cm-dock-text">
          <span className="cm-dock-title"><b>Messages</b>{unread > 0 && <span className="cm-dock-count">{`${unread} unread`}</span>}</span>
          <span className="cm-dock-snippet">{newest ? `${newest.name}: ${newest.snippet}` : "No new messages"}</span>
        </span>
        <span className="cm-dock-chevron" aria-hidden="true"><ChevronUpIcon size={18} /></span>
      </button>
    );
  }

  return (
    <section id={panelId} className="cm-dock-panel cm-pop" aria-label="Messages" onKeyDown={onKeyDown}>
      <header className="cm-dock-head">
        {chat ? (
          <>
            <button type="button" className="cm-dock-round" aria-label="All conversations" onClick={() => setChatId(null)}><BackIcon size={18} /></button>
            <OnlineFace who={chat.id} size={40} online={chat.online} />
            <div className="cm-dock-who"><h2 ref={heading} tabIndex={-1}>{chat.name}</h2><p>{chat.status}</p></div>
          </>
        ) : (
          <div className="cm-dock-who"><h2 ref={heading} tabIndex={-1}>Messages</h2><p>{unread > 0 ? `${unread} unread` : "All caught up"}</p></div>
        )}
        <button type="button" className="cm-dock-round" aria-label="Close messages" aria-expanded={true} onClick={collapse}><ChevronDownIcon size={18} /></button>
      </header>
      {chat ? (
        <>
          <div className="cm-dock-log" ref={box} onScroll={onScroll} role="log" aria-live="off" aria-label={`Messages with ${chat.name}`} tabIndex={0}>
            <DirectLines chat={chat} typing={typing} />
          </div>
          <DirectComposer chat={chat} compact />
        </>
      ) : (
        <div className="cm-dock-body">
          <ul className="cm-dock-list" aria-label="Conversations">
            {chats.map(item => (
              <li key={item.id}>
                <button type="button" className={`cm-dock-row ${item.unread > 0 ? "is-unread" : ""}`} onClick={() => setChatId(item.id)}>
                  <OnlineFace who={item.id} size={40} online={item.online} />
                  <span className="cm-dm-row-text">
                    <span className="cm-dm-row-top"><b>{item.name}</b><span className="cm-dm-when">{shortWhen(item.lastAt)}</span></span>
                    <span className="cm-dm-snippet">{item.snippet}</span>
                  </span>
                  {item.unread > 0 && <span className="cm-dm-dot" aria-hidden="true" />}
                  <span className="cm-sr">{item.unread > 0 ? `, ${item.unread} unread` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
          {chats.length === 0 && <p className="cm-plain-empty">No conversations yet.</p>}
          <Link className="cm-dock-all" href={messagesHref()} onClick={() => setOpen(false)}>Open Messages</Link>
        </div>
      )}
    </section>
  );
}
