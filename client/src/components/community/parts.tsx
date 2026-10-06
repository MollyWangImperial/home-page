import { useId, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Link, useSearch } from "wouter";
import { isPersonId, members, myDrawnFace, people, reactionLabels, type GroupCover, type GroupMessage, type MemberId, type PersonId, type PictureChoice, type QuickTone, type ReactionKind } from "@/content/community-samples";
import { communityStore, communityViewFromQuery, friendsHref, placeOf, preparePostPhoto, relationship, useCommunity, type NoteDraft, type OwnNote } from "@/lib/community-store";
import { profileInitial, useProfile } from "@/lib/profile";
import type { Burst } from "./hooks";
import { useVoiceNote, voiceSeconds } from "./hooks";
import { ArrowIcon, CheckIcon, CloseIcon, HandIcon, HeartIcon, LockIcon, MicIcon, PhotoIcon, PlayIcon, PulseIcon, StarIcon, StopIcon, ThemeIcon } from "./icons";

/* ------------------------------------------------------------------ faces */

/** An example person's face. Decorative: their name is always written beside it. */
export function Face({ who, size = 40, className = "", style }: { who: PersonId; size?: number; className?: string; style?: CSSProperties }) {
  const person = people[who];
  return <span className={`cm-face ${className}`} style={{ width: size, height: size, backgroundColor: person.tint, backgroundImage: `url("${person.face}")`, ...style }} aria-hidden="true" />;
}

/** Anyone in My community: an example person's face, or the initial of someone without a drawing (Gary). */
export function MemberFace({ who, size = 40, className = "", style }: { who: MemberId; size?: number; className?: string; style?: CSSProperties }) {
  if (isPersonId(who)) return <Face who={who} size={size} className={className} style={style} />;
  const member = members[who];
  return <span className={`cm-face cm-face-initial ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.4), fontWeight: 700, backgroundColor: member.tint, color: member.ink, ...style }} aria-hidden="true">{member.initial}</span>;
}

/**
 * The person using the app, as they chose in Community settings ("My picture"): the drawn face,
 * their own photo (their initial until they add one), or their initial. `picture` previews a choice.
 */
export function MyFace({ size = 40, className = "", style, picture }: { size?: number; className?: string; style?: CSSProperties; picture?: PictureChoice }) {
  const profile = useProfile();
  const chosen = useCommunity().settings.picture;
  const look = picture ?? chosen;
  if (look === "drawn") return <span className={`cm-face ${className}`} style={{ width: size, height: size, backgroundColor: myDrawnFace.tint, backgroundImage: `url("${myDrawnFace.face}")`, ...style }} aria-hidden="true" />;
  if (look === "photo" && profile.photo) return <span className={`cm-face ${className}`} style={{ width: size, height: size, backgroundImage: `url("${profile.photo}")`, ...style }} aria-hidden="true" />;
  return <span className={`cm-face cm-face-initial ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.42), ...style }} aria-hidden="true">{profileInitial(profile)}</span>;
}

/** A group's cover: its drawing, or its colour with a letter or a sign. */
export function Cover({ cover, className = "", style, iconSize = 22 }: { cover: GroupCover; className?: string; style?: CSSProperties; iconSize?: number }) {
  const look: CSSProperties = { backgroundColor: cover.tint, color: cover.ink, ...(cover.image ? { backgroundImage: `url("${cover.image}")` } : {}), ...style };
  return (
    <span className={`cm-cover ${className}`} style={look} aria-hidden="true">
      {!cover.image && cover.initial && <span className="cm-cover-letter">{cover.initial}</span>}
      {!cover.image && !cover.initial && cover.icon && <ThemeIcon theme={cover.icon} size={iconSize} strokeWidth={1.6} />}
    </span>
  );
}

