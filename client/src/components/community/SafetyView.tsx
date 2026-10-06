import { useId, useState, type ReactNode } from "react";
import { Link } from "wouter";
import type { MemberId } from "@/content/community-samples";
import { communityHref, communityStore, daysAgoLabel, friendsHref, isBlocked, isMuted, useCommunity, type CommunityMemory, type OpenSafetyMenu } from "@/lib/community-store";
import { BlockIcon, DotsIcon, EyeOffIcon, FlagIcon, LockIcon, NextIcon, QuestionIcon, ShieldIcon, SlidersIcon, UsersIcon } from "./icons";
import { MemberFace } from "./parts";
import { personWords, quoteFor, reasonOf, safetyLists, savedLabel, unblockQuestion } from "./safety-model";

// F6: the Safety page. The person's reports, the people they have blocked or hidden, and the
// posts they hid, each with a way to undo it; what they can do about someone; and where to go if
// they feel unwell or unsafe. Everything here is kept on this device, and no one is ever told.

export type SafetyViewProps = {
  /** The person's first name. */
  name: string;
  /** The Warning signs check, returning here afterwards. */
  warningSignsHref: string;
  /** Opens the hide, block or report sheet about someone. */
  onPersonMenu: OpenSafetyMenu;
};

/** Something undone on this page during this visit: its row stays, with an Undo, until the person leaves. */
type Undone =
  | { kind: "blocked"; who: MemberId; at: number }
  | { kind: "muted"; who: MemberId; at: number }
  | { kind: "post"; who: MemberId; postId: string; at: number };

/** A small picture of a post's ··· button, read out as its name, "More options". */
const MoreSign = () => <><span className="cm-sa-dots" aria-hidden="true"><DotsIcon size={16} /></span><span className="cm-sr">More options</span></>;

/** A person (or their post) in "Blocked and hidden": their face, what happened and when, and what can be done. */
function PersonRow({ who, title, detail, extra, children }: { who: MemberId; title: string; detail: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <li className="cm-sa-person">
      <MemberFace who={who} size={44} />
      <span className="cm-plain-text cm-sa-person-text"><b>{title}</b><span>{detail}</span>{extra}</span>
      {children}
    </li>
  );
}

