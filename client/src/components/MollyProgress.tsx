import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, SendHorizontal, Sprout, Square } from "lucide-react";
import AliraAvatar from "./AliraAvatar";
import { TypedChatText } from "./TypedChatText";
import { Markdown } from "./HowItWorks";
import { ProjectHeatmap } from "./ProjectHeatmap";
import { askAliraChannel, type ChannelStatus, type ChannelTurn } from "@/lib/alira-channel-client";
import { replyTo, typingMs, type Chip, type ProgressHistory, type ThreadMessage } from "@/lib/molly-progress";
import { mollyChatDay, mollyChatStore, startMollyChat, untilNextChatDay, type MollyDailyChat } from "@/lib/molly-daily-chat";
import "./molly-progress.css";

type Load = { state: "loading" } | { state: "error" } | { state: "ready"; history: ProgressHistory };
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Settings tab: the first visit each day reveals Molly's report; later visits restore the day's chat.
 * Data: /api/molly-progress, written by the 8pm job on Molly's machine and published to Render.
 */
export function MollyProgressPanel({ onOpenExercises }: { onOpenExercises: () => void }) {
  const [day, setDay] = useState(() => mollyChatDay());
  useEffect(() => {
    let midnight = 0;
    const checkDay = () => {
      setDay(mollyChatDay());
      window.clearTimeout(midnight);
      midnight = window.setTimeout(checkDay, untilNextChatDay());
    };
    checkDay();
    // Focus catches sleeping laptops; the interval also catches a clock/time-zone change.
    const interval = window.setInterval(checkDay, 60_000);
    window.addEventListener("focus", checkDay);
    document.addEventListener("visibilitychange", checkDay);
    return () => {
      window.clearTimeout(midnight);
      window.clearInterval(interval);
      window.removeEventListener("focus", checkDay);
      document.removeEventListener("visibilitychange", checkDay);
    };
  }, []);
  return <DailyProgress key={day} day={day} onOpenExercises={onOpenExercises} />;
}