/** Alira's mark, breathing gently. */
export function AliraMark({ size = 34, light = false, className = "" }: { size?: number; light?: boolean; className?: string }) {
  return (
    <span className={`cm-alira ${light ? "is-light" : ""} ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <span className="cm-alira-ring" />
      <span className="cm-alira-dot"><PulseIcon size={Math.round(size * 0.52)} /></span>
    </span>
  );
}

export const LiveDot = ({ tone = "red", className = "" }: { tone?: "red" | "green" | "amber"; className?: string }) => <span className={`cm-dot cm-dot-${tone} ${tone !== "amber" ? "cm-live" : ""} ${className}`} aria-hidden="true" />;

export function TypingDots() {
  return <span className="cm-typing-dots" aria-hidden="true"><i /><i /><i /></span>;
}

/** Said under everything the person writes: in this preview, it goes nowhere. */
export function OnlyYou({ className = "", children = "Only you can see this" }: { className?: string; children?: string }) {
  return <span className={`cm-only-you ${className}`}><LockIcon size={14} />{children}</span>;
}

export function FloatingHearts({ bursts, className = "" }: { bursts: Burst[]; className?: string }) {
  return (
    <div className={`cm-hearts ${className}`} aria-hidden="true">
      {bursts.map(item => (
        <span key={item.id} className="cm-floaty" style={{ left: item.left, background: item.bg, color: item.fg, "--dx": `${item.dx}px` } as CSSProperties}>
          <HeartIcon size={18} fill="currentColor" strokeWidth={1.6} />
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- reactions */

const reactionLook: Record<ReactionKind, { tone: "love" | "clap" | "same"; icon: ReactNode }> = {
  love: { tone: "love", icon: <HeartIcon fill="#E8795A" stroke="#C8553A" strokeWidth={1.6} /> },
  withyou: { tone: "love", icon: <HeartIcon fill="#E8795A" stroke="#C8553A" strokeWidth={1.6} /> },
  welldone: { tone: "clap", icon: <StarIcon fill="#F2C14E" stroke="#C99A1A" strokeWidth={1.6} /> },
  metoo: { tone: "same", icon: <HandIcon stroke="#3F86AC" /> },
};

/** One tap to join in. A second tap takes it back. The count hides when "Show numbers of hearts" is off. */
export function ReactionButton({ postId, kind, count }: { postId: string; kind: ReactionKind; count: number }) {
  const memory = useCommunity();
  const on = memory.reactions.includes(`${postId}:${kind}`);
  const look = reactionLook[kind];
  return (
    <button type="button" className={`cm-react cm-tone-${look.tone} ${on ? "is-on" : ""}`} aria-pressed={on} onClick={() => communityStore.toggleReaction(postId, kind)}>
      {look.icon}<span>{reactionLabels[kind]}</span>
      {memory.settings.showHeartCounts && <>{" "}<span className="cm-react-count">{count + (on ? 1 : 0)}</span></>}
    </button>
  );
}

/**
 * Where the person stands with someone, beside their name: "Add friend" sends a request and
 * "Request sent" cancels it (both show in the Friends drawer's Sent tab), "Wants to be friends"
 * opens the drawer at their request, and a friend shows "Friends". Nothing shows for someone blocked.
 * `onLeave` is called as "Wants to be friends" opens the drawer, so a panel it sits in (Find) can close.
 */
export function FriendButton({ who, className = "", onLeave }: { who: PersonId; className?: string; onLeave?: () => void }) {
  const memory = useCommunity();
  const search = useSearch();
  const status = relationship(memory, who);
  const name = people[who].name;
  if (status === "blocked") return null;
  if (status === "friend") return <span className={`cm-friend is-friend ${className}`}><CheckIcon size={15} />Friends<span className="cm-sr">{` with ${name}`}</span></span>;
  if (status === "incoming") {
    return (
      <Link className={`cm-friend is-asking ${className}`} href={friendsHref("requests", placeOf(communityViewFromQuery(search)))} onClick={onLeave}>
        Wants to be friends<span className="cm-sr">{`: see ${name}'s request`}</span>
      </Link>
    );
  }
  const on = status === "sent";
  return (
    <button type="button" className={`cm-friend ${on ? "is-on" : ""} ${className}`} onClick={() => (on ? communityStore.cancelRequest(who) : communityStore.requestFriend(who))}>
      {on ? "Request sent" : "Add friend"}<span className="cm-sr">{on ? ` to ${name}. Press to cancel it` : ` (${name})`}</span>
    </button>
  );
}

/* ------------------------------------------------------------- voice note */

