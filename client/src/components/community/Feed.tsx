import { useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "wouter";
import { feedPosts, feelings, people, sampleGroups, type FeelingId, type PersonId, type SamplePost } from "@/content/community-samples";
import { communityHref, communityStore, preparePostPhoto, timeAgo, useCommunity, type CommunityMemory, type OwnPost } from "@/lib/community-store";
import { coverForTheme } from "./group-model";
import { ArrowIcon, ChatIcon, CloseIcon, MicIcon, PhotoIcon, PlusIcon, SmileIcon, StarIcon } from "./icons";
import { AliraMark, Cover, Face, FriendButton, LiveDot, MyFace, OnlyYou, ReactionButton, TypingDots, VoiceNote } from "./parts";

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

/**
 * "What's new with you?" Photo, Voice, Feeling and Little win shape the post. Whatever is posted
 * stays on this device and is shown only to the person who wrote it.
 */
function PostComposer({ name }: { name: string }) {
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
    setPosted("Posted. Only you can see it: in this preview, nothing leaves this device.");
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
            <OnlyYou>Only you will see this post</OnlyYou>
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

function OwnPostCard({ post, name }: { post: OwnPost; name: string }) {
  const [asking, setAsking] = useState(false);
  const headingId = useId();
  return (
    <article className="cm-card cm-post is-mine cm-msg-in" aria-labelledby={headingId}>
      <header className="cm-post-head">
        <MyFace size={48} />
        <div className="cm-post-who">
          <h3 className="cm-post-name" id={headingId}>{name} <span className="cm-post-in">(you)</span></h3>
          <p className="cm-post-meta">{timeAgo(post.createdAt)}</p>
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
      <OnlyYou />
    </article>
  );
}

function Thread({ post, id }: { post: SamplePost; id: string }) {
  const replies = useCommunity().replies[post.id] ?? [];
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const name = people[post.who].name;
  const reply = (words: string) => {
    if (communityStore.addReply(post.id, { text: words })) { setText(""); setStatus("Reply added. Only you can see it."); }
  };
  return (
    <div className="cm-thread" id={id}>
      <ul className="cm-comments">
        {post.comments.map((comment, index) => (
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
              <span className="cm-mine-foot"><OnlyYou /><button type="button" className="cm-text-button" onClick={() => communityStore.removeReply(post.id, item.id)}>Remove<span className="cm-sr"> your reply</span></button></span>
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

function SamplePostCard({ post, rise }: { post: SamplePost; rise: string }) {
  const replies = useCommunity().replies[post.id] ?? [];
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const threadId = useId();
  const person = people[post.who];
  const group = post.group ? sampleGroups.find(item => item.id === post.group) : undefined;
  const count = post.comments.length + replies.length;
  const last = post.comments[post.comments.length - 1];
  return (
    <article className={`cm-card cm-post ${rise}`} aria-labelledby={headingId}>
      <header className="cm-post-head">
        <Face who={post.who} size={48} />
        <div className="cm-post-who">
          <h3 className="cm-post-name" id={headingId}>
            {person.name}
            {group && <> <span className="cm-post-in">in</span> <Link className="cm-inline-link" href={communityHref("groups", group.id)}>{group.name}</Link></>}
          </h3>
          <p className="cm-post-meta">{post.where} · {post.when}</p>
        </div>
        <FriendButton who={post.who} />
      </header>
      <PostTags win={!!post.win} feeling={null} />
      {post.voice
        ? <VoiceNote words={post.text} seconds={post.voice.seconds} label={`${person.name}'s voice note`} wordsClassName="cm-post-text" />
        : <p className="cm-post-text">{post.text}</p>}
      {post.photo && <img className="cm-post-photo" src={post.photo.src} alt={post.photo.alt} style={{ backgroundColor: post.photo.tint }} loading="lazy" />}
      <div className="cm-reactions">
        {post.reactions.map(item => <ReactionButton key={item.kind} postId={post.id} kind={item.kind} count={item.count} />)}
        <button type="button" className="cm-comments-toggle" aria-expanded={open} aria-controls={threadId} onClick={() => setOpen(!open)}>
          <ChatIcon /><span>{count}</span><span className="cm-sr"> comments</span>
        </button>
      </div>
      {!open && post.peek && last && (
        <div className="cm-comment cm-comment-peek">
          <Face who={last.who} size={34} />
          <p><strong>{people[last.who].name}</strong> {last.text}</p>
        </div>
      )}
      {open && <Thread post={post} id={threadId} />}
    </article>
  );
}

/* ------------------------------------------------------------ side column */

function LoungeCard({ here }: { here: number }) {
  const titleId = useId();
  return (
    <section className="cm-card cm-side-card cm-rise-2" aria-labelledby={titleId}>
      <div className="cm-card-head">
        <span className="cm-round-icon cm-round-icon-small"><ChatIcon size={22} /></span>
        <div className="cm-card-titles"><h3 id={titleId}>The lounge</h3><p>Drop in for a chat</p></div>
        <span className="cm-live-pill"><LiveDot />Live</span>
      </div>
      <div className="cm-peek-line">
        <Face who="anne" size={30} />
        <p className="cm-peek-bubble"><span className="cm-sr">Anne: </span>It does get lighter, promise.</p>
      </div>
      <div className="cm-peek-line">
        <Face who="priya" size={30} />
        <span className="cm-typing-pill"><TypingDots /></span><span className="cm-sr">Priya is writing</span>
      </div>
      <div className="cm-card-foot">
        <span className="cm-face-stack"><Face who="margaret" size={30} /><Face who="david" size={30} /><Face who="tomasz" size={30} /></span>
        <span className="cm-here">{here} here</span>
        <Link className="cm-btn cm-btn-green cm-btn-small" href={communityHref("lounge")}>Jump in<span className="cm-sr"> to the lounge</span></Link>
      </div>
    </section>
  );
}

const miniSeats: { who: PersonId; left: number; top: number }[] = [
  { who: "joan", left: 63, top: 6 }, { who: "david", left: 167, top: 6 }, { who: "margaret", left: 25, top: 20 }, { who: "liwei", left: 205, top: 20 },
  { who: "samuel", left: 25, top: 58 }, { who: "tomasz", left: 205, top: 58 }, { who: "anne", left: 63, top: 72 }, { who: "priya", left: 167, top: 72 },
];

function CircleCard({ seated }: { seated: boolean }) {
  const titleId = useId();
  return (
    <section className="cm-circle-card cm-rise-3" aria-labelledby={titleId}>
      <div className="cm-mini-circle" aria-hidden="true">
        <span className="cm-mini-glow" />
        <span className="cm-mini-ring" />
        <span className="cm-mini-seat" style={{ left: 115, top: 1 }}><AliraMark size={34} light /></span>
        {miniSeats.map(seat => <Face key={seat.who} who={seat.who} size={34} className="cm-mini-seat cm-mini-face" style={{ left: seat.left, top: seat.top }} />)}
        <span className="cm-mini-seat" style={{ left: 115, top: 77 }}>
          {seated
            ? <MyFace size={34} className="cm-mini-face" />
            : <span className="cm-empty-seat"><span className="cm-seat-pulse" /><span className="cm-empty-plus"><PlusIcon size={16} strokeWidth={2.4} /></span></span>}
        </span>
      </div>
      <div className="cm-circle-card-text">
        <h3 id={titleId}>Sunday circle</h3>
        <p>{seated ? "Open now. Your seat is kept for you." : "Open now. One seat is yours."}</p>
      </div>
      <Link className="cm-btn cm-btn-rust" href={communityHref("circle")} onClick={() => communityStore.takeSeat()}>{seated ? "Go to your seat" : "Take your seat"}</Link>
    </section>
  );
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
        <h3 id={titleId}>My groups</h3>
        <Link className="cm-see-all" href={communityHref("groups")}>See all<span className="cm-sr"> my groups</span></Link>
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
        {sampleGroups.slice(0, 2).map(group => {
          const unread = (memory.read as string[]).includes(group.id) ? 0 : group.unread;
          return (
            <li key={group.id}>
              <Link className="cm-group-link" href={communityHref("groups", group.id)}>
                <Cover cover={group.cover} className="cm-cover-thumb" />
                <span className="cm-group-text"><b>{group.name}</b><span>{mine(group.id) ?? group.preview}</span></span>
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

/** F: the feed in the middle, with the lounge, the Sunday circle and my groups alongside. */
export default function FeedView({ name, here }: { name: string; here: number }) {
  const memory = useCommunity();
  return (
    <div className="cm-layout">
      <div className="cm-lane">
        <h2 className="cm-sr">Feed</h2>
        <PostComposer name={name} />
        {memory.posts.map(post => <OwnPostCard key={post.id} post={post} name={name} />)}
        {feedPosts.map((post, index) => <SamplePostCard key={post.id} post={post} rise={["cm-rise-2", "cm-rise-3", "cm-rise-4"][index] ?? "cm-rise-4"} />)}
      </div>
      <aside className="cm-side" aria-labelledby="cm-side-feed">
        <h2 className="cm-sr" id="cm-side-feed">Around the community</h2>
        <LoungeCard here={here} />
        <CircleCard seated={memory.seated} />
        <GroupsCard memory={memory} />
      </aside>
    </div>
  );
}
