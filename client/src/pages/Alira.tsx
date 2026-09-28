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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { aliraTopics, type AliraTopic } from "@/lib/alira-topics";
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

const topicIcons = {
  question: HelpCircle,
  concern: AlertTriangle,
  encouragement: Sparkles,
  feelings: Heart,
};

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
  const [activeTopic, setActiveTopic] = useState<AliraTopic | null>(null);
  const [topicDrafts, setTopicDrafts] = useState<
    Partial<Record<AliraTopic["id"], string>>
  >({});
  const topicTrigger = useRef<HTMLButtonElement | null>(null);
  const topicQuestion = useRef<HTMLParagraphElement>(null);
  const composerInput = useRef<HTMLInputElement>(null);
  const returnToComposer = useRef(false);
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

  const openTopic = (topic: AliraTopic, trigger: HTMLButtonElement) => {
    topicTrigger.current = trigger;
    returnToComposer.current = false;
    setIsGreeting(false);
    setActiveTopic(topic);
    void speech.current?.play(`topic-${topic.id}`, topic.prompt);
  };
  const closeTopic = () => {
    speech.current?.stop();
    setActiveTopic(null);
  };
  const sendTopic = (event: FormEvent) => {
    event.preventDefault();
    if (!activeTopic || replyTimer.current !== null) return;
    const message = topicDrafts[activeTopic.id]?.trim();
    if (!message) return;
    setMessages(current => [
      ...current,
      { from: "Alira", text: activeTopic.prompt, group: activeTopic.title },
    ]);
    setTopicDrafts(current => ({ ...current, [activeTopic.id]: "" }));
    returnToComposer.current = true;
    closeTopic();
    replyTo(message, activeTopic.response);
  };

  return (
    <Dialog
      open={Boolean(activeTopic)}
      onOpenChange={open => {
        if (!open) closeTopic();
      }}
    >
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
          {!activeTopic && speechState.loading && (
            <p className="alira-voice-notice" role="status">
              Getting Alira’s voice ready…
            </p>
          )}
          {!activeTopic && speechState.error && (
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
                        <span className="alira-day-divider">
                          {message.group}
                        </span>
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
                            speech.current?.play(
                              `message-${index}`,
                              message.text
                            )
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
                  ref={composerInput}
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
                    speechState.activeId
                      ? "Stop audio"
                      : "Listen to latest reply"
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
                  {aliraTopics.map(topic => {
                    const { title, detail, id } = topic;
                    const Icon = topicIcons[id];
                    return (
                      <button
                        key={title}
                        disabled={isReplying}
                        aria-haspopup="dialog"
                        aria-expanded={activeTopic?.id === id}
                        onClick={event => openTopic(topic, event.currentTarget)}
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
                    );
                  })}
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
      {activeTopic && (
        <DialogContent
          className="alira-topic-dialog"
          data-speaking={
            speechState.speaking &&
            speechState.activeId === `topic-${activeTopic.id}`
          }
          data-loading={speechState.loading}
          onOpenAutoFocus={event => {
            event.preventDefault();
            topicQuestion.current?.focus();
          }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            if (returnToComposer.current) composerInput.current?.focus();
            else topicTrigger.current?.focus();
          }}
        >
          <div className="alira-topic-intro">
            <button
              type="button"
              className="alira-presence-avatar alira-topic-avatar"
              aria-label={
                speechState.activeId
                  ? "Stop Alira’s question"
                  : "Replay Alira’s question"
              }
              onClick={() => {
                void speech.current?.play(
                  `topic-${activeTopic.id}`,
                  activeTopic.prompt
                );
              }}
            >
              <span className="alira-presence-halo" />
              <span className="alira-presence-halo alira-presence-halo-outer" />
              <span className="alira-presence-core">
                <AliraAvatar />
              </span>
              <span className="alira-presence-spark" />
            </button>
          </div>
          <div className="alira-topic-copy">
            <DialogTitle className="sr-only">{activeTopic.title}</DialogTitle>
            <DialogDescription
              ref={topicQuestion}
              tabIndex={-1}
              className="alira-topic-question"
            >
              {activeTopic.prompt}
            </DialogDescription>
          </div>
          {speechState.error && (
            <p className="alira-topic-error" role="alert">
              {speechState.error}
            </p>
          )}
          <form className="alira-topic-form" onSubmit={sendTopic}>
            <textarea
              id="alira-topic-reply"
              aria-label="Tell Alira what’s on your mind"
              rows={3}
              maxLength={2000}
              placeholder={activeTopic.placeholder}
              value={topicDrafts[activeTopic.id] ?? ""}
              onChange={event => {
                if (speechState.activeId) speech.current?.stop();
                setTopicDrafts(current => ({
                  ...current,
                  [activeTopic.id]: event.target.value,
                }));
              }}
            />
            <div className="alira-topic-footer">
              <DialogClose asChild>
                <button type="button" className="alira-topic-later">
                  Not now
                </button>
              </DialogClose>
              <button
                className="alira-topic-submit"
                type="submit"
                disabled={!topicDrafts[activeTopic.id]?.trim() || isReplying}
              >
                Send to Alira <ArrowUp size={17} />
              </button>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
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