const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, "0")}`;
function waveHeights(words: string, bars = 26): number[] {
  const heights: number[] = [];
  let seed = 7;
  for (let i = 0; i < words.length; i++) seed = (seed * 31 + words.charCodeAt(i)) % 9973;
  for (let i = 0; i < bars; i++) {
    seed = (seed * 73 + 41) % 9973;
    const swell = Math.sin((i / (bars - 1)) * Math.PI);
    heights.push(Math.round(6 + swell * 10 + (seed % 9)));
  }
  return heights;
}

/**
 * A voice note with its words written underneath, for anyone who finds listening, speaking or
 * typing hard. Play reads the words aloud in this device's voice where there is one. With "Write
 * out voice notes" off in Community settings, the words wait behind a "Show the words" button.
 */
export function VoiceNote({ words, seconds, label, mine = false, wordsClassName = "" }: { words: string; seconds?: number; label: string; mine?: boolean; wordsClassName?: string }) {
  const length = seconds ?? voiceSeconds(words);
  const { playing, progress, toggle } = useVoiceNote(words, length);
  const [heights] = useState(() => waveHeights(words));
  const writeOut = useCommunity().settings.writeOutVoiceNotes;
  const [showWords, setShowWords] = useState(false);
  const wordsId = useId();
  const played = Math.round(progress * heights.length);
  if (!writeOut) {
    return (
      <div className={`cm-voice ${mine ? "is-mine" : ""} ${playing ? "is-playing" : ""}`}>
        <div className="cm-voice-player">
          <button type="button" className="cm-voice-play" onClick={toggle} aria-label={playing ? `Stop ${label}` : `Play ${label}, ${length} seconds`}>
            {playing ? <StopIcon size={18} /> : <PlayIcon size={20} />}
          </button>
          <span className="cm-voice-wave" aria-hidden="true">
            {heights.map((height, index) => <i key={index} className={index < played ? "is-played" : ""} style={{ height }} />)}
          </span>
          <span className="cm-voice-time" aria-hidden="true">{formatTime(playing ? Math.ceil(length * (1 - progress)) : length)}</span>
        </div>
        <button type="button" className="cm-voice-show" aria-expanded={showWords} aria-controls={showWords ? wordsId : undefined} onClick={() => setShowWords(!showWords)}>
          {showWords ? "Hide the words" : "Show the words"}<span className="cm-sr">{` of ${label}`}</span>
        </button>
        {showWords && <p id={wordsId} className={`cm-voice-words ${wordsClassName}`}>{words}</p>}
      </div>
    );
  }
  return (
    <div className={`cm-voice ${mine ? "is-mine" : ""} ${playing ? "is-playing" : ""}`}>
      <div className="cm-voice-player">
        <button type="button" className="cm-voice-play" onClick={toggle} aria-label={playing ? `Stop ${label}` : `Play ${label}, ${length} seconds`}>
          {playing ? <StopIcon size={18} /> : <PlayIcon size={20} />}
        </button>
        <span className="cm-voice-wave" aria-hidden="true">
          {heights.map((height, index) => <i key={index} className={index < played ? "is-played" : ""} style={{ height }} />)}
        </span>
        <span className="cm-voice-time" aria-hidden="true">{formatTime(playing ? Math.ceil(length * (1 - progress)) : length)}</span>
      </div>
      <p className={`cm-voice-words ${wordsClassName}`}><span className="cm-voice-caption">Words</span>{words}</p>
    </div>
  );
}

/* ------------------------------------------------------------------- chat */

export const toneClass = (tone: QuickTone) => `cm-quick-${tone}`;

/** A message from an example person, with a heart that can be given and taken back. */
export function TheirMessage({ message, heartKey }: { message: GroupMessage; heartKey: string }) {
  const memory = useCommunity();
  const on = memory.hearts.includes(heartKey);
  const counts = memory.settings.showHeartCounts;
  const name = people[message.who].name;
  return (
    <li className="cm-msg cm-msg-in">
      <Face who={message.who} size={40} />
      <div className="cm-msg-body">
        <p className="cm-msg-name">{name}{message.note && <span>{` ${message.note}`}</span>}</p>
        <div className={`cm-bubble ${message.photo ? "has-photo" : ""}`}>
          {message.photo && <img src={message.photo.src} alt={message.photo.alt} style={{ backgroundColor: message.photo.tint }} loading="lazy" />}
          <p>{message.text}</p>
        </div>
      </div>
      <button type="button" className={`cm-heart ${on ? "is-on" : ""}`} aria-pressed={on} aria-label={`Heart for ${name}'s message${counts ? `, ${message.hearts + (on ? 1 : 0)}` : ""}`} onClick={() => communityStore.toggleHeart(heartKey)}>
        <HeartIcon size={15} fill={on ? "#E8795A" : "none"} strokeWidth={2} />{counts && <span aria-hidden="true">{message.hearts + (on ? 1 : 0)}</span>}
      </button>
    </li>
  );
}

