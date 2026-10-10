import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useSearch } from "wouter";
import { members, reportReasons, type ReportReason } from "@/content/community-samples";
import { communityHref, communityStore, communityViewFromQuery, isBlocked, isMuted, leadsHere, LIMITS, useCommunity, type SafetyTarget } from "@/lib/community-store";
import CommunityDialog from "./dialog";
import { BackIcon, BandageIcon, BlockIcon, ChatIcon, CheckIcon, CloseIcon, CoinsIcon, EllipsisCircleIcon, EyeOffIcon, FlagIcon, FrownIcon, MaskIcon, NextIcon, ShieldIcon } from "./icons";
import { MemberFace } from "./parts";
import { aboutLine, blockingFacts, fileReport, personWords, quoteFor, reasonOf, type ReportOutcome } from "./safety-model";

// F6: the sheet a post's ··· button opens (or a friend's, in the Friends drawer): hide someone's
// posts, block them, or report them. Whatever is chosen stays on this device: a report is kept in
// Safety, a block or a hidden post is for this person only, and the person it is about is not told.

export type PostMenuProps = {
  /** Who the sheet is about, and their post (null when it was opened for a person, not a post). */
  target: SafetyTarget;
  /** The person's first name ("Thank you, Zak."). */
  name: string;
  /** Closes the sheet. The focus goes back to the ··· button that opened it. */
  onClose: () => void;
  /** The ··· button that opened the sheet. Pass it to CommunityDialog as returnFocus. */
  returnFocus: HTMLElement | null;
  /** Where the focus goes if that button has gone (the post was hidden). Pass it to CommunityDialog. */
  fallbackFocus: () => HTMLElement | null | undefined;
  /** "block" opens the sheet at "Block them?" (a Block button pressed), rather than at the menu. */
  startAt?: "block";
};

/** The sheet's steps: the menu, the two report steps and their end, and the ends of blocking and hiding. */
export type SheetStep = "menu" | "reason" | "details" | "sent" | "block" | "blocked" | "muted";
/** Where the sheet starts. The app always starts at the menu; tests can start at any step. */
export type SheetStart = { step?: SheetStep; reason?: ReportReason | null; note?: string; alsoBlock?: boolean; outcome?: ReportOutcome | null; blockedHere?: boolean };

const reasonIcons: Record<ReportReason, ReactNode> = {
  money: <CoinsIcon size={26} />,
  health: <BandageIcon size={26} />,
  unkind: <FrownIcon size={26} />,
  fake: <MaskIcon size={26} />,
  other: <EllipsisCircleIcon size={26} />,
};

type Tone = "mint" | "amber" | "rose" | "blue";
const classes = (...names: (string | false)[]) => names.filter(Boolean).join(" ");

/** One of the three choices on the menu: a coloured sign, what it does, and an arrow. */
function Choice({ tone, icon, title, detail, onClick }: { tone: Tone; icon: ReactNode; title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" className="cm-sa-option" onClick={onClick}>
      <span className={`cm-sa-option-icon cm-sa-tone-${tone}`} aria-hidden="true">{icon}</span>
      <span className="cm-sa-option-text"><b>{title}</b><span>{detail}</span></span>
      <span className="cm-sa-option-go" aria-hidden="true"><NextIcon size={20} /></span>
    </button>
  );
}

/** "Step 1 of 2", with a pill for each step done. */
function Progress({ step }: { step: 1 | 2 }) {
  return (
    <span className="cm-sa-progress">
      <i className="is-on" aria-hidden="true" />
      <i className={step === 2 ? "is-on" : ""} aria-hidden="true" />
      <span>{`Step ${step} of 2`}</span>
    </span>
  );
}

/** The big tick at the top of a finished step. */
function Tick({ tone }: { tone: "mint" | "amber" }) {
  return (
    <span className={`cm-sa-big cm-sa-tone-${tone} cm-pop`} aria-hidden="true">
      <span className="cm-sa-tick"><CheckIcon size={42} strokeWidth={2.4} /></span>
    </span>
  );
}

/**
 * The steps inside the sheet. Each step's heading carries `titleId`, which names the dialog, and the
 * focus moves to it whenever the step changes. `start` opens the sheet at a later step.
 */