function DailyProgress({ day, onOpenExercises }: { day: string; onOpenExercises: () => void }) {
  const [opened] = useState(() => mollyChatStore.read());
  const [load, setLoad] = useState<Load>(opened ? { state: "ready", history: opened.history } : { state: "loading" });
  const [shown, setShown] = useState<ThreadMessage[]>(opened?.messages ?? []);
  const [typing, setTyping] = useState(false);
  const [done, setDone] = useState(Boolean(opened));
  const [input, setInput] = useState(opened?.draft ?? "");
  const draft = useRef(opened?.draft ?? "");
  const [turns, setTurns] = useState<ChannelTurn[]>(opened?.turns ?? []);
  const [busy, setBusy] = useState(false);
  const [revealingTurn, setRevealingTurn] = useState<number | null>(null);
  const revealing = revealingTurn !== null;
  const [status, setStatus] = useState<ChannelStatus | null>(null);
  const abort = useRef<AbortController | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const navigationTimer = useRef<number>(0);
  const openExercisesAfterReply = useRef(false);
  const openExercises = useRef(onOpenExercises);
  openExercises.current = onOpenExercises;
  const saved = useRef<MollyDailyChat | null>(opened);
  const staticMessages = useRef(new Set(opened?.messages.map(message => message.id)));
  const thread = useRef<HTMLDivElement>(null);
  const restoreScroll = useRef(opened?.scrollTop ?? null);
  const scrollTimer = useRef(0);
  const queue = useRef<ThreadMessage[]>([]);
  const timer = useRef<number>(0);
  const end = useRef<HTMLDivElement>(null);
  const heatmap = useRef<HTMLDivElement>(null);
  const historyRef = useRef<ProgressHistory | null>(opened?.history ?? null);

  const remember = useCallback((patch: Partial<MollyDailyChat>) => {
    if (!saved.current) return;
    saved.current = { ...saved.current, ...patch };
    mollyChatStore.save(saved.current);
  }, []);

  useLayoutEffect(() => {
    if (restoreScroll.current !== null && thread.current) {
      thread.current.scrollTop = restoreScroll.current;
      restoreScroll.current = null;
    }
  }, []);

  const scroll = () => end.current?.scrollIntoView({ block: "end", behavior: reducedMotion() ? "auto" : "smooth" });

  const pump = useCallback(() => {
    window.clearTimeout(timer.current);
    const next = queue.current[0];
    if (!next) {
      setTyping(false); setDone(true);
      if (openExercisesAfterReply.current) {
        openExercisesAfterReply.current = false;
        navigationTimer.current = window.setTimeout(() => openExercises.current(), 600);
      }
      return;
    }
    setDone(false);
    if (next.from === "zak") {
      queue.current.shift();
      setShown(list => [...list, next]);
      pump();
      return;
    }
    if (next.kind === "text") {
      queue.current.shift();
      setShown(list => [...list, next]);
      setTyping(false);
      return; // The next item waits for TypedChatText to finish this new message.
    }
    setTyping(true);
    timer.current = window.setTimeout(() => {
      queue.current.shift();
      setShown(list => [...list, next]);
      setTyping(false);
      timer.current = window.setTimeout(pump, 260);
    }, reducedMotion() ? 0 : typingMs(next));
  }, []);

  const enqueue = useCallback((messages: ThreadMessage[]) => {
    queue.current.push(...messages);
    if (!typing) pump();
  }, [pump, typing]);

  useEffect(() => {
    let alive = true;
    if (!opened) fetch("/api/molly-progress", { cache: "no-store" })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((history: ProgressHistory) => {
        if (!alive || day !== mollyChatDay()) return;
        const chat = startMollyChat(history);
        chat.draft = draft.current;
        saved.current = chat;
        mollyChatStore.save(chat);
        historyRef.current = history;
        setLoad({ state: "ready", history });
        queue.current = chat.messages.slice();
        pump();
      })
      .catch(() => alive && setLoad({ state: "error" }));
    fetch("/api/alira/channel/status", { cache: "no-store" }).then(res => res.json()).then(data => { if (alive) setStatus(data); }).catch(() => { /* A send can still report a connection error. */ });
    const flush = () => { if (saved.current) mollyChatStore.save(saved.current); };
    window.addEventListener("pagehide", flush);
    return () => {
      alive = false;
      window.clearTimeout(timer.current);
      window.clearTimeout(navigationTimer.current);
      window.clearTimeout(scrollTimer.current);
      abort.current?.abort();
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [pump, opened, day]);

  useEffect(() => {
    if (opened && shown === opened.messages && turns === opened.turns) return;
    const latest = shown.at(-1);
    const heatmapShown = latest?.kind === "heatmap" || (latest?.kind === "chips" && shown.at(-2)?.kind === "heatmap");
    if (heatmapShown && done && turns.length === 0) heatmap.current?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    else scroll();
  }, [shown, typing, turns, busy, done]);

  const answer = (chip: Chip) => {
    if (!done || !saved.current || day !== mollyChatDay()) return;
    const index = saved.current.messages.length;
    const question: ThreadMessage = { id: `reply-${index}`, from: "zak", kind: "text", text: chip.label };
    const replies = replyTo(chip.id, historyRef.current).map((message, offset) => ({ ...message, id: `reply-${index + offset + 1}` }));
    remember({ messages: [...saved.current.messages, question, ...replies] });
    setShown(list => [...list, question]);
    openExercisesAfterReply.current = chip.id === "try";
    enqueue(replies);
  };

  const lastChips = [...shown].reverse().find(m => m.kind === "chips");
  const hasNewerAlira = lastChips ? shown.indexOf(lastChips) < shown.length - 1 : false;
  const unavailable = status && (!status.enabled || !status.configured);
  const waiting = load.state === "loading" || (load.state === "ready" && !done);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy || revealing || waiting || unavailable || day !== mollyChatDay()) return;
    const history: ChannelTurn[] = [...turns, { role: "user", text }];
    setTurns(history);
    setInput("");
    draft.current = "";
    remember({ turns: history, draft: "" });
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const reply = await askAliraChannel({ turns: history, signal: controller.signal, context: "molly-progress" });
      if (controller.signal.aborted || day !== mollyChatDay()) return;
      const next: ChannelTurn[] = [...history, { role: "assistant", text: reply.text }];
      remember({ turns: next });
      setRevealingTurn(next.length - 1);
      setTurns(next);
    } catch (error) {
      if (!controller.signal.aborted && day === mollyChatDay()) {
        const next: ChannelTurn[] = [...history, { role: "assistant", failed: true, text: error instanceof Error ? error.message : "I couldn't answer just now. Please try again." }];
        remember({ turns: next });
        setRevealingTurn(next.length - 1);
        setTurns(next);
      }
    } finally {
      if (!controller.signal.aborted) box.current?.focus();
      setBusy(false);
      abort.current = null;
    }
  }

  return (
    <div className="mp">
      <div ref={thread} className="mp-thread" role="log" aria-live="polite" aria-label="Alira's messages about Molly's progress" onScroll={event => {
        if (!saved.current) return;
        saved.current = { ...saved.current, scrollTop: event.currentTarget.scrollTop };
        window.clearTimeout(scrollTimer.current);
        scrollTimer.current = window.setTimeout(() => { if (saved.current) mollyChatStore.save(saved.current); }, 200);
      }}>
        {load.state === "loading" && <p className="mp-status">Alira is opening Molly's notes…</p>}
        {load.state === "error" && (
          <div className="mp-status" role="alert">
            <Sprout size={18} aria-hidden="true" />
            <p>I couldn't reach Molly's notes just now. Close this tab and open it again in a moment.</p>
          </div>
        )}
        {shown.map(message => <Bubble key={message.id} message={message} restored={staticMessages.current.has(message.id)} onMessageComplete={() => { timer.current = window.setTimeout(pump, 260); }} onChip={answer} heatmapRef={heatmap} showChips={message === lastChips && !hasNewerAlira && done && turns.length === 0} />)}
        {typing && (
          <div className="mp-row"><span className="mp-avatar mp-avatar-sm"><AliraAvatar /></span><div className="mp-typing" aria-label="Alira is typing"><i /><i /><i /></div></div>
        )}
        {turns.map((turn, index) => turn.role === "user" ? (
          <div className={`mp-row mp-row-zak${index < (opened?.turns.length ?? 0) ? " mp-history" : ""}`} key={`chat-${index}`}><div className="mp-bubble mp-zak">{turn.text}</div></div>
        ) : (
          <div className={`mp-row${index < (opened?.turns.length ?? 0) ? " mp-history" : ""}`} key={`chat-${index}`}>
            <span className="mp-avatar mp-avatar-sm"><AliraAvatar /></span>
            <div className={`mp-bubble ${turn.failed ? "hw-failed" : ""}`}>
              {index === revealingTurn
                ? <TypedChatText text={turn.text} onComplete={() => setRevealingTurn(null)} onProgress={() => end.current?.scrollIntoView({ block: "end" })}>{visible => turn.failed ? visible : <Markdown text={visible} />}</TypedChatText>
                : turn.failed ? turn.text : <Markdown text={turn.text} />}
            </div>
          </div>
        ))}
        {busy && <div className="mp-row"><span className="mp-avatar mp-avatar-sm"><AliraAvatar /></span><div className="mp-typing" role="status" aria-label="Alira is thinking"><i /><i /><i /></div></div>}
        <div ref={end} />
      </div>
      {unavailable && <p className="hw-note" role="alert">{!status.enabled ? "This chat is switched off on this site." : "Alira's thinking service isn't connected yet. Please try again later."}</p>}
      <form className="mp-form" onSubmit={event => { event.preventDefault(); void ask(input); }}>
        <label htmlFor="mp-input" className="chat-sr">Ask Alira about Molly's progress</label>
        <textarea id="mp-input" ref={box} rows={2} value={input} maxLength={2000} placeholder="Ask Alira about Molly's progress…" onChange={event => { draft.current = event.target.value; setInput(event.target.value); remember({ draft: event.target.value }); }} disabled={Boolean(unavailable)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(input); } }} />
        {busy ? <button type="button" className="mp-send" aria-label="Stop" onClick={() => abort.current?.abort()}><Square size={16} aria-hidden="true" /></button> : <button type="submit" className="mp-send" aria-label="Send" disabled={!input.trim() || revealing || waiting || Boolean(unavailable)}><SendHorizontal size={18} aria-hidden="true" /></button>}
      </form>
    </div>
  );
}