/** Something the person wrote. It is shown to them only. */
export function MyMessage({ note, onRemove }: { note: Pick<OwnNote, "text" | "photo" | "voice">; onRemove?: () => void }) {
  return (
    <li className="cm-msg is-mine cm-msg-in">
      <div className={`cm-bubble-mine ${note.photo ? "has-photo" : ""} ${note.voice ? "has-voice" : ""}`}>
        {note.photo && <img src={note.photo} alt="Your photo" />}
        {note.voice ? <VoiceNote words={note.text} label="your voice note" mine /> : note.text && <p>{note.text}</p>}
      </div>
      <span className="cm-mine-foot">
        <OnlyYou />
        {onRemove && <button type="button" className="cm-text-button" onClick={onRemove}>Remove<span className="cm-sr"> your message</span></button>}
      </span>
    </li>
  );
}

export function TypingRow({ who }: { who: PersonId }) {
  return (
    <div className="cm-typing-row cm-msg-in">
      <Face who={who} size={32} />
      <TypingDots />
      <span>{people[who].name} is writing</span>
    </div>
  );
}

/**
 * The writing row under a chat: a voice-note switch, an optional photo, the words and Send.
 * Recording isn't switched on in this preview, so a voice note is made from written words.
 */
export function ChatInput({ label, placeholder, onSend, allowPhoto = false }: { label: string; placeholder: string; onSend: (draft: NoteDraft) => void; allowPhoto?: boolean }) {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const hintId = useId();

  const send = (event: FormEvent) => {
    event.preventDefault();
    const words = text.trim();
    if (voice && !words) { setProblem("Write the words for your voice note first."); field.current?.focus(); return; }
    if (!words && !photo) { field.current?.focus(); return; }
    onSend({ text: words, photo, voice });
    setText(""); setPhoto(null); setVoice(false); setProblem("");
  };
  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try { setPhoto(await preparePostPhoto(file)); setProblem(""); }
    catch (error) { setProblem(error instanceof Error ? error.message : "This photo couldn't be added."); }
  };

  return (
    <form className="cm-chat-input" onSubmit={send}>
      {photo && (
        <div className="cm-attached">
          <img src={photo} alt="The photo you chose" />
          <button type="button" className="cm-icon-button" aria-label="Remove the photo" onClick={() => setPhoto(null)}><CloseIcon size={18} /></button>
        </div>
      )}
      <div className="cm-chat-row">
        <button type="button" className={`cm-round cm-round-voice ${voice ? "is-on" : ""}`} aria-pressed={voice} aria-label="Send as a voice note" aria-describedby={voice ? hintId : undefined} onClick={() => { setVoice(!voice); setProblem(""); field.current?.focus(); }}>
          <MicIcon size={24} />
        </button>
        {allowPhoto && (
          <>
            <button type="button" className="cm-round cm-round-photo" aria-label="Add a photo" onClick={() => picker.current?.click()}><PhotoIcon size={24} /></button>
            <input ref={picker} className="cm-sr" type="file" accept="image/jpeg,image/png,image/webp" tabIndex={-1} aria-hidden="true" onChange={choose} />
          </>
        )}
        <label className="cm-chat-field">
          <span className="cm-sr">{voice ? `${label}, as a voice note` : label}</span>
          <input ref={field} type="text" value={text} maxLength={400} placeholder={voice ? "Write the words for your voice note" : placeholder} onChange={event => { setText(event.target.value); setProblem(""); }} enterKeyHint="send" autoComplete="off" />
        </label>
        <button type="submit" className="cm-round cm-round-send" aria-label="Send"><ArrowIcon size={22} /></button>
      </div>
      {voice && <p className="cm-hint" id={hintId}>Recording isn't switched on in this preview. Write your words, and Play will read them aloud on this device.</p>}
      {problem && <p className="cm-problem" role="alert">{problem}</p>}
    </form>
  );
}