export function SafetySheetSteps({ target, name, titleId, onClose, start }: { target: SafetyTarget; name: string; titleId: string; onClose: () => void; start?: SheetStart }) {
  const memory = useCommunity();
  const search = useSearch();
  const [step, setStep] = useState<SheetStep>(start?.step ?? "menu");
  const [reason, setReason] = useState<ReportReason | null>(start?.reason ?? null);
  const [note, setNote] = useState(start?.note ?? "");
  const [alsoBlock, setAlsoBlock] = useState(start?.alsoBlock ?? true);
  const [outcome, setOutcome] = useState<ReportOutcome | null>(start?.outcome ?? null);
  // Whether the block was made in this sheet (so it can be undone here), or was there already.
  const [blockedHere, setBlockedHere] = useState(start?.blockedHere ?? false);
  const [needReason, setNeedReason] = useState(false);
  const [problem, setProblem] = useState("");
  const shown = useRef(step);
  const hintId = useId();
  const switchLabelId = useId();
  const switchHintId = useId();

  // A new step: the focus moves to its heading, so a keyboard or screen reader carries on from there.
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    document.getElementById(titleId)?.focus();
  }, [step, titleId]);

  const who = target.who;
  const person = personWords(who);
  const blocked = isBlocked(memory, who);
  const muted = isMuted(memory, who);
  const quote = quoteFor(memory, target.postId);
  const reasonLabel = reason ? reasonOf(reason).label : "";
  const view = communityViewFromQuery(search);
  const backLabel = view.space === "feed" && !view.panel ? "Back to the feed" : "Done";

  const go = (next: SheetStep) => { setNeedReason(false); setProblem(""); setStep(next); };
  const hide = () => { communityStore.mute(who); go("muted"); };
  const chooseBlock = () => {
    if (blocked) { setBlockedHere(false); go("blocked"); }
    else go("block");
  };
  const block = () => {
    setBlockedHere(!blocked);
    communityStore.block(who);
    go("blocked");
  };
  const unblock = () => { communityStore.unblock(who); onClose(); };
  const pick = (id: ReportReason) => { setReason(id); setNeedReason(false); };
  const next = () => {
    if (reason) go("details");
    else setNeedReason(true);
  };
  const save = () => {
    if (!reason) { go("reason"); return; }
    const result = fileReport(communityStore, target, { reason, note, alsoBlock: alsoBlock && !blocked });
    if (!result) { setProblem("This report couldn't be saved. Please try again."); return; }
    setOutcome(result);
    go("sent");
  };

  let body: ReactNode;
  let finished = false;

  if (step === "reason") {
    body = (
      <>
        <div className="cm-sa-top">
          <button type="button" className="cm-sa-back" aria-label="Back" onClick={() => go("menu")}><BackIcon size={20} /></button>
          <Progress step={1} />
        </div>
        <div className="cm-sa-titles">
          <h2 id={titleId} tabIndex={-1} className="cm-sa-title">{target.postId ? "What's wrong with this post?" : "What's wrong?"}</h2>
          <p>Pick the one that fits best.</p>
        </div>
        <div className="cm-sa-reasons" role="group" aria-labelledby={titleId}>
          {reportReasons.map(item => {
            const on = reason === item.id;
            return (
              <button key={item.id} type="button" className={classes("cm-sa-reason", item.id === "other" && "is-wide", on && "is-on")} aria-pressed={on} style={{ backgroundColor: item.tint, color: item.ink }} onClick={() => pick(item.id)}>
                <span className="cm-sa-reason-icon" aria-hidden="true">{reasonIcons[item.id]}</span>
                <span className="cm-sa-reason-label">{item.label}</span>
                {on && <span className="cm-sa-reason-check cm-pop" aria-hidden="true"><CheckIcon size={16} strokeWidth={2.6} /></span>}
              </button>
            );
          })}
        </div>
        <div className="cm-sa-next">
          <p className="cm-sa-need" role="status">{needReason && !reason ? "Choose the one that fits best, then press Next." : ""}</p>
          <button type="button" className={`cm-sa-wide ${reason ? "cm-sa-green" : "cm-sa-waiting"}`} aria-disabled={!reason} onClick={next}>Next</button>
        </div>
      </>
    );
  } else if (step === "details") {
    body = (
      <>
        <div className="cm-sa-top">
          <button type="button" className="cm-sa-back" aria-label="Back" onClick={() => go("reason")}><BackIcon size={20} /></button>
          <Progress step={2} />
        </div>
        <div className="cm-sa-titles">
          <h2 id={titleId} tabIndex={-1} className="cm-sa-title">Anything else to add?</h2>
          <p id={hintId}>You can skip this. Anything you write stays with your report, on this device.</p>
        </div>
        <label className="cm-sa-note">
          <span className="cm-sr">Your note</span>
          <textarea value={note} rows={2} maxLength={LIMITS.reportNote} placeholder="Type a few words, if you like" aria-describedby={hintId} onChange={event => setNote(event.target.value)} />
        </label>
        <div className="cm-sa-quote">
          <p className="cm-sa-quote-head"><CheckIcon size={16} strokeWidth={2.4} /><span>{target.postId ? `This post · ${reasonLabel}` : `About ${person.name} · ${reasonLabel}`}</span></p>
          {quote && <p className={quote.covered ? "cm-sa-quote-covered" : "cm-sa-quote-text"}>{quote.covered ? quote.text : `“${quote.text}”`}</p>}
        </div>
        {blocked ? (
          <p className="cm-sa-already"><BlockIcon size={20} /><span>{`${person.name} is already blocked.`}</span></p>
        ) : (
          <div className="cm-sa-switch-row">
            <span className="cm-sa-switch-text">
              <span id={switchLabelId}>{`Also block ${person.name}`}</span>
              <span id={switchHintId}>{`${person.Subject} won't be able to see you or message you`}</span>
            </span>
            <button type="button" role="switch" className="cm-switch" aria-checked={alsoBlock} aria-labelledby={switchLabelId} aria-describedby={switchHintId} onClick={() => setAlsoBlock(!alsoBlock)}><span /></button>
          </div>
        )}
        {problem && <p className="cm-problem" role="alert">{problem}</p>}
        <button type="button" className="cm-sa-wide cm-sa-rust" onClick={save}>Save report</button>
      </>
    );
  } else if (step === "sent") {
    finished = true;
    body = (
      <>
        <Tick tone="mint" />
        <h2 id={titleId} tabIndex={-1} className="cm-sa-title cm-sa-title-done">{`Thank you, ${name}.`}</h2>
        <p className="cm-sa-done-text">Your report is saved on this device.</p>
        <ul className="cm-sa-facts">
          <li><ShieldIcon size={20} className="cm-sa-ink-ok" /><span>{`${person.name} won't be told.`}</span></li>
          {outcome?.blocked && <li><BlockIcon size={20} className="cm-sa-ink-amber" /><span>{`${person.name} is blocked, so you won't see ${person.possessive} posts.`}</span></li>}
          {outcome?.postHidden && <li><EyeOffIcon size={20} className="cm-sa-ink-green" /><span>This post is hidden for you.</span></li>}
          <li><FlagIcon size={20} className="cm-sa-ink-blue" /><span>You can find it in Safety, and remove it any time.</span></li>
        </ul>
        <div className="cm-sa-pair">
          <button type="button" className="cm-sa-wide cm-sa-green" onClick={onClose}>{backLabel}</button>
          {/* Opened on the Safety page itself, it only closes the sheet: Back isn't given the same page twice. */}
          <Link className="cm-sa-wide cm-sa-outline" href={communityHref("safety")} replace={leadsHere(communityHref("safety"), search)} onClick={onClose}>See my reports</Link>
        </div>
        <Link className="cm-sa-alira" href="/alira" onClick={onClose}>Feeling shaken? Talk it through with Alira</Link>
      </>
    );
  } else if (step === "block") {
    const [cantSee, cantAsk, notTold] = blockingFacts(who);
    body = (
      <>
        <div className="cm-sa-top">
          <button type="button" className="cm-sa-back" aria-label="Back" onClick={() => go("menu")}><BackIcon size={20} /></button>
        </div>
        <h2 id={titleId} tabIndex={-1} className="cm-sa-title">{`Block ${person.name}?`}</h2>
        <ul className="cm-sa-lines">
          <li><span className="cm-sa-line-icon cm-sa-tone-mint" aria-hidden="true"><EyeOffIcon size={22} /></span><span>{cantSee}</span></li>
          <li><span className="cm-sa-line-icon cm-sa-tone-blue" aria-hidden="true"><ChatIcon size={22} /></span><span>{cantAsk}</span></li>
          <li><span className="cm-sa-line-icon cm-sa-tone-amber" aria-hidden="true"><ShieldIcon size={22} /></span><span>{notTold}</span></li>
        </ul>
        <div className="cm-sa-pair cm-sa-pair-spaced">
          <button type="button" className="cm-sa-wide cm-sa-danger" onClick={block}>{`Block ${person.name}`}</button>
          <button type="button" className="cm-sa-wide cm-sa-plain" onClick={() => go("menu")}>Cancel</button>
        </div>
        <button type="button" className="cm-sa-also" onClick={() => go("reason")}>{`Report ${person.name} as well`}</button>
      </>
    );
  } else if (step === "blocked") {
    finished = true;
    body = (
      <>
        <Tick tone="amber" />
        <h2 id={titleId} tabIndex={-1} className="cm-sa-title cm-sa-title-done">{`${person.name} is blocked`}</h2>
        <p className="cm-sa-done-text">{`You won't see each other in My community. Unblock ${person.object} any time from Safety.`}</p>
        <div className="cm-sa-pair">
          <button type="button" className="cm-sa-wide cm-sa-green" onClick={onClose}>{backLabel}</button>
          <button type="button" className="cm-sa-wide cm-sa-outline" onClick={unblock}>
            {blockedHere ? <>Undo<span className="cm-sr">{`: unblock ${person.name}`}</span></> : `Unblock ${person.name}`}
          </button>
        </div>
      </>
    );
  } else if (step === "muted") {
    finished = true;
    body = (
      <>
        <Tick tone="mint" />
        <h2 id={titleId} tabIndex={-1} className="cm-sa-title cm-sa-title-done">{`${person.name}'s posts are hidden`}</h2>
        <p className="cm-sa-done-text">{`You won't see them any more, and ${person.name} won't be told. If ${person.subject} ${person.is} bothering you, blocking stops that too.`}</p>
        <div className="cm-sa-pair">
          <button type="button" className="cm-sa-wide cm-sa-green" onClick={onClose}>Done</button>
          <button type="button" className="cm-sa-wide cm-sa-outline" onClick={() => go("block")}>{`Block ${person.object} instead`}</button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div className="cm-sa-who">
          <MemberFace who={who} size={64} />
          <div className="cm-sa-who-text">
            <h2 id={titleId} tabIndex={-1} className="cm-sa-name">{person.name}{target.postId && <span className="cm-sr">'s post</span>}</h2>
            <p className="cm-sa-about">{aboutLine(memory, who)}</p>
          </div>
          <button type="button" className="cm-dialog-close" aria-label="Close" onClick={onClose}><CloseIcon size={22} /></button>
        </div>
        <p className="cm-sa-intro">{`Something not right? Choose what you'd like to do. ${person.name} won't be told.`}</p>
        {!blocked && (
          <Choice tone="mint" icon={<EyeOffIcon size={24} />} title={`Hide ${person.name}'s posts`}
            detail={muted ? "Already hidden for you. Nothing else has changed." : "You stop seeing them. Nothing else changes."} onClick={hide} />
        )}
        <Choice tone="amber" icon={<BlockIcon size={24} />} title={blocked ? `${person.name} is blocked` : `Block ${person.name}`}
          detail={blocked ? "You won't see each other in My community." : `${person.Subject} can't see you, message you or find you.`} onClick={chooseBlock} />
        <Choice tone="rose" icon={<FlagIcon size={24} />} title={`Report ${person.name}`} detail="Say what's wrong. Your report stays on this device." onClick={() => go("reason")} />
        <button type="button" className="cm-sa-never" onClick={onClose}>Never mind</button>
      </>
    );
  }

  return <div key={step} className={classes("cm-sa-step", finished && "cm-sa-finished")}>{body}</div>;
}