/** The page itself, drawn from `memory`. SafetyView gives it the person's record. */
export function SafetyPage({ memory, warningSignsHref, onPersonMenu }: SafetyViewProps & { memory: CommunityMemory }) {
  const base = useId();
  const [undone, setUndone] = useState<Undone[]>([]);
  const [asking, setAsking] = useState<MemberId | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const id = (part: string) => `${base}-${part}`;
  /** Puts the focus on a control drawn in the next frame, as the one pressed has been replaced. */
  const focusSoon = (part: string) => {
    if (typeof window !== "undefined") window.requestAnimationFrame(() => document.getElementById(id(part))?.focus());
  };

  const lists = safetyLists(memory);
  const reports = memory.reports;
  const sameAs = (item: Undone, other: Undone) => item.kind === other.kind && item.who === other.who && (item.kind !== "post" || (other.kind === "post" && item.postId === other.postId));
  const remember = (item: Undone) => setUndone(list => [...list.filter(other => !sameAs(other, item)), item]);
  const forget = (item: Undone) => setUndone(list => list.filter(other => !sameAs(other, item)));
  // Rows undone here stay until what they undid is back (from here, or from anywhere else).
  const unblocked = undone.filter(item => item.kind === "blocked" && !isBlocked(memory, item.who));
  const shown = undone.filter(item => item.kind === "muted" && !isMuted(memory, item.who));
  const postsShown = undone.filter((item): item is Extract<Undone, { kind: "post" }> => item.kind === "post" && !memory.hiddenPosts[item.postId]);
  const nothing = lists.blocked.length + lists.muted.length + lists.posts.length + unblocked.length + shown.length + postsShown.length === 0;

  const askUnblock = (who: MemberId) => { setAsking(who); focusSoon(`yes-${who}`); };
  const keepBlocked = (who: MemberId) => { setAsking(null); focusSoon(`unblock-${who}`); };
  const unblock = (who: MemberId, at: number) => {
    communityStore.unblock(who);
    remember({ kind: "blocked", who, at });
    setAsking(null);
    focusSoon(`reblock-${who}`);
  };
  const reblock = (item: Undone) => { communityStore.block(item.who, item.at); forget(item); focusSoon(`unblock-${item.who}`); };
  const showPosts = (who: MemberId, at: number) => { communityStore.unmute(who); remember({ kind: "muted", who, at }); focusSoon(`rehide-${who}`); };
  const rehide = (item: Undone) => { communityStore.mute(item.who, item.at); forget(item); focusSoon(`show-${item.who}`); };
  const showPost = (who: MemberId, postId: string, at: number) => { communityStore.unhidePost(postId); remember({ kind: "post", who, postId, at }); focusSoon(`rehide-post-${postId}`); };
  const rehidePost = (item: Extract<Undone, { kind: "post" }>) => { communityStore.hidePost(item.postId, item.at); forget(item); focusSoon(`show-post-${item.postId}`); };
  const askRemove = (reportId: string) => { setRemoving(reportId); focusSoon(`remove-yes-${reportId}`); };
  const keepReport = (reportId: string) => { setRemoving(null); focusSoon(`remove-${reportId}`); };
  const removeReport = (reportId: string) => { communityStore.removeReport(reportId); setRemoving(null); focusSoon("reports"); };

  return (
    <div className="cm-sa-page">
      <header className="cm-sa-head">
        <span className="cm-sa-head-icon" aria-hidden="true"><ShieldIcon size={28} /></span>
        <div className="cm-sa-head-text">
          <h2 className="cm-view-title" tabIndex={-1} data-view-heading>Safety</h2>
          <p className="cm-view-intro">Your reports, blocked and hidden people</p>
        </div>
      </header>

      <div className="cm-sa-layout">
        <div className="cm-sa-main">
          <section className="cm-card cm-sa-card" aria-labelledby={id("reports")}>
            <h3 className="cm-sa-overline" id={id("reports")} tabIndex={-1}>Your reports</h3>
            {reports.length === 0 ? (
              <p className="cm-sa-empty">You haven't reported anything. If a post isn't right, press <MoreSign /> on it and choose Report.</p>
            ) : (
              <ul className="cm-sa-reports">
                {reports.map(report => {
                  const person = personWords(report.who);
                  const quote = quoteFor(memory, report.postId);
                  return (
                    <li key={report.id} className="cm-sa-report">
                      <div className="cm-sa-report-head">
                        <MemberFace who={report.who} size={40} />
                        <span className="cm-sa-report-text"><b>{`${person.name} · ${reasonOf(report.reason).label}`}</b><span>{`Saved ${savedLabel(report.createdAt)}`}</span></span>
                      </div>
                      {quote && <p className={quote.covered ? "cm-sa-quote-covered" : "cm-sa-report-quote"}>{quote.covered ? quote.text : `“${quote.text}”`}</p>}
                      {report.note && <p className="cm-sa-report-note"><b>Your note:</b> {report.note}</p>}
                      <div className="cm-sa-report-foot">
                        <span className="cm-sa-kept"><LockIcon size={15} />Kept on this device</span>
                        {removing === report.id ? (
                          <span className="cm-confirm" role="group" aria-label={`Remove your report about ${person.name}?`}>
                            <button id={id(`remove-yes-${report.id}`)} type="button" className="cm-btn cm-btn-small cm-btn-rust" onClick={() => removeReport(report.id)}>Remove it</button>
                            <button type="button" className="cm-btn cm-btn-small cm-btn-quiet" onClick={() => keepReport(report.id)}>Keep</button>
                          </span>
                        ) : (
                          <button id={id(`remove-${report.id}`)} type="button" className="cm-text-button" onClick={() => askRemove(report.id)}>Remove<span className="cm-sr">{` your report about ${person.name}`}</span></button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="cm-card cm-sa-card" aria-labelledby={id("hidden")}>
            <h3 className="cm-sa-overline" id={id("hidden")}>Blocked and hidden</h3>
            {nothing ? (
              <p className="cm-sa-empty">No one is blocked or hidden. Anyone you block or hide shows here, with a way to undo it.</p>
            ) : (
              <ul className="cm-sa-people">
                {lists.blocked.map(entry => {
                  const person = personWords(entry.who);
                  return (
                    <PersonRow key={`blocked-${entry.who}`} who={entry.who} title={person.name} detail={`Blocked ${daysAgoLabel(entry.at)}${entry.muted ? " · posts hidden too" : ""}`}>
                      {asking === entry.who ? (
                        <div className="cm-sa-confirm cm-pop" role="group" aria-labelledby={id(`ask-${entry.who}`)}>
                          <p id={id(`ask-${entry.who}`)}>{unblockQuestion(entry.who)}</p>
                          <div className="cm-sa-confirm-buttons">
                            <button id={id(`yes-${entry.who}`)} type="button" className="cm-sa-yes" onClick={() => unblock(entry.who, entry.at)}>Yes, unblock</button>
                            <button type="button" className="cm-sa-keep" onClick={() => keepBlocked(entry.who)}>Keep blocked</button>
                          </div>
                        </div>
                      ) : (
                        <span className="cm-sa-person-actions">
                          <button id={id(`unblock-${entry.who}`)} type="button" className="cm-sa-pill" onClick={() => askUnblock(entry.who)}>Unblock<span className="cm-sr">{` ${person.name}`}</span></button>
                        </span>
                      )}
                    </PersonRow>
                  );
                })}
                {unblocked.map(item => {
                  const person = personWords(item.who);
                  return (
                    <PersonRow key={`unblocked-${item.who}`} who={item.who} title={person.name} detail="Unblocked just now">
                      <span className="cm-sa-person-actions">
                        <button id={id(`reblock-${item.who}`)} type="button" className="cm-text-button" onClick={() => reblock(item)}>Undo<span className="cm-sr">{`: block ${person.name} again`}</span></button>
                      </span>
                    </PersonRow>
                  );
                })}
                {lists.muted.map(entry => {
                  const person = personWords(entry.who);
                  return (
                    <PersonRow key={`muted-${entry.who}`} who={entry.who} title={person.name} detail={`Posts hidden ${daysAgoLabel(entry.at)}`}>
                      <span className="cm-sa-person-actions">
                        <button id={id(`show-${entry.who}`)} type="button" className="cm-sa-pill" onClick={() => showPosts(entry.who, entry.at)}>Show posts<span className="cm-sr">{` from ${person.name}`}</span></button>
                        <button type="button" className="cm-more" aria-label={`More options for ${person.name}`} aria-haspopup="dialog" onClick={event => onPersonMenu({ who: entry.who, postId: null }, event.currentTarget)}><DotsIcon size={22} /></button>
                      </span>
                    </PersonRow>
                  );
                })}
                {shown.map(item => {
                  const person = personWords(item.who);
                  return (
                    <PersonRow key={`shown-${item.who}`} who={item.who} title={person.name} detail="Showing posts again">
                      <span className="cm-sa-person-actions">
                        <button id={id(`rehide-${item.who}`)} type="button" className="cm-text-button" onClick={() => rehide(item)}>Undo<span className="cm-sr">{`: hide ${person.name}'s posts again`}</span></button>
                      </span>
                    </PersonRow>
                  );
                })}
                {lists.posts.map(entry => {
                  const person = personWords(entry.who);
                  return (
                    <PersonRow key={`post-${entry.postId}`} who={entry.who} title={`${person.name}'s post`} detail={`Hidden ${daysAgoLabel(entry.at)}`} extra={<span className="cm-sa-snippet">{entry.quote.covered ? entry.quote.text : `“${entry.quote.text}”`}</span>}>
                      <span className="cm-sa-person-actions">
                        <button id={id(`show-post-${entry.postId}`)} type="button" className="cm-sa-pill" onClick={() => showPost(entry.who, entry.postId, entry.at)}>Show it<span className="cm-sr">{` (${person.name}'s post)`}</span></button>
                        <button type="button" className="cm-more" aria-label={`More options for ${person.name}'s post`} aria-haspopup="dialog" onClick={event => onPersonMenu({ who: entry.who, postId: entry.postId }, event.currentTarget)}><DotsIcon size={22} /></button>
                      </span>
                    </PersonRow>
                  );
                })}
                {postsShown.map(item => {
                  const person = personWords(item.who);
                  return (
                    <PersonRow key={`post-shown-${item.postId}`} who={item.who} title={`${person.name}'s post`} detail="Showing in the feed again">
                      <span className="cm-sa-person-actions">
                        <button id={id(`rehide-post-${item.postId}`)} type="button" className="cm-text-button" onClick={() => rehidePost(item)}>Undo<span className="cm-sr">{`: hide ${person.name}'s post again`}</span></button>
                      </span>
                    </PersonRow>
                  );
                })}
              </ul>
            )}
            <Link className="cm-sa-link" href={friendsHref("blocked", { space: "safety", group: null })}><UsersIcon size={20} /><span>See blocked people in Friends</span></Link>
          </section>
        </div>

        <aside className="cm-sa-side" aria-label="Staying safe">
          <section className="cm-card cm-sa-card" aria-labelledby={id("can")}>
            <h3 className="cm-sa-card-title" id={id("can")}>What you can do</h3>
            <ul className="cm-sa-cans">
              <li><span className="cm-sa-can-icon cm-sa-tone-mint" aria-hidden="true"><EyeOffIcon size={22} /></span><span className="cm-sa-can-text"><b>Hide someone's posts</b><span>You stop seeing them. Nothing else changes.</span></span></li>
              <li><span className="cm-sa-can-icon cm-sa-tone-amber" aria-hidden="true"><BlockIcon size={22} /></span><span className="cm-sa-can-text"><b>Block someone</b><span>You won't see each other in My community.</span></span></li>
              <li><span className="cm-sa-can-icon cm-sa-tone-rose" aria-hidden="true"><FlagIcon size={22} /></span><span className="cm-sa-can-text"><b>Report a post</b><span>Say what's wrong. Your report is kept here, on this device.</span></span></li>
            </ul>
            <p className="cm-sa-how">Press <MoreSign /> on any post, or beside a friend in Friends. No one is told.</p>
          </section>

          <section className="cm-sa-help" aria-label="Help now">
            <span className="cm-sa-help-icon" aria-hidden="true"><QuestionIcon size={22} /></span>
            <div className="cm-sa-help-text">
              <p>{"If you feel unwell or unsafe right now, don't wait. "}<Link className="cm-sa-help-link" href={warningSignsHref}>See Warning signs</Link></p>
              <p>{"Shaken by something you saw here? "}<Link className="cm-sa-help-link" href="/alira">Talk it through with Alira</Link></p>
            </div>
          </section>

          <Link className="cm-card cm-sa-settings" href={communityHref("settings", null, { section: "see" })}>
            <span className="cm-sa-settings-icon cm-sa-tone-mint" aria-hidden="true"><SlidersIcon size={22} /></span>
            <span className="cm-sa-settings-text"><b>Community settings</b><span>Hidden words, gentle mode and who can send you requests</span></span>
            <NextIcon size={20} />
          </Link>
        </aside>
      </div>
    </div>
  );
}

export default function SafetyView({ name, warningSignsHref, onPersonMenu }: SafetyViewProps) {
  const memory = useCommunity();
  return <SafetyPage memory={memory} name={name} warningSignsHref={warningSignsHref} onPersonMenu={onPersonMenu} />;
}
