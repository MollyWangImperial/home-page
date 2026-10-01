import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { SendHorizontal, Square } from "lucide-react";
import AliraAvatar from "./AliraAvatar";
import { TypedChatText } from "./TypedChatText";
import { askAliraChannel } from "@/lib/alira-channel-client";
import { howItWorksVisitStore } from "@/lib/how-it-works-visit";
import "./how-it-works.css";

type Turn = { role: "user" | "assistant"; text: string; failed?: boolean };
type Status = { enabled: boolean; configured: boolean } | null;

const GREETING = "Hi Zak. Ask me how Molly built Alira: how patient scores are calculated, how exercises are assigned, and what happens behind the scenes. I can explain the logic and show you the code.";

const STARTERS = [
  "How are exercise scores calculated?",
  "How does Alira score the movement check?",
  "What is the difference between the two scores?",
];

/**
 * Settings tab: ask Alira how the website works. She is a Claude agent with read-only tools over the source code
 * (server/alira-channel.ts), so answers about scoring and logic come from the code itself.
 */
export function HowItWorksPanel() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [animateGreeting] = useState(() => !howItWorksVisitStore.hasVisited());
  const [greetingDone, setGreetingDone] = useState(!animateGreeting);
  const [revealing, setRevealing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { howItWorksVisitStore.remember(); }, []);

  useEffect(() => {
    fetch("/api/alira/channel/status", { cache: "no-store" }).then(r => r.json()).then(setStatus).catch(() => setStatus({ enabled: true, configured: true }));
    return () => abort.current?.abort();
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns, searching, busy]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy || revealing || !greetingDone) return;
    const history: Turn[] = [...turns, { role: "user", text }];
    setTurns(history);
    setInput("");
    setBusy(true);
    setSearching(false);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const answer = await askAliraChannel({ turns: history, signal: controller.signal, onStatus: () => setSearching(true) });
      if (controller.signal.aborted) return;
      setRevealing(true);
      setTurns(list => [...list, { role: "assistant", text: answer.text }]);
    } catch (error) {
      if (!controller.signal.aborted) {
        setRevealing(true);
        setTurns(list => [...list, { role: "assistant", failed: true, text: error instanceof Error ? error.message : "I couldn't answer that just now." }]);
      }
    } finally {
      setBusy(false);
      setSearching(false);
      abort.current = null;
      box.current?.focus();
    }
  }

  const unavailable = status && (!status.enabled || !status.configured);
  return (
    <div className="hw">
      <div className="hw-thread" role="log" aria-live="polite" aria-label="Conversation with Alira about how Rehyn works">
        {unavailable && <p className="hw-note" role="alert">{!status.enabled ? "This channel is switched off on this site." : "My thinking service isn't connected yet: the server has no API key."}</p>}
        <div className="hw-row">
          <span className="hw-avatar hw-avatar-sm"><AliraAvatar /></span>
          <div className="hw-bubble">{animateGreeting
            ? <TypedChatText text={GREETING} onComplete={() => setGreetingDone(true)} onProgress={() => end.current?.scrollIntoView({ block: "end" })} />
            : GREETING}</div>
        </div>
        {turns.length === 0 && greetingDone && (
          <div className="hw-chips" role="group" aria-label="Suggested questions">
            {STARTERS.map(q => <button key={q} onClick={() => void ask(q)} disabled={Boolean(unavailable)}>{q}</button>)}
          </div>
        )}
        {turns.map((turn, i) => turn.role === "user" ? (
          <div key={i} className="hw-row hw-row-user"><div className="hw-bubble hw-user">{turn.text}</div></div>
        ) : (
          <div key={i} className="hw-row">
            <span className="hw-avatar hw-avatar-sm"><AliraAvatar /></span>
            <div className={`hw-bubble ${turn.failed ? "hw-failed" : ""}`}>
              <TypedChatText text={turn.text} onComplete={() => { if (i === turns.length - 1) setRevealing(false); }} onProgress={() => end.current?.scrollIntoView({ block: "end" })}>{visible => turn.failed ? visible : <Markdown text={visible} />}</TypedChatText>
            </div>
          </div>
        ))}
        {busy && (
          <div className="hw-row">
            <span className="hw-avatar hw-avatar-sm"><AliraAvatar /></span>
            <div className="hw-bubble hw-working" role="status">
              <div className="hw-dots" aria-hidden="true"><i /><i /><i /></div>
              <p>I'm thinking about your question.{searching && <><br />I'm looking up the details for you.</>}</p>
            </div>
          </div>
        )}
        {turns.at(-1)?.role === "assistant" && !busy && !revealing && <div className="hw-chips hw-follow" role="group" aria-label="Follow-up ideas">
          {["Show me the code for that", "Explain it more simply", "Give me a worked example"].map(q => <button key={q} onClick={() => void ask(q)} disabled={Boolean(unavailable)}>{q}</button>)}
        </div>}
        {turns.length > 0 && !busy && !revealing && <button className="hw-reset" onClick={() => setTurns([])}>Start a new chat</button>}
        <div ref={end} />
      </div>

      <form className="hw-form" onSubmit={e => { e.preventDefault(); void ask(input); }}>
        <label htmlFor="hw-input" className="hw-sr">Ask Alira a question</label>
        <textarea
          id="hw-input" ref={box} rows={2} value={input} maxLength={2000} placeholder="Ask about scores, exercises, the movement check, or the code…"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(input); } }}
          disabled={Boolean(unavailable)}
        />
        {busy
          ? <button type="button" className="hw-send" onClick={() => abort.current?.abort()} aria-label="Stop"><Square size={16} aria-hidden="true" /></button>
          : <button type="submit" className="hw-send" disabled={!input.trim() || Boolean(unavailable) || revealing || !greetingDone} aria-label="Send"><SendHorizontal size={18} aria-hidden="true" /></button>}
      </form>
    </div>
  );
}

// ---------- a small, safe Markdown renderer (paragraphs, lists, bold, italics, code) ----------

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith("`") ? <code key={key++}>{t.slice(1, -1)}</code> : t.startsWith("**") ? <strong key={key++}>{t.slice(2, -2)}</strong> : <em key={key++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={key++}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    if (line.trim().startsWith("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={key++} className="hw-table"><table>
          <thead><tr>{head.map((c, n) => <th key={n}>{inline(c)}</th>)}</tr></thead>
          <tbody>{rows.map((r, n) => <tr key={n}>{r.map((c, m) => <td key={m}>{inline(c)}</td>)}</tr>)}</tbody>
        </table></div>
      );
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) { blocks.push(<p key={key++} className="hw-h"><strong>{inline(heading[1])}</strong></p>); i++; continue; }
    const bullet = /^\s*[-*]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? numbered : bullet).test(lines[i])) items.push(lines[i++].replace(ordered ? numbered : bullet, ""));
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={key++}>{items.map((item, n) => <li key={n}>{inline(item)}</li>)}</List>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith("|") && !lines[i].startsWith("```") && !/^#{1,4}\s/.test(lines[i]) && !bullet.test(lines[i]) && !numbered.test(lines[i])) para.push(lines[i++]);
    // A table row may arrive before its separator while the reply is being typed.
    if (!para.length) para.push(lines[i++]);
    blocks.push(<p key={key++}>{para.map((p, n) => <Fragment key={n}>{n > 0 && <br />}{inline(p)}</Fragment>)}</p>);
  }
  return <div className="hw-md">{blocks}</div>;
}
