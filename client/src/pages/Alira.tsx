import { useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowUp,
  Heart,
  HelpCircle,
  MessageCircle,
  Mic,
  Send,
  Sparkles,
  Volume2,
} from "lucide-react";
import RecoveryShell from "@/components/RecoveryShell";

type Message = { from: "Molly" | "Alira"; text: string; group?: string };

const suggestions = [
  { title: "Ask a question", detail: "About exercises, tiredness or recovery", icon: HelpCircle, response: "Ask anything that is on your mind, Molly. We can take it one small step at a time." },
  { title: "Raise a concern", detail: "Something doesn’t feel right", icon: AlertTriangle, response: "Thank you for sharing that. I’ll note it for your care team, and you can also tell your therapist directly." },
  { title: "Lift me up", detail: "Words to keep you going", icon: Sparkles, response: "Five days in a row, Molly. Every repetition is your brain building a new path. That’s real, and it’s yours." },
  { title: "Talk it through", detail: "Share how you’re feeling", icon: Heart, response: "I’m here with you. There is no need to rush what you want to say." },
];

const initialMessages: Message[] = [
  { from: "Molly", group: "Yesterday", text: "Can I do my session in the evening instead?" },
  { from: "Alira", text: "Yes, any time of day works. Many people find late afternoon easier, when their energy is steadier." },
  { from: "Alira", group: "Today", text: "Good afternoon, Molly. It’s lovely to see you." },
  { from: "Alira", text: "How can I help today?" },
];

export default function Alira() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const [largePanelText, setLargePanelText] = useState(false);

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    const message = draft.trim();
    if (!message) return;
    setMessages((current) => [...current, { from: "Molly", text: message }, { from: "Alira", text: "Thank you for telling me, Molly. We can take this at a comfortable pace." }]);
    setDraft("");
  };

  const useSuggestion = (response: string) => {
    setMessages((current) => [...current, { from: "Alira", text: response }]);
  };

  const readLatest = () => {
    const latest = [...messages].reverse().find((message) => message.from === "Alira");
    if (latest && "speechSynthesis" in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(latest.text));
  };

  return (
    <RecoveryShell active="Alira" dateLabel="">
      <div className={`recovery-page alira-page ${largePanelText ? "alira-large-panel-text" : ""}`}>
        <section className="alira-heading">
          <div className="alira-heading-title"><span><ActivityMark /></span><div><h1>Alira</h1><p><i /> Your recovery companion, here any time</p></div></div>
          <div className="alira-actions"><button onClick={() => setLargePanelText(!largePanelText)} className={largePanelText ? "is-on" : ""}><b>Aa</b> Larger text</button><button onClick={readLatest}><Volume2 size={16} /> Read aloud</button></div>
        </section>
        <div className="alira-layout">
          <section className="alira-chat-card" aria-label="Conversation with Alira">
            <div className="alira-thread">
              {messages.map((message, index) => <div key={`${message.text}-${index}`} className={`alira-message-row ${message.from === "Molly" ? "from-molly" : "from-alira"}`}>
                {message.group && <span className="alira-day-divider">{message.group}</span>}
                {message.from === "Alira" && <span className="alira-message-avatar"><ActivityMark /></span>}
                <p>{message.text}</p>
              </div>)}
              <article className="alira-encouragement"><span>FOR YOU, MOLLY</span><p>Five days in a row, Molly. Every repetition is your brain building a new path. That’s real, and it’s yours.</p><button className={saved ? "is-saved" : ""} onClick={() => setSaved(!saved)}><Heart size={14} fill={saved ? "currentColor" : "none"} /> {saved ? "Saved" : "Save words"}</button></article>
              <div className="alira-suggestion-grid">{suggestions.map(({ title, detail, icon: Icon, response }) => <button key={title} onClick={() => useSuggestion(response)}><span><Icon size={17} /></span><b>{title}<small>{detail}</small></b></button>)}</div>
            </div>
            <form className="alira-composer" onSubmit={send}><input aria-label="Message Alira" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Type a message to Alira" /><button type="button" className="alira-mic" aria-label="Speak to Alira"><Mic size={18} /></button><button type="submit" className="alira-send" aria-label="Send message"><ArrowUp size={19} /></button></form>
          </section>
          <aside className="alira-side-panel">
            <section className="alira-start-card"><span className="recovery-overline">MESSAGE ALIRA</span><h2>Start a conversation</h2><div>{suggestions.map(({ title, detail, icon: Icon, response }) => <button key={title} onClick={() => useSuggestion(response)}><span><Icon size={18} /></span><b>{title}<small>{detail}</small></b><Send size={16} /></button>)}</div></section>
            <section className="alira-care-card"><span className="recovery-overline">YOUR CARE TEAM</span><div className="alira-therapist"><b>PT</b><p><strong>[THERAPIST NAME]</strong><small>Your physiotherapist</small></p></div><p>Anything you flag with Alira is shared here, so your therapist sees it before your next session.</p><div className="alira-shared"><span>Shared this week</span><b>1</b></div></section>
            <section className="alira-saved-card"><div><span className="recovery-overline">SAVED WORDS</span><b>1 saved</b></div><p>Five days in a row, Molly. Every repetition is your brain building a new path. That’s real, and it’s yours.</p><small>Alira supports your care team and is not an emergency service. If you think you are having a stroke, call 999.</small></section>
          </aside>
        </div>
      </div>
    </RecoveryShell>
  );
}

function ActivityMark() { return <ActivityIcon />; }
function ActivityIcon() { return <MessageCircle size={17} strokeWidth={2.2} />; }
