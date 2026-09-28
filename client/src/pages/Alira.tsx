import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowUp,
  Heart,
  HelpCircle,
  Check,
  Send,
  Sparkles,
  Square,
  Volume2,
} from "lucide-react";
import RecoveryShell from "@/components/RecoveryShell";
import {
  checkInAnswers,
  checkInQuestions,
  loadRememberedCheckIn,
  rememberCheckIn,
  type CheckInAnswer,
  type RememberedCheckIn,
} from "@/lib/alira-check-ins";
import { createAliraSpeech, silentSpeech } from "@/lib/alira-speech";

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
  const [memory, setMemory] = useState(loadRememberedCheckIn);
  const [speechState, setSpeechState] = useState(silentSpeech);
  const speech = useRef<ReturnType<typeof createAliraSpeech> | null>(null);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const greetingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  const previousMessages = useRef(messages);
  const presence = speechState.speaking
    ? "speaking"
    : isReplying
      ? "replying"
      : isGreeting
        ? "greeting"
        : composerFocused || draft.trim()
          ? "attentive"
          : "idle";

  useEffect(() => {
    speech.current = createAliraSpeech(setSpeechState);
    return () => speech.current?.stop(false);
  }, []);

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
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "nearest",
      });
    }
    previousMessages.current = messages;
  }, [messages, isReplying]);

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
    speech.current?.stop();
    setIsGreeting(false);
    setMessages(current => [...current, { from: "Molly", text: message }]);
    setIsReplying(true);
    replyTimer.current = setTimeout(() => {
      setMessages(current => [...current, { from: "Alira", text: response }]);
      setIsReplying(false);
      replyTimer.current = null;
      setIsGreeting(true);
      if (greetingTimer.current !== null) clearTimeout(greetingTimer.current);
      greetingTimer.current = setTimeout(() => setIsGreeting(false), 1500);
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
      <div className="recovery-page alira-page" data-presence={presence}>
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
              <button
                type="button"
                className="alira-listen-greeting"
                onClick={() =>
                  speech.current?.play(
                    "greeting",
                    "Hello, Molly. It’s lovely to see you. How are you feeling today?"
                  )
                }
                aria-label={
                  speechState.activeId === "greeting"
                    ? "Stop greeting"
                    : "Hear Alira’s greeting"
                }
              >
                {speechState.activeId === "greeting" ? (
                  <Square size={12} />
                ) : (
                  <Volume2 size={14} />
                )}
                {speechState.activeId === "greeting"
                  ? "Stop audio"
                  : "Hear Alira"}
              </button>
            </div>
          </div>
          <AliraCheckIn
            memory={memory}
            busy={isReplying}
            onAnswer={answer => {
              if (replyTimer.current !== null) return;
              setMemory(rememberCheckIn(answer));
              replyTo(answer.message, answer.response);
            }}
          />
        </section>
        {speechState.loading && (
          <p className="alira-voice-notice" role="status">
            Getting Alira’s voice ready…
          </p>
        )}
        {speechState.error && (
          <p className="alira-voice-notice" role="status">
            {speechState.error}
          </p>
        )}
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
                  className={`alira-save-button ${saved ? "is-saved" : ""}`}
                  aria-pressed={saved}
                  onClick={() => setSaved(!saved)}
                >
                  <span className="alira-save-heart" aria-hidden="true">
                    <Heart size={14} fill={saved ? "currentColor" : "none"} />
                  </span>
                  {saved ? "Saved" : "Save words"}
                  <span className="alira-save-burst" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
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
                    className={`alira-message-row ${message.from === "Molly" ? "from-molly" : "from-alira"} ${index >= initialMessages.length ? "is-new" : ""} ${speechState.speaking && speechState.activeId === `message-${index}` ? "is-speaking" : ""}`}
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
                    {message.from === "Alira" && (
                      <button
                        type="button"
                        className="alira-message-listen"
                        aria-label={
                          speechState.activeId === `message-${index}`
                            ? "Stop audio"
                            : "Listen to this message"
                        }
                        onClick={() =>
                          speech.current?.play(`message-${index}`, message.text)
                        }
                      >
                        {speechState.activeId === `message-${index}` ? (
                          <Square size={12} />
                        ) : (
                          <Volume2 size={14} />
                        )}
                      </button>
                    )}
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
                aria-label={
                  speechState.activeId ? "Stop audio" : "Listen to latest reply"
                }
                onClick={() => {
                  if (speechState.activeId) {
                    speech.current?.stop();
                    return;
                  }
                  const index = messages.findLastIndex(
                    message => message.from === "Alira"
                  );
                  if (index >= 0)
                    speech.current?.play(
                      `message-${index}`,
                      messages[index].text
                    );
                }}
              >
                {speechState.activeId ? (
                  <Square size={16} />
                ) : (
                  <Volume2 size={18} />
                )}
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

function AliraCheckIn({
  memory,
  busy,
  onAnswer,
}: {
  memory: RememberedCheckIn | null;
  busy: boolean;
  onAnswer: (answer: CheckInAnswer) => void;
}) {
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answer, setAnswer] = useState<CheckInAnswer | null>(null);
  const question = checkInQuestions[questionIndex];
  const rememberedQuestion =
    memory && questionIndex === 0
      ? checkInAnswers[memory.answerId].followUp
      : null;
  const answers =
    rememberedQuestion && memory
      ? (checkInQuestions.find(item =>
          item.answers.some(option => option.id === memory.answerId)
        )?.answers ?? question.answers)
      : question.answers;

  return (
    <aside
      className="alira-check-in"
      aria-label="A question from Alira"
      data-answered={Boolean(answer)}
      aria-busy={busy}
    >
      <AliraThoughts />
      <p
        key={`${questionIndex}-${answer?.id ?? "question"}`}
        className="alira-check-in-question"
        onAnimationEnd={() => {
          if (!answer && !busy)
            setQuestionIndex(
              current => (current + 1) % checkInQuestions.length
            );
        }}
      >
        {answer
          ? "Thank you for sharing, Molly."
          : (rememberedQuestion ?? question.text)}
      </p>
      {answer ? (
        <div className="alira-check-in-answered">
          <span>
            <Check size={14} /> {answer.label}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setAnswer(null);
              setQuestionIndex(
                current => (current + 1) % checkInQuestions.length
              );
            }}
          >
            Check in again
          </button>
        </div>
      ) : (
        <div
          className="alira-check-in-answers"
          role="group"
          aria-label="Your check-in answer"
        >
          {answers.map(option => (
            <button
              key={option.id}
              type="button"
              disabled={busy}
              onClick={() => {
                setAnswer(option);
                onAnswer(option);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

// Decorative neural connections: staggered signals flow between softly firing nodes.
function AliraThoughts() {
  const connections = [
    "M18 28 Q48 8 83 18 T144 42 Q176 50 214 20 T351 24",
    "M83 18 Q102 69 43 105 Q74 123 109 136 T189 113",
    "M144 42 Q172 69 189 113 Q228 148 265 134 T338 113",
    "M214 20 Q237 35 275 50 Q310 76 338 113 T392 74",
    "M351 24 Q335 61 275 50 Q231 59 189 113 T109 136",
    "M18 28 Q27 75 43 105 Q94 79 144 42 M265 134 Q298 157 338 113 Q378 105 392 74",
  ];
  const nodes = [
    [18, 28],
    [83, 18],
    [144, 42],
    [214, 20],
    [275, 50],
    [351, 24],
    [392, 74],
    [338, 113],
    [265, 134],
    [189, 113],
    [109, 136],
    [43, 105],
  ];
  return (
    <svg
      className="alira-thought-network"
      viewBox="0 0 400 160"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {connections.map((connection, index) => (
        <g key={connection}>
          <path className="alira-thought-connection" d={connection} />
          <path
            className="alira-thought-signal"
            d={connection}
            pathLength="100"
            style={{ animationDelay: `${index * -0.47}s` }}
          />
        </g>
      ))}
      {nodes.map(([x, y], index) => (
        <g key={`${x}-${y}`}>
          <circle
            className="alira-thought-node-halo"
            cx={x}
            cy={y}
            r="7"
            style={{ animationDelay: `${index * -0.31}s` }}
          />
          <circle
            className="alira-thought-node"
            cx={x}
            cy={y}
            r="2.5"
            style={{ animationDelay: `${index * -0.31}s` }}
          />
        </g>
      ))}
    </svg>
  );
}

function AliraAvatar() {
  return (
    <svg
      className="alira-avatar-image"
      viewBox="0 0 80 80"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="40" cy="40" r="39" fill="#dfe7df" />
      <circle cx="40" cy="40" r="34" fill="#285b49" />
      <path
        className="alira-pulse-line"
        d="M24 40h9l6-10 9 20 6-10h5"
        fill="none"
        stroke="#f5faf3"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="alira-pulse-trace"
        d="M24 40h9l6-10 9 20 6-10h5"
        pathLength="100"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
