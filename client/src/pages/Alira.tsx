import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowUp,
  Heart,
  HelpCircle,
  Mic,
  Pause,
  Play,
  Send,
  Sparkles,
} from "lucide-react";
import RecoveryShell from "@/components/RecoveryShell";

type Message = { from: "Molly" | "Alira"; text: string; group?: string };

const suggestions = [
  {
    title: "Ask a question",
    detail: "About exercises, tiredness or recovery",
    icon: HelpCircle,
    response:
      "Ask anything that is on your mind, Molly. We can take it one small step at a time.",
  },
  {
    title: "Raise a concern",
    detail: "Something doesn’t feel right",
    icon: AlertTriangle,
    response:
      "Thank you for sharing that. I’ll note it for your care team, and you can also tell your therapist directly.",
  },
  {
    title: "Lift me up",
    detail: "Words to keep you going",
    icon: Sparkles,
    response:
      "Five days in a row, Molly. Every repetition is your brain building a new path. That’s real, and it’s yours.",
  },
  {
    title: "Talk it through",
    detail: "Share how you’re feeling",
    icon: Heart,
    response:
      "I’m here with you. There is no need to rush what you want to say.",
  },
];

const initialMessages: Message[] = [
  {
    from: "Molly",
    group: "Yesterday",
    text: "Can I do my session in the evening instead?",
  },
  {
    from: "Alira",
    text: "Yes, any time of day works. Many people find late afternoon easier, when their energy is steadier.",
  },
  {
    from: "Alira",
    group: "Today",
    text: "Good afternoon, Molly. It’s lovely to see you.",
  },
  { from: "Alira", text: "How can I help today?" },
];

