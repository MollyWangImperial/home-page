import { useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "wouter";
import { circle, CIRCLE_SEATS, feedPosts, feelings, friendSuggestions, isPersonId, lounge, members, PERSON_IDS, people, sampleGroups, settingsChoices, type FeelingId, type PersonId, type PostsSeenBy, type SampleGroup, type SamplePost } from "@/content/community-samples";
import {
  canSee,
  circleSeatsTaken,
  communityHref,
  communityStore,
  hiddenThisVisit,
  isBlocked,
  listNames,
  postVisibility,
  preparePostPhoto,
  relationship,
  timeAgo,
  useCommunity,
  type CommunityMemory,
  type OpenSafetyMenu,
  type OwnPost,
  type PostVisibility,
} from "@/lib/community-store";
import { coverForTheme, lastLine, myGroups } from "./group-model";
import { useVoiceNote, voiceSeconds } from "./hooks";
import { ArrowIcon, ChatIcon, CloseIcon, DotsIcon, EyeIcon, EyeOffIcon, GlobeIcon, LockIcon, MicIcon, PhotoIcon, PlusIcon, SmileIcon, SpeakerIcon, StarIcon, StopIcon, UsersIcon } from "./icons";
import { Cover, Face, FriendButton, LiveDot, MemberFace, MyFace, ReactionButton, VoiceNote } from "./parts";
import { postsAudience } from "./settings-model";

const feelingLabel = (id: FeelingId | null) => feelings.find(item => item.id === id)?.label.toLowerCase();

function PostTags({ win, feeling }: { win: boolean; feeling: FeelingId | null }) {
  if (!win && !feeling) return null;
  return (
    <p className="cm-post-tags">
      {win && <span className="cm-tag cm-tag-win"><StarIcon size={16} />Little win</span>}
      {feeling && <span className="cm-tag cm-tag-feeling"><SmileIcon size={16} />{`Feeling ${feelingLabel(feeling)}`}</span>}
    </p>
  );
}

/* --------------------------------------------------------------- composer */

/** Everyone, Friends or Only me, as a small picture. */
function AudienceIcon({ seenBy, size = 16 }: { seenBy: PostsSeenBy; size?: number }) {
  if (seenBy === "everyone") return <GlobeIcon size={size} />;
  if (seenBy === "onlyMe") return <LockIcon size={size} />;
  return <UsersIcon size={size} />;
}

/**
 * Who can see the person's posts, chosen right where they write. It is the same choice as "Who can
 * see my posts" in Community settings, so changing it here changes it there too.
 */
function AudiencePicker({ seenBy }: { seenBy: PostsSeenBy }) {
  return (
    <label className="cm-audience">
      <AudienceIcon seenBy={seenBy} />
      <select aria-label="Who can see my posts" value={seenBy} onChange={event => communityStore.updateSettings({ postsSeenBy: event.target.value as PostsSeenBy })}>
        {settingsChoices.postsSeenBy.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
      </select>
    </label>
  );
}

/**
 * "What's new with you?" Photo, Voice, Feeling and Little win shape the post, and the picker beside
 * Post says who can see it (Community settings holds the same choice).
 */
function PostComposer({ name }: { name: string }) {
  const seenBy = useCommunity().settings.postsSeenBy;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [voice, setVoice] = useState(false);
  const [feeling, setFeeling] = useState<FeelingId | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [win, setWin] = useState(false);
  const [problem, setProblem] = useState("");
  const [posted, setPosted] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const feelingsId = useId();
  const hintId = useId();
  const prompt = `What's new with you, ${name}?`;

  const focusBox = () => window.requestAnimationFrame(() => box.current?.focus());
  const expand = () => { setOpen(true); setPosted(""); };
  const reset = () => { setText(""); setPhoto(null); setVoice(false); setFeeling(null); setChoosing(false); setWin(false); setProblem(""); };
  const close = () => { reset(); setOpen(false); window.requestAnimationFrame(() => opener.current?.focus()); };

  const choosePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    expand();
    try { setPhoto(await preparePostPhoto(file)); setProblem(""); }
    catch (error) { setProblem(error instanceof Error ? error.message : "This photo couldn't be added."); }
  };
  const post = (event: FormEvent) => {
    event.preventDefault();
    const words = text.trim();
    if (voice && !words) { setProblem("Write the words for your voice note first."); box.current?.focus(); return; }
    if (!words && !photo) { setProblem("Write something, or add a photo, before you post."); box.current?.focus(); return; }
    communityStore.addPost({ text: words, photo, voice, feeling, win });
    close();
    setPosted(postsAudience(seenBy).posted);
  };

  return (
    <section className="cm-card cm-composer cm-rise" aria-label="Write a post">
      <form onSubmit={post}>
        <div className="cm-composer-top">
          <MyFace size={48} />
          {open ? (
            <label className="cm-composer-field">
              <span className="cm-sr">{voice ? `${prompt} Write the words for your voice note.` : prompt}</span>
              <textarea ref={box} value={text} rows={3} maxLength={600} placeholder={voice ? "Write the words for your voice note" : prompt} aria-describedby={voice ? hintId : undefined} onChange={event => { setText(event.target.value); setProblem(""); }} />
            </label>
          ) : (
            <button ref={opener} type="button" className="cm-composer-prompt" onClick={() => { expand(); focusBox(); }}>{prompt}</button>
          )}
        </div>

        {open && (photo || voice || win || feeling || choosing) && (
          <div className="cm-composer-extras">
            {photo && (
              <div className="cm-attached cm-attached-large">
                <img src={photo} alt="The photo you chose" />
                <button type="button" className="cm-icon-button" aria-label="Remove the photo" onClick={() => setPhoto(null)}><CloseIcon size={18} /></button>
              </div>
            )}
            {voice && <p className="cm-hint" id={hintId}><MicIcon size={18} /><span>Recording isn't switched on in this preview. Write your words, and Play will read them aloud on this device, with the words written underneath.</span></p>}
            <PostTags win={win} feeling={feeling} />
            {choosing && (
              <fieldset className="cm-feelings" id={feelingsId}>
                <legend>How are you feeling?</legend>
                <div>
                  {feelings.map(item => (
                    <button key={item.id} type="button" className={`cm-feeling ${feeling === item.id ? "is-on" : ""}`} aria-pressed={feeling === item.id}
                      onClick={() => { setFeeling(feeling === item.id ? null : item.id); setChoosing(false); focusBox(); }}>{item.label}</button>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        )}

        <div className="cm-composer-chips">
          <button type="button" className="cm-chip cm-chip-photo" onClick={() => picker.current?.click()}><PhotoIcon /><span>Photo</span></button>
          <button type="button" className={`cm-chip cm-chip-voice ${open && voice ? "is-on" : ""}`} aria-pressed={open && voice}
            onClick={() => { expand(); setVoice(!(open && voice)); setProblem(""); focusBox(); }}><MicIcon /><span>Voice</span></button>
          <button type="button" className={`cm-chip cm-chip-feeling ${open && (choosing || !!feeling) ? "is-on" : ""}`} aria-expanded={open && choosing} aria-controls={open && choosing ? feelingsId : undefined}
            onClick={() => { expand(); setChoosing(!(open && choosing)); }}><SmileIcon /><span>Feeling</span></button>
          <button type="button" className={`cm-chip cm-chip-win ${open && win ? "is-on" : ""}`} aria-pressed={open && win}
            onClick={() => { expand(); setWin(!(open && win)); focusBox(); }}><StarIcon /><span>Little win</span></button>
          <input ref={picker} className="cm-sr" type="file" accept="image/jpeg,image/png,image/webp" tabIndex={-1} aria-hidden="true" onChange={choosePhoto} />
        </div>

        {problem && <p className="cm-problem" role="alert">{problem}</p>}
        {open && (
          <div className="cm-composer-foot">
            <AudiencePicker seenBy={seenBy} />
            <span className="cm-composer-actions">
              <button type="button" className="cm-btn cm-btn-quiet" onClick={close}>Cancel</button>
              <button type="submit" className="cm-btn cm-btn-green">Post</button>
            </span>
          </div>
        )}
      </form>
      <p className="cm-status" role="status">{posted}</p>
    </section>
  );
}

/* ------------------------------------------------------------------ posts */

export function OwnPostCard({ post, name }: { post: OwnPost; name: string }) {
  const [asking, setAsking] = useState(false);
  const headingId = useId();
  const seenBy = useCommunity().settings.postsSeenBy;
  return (
    <article className="cm-card cm-post is-mine cm-msg-in" aria-labelledby={headingId}>
      <header className="cm-post-head">
        <MyFace size={48} />
        <div className="cm-post-who">
          <h3 className="cm-post-name" id={headingId}>{name} <span className="cm-post-in">(you)</span></h3>
          <p className="cm-post-meta">
            {timeAgo(post.createdAt)} ·{" "}
            <span className="cm-post-audience"><AudienceIcon seenBy={seenBy} size={14} /><span><span className="cm-sr">Seen by </span>{postsAudience(seenBy).label}</span></span>
          </p>
        </div>
        {asking ? (
          <span className="cm-confirm" role="group" aria-label="Remove this post?">
            <button type="button" className="cm-btn cm-btn-small cm-btn-rust" onClick={() => communityStore.removePost(post.id)}>Remove it</button>
            <button type="button" className="cm-btn cm-btn-small cm-btn-quiet" onClick={() => setAsking(false)}>Keep</button>
          </span>
        ) : (
          <button type="button" className="cm-text-button" onClick={() => setAsking(true)}>Remove<span className="cm-sr"> your post</span></button>
        )}
      </header>
      <PostTags win={post.win} feeling={post.feeling} />
      {post.voice ? <VoiceNote words={post.text} label="your voice note" wordsClassName="cm-post-text" /> : post.text && <p className="cm-post-text">{post.text}</p>}
      {post.photo && <img className="cm-post-photo is-own" src={post.photo} alt="Your photo" />}
    </article>
  );
}

function Thread({ post, id }: { post: SamplePost; id: string }) {
  const memory = useCommunity();
  const replies = memory.replies[post.id] ?? [];
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const name = members[post.who].name;
  const reply = (words: string) => {
    if (communityStore.addReply(post.id, { text: words })) { setText(""); setStatus("Reply added."); }
  };
  return (
    <div className="cm-thread" id={id}>
      <ul className="cm-comments">
        {post.comments.filter(comment => canSee(memory, comment.who)).map((comment, index) => (
          <li key={index} className="cm-comment">
            <Face who={comment.who} size={34} />
            <p><strong>{people[comment.who].name}</strong> {comment.text}</p>
          </li>
        ))}
        {replies.map(item => (
          <li key={item.id} className="cm-comment is-mine cm-msg-in">
            <MyFace size={34} />
            <div>
              <p><strong>You</strong> {item.text}</p>
              <span className="cm-mine-foot"><button type="button" className="cm-text-button" onClick={() => communityStore.removeReply(post.id, item.id)}>Remove<span className="cm-sr"> your reply</span></button></span>
            </div>
          </li>
        ))}
      </ul>
      <div className="cm-quick-row" role="group" aria-label={`Quick replies to ${name}`}>
        {post.quickReplies.map(words => <button key={words} type="button" className="cm-quick cm-quick-mint" onClick={() => reply(words)}>{words}</button>)}
      </div>
      <form className="cm-reply" onSubmit={event => { event.preventDefault(); if (text.trim()) reply(text); }}>
        <label className="cm-chat-field">
          <span className="cm-sr">{`Write a reply to ${name}`}</span>
          <input type="text" value={text} maxLength={400} placeholder="Write a reply" autoComplete="off" onChange={event => setText(event.target.value)} />
        </label>
        <button type="submit" className="cm-round cm-round-send cm-round-small" aria-label="Send reply"><ArrowIcon size={20} /></button>
      </form>
      <p className="cm-status" role="status">{status}</p>
    </div>
  );
}

/** "Read posts aloud" in Community settings adds this: the device's own voice reads the post. */
function ListenButton({ text, name }: { text: string; name: string }) {
  const { playing, toggle } = useVoiceNote(text, voiceSeconds(text));
  return (
    <button type="button" className={`cm-listen ${playing ? "is-on" : ""}`} onClick={toggle} aria-label={playing ? `Stop reading ${name}'s post` : `Listen to ${name}'s post`}>
      {playing ? <StopIcon size={16} /> : <SpeakerIcon size={18} />}<span>{playing ? "Stop" : "Listen"}</span>
    </button>
  );
}

/**
 * An example post. `acting` is on while the hide, block or report sheet is open about this post:
 * the post and its ··· button are marked, so it is clear which post the sheet is about.
 */
function SamplePostCard({ post, rise, onMore, acting }: { post: SamplePost; rise: string; onMore: OpenSafetyMenu; acting: boolean }) {
  const memory = useCommunity();
  const replies = memory.replies[post.id] ?? [];
  const [open, setOpen] = useState(false);
  // Gentle mode covers a sad or upsetting post until it is shown, for this visit.
  const [uncovered, setUncovered] = useState(false);
  const headingId = useId();
  const threadId = useId();
  const person = members[post.who];
  const group = post.group ? sampleGroups.find(item => item.id === post.group) : undefined;
  const comments = post.comments.filter(comment => canSee(memory, comment.who));
  const count = comments.length + replies.length;
  const last = comments[comments.length - 1];
  const covered = !!post.gentle && memory.settings.gentleMode && !uncovered;
  const quiet = post.reactions.length === 0 && post.quickReplies.length === 0;
  return (
    <article className={`cm-card cm-post ${rise}${acting ? " is-acting" : ""}`} aria-labelledby={headingId}>
      <header className="cm-post-head">
        <MemberFace who={post.who} size={48} />
        <div className="cm-post-who">
          <h3 className="cm-post-name" id={headingId}>
            {person.name}
            {group && <> <span className="cm-post-in">in</span> <Link className="cm-inline-link" href={communityHref("groups", group.id)}>{group.name}</Link></>}
          </h3>
          <p className="cm-post-meta">{post.where} · {post.when}</p>
        </div>
        {isPersonId(post.who) && <FriendButton who={post.who} />}
        <button type="button" className="cm-more" aria-label={`More options for ${person.name}'s post`} aria-haspopup="dialog" aria-expanded={acting} onClick={event => onMore({ who: post.who, postId: post.id }, event.currentTarget)}>
          <DotsIcon size={22} />
        </button>
      </header>
      {covered ? (
        <div className="cm-gentle">
          <span className="cm-gentle-icon" aria-hidden="true"><EyeOffIcon size={22} /></span>
          <p>{`${person.name} shares ${post.gentle}. Gentle mode keeps it covered until you choose to read it.`}</p>
          <span className="cm-gentle-actions">
            <button type="button" className="cm-btn cm-btn-outline cm-btn-small" onClick={() => setUncovered(true)}><EyeIcon size={18} />Show the post<span className="cm-sr">{` from ${person.name}`}</span></button>
            <Link className="cm-text-button" href={communityHref("settings", null, { section: "see" })}>Gentle mode settings</Link>
          </span>
        </div>
      ) : (
        <>
          <PostTags win={!!post.win} feeling={null} />
          {post.voice
            ? <VoiceNote words={post.text} seconds={post.voice.seconds} label={`${person.name}'s voice note`} wordsClassName="cm-post-text" />
            : <p className="cm-post-text">{post.text}</p>}
          {memory.settings.readAloud && !post.voice && <ListenButton text={post.text} name={person.name} />}
          {post.photo && <img className="cm-post-photo" src={post.photo.src} alt={post.photo.alt} style={{ backgroundColor: post.photo.tint }} loading="lazy" />}
          {!quiet && (
            <div className="cm-reactions">
              {post.reactions.map(item => <ReactionButton key={item.kind} postId={post.id} kind={item.kind} count={item.count} />)}
              <button type="button" className="cm-comments-toggle" aria-expanded={open} aria-controls={threadId} onClick={() => setOpen(!open)}>
                <ChatIcon /><span>{count}</span><span className="cm-sr"> comments</span>
              </button>
            </div>
          )}
          {!open && post.peek && last && (
            <div className="cm-comment cm-comment-peek">
              <Face who={last.who} size={34} />
              <p><strong>{people[last.who].name}</strong> {last.text}</p>
            </div>
          )}
          {open && <Thread post={post} id={threadId} />}
        </>
      )}
    </article>
  );
}

/** Where a post was, after it was hidden during this visit: what happened, and a way to undo it. */
function HiddenPostNote({ post, why }: { post: SamplePost; why: "blocked" | "muted" | "post" }) {
  const name = members[post.who].name;
  const text = why === "blocked" ? `Post hidden. You blocked ${name}.` : why === "muted" ? `You hid ${name}'s posts.` : `You hid ${name}'s post.`;
  const undo = () => {
    if (why === "blocked") communityStore.unblock(post.who);
    else if (why === "muted") communityStore.unmute(post.who);
    else communityStore.unhidePost(post.id);
  };
  const undoWhat = why === "blocked" ? `, unblock ${name}` : why === "muted" ? `, show ${name}'s posts again` : `, show ${name}'s post again`;
  return (
    <div className="cm-hidden-note cm-pop">
      <span className="cm-hidden-icon" aria-hidden="true"><EyeOffIcon size={20} /></span>
      <p>{text}</p>
      <button type="button" className="cm-text-button" onClick={undo}>Undo<span className="cm-sr">{undoWhat}</span></button>
    </div>
  );
}

/** Posts that mention a word the person chose to hide wait behind this note. */
function HiddenWordsNote({ words, onShow }: { words: string[]; onShow: () => void }) {
  const count = words.length;
  return (
    <div className="cm-words-note">
      <span className="cm-hidden-icon" aria-hidden="true"><EyeOffIcon size={20} /></span>
      <p>{`${count === 1 ? "1 post is" : `${count} posts are`} hidden because ${count === 1 ? "it mentions" : "they mention"} ${listNames(Array.from(new Set(words)).map(word => `“${word}”`))}.`}</p>
      <span className="cm-words-actions">
        <button type="button" className="cm-text-button" onClick={onShow}>Show {count === 1 ? "it" : "them"} this time</button>
        <Link className="cm-text-button" href={communityHref("settings", null, { section: "see" })}>Change your hidden words</Link>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------ side column */

// Blocked people are out of sight everywhere in My community, their faces included.
const loungeFaces: PersonId[] = ["margaret", "david", "anne", "tomasz"];
const loungeQuote = lounge.messages.find(message => message.id === "l3");

function LoungeCard({ here }: { here: number }) {
  const memory = useCommunity();
  const titleId = useId();
  return (
    <section className="cm-card cm-side-card cm-rise-2" aria-labelledby={titleId}>
      <div className="cm-card-row">
        <h3 className="cm-side-title" id={titleId}>The lounge</h3>
        <span className="cm-live-pill"><LiveDot />Live</span>
      </div>
      <div className="cm-card-foot">
        <span className="cm-face-stack" aria-hidden="true">{loungeFaces.filter(who => !isBlocked(memory, who)).map(who => <Face key={who} who={who} size={30} />)}</span>
        <span className="cm-here">{`${here} people chatting now`}</span>
      </div>
      {loungeQuote && canSee(memory, loungeQuote.who) && (
        <figure className="cm-quote">
          <blockquote>{`“${loungeQuote.text}”`}</blockquote>
          <figcaption>{`${people[loungeQuote.who].name} · ${loungeQuote.minutesAgo ?? 0} min ago`}</figcaption>
        </figure>
      )}
      <Link className="cm-btn cm-btn-green cm-btn-wide" href={communityHref("lounge")}>Join the conversation<span className="cm-sr"> in the lounge</span></Link>
    </section>
  );
}

function CircleCard({ seated, memory }: { seated: boolean; memory: CommunityMemory }) {
  const titleId = useId();
  const taken = circleSeatsTaken(memory);
  return (
    <section className="cm-circle-card cm-rise-3" aria-labelledby={titleId}>
      <p className="cm-circle-card-over"><LiveDot /><span>Live now · Hosted by Alira</span></p>
      <div className="cm-circle-card-text">
        <h3 id={titleId}>Sunday circle</h3>
        <p>{circle.topic}</p>
      </div>
      <div className="cm-seat-meter">
        <span className="cm-seat-bar" role="progressbar" aria-label="Seats taken" aria-valuemin={0} aria-valuemax={CIRCLE_SEATS} aria-valuenow={taken} aria-valuetext={`${taken} of ${CIRCLE_SEATS} seats taken`}>
          <span style={{ width: `${Math.round((taken * 100) / CIRCLE_SEATS)}%` }} />
        </span>
        <span aria-hidden="true">{`${taken} of ${CIRCLE_SEATS} seats taken${seated ? " · yours is kept" : ""}`}</span>
      </div>
      <Link className="cm-btn cm-btn-gold" href={communityHref("circle")} onClick={() => communityStore.takeSeat()}>{seated ? "Go to your seat" : "Take your seat"}</Link>
    </section>
  );
}

/** "People you may know": a request with one tap, and taken back with another. */
function PeopleCard({ memory }: { memory: CommunityMemory }) {
  const titleId = useId();
  const suggestions = friendSuggestions.filter(({ who }) => ["none", "sent"].includes(relationship(memory, who)));
  if (!suggestions.length) return null;
  return (
    <section className="cm-card cm-side-card cm-rise-4" aria-labelledby={titleId}>
      <h3 className="cm-side-title" id={titleId}>People you may know</h3>
      <ul className="cm-people">
        {suggestions.map(({ who, why }) => (
          <li key={who}>
            <Face who={who} size={40} />
            <span className="cm-group-text"><b>{people[who].name}</b><span>{why}</span></span>
            <FriendButton who={who} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The line under an example group: its own preview ("Margaret: First tomatoes!"), unless the person
 * has blocked or hidden its writer. Then it is the group's last line from someone they still see,
 * as My groups shows it.
 */
function previewLine(group: SampleGroup, memory: CommunityMemory): string {
  const writer = PERSON_IDS.find(who => group.preview?.startsWith(`${people[who].name}:`));
  if (group.preview && (!writer || canSee(memory, writer))) return group.preview;
  const model = myGroups(memory).find(item => item.id === group.id);
  return model ? lastLine(model, memory, null, who => people[who].name, who => canSee(memory, who)) : "";
}

function GroupsCard({ memory }: { memory: CommunityMemory }) {
  const titleId = useId();
  const newest = memory.started[0];
  const mine = (groupId: string) => {
    const notes = memory.messages[groupId];
    return notes?.length ? `You: ${notes[notes.length - 1].text || "a photo"}` : null;
  };
  return (
    <section className="cm-card cm-side-card cm-rise-4" aria-labelledby={titleId}>
      <div className="cm-card-row">
        <h3 className="cm-side-title" id={titleId}>Your groups</h3>
        <Link className="cm-see-all" href={communityHref("groups")}>See all<span className="cm-sr"> your groups</span></Link>
      </div>
      <ul className="cm-group-links">
        {newest && (
          <li>
            <Link className="cm-group-link" href={communityHref("groups", newest.id)}>
              <Cover cover={coverForTheme(newest.theme)} className="cm-cover-thumb" />
              <span className="cm-group-text"><b>{newest.name}</b><span>{mine(newest.id) ?? (newest.hello ? `You: ${newest.hello}` : "You started this group")}</span></span>
            </Link>
          </li>
        )}
        {sampleGroups.slice(0, newest ? 3 : 4).map(group => {
          const unread = (memory.read as string[]).includes(group.id) ? 0 : group.unread;
          return (
            <li key={group.id}>
              <Link className="cm-group-link" href={communityHref("groups", group.id)}>
                <Cover cover={group.cover} className="cm-cover-thumb" />
                <span className="cm-group-text"><b>{group.name}</b><span>{mine(group.id) ?? previewLine(group, memory)}</span></span>
                {unread > 0 && <span className="cm-badge"><span aria-hidden="true">{unread}</span><span className="cm-sr">{`, ${unread} unread`}</span></span>}
              </Link>
            </li>
          );
        })}
      </ul>
      <Link className="cm-start-link" href={communityHref("start")}><PlusIcon size={20} /><span>Start a group</span></Link>
    </section>
  );
}

/* ------------------------------------------------------------------- view */

/**
 * F: the feed in the middle, with the lounge, the Sunday circle and my groups alongside. Posts
 * from people the person has blocked or hidden, and posts they hid, are left out (with an Undo
 * where one was hidden during this visit); posts mentioning a hidden word wait behind a note.
 * `onMore` opens the hide, block or report sheet from a post's ··· button; `openPostId` is the
 * post that sheet is about while it is open, which is marked.
 */
export default function FeedView({ name, here, onMore, openPostId = null }: { name: string; here: number; onMore: OpenSafetyMenu; openPostId?: string | null }) {
  const memory = useCommunity();
  const [showWords, setShowWords] = useState(false);
  const seen = feedPosts.map(post => ({ post, state: postVisibility(memory, post) }));
  const byWords = seen.flatMap(({ state }) => (!state.shown && state.why === "words" && state.word ? [state.word] : []));
  const shown = (state: PostVisibility) => state.shown || (showWords && state.why === "words");
  let rise = 0;
  return (
    <div className="cm-layout">
      <div className="cm-lane">
        <h2 className="cm-sr">Feed</h2>
        <PostComposer name={name} />
        {memory.posts.map(post => <OwnPostCard key={post.id} post={post} name={name} />)}
        {seen.map(({ post, state }) => {
          if (shown(state)) return <SamplePostCard key={post.id} post={post} onMore={onMore} acting={openPostId === post.id} rise={["cm-rise-2", "cm-rise-3", "cm-rise-4"][rise++] ?? "cm-rise-4"} />;
          if (!state.shown && state.why !== "words" && hiddenThisVisit(state.at)) return <HiddenPostNote key={post.id} post={post} why={state.why} />;
          return null;
        })}
        {byWords.length > 0 && !showWords && <HiddenWordsNote words={byWords} onShow={() => setShowWords(true)} />}
      </div>
      <aside className="cm-side" aria-labelledby="cm-side-feed">
        <h2 className="cm-sr" id="cm-side-feed">Around the community</h2>
        <LoungeCard here={here} />
        <CircleCard seated={memory.seated} memory={memory} />
        <GroupsCard memory={memory} />
        <PeopleCard memory={memory} />
        <div className="cm-side-foot">
          <Link className="cm-inline-link" href={communityHref("safety")}>Community guidelines and safety</Link>
          <p>Rehyn is not an emergency service. If you think someone is having a stroke, call 999.</p>
        </div>
      </aside>
    </div>
  );
}