/**
 * Where the focus goes when the sheet closes and its ··· button has gone: the same post's ··· button
 * (back again after an Undo), the line left where the post was hidden, or the person's row on the
 * Safety page. Null when there is none, and the page's own fallback is used.
 */
function nearOpener(target: SafetyTarget): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const name = members[target.who].name;
  const shown = (element: Element) => !element.closest("[hidden], [inert]");
  const all = (selector: string): HTMLElement[] => Array.prototype.slice.call(document.querySelectorAll<HTMLElement>(selector)).filter(shown);
  const label = target.postId ? `More options for ${name}'s post` : `More options for ${name}`;
  const more = all(".cm-page button.cm-more").find(button => button.getAttribute("aria-label") === label);
  if (more) return more;
  const note = target.postId ? all(".cm-page .cm-hidden-note button").find(button => (button.textContent ?? "").includes(name)) : undefined;
  if (note) return note;
  const title = target.postId ? `${name}'s post` : name;
  const row = all(".cm-page .cm-sa-person").find(item => item.querySelector("b")?.textContent === title) ?? all(".cm-page .cm-sa-person").find(item => item.querySelector("b")?.textContent === name);
  return row?.querySelector<HTMLElement>("button") ?? null;
}

export default function PostMenu({ target, name, onClose, returnFocus, fallbackFocus, startAt }: PostMenuProps) {
  const titleId = useId();
  return (
    <CommunityDialog kind="sheet" labelledBy={titleId} onClose={onClose} returnFocus={returnFocus} fallbackFocus={() => nearOpener(target) ?? fallbackFocus()} className="cm-sa-sheet">
      <SafetySheetSteps target={target} name={name} titleId={titleId} onClose={onClose} start={startAt ? { step: startAt } : undefined} />
    </CommunityDialog>
  );
}