export default function Alira() {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [isGreeting, setIsGreeting] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const greetingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  const previousMessages = useRef(messages);
  const presence = isReplying
    ? "replying"
    : isGreeting
      ? "greeting"
      : composerFocused || draft.trim()
        ? "attentive"
        : "idle";
  const presenceLabel = {
    idle: "Here with you, Molly",
    attentive: "Take your time. I’m here.",
    replying: "Writing back to you…",
    greeting: "Hello, Molly. Good to see you.",
  }[presence];

  useEffect(
    () => () => {
      if (replyTimer.current !== null) clearTimeout(replyTimer.current);
      if (greetingTimer.current !== null) clearTimeout(greetingTimer.current);
    },
    []
  );

  useEffect(() => {
    if (
      messages.length > initialMessages.length &&
      messages !== previousMessages.current
    ) {
      threadEnd.current?.scrollIntoView({
        behavior:
          motionPaused ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        block: "nearest",
      });
    }
    previousMessages.current = messages;
  }, [messages, isReplying, motionPaused]);

  const greet = () => {
    if (isReplying) return;
    if (greetingTimer.current !== null) clearTimeout(greetingTimer.current);
    setIsGreeting(true);
    greetingTimer.current = setTimeout(() => {
      setIsGreeting(false);
      greetingTimer.current = null;
    }, 3200);
  };

  const replyTo = (message: string, response: string) => {
    if (replyTimer.current !== null) return;
    setIsGreeting(false);
    setMessages(current => [...current, { from: "Molly", text: message }]);
    setIsReplying(true);
    replyTimer.current = setTimeout(() => {
      setMessages(current => [...current, { from: "Alira", text: response }]);
      setIsReplying(false);
      replyTimer.current = null;
    }, 850);
  };

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    const message = draft.trim();
    if (!message || isReplying) return;
    replyTo(
      message,
      "Thank you for telling me, Molly. We can take this at a comfortable pace."
    );
    setDraft("");
  };

  return (
    <RecoveryShell active="Alira" dateLabel="">
      <div
        className="recovery-page alira-page"
        data-presence={presence}
        data-motion={motionPaused ? "paused" : "playing"}
      >
        <section className="alira-heading">
          <div className="alira-heading-title">
            <button
              type="button"
              className="alira-presence-avatar"
              aria-label="Say hello to Alira"
              title="Say hello to Alira"
              onClick={greet}
              disabled={isReplying}
            >
              <span className="alira-presence-halo" aria-hidden="true" />
              <span
                className="alira-presence-halo alira-presence-halo-outer"
                aria-hidden="true"
              />
              <span className="alira-presence-core">
                <AliraAvatar />
              </span>
              <span className="alira-presence-spark" aria-hidden="true" />
            </button>
            <div>
              <h1>Alira</h1>
              <span className="alira-companion-caption">
                Your recovery companion
              </span>
              <p
                className="alira-presence-status"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                <span className="alira-presence-wave" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                {presenceLabel}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="alira-motion-toggle"
            onClick={() => setMotionPaused(current => !current)}
            aria-pressed={motionPaused}
            aria-label={
              motionPaused
                ? "Resume Alira animations"
                : "Pause Alira animations"
            }
            title={motionPaused ? "Resume animation" : "Pause animation"}
          >
            {motionPaused ? <Play size={14} /> : <Pause size={14} />}
          </button>
        </section>
        <div className="alira-layout">
          <section
            className="alira-chat-card"
            aria-label="Conversation with Alira"
          >
            <div className="alira-thread">
              <article
                className="alira-encouragement"
                aria-label="Your summary from Alira"
              >
                <span>FOR YOU, MOLLY</span>
                <p>
                  Five days in a row, Molly. Every repetition is your brain
                  building a new path. That’s real, and it’s yours.
                </p>
                <button
                  className={saved ? "is-saved" : ""}
                  aria-pressed={saved}
                  onClick={() => setSaved(!saved)}
                >
                  <Heart size={14} fill={saved ? "currentColor" : "none"} />{" "}
                  {saved ? "Saved" : "Save words"}
                </button>
              </article>
              <div
                className="alira-messages"
                role="log"
                aria-label="Messages with Alira"
                aria-live="polite"
                aria-relevant="additions"
              >
                {messages.map((message, index) => (
                  <div
                    key={`${message.text}-${index}`}
                    className={`alira-message-row ${message.from === "Molly" ? "from-molly" : "from-alira"} ${index >= initialMessages.length ? "is-new" : ""}`}
                  >
                    {message.group && (
                      <span className="alira-day-divider">{message.group}</span>
                    )}
                    {message.from === "Alira" && (
                      <span className="alira-message-avatar">
                        <AliraAvatar />
                      </span>
                    )}
                    <p>{message.text}</p>
                  </div>
                ))}
              </div>
              {isReplying && (
                <div className="alira-typing" role="status">
                  <span className="alira-message-avatar">
                    <AliraAvatar />
                  </span>
                  <span>
                    Alira is replying
                    <span className="alira-typing-dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  </span>
                </div>
              )}
              <div ref={threadEnd} />
            </div>
            <form className="alira-composer" onSubmit={send}>
              <span className="alira-composer-avatar" aria-hidden="true">
                <span className="alira-presence-core">
                  <AliraAvatar />
                </span>
              </span>
              <input
                aria-label="Message Alira"
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onFocus={() => {
                  setComposerFocused(true);
                  setIsGreeting(false);
                }}
                onBlur={() => setComposerFocused(false)}
                placeholder="Type a message to Alira"
              />
              <button
                type="button"
                className="alira-mic"
                aria-label="Speak to Alira"
              >
                <Mic size={18} />
              </button>
              <button
                type="submit"
                className="alira-send"
                aria-label="Send message"
                disabled={!draft.trim() || isReplying}
              >
                <ArrowUp size={19} />
              </button>
            </form>
          </section>
          <aside className="alira-side-panel">
            <section className="alira-start-card">
              <span className="recovery-overline">MESSAGE ALIRA</span>
              <h2>Start a conversation</h2>
              <div>
                {suggestions.map(({ title, detail, icon: Icon, response }) => (
                  <button
                    key={title}
                    disabled={isReplying}
                    onClick={() => replyTo(title, response)}
                  >
                    <span>
                      <Icon size={18} />
                    </span>
                    <b>
                      {title}
                      <small>{detail}</small>
                    </b>
                    <Send size={16} />
                  </button>
                ))}
              </div>
            </section>
            <section className="alira-care-card">
              <span className="recovery-overline">YOUR CARE TEAM</span>
              <div className="alira-therapist">
                <b>PT</b>
                <p>
                  <strong>Dr. Jack</strong>
                  <small>Your physiotherapist</small>
                </p>
              </div>
              <p>
                Anything you flag with Alira is shared here, so your therapist
                sees it before your next session.
              </p>
              <div className="alira-shared">
                <span>Shared this week</span>
                <b>1</b>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </RecoveryShell>
  );
}

function AliraAvatar() {
  return (
    <img
      className="alira-avatar-image"
      src="/images/alira-avatar.png"
      alt=""
      aria-hidden="true"
    />
  );
}