function Bubble({ message, restored, onMessageComplete, onChip, showChips, heatmapRef }: { message: ThreadMessage; restored: boolean; onMessageComplete: () => void; onChip: (chip: Chip) => void; showChips: boolean; heatmapRef: RefObject<HTMLDivElement | null> }) {
  if (message.from === "zak") return <div className={`mp-row mp-row-zak${restored ? " mp-history" : ""}`}><div className="mp-bubble mp-zak">{message.text}</div></div>;
  if (message.kind === "chips") {
    return showChips ? <div className={`mp-chips${restored ? " mp-history" : ""}`} role="group" aria-label="Reply to Alira">{message.chips.slice(0, 3).map(chip => <button key={chip.id} onClick={() => onChip(chip)}>{chip.label}</button>)}</div> : null;
  }
  return (
    <div className={`mp-row${restored ? " mp-history" : ""}`} ref={message.kind === "heatmap" ? heatmapRef : undefined}>
      <span className="mp-avatar mp-avatar-sm"><AliraAvatar /></span>
      {message.kind === "text" && <div className="mp-bubble">{restored ? message.text : <TypedChatText text={message.text} onComplete={onMessageComplete} />}</div>}
      {message.kind === "area" && <AreaCard message={message} />}
      {message.kind === "week" && <WeekCard message={message} />}
      {message.kind === "heatmap" && <ProjectHeatmap progress={message.progress} />}
      {message.kind === "numbers" && (
        <dl className="mp-card mp-numbers">{message.rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
      )}
    </div>
  );
}

function AreaCard({ message }: { message: Extract<ThreadMessage, { kind: "area" }> }) {
  const [open, setOpen] = useState(false);
  const id = `mp-benefit-${message.id}`;
  return (
    <div className="mp-card">
      <b>{message.title}</b>
      <p>{message.body}</p>
      <button className="mp-more" aria-expanded={open} aria-controls={id} onClick={() => setOpen(v => !v)}>
        What this means for you <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && <p id={id} className="mp-benefit">{message.benefit}</p>}
    </div>
  );
}

function WeekCard({ message }: { message: Extract<ThreadMessage, { kind: "week" }> }) {
  const max = Math.max(1, ...message.bars.map(b => b.lines));
  const summary = message.bars.map(b => `${b.label}: ${b.quiet ? "quiet" : `${b.lines} lines`}`).join(", ");
  return (
    <figure className="mp-card mp-week">
      <svg viewBox="0 0 210 92" role="img" aria-label={`Molly's week. ${summary}`}>
        {message.bars.map((bar, i) => {
          const h = bar.quiet ? 3 : 8 + (bar.lines / max) * 56;
          return (
            <g key={bar.date}>
              <rect x={i * 30 + 5} y={70 - h} width="20" height={h} rx="5" className={bar.quiet ? "quiet" : "busy"} />
              <text x={i * 30 + 15} y="86" textAnchor="middle">{bar.label}</text>
            </g>
          );
        })}
      </svg>
      <figcaption>{message.caption}</figcaption>
    </figure>
  );
}
