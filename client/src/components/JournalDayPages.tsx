import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ArrowRight, Check, ChevronLeft, ChevronRight, ChevronsRight, Mic, Pencil, Plus, RotateCcw, UsersRound, X } from "lucide-react";
import AliraAvatar from "@/components/AliraAvatar";
import { MoodFace, moodOptions } from "@/components/JournalMood";
import { dayKey } from "@/lib/home-stage";
import {
  addDays, allParts, daysBetween, formatSeconds, freshStore, fromKey, isEmail, JOURNAL_QUESTIONS, joinNames, loadJournal,
  longDate, lookbackDay, MOOD_TONES, monthGrid, monthName, monthOf, PAGE_PLACEHOLDER, pickQuestion, recentDays, saveJournal,
  SHARE_PARTS, shortWeekday, type FamilyMember, type JournalMood, type JournalPage, type JournalStore, type SharePartKey,
} from "@/lib/journal-days";
import { todayLabel } from "@/pages/Welcome";
import "./journal-day-pages.css";

type Face = Exclude<JournalMood, -1>;
type DialogStep = "" | "ask" | "parts" | "people";
type TypeRun = { id: number; withPlaceholder: boolean; whole: boolean };

const FACES_HAPPIEST_FIRST: Face[] = [4, 3, 2, 1, 0];
const TYPE_STEP_MS = 34;
const FULL = 100000;

function usePrefersReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setReduced(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

/** Gives a day its question the first time it is opened, never the same as the day before. */
function withQuestion(store: JournalStore, key: string): JournalStore {
  if (store.questions[key] != null) return store;
  return { ...store, questions: { ...store.questions, [key]: pickQuestion(store.questions[addDays(key, -1)] ?? -1) } };
}

function moodLabel(mood: JournalMood): string {
  return mood >= 0 ? moodOptions[mood as Face].label : "";
}

function pageTint(mood: JournalMood, fallback: string): string {
  return mood >= 0 ? MOOD_TONES[mood as Face].page : fallback;
}

function MoodBadge({ mood }: { mood: JournalMood }) {
  if (mood < 0) return null;
  const tone = MOOD_TONES[mood as Face];
  return <span className="dp-badge" style={{ color: tone.badgeInk, background: tone.badgeBg }}><MoodFace mood={mood as Face} />{moodLabel(mood)}</span>;
}

function Switch({ on, onToggle, labelledBy, small = false }: { on: boolean; onToggle: () => void; labelledBy: string; small?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-labelledby={labelledBy} className={`dp-switch ${small ? "is-small" : ""} ${on ? "is-on" : ""}`} onClick={onToggle}><span /></button>;
}

export default function JournalDayPages({ onDateLabel, animateEntrance = true }: { onDateLabel?: (label: string) => void; animateEntrance?: boolean }) {
  const reduced = usePrefersReducedMotion();
  const [store, setStore] = useState<JournalStore>(() => {
    const loaded = loadJournal();
    return withQuestion(loaded, addDays(dayKey(new Date()), loaded.testDays));
  });
  const todayKey = addDays(dayKey(new Date()), store.testDays);

  const [viewKey, setViewKey] = useState(todayKey);
  const firstPage = store.pages[todayKey];
  const [mood, setMood] = useState<JournalMood>(firstPage?.mood ?? -1);
  const [text, setText] = useState(firstPage?.text ?? "");
  const [voice, setVoice] = useState(firstPage?.voice ?? 0);
  const [saved, setSaved] = useState(Boolean(firstPage));
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);

  const [custom, setCustom] = useState<Record<string, string>>({});
  const [seen, setSeen] = useState<Record<string, true>>({});
  const [typeRun, setTypeRun] = useState<TypeRun>({ id: 0, withPlaceholder: true, whole: Boolean(firstPage) || !animateEntrance });
  const [tick, setTick] = useState(0);
  const [spin, setSpin] = useState(0);
  const [turn, setTurn] = useState<{ n: number; dir: "next" | "prev" }>({ n: 0, dir: "next" });

  const [shownMonth, setShownMonth] = useState<number | null>(null);
  const [gridRun, setGridRun] = useState(0);
  const [popKey, setPopKey] = useState<string | null>(null);

  const [admin, setAdmin] = useState(false);
  const [dialog, setDialog] = useState<DialogStep>("");
  const [dialogFor, setDialogFor] = useState<"setup" | "one">("setup");
  const [askKey, setAskKey] = useState<string | null>(null);
  const [draftParts, setDraftParts] = useState<Record<SharePartKey, boolean>>(allParts());
  const [draftRows, setDraftRows] = useState<FamilyMember[]>([{ name: "", email: "" }]);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);

  const textRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => saveJournal(store), [store]);
  useEffect(() => { onDateLabel?.(todayLabel(fromKey(todayKey))); }, [todayKey, onDateLabel]);

  // Voice notes count up while recording, as before.
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setRecSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (!popKey) return;
    const timer = window.setTimeout(() => setPopKey(null), 1200);
    return () => window.clearTimeout(timer);
  }, [popKey]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Alira's question writes itself out the first time a day is opened, then the "Start anywhere" line does the same.
  const question = custom[viewKey] ?? JOURNAL_QUESTIONS[store.questions[viewKey] ?? 0];
  const qLen = question.length, pLen = PAGE_PLACEHOLDER.length;
  const typeTotal = typeRun.withPlaceholder ? qLen + 1 + pLen : qLen + 1;
  const whole = typeRun.whole || reduced;
  useEffect(() => {
    if (whole) { setTick(FULL); return; }
    setTick(0);
    const timer = window.setInterval(() => setTick((t) => t + 1), TYPE_STEP_MS);
    return () => window.clearInterval(timer);
  }, [typeRun, whole]);
  useEffect(() => {
    if (whole || tick < typeTotal) return;
    setSeen((s) => ({ ...s, [viewKey]: true }));
    setTypeRun((r) => ({ ...r, whole: true }));
  }, [tick, typeTotal, whole, viewKey]);
  const questionShown = whole ? question : question.slice(0, tick);
  const caret = !whole && tick <= qLen;
  const placeholderShown = whole || !typeRun.withPlaceholder ? PAGE_PLACEHOLDER : PAGE_PLACEHOLDER.slice(0, Math.max(0, tick - qLen - 1));
  const startTyping = (withPlaceholder: boolean) => setTypeRun((r) => ({ id: r.id + 1, withPlaceholder, whole: false }));

  // Dialogs: first control gets focus, Escape closes.
  useEffect(() => {
    if (!dialog) return;
    dialogRef.current?.querySelector<HTMLElement>("input, button:not([aria-label='Close'])")?.focus();
  }, [dialog]);

  const openDay = (key: string, advanceToday = false) => {
    const page = store.pages[key];
    let next = store;
    if (advanceToday) next = { ...next, testDays: next.testDays + 1 };
    next = withQuestion(next, key);
    if (next !== store) setStore(next);
    setTurn((t) => ({ n: t.n + 1, dir: key > viewKey ? "next" : "prev" }));
    if (monthOf(key) !== (shownMonth ?? monthOf(viewKey))) setGridRun((g) => g + 1);
    setViewKey(key);
    setShownMonth(null);
    setMood(page?.mood ?? -1);
    setText(page?.text ?? "");
    setVoice(page?.voice ?? 0);
    setSaved(Boolean(page));
    setRecording(false);
    setRecSeconds(0);
    if (seen[key] || page) setTypeRun((r) => ({ id: r.id + 1, withPlaceholder: false, whole: true }));
    else startTyping(true);
  };

  const prevOff = daysBetween(store.startKey, viewKey) <= 0;
  const nextOff = viewKey >= todayKey && !admin;
  const goPrev = () => { if (!prevOff) openDay(addDays(viewKey, -1)); };
  const goNext = () => { if (!nextOff) openDay(addDays(viewKey, 1), viewKey >= todayKey); };

  const edited = () => setSaved(false);
  const pickMood = (face: Face) => { setMood((m) => (m === face ? -1 : face)); edited(); };
  const toggleRecording = () => {
    if (recording) { setRecording(false); setVoice(Math.max(1, recSeconds)); }
    else { setRecSeconds(0); setRecording(true); }
    edited();
  };

  const canKeep = !saved && (mood !== -1 || text.trim() !== "" || voice > 0 || recording);
  const showToast = (message: string) => setToast({ id: Date.now(), text: message });

  const keep = () => {
    if (!canKeep) return;
    const seconds = recording ? Math.max(1, recSeconds) : voice;
    if (recording) { setRecording(false); setVoice(seconds); }
    const page: JournalPage = { mood, text: text.trim(), question, ...(seconds > 0 ? { voice: seconds } : {}) };
    const sharing = store.share.on && store.share.people.length > 0;
    setStore((s) => ({ ...s, pages: { ...s.pages, [viewKey]: page }, shared: sharing ? { ...s.shared, [viewKey]: true } : s.shared }));
    setSaved(true);
    setPopKey(viewKey);
    if (shownMonth != null && shownMonth !== monthOf(viewKey)) setGridRun((g) => g + 1);
    setShownMonth(null);
    if (sharing) showToast(`Kept and shared with ${joinNames(store.share.people)}`);
    else { setAskKey(viewKey); setDialogFor("setup"); setDialog("ask"); }
  };

  // Share with family: the same card and two-step setup as on Progress.
  const closeDialog = () => { setDialog(""); setAskKey(null); };
  const markShared = (key: string | null) => (key ? { [key]: true as const } : {});
  const toggleShare = () => {
    const share = store.share;
    if (share.on) { setStore((s) => ({ ...s, share: { ...s.share, on: false } })); return; }
    if (share.configured) { setStore((s) => ({ ...s, share: { ...s.share, on: true } })); showToast(`Your journal is shared with ${joinNames(share.people)}`); return; }
    setAskKey(null); setDialogFor("setup"); setDraftParts(allParts());
    setDraftRows(share.people.length ? share.people : [{ name: "", email: "" }]); setDialog("parts");
  };
  const editShare = () => {
    setAskKey(null); setDialogFor("setup"); setDraftParts(store.share.parts);
    setDraftRows(store.share.people.length ? store.share.people : [{ name: "", email: "" }]); setDialog("parts");
  };
  const shareThis = () => {
    if (store.share.people.length) {
      setStore((s) => ({ ...s, shared: { ...s.shared, ...markShared(askKey) } }));
      showToast(`Shared with ${joinNames(store.share.people)}`);
      closeDialog();
      return;
    }
    setDialogFor("one"); setDraftRows([{ name: "", email: "" }]); setDialog("people");
  };
  const shareAlways = () => {
    if (store.share.configured) {
      setStore((s) => ({ ...s, share: { ...s.share, on: true }, shared: { ...s.shared, ...markShared(askKey) } }));
      showToast(`Shared with ${joinNames(store.share.people)}. Every page from now on too.`);
      closeDialog();
      return;
    }
    setDialogFor("setup"); setDraftParts(allParts());
    setDraftRows(store.share.people.length ? store.share.people : [{ name: "", email: "" }]); setDialog("parts");
  };
  const draftCount = SHARE_PARTS.filter((part) => draftParts[part.key]).length;
  const validRows = draftRows.filter((row) => row.name.trim() && isEmail(row.email));
  const finishPeople = () => {
    if (!validRows.length) return;
    const people = validRows.map((row) => ({ name: row.name.trim(), email: row.email.trim() }));
    const who = joinNames(people);
    if (dialogFor === "one") {
      setStore((s) => ({ ...s, share: { ...s.share, people }, shared: { ...s.shared, ...markShared(askKey) } }));
      showToast(`Shared with ${who}`);
    } else {
      const wasConfigured = store.share.configured;
      setStore((s) => ({ ...s, share: { on: true, configured: true, parts: draftParts, people }, shared: { ...s.shared, ...markShared(askKey) } }));
      showToast(askKey ? `Shared with ${who}. Every page from now on too.` : wasConfigured ? "Sharing updated" : `Your journal is shared with ${who}`);
    }
    closeDialog();
  };
  const onDialogKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeDialog(); };

  const reroll = () => {
    setStore((s) => ({ ...s, questions: { ...s.questions, [viewKey]: pickQuestion(s.questions[viewKey] ?? -1) } }));
    setCustom((c) => { const next = { ...c }; delete next[viewKey]; return next; });
    setSpin((n) => n + 1);
    startTyping(false);
  };

  const resetAll = () => {
    const fresh = withQuestion(freshStore(), dayKey(new Date()));
    setStore(fresh);
    setViewKey(fresh.startKey);
    setMood(-1); setText(""); setVoice(0); setSaved(false); setRecording(false); setRecSeconds(0);
    setCustom({}); setSeen({}); setShownMonth(null); setGridRun((g) => g + 1); setTurn({ n: 0, dir: "next" });
    closeDialog(); setToast(null);
    startTyping(true);
  };

  // Month grid for the page being viewed; every day starts blank and fills in once its page is kept.
  const month = shownMonth ?? monthOf(viewKey);
  const firstMonth = monthOf(store.startKey), lastMonth = monthOf(todayKey);
  const cells = useMemo(() => monthGrid(month), [month]);
  const recent = recentDays(todayKey, store.startKey);
  const lbKey = lookbackDay(store.pages, viewKey);
  const lbPage = lbKey ? store.pages[lbKey] : null;
  const askPage = askKey ? store.pages[askKey] : null;
  const hasPages = Object.keys(store.pages).length > 0;
  const pageTone = pageTint(mood, "#fffdf6");

  const reflect = () => {
    if (!lbKey || !lbPage) return;
    const words = lbPage.mood >= 0 ? `On ${longDate(lbKey)} you felt ${moodLabel(lbPage.mood).toLowerCase()}. How does it feel now?` : `You kept a page on ${longDate(lbKey)}. How does that feel now?`;
    setCustom((c) => ({ ...c, [viewKey]: words }));
    startTyping(false);
    textRef.current?.focus();
  };

  const firstRender = turn.n === 0;
  const cellDelay = (index: number): CSSProperties => ({ "--dp-cell-delay": `${(gridRun === 0 ? 300 : 0) + index * 14}ms` } as CSSProperties);

  return (
    <section className="dp-journal" aria-label="Your journal">
      <div className="dp-column">
        <section className={`dp-page ${firstRender ? "is-first" : ""}`} aria-labelledby="dp-page-date" style={{ background: pageTone }}>
          <div className="dp-page-head">
            <h2 id="dp-page-date" key={`date-${viewKey}`} className={firstRender ? "" : `dp-turn-${turn.dir}`}>{longDate(viewKey)}</h2>
            <div className="dp-page-nav">
              <button type="button" aria-label="Earlier page" disabled={prevOff} onClick={goPrev}><ChevronLeft size={19} /></button>
              <button type="button" aria-label="Later page" disabled={nextOff} onClick={goNext}><ChevronRight size={19} /></button>
            </div>
          </div>
          <div key={`body-${viewKey}`} className={`dp-page-body ${firstRender ? "" : `dp-turn-${turn.dir}`}`}>
            <div className="dp-question">
              <span className="journey-alira-avatar dp-alira" aria-hidden="true"><AliraAvatar /></span>
              <p aria-hidden="true">{questionShown}{caret && <i className="dp-caret" />}</p>
              <button type="button" aria-label="Ask me something else" onClick={reroll}><RotateCcw key={spin} size={18} className={spin ? "dp-spin" : ""} /></button>
            </div>
            <textarea
              ref={textRef}
              id="dp-page-text"
              className={`dp-lines ${firstRender ? "is-first" : ""}`}
              aria-label={question}
              value={text}
              placeholder={placeholderShown}
              onChange={(event) => { setText(event.target.value); edited(); }}
            />
            <div className="dp-page-tools">
              <button type="button" className={`dp-voice ${recording ? "is-recording" : ""}`} onClick={toggleRecording}>
                <Mic size={16} />{recording ? `Stop recording · ${formatSeconds(recSeconds)}` : voice ? `Record again · ${formatSeconds(voice)}` : "Say it instead"}
              </button>
              <fieldset className="dp-feels" aria-label="How today feels">
                <span>Today feels</span>
                <div>
                  {FACES_HAPPIEST_FIRST.map((face) => (
                    <button key={face} type="button" aria-label={moodOptions[face].label} aria-pressed={mood === face} className={mood === face ? "is-selected" : ""} style={{ "--dp-mood": moodOptions[face].color } as CSSProperties} onClick={() => pickMood(face)}>
                      <span><MoodFace mood={face} /></span>
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
            <button type="button" className={`dp-keep ${saved ? "is-kept" : ""}`} disabled={!canKeep} onClick={keep}>
              {saved ? <><Check size={16} strokeWidth={2.4} />Kept</> : "Keep this page"}
            </button>
          </div>
        </section>

        {hasPages && (
          <section className="dp-card dp-share" aria-labelledby="dp-share-title">
            <span className="dp-overline">SHARE WITH FAMILY</span>
            <div className="dp-share-row">
              <span className="dp-family-icon"><UsersRound size={20} /></span>
              <b id="dp-share-title">Share my journal</b>
              <Switch on={store.share.on} onToggle={toggleShare} labelledBy="dp-share-title" />
            </div>
            {store.share.on && (
              <div className="dp-share-people">
                {store.share.people.map((person) => (
                  <div key={person.email} className="dp-person"><span>{person.name.charAt(0).toUpperCase()}</span><div><b>{person.name}</b><small>{person.email}</small></div></div>
                ))}
                <div className="dp-share-summary">
                  <small>Sharing {SHARE_PARTS.filter((part) => store.share.parts[part.key]).length} of {SHARE_PARTS.length} parts of your journal</small>
                  <button type="button" onClick={editShare}>Edit</button>
                </div>
              </div>
            )}
          </section>
        )}

        <div className="dp-admin">
          <div>
            <button type="button" aria-pressed={admin} className={`dp-admin-toggle ${admin ? "is-on" : ""}`} onClick={() => setAdmin((a) => !a)}>
              <ChevronsRight size={15} aria-hidden="true" />Administrative control<i><em /></i>
            </button>
            {admin && <button type="button" className="dp-admin-reset" onClick={resetAll}><RotateCcw size={14} />Start again</button>}
          </div>
          {admin && <p>Test mode. The right arrow on the page now steps into future days, so you can keep pages ahead of time.</p>}
        </div>
      </div>

      <div className="dp-column">
        <section className="dp-card dp-month" aria-labelledby="dp-month-title">
          <div className="dp-month-head">
            <h3 id="dp-month-title" key={`m-${month}`} className={gridRun ? "dp-month-in" : ""}>{monthName(month)}</h3>
            <div>
              <button type="button" aria-label="Previous month" disabled={month <= firstMonth} onClick={() => { setShownMonth(month - 1); setGridRun((g) => g + 1); }}><ChevronLeft size={17} /></button>
              <button type="button" aria-label="Next month" disabled={month >= lastMonth} onClick={() => { setShownMonth(month + 1); setGridRun((g) => g + 1); }}><ChevronRight size={17} /></button>
            </div>
          </div>
          <div className="dp-weekdays" aria-hidden="true">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}</div>
          <div className="dp-grid" key={`grid-${gridRun}`}>
            {cells.map((key, index) => {
              if (!key) return <span key={`pad-${index}`} className="dp-cell is-pad" aria-hidden="true" />;
              const page = store.pages[key];
              const isToday = key === todayKey;
              const isView = key === viewKey && Boolean(page);
              const tone = page && page.mood >= 0 ? MOOD_TONES[page.mood as Face] : null;
              const label = `${longDate(key)}${page ? (page.mood >= 0 ? `, ${moodLabel(page.mood)}` : ", page kept") : isToday ? ", today" : ", no page"}`;
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={label}
                  aria-pressed={isView}
                  disabled={!page}
                  onClick={() => { if (page && !isView) openDay(key); }}
                  className={`dp-cell ${page ? "is-kept" : ""} ${isToday ? "is-today" : ""} ${isView ? "is-view" : ""} ${popKey === key ? "is-pop" : ""}`}
                  style={{ ...cellDelay(index), ...(tone ? { background: tone.tint, color: tone.deep } : {}) }}
                >
                  <span className="dp-cell-num">{fromKey(key).getDate()}</span>
                  {page && page.mood >= 0 && <MoodFace mood={page.mood as Face} />}
                  {page && page.mood < 0 && <Pencil size={16} />}
                  {!page && isToday && <span className="dp-cell-today">Today</span>}
                  {popKey === key && <span className="dp-ripple" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </section>

        <section className="dp-card dp-recent" aria-labelledby="dp-recent-title">
          <h3 id="dp-recent-title">The last three days</h3>
          {recent.length === 0 ? (
            <>
              <p className="dp-recent-empty">Your last three days will gather here once you start keeping pages.</p>
              {[0, 1, 2].map((i) => <div key={i} className="dp-ghost" aria-hidden="true"><span /><span><i /><i /></span></div>)}
            </>
          ) : (
            <div key={`recent-${todayKey}`}>
              {recent.map((key, index) => {
                const page = store.pages[key];
                const body = page ? (page.text || (page.voice ? `Voice note · ${formatSeconds(page.voice)}` : "No words that day, just the feeling.")) : "";
                return (
                  <button
                    key={key}
                    type="button"
                    className={`dp-recent-row ${key === viewKey ? "is-view" : ""}`}
                    style={{ "--dp-row-delay": `${(firstRender ? 450 : 60) + index * 90}ms` } as CSSProperties}
                    aria-current={key === viewKey ? "date" : undefined}
                    aria-label={`${longDate(key)}${page ? (page.mood >= 0 ? `, ${moodLabel(page.mood)}` : ", page kept") : ", no page kept"}. Open this page`}
                    onClick={() => { if (key !== viewKey) openDay(key); }}
                  >
                    <span className="dp-recent-date"><small>{shortWeekday(key)}</small><b className={page ? "" : "is-empty"}>{fromKey(key).getDate()}</b></span>
                    <span className="dp-recent-body">
                      <span className="dp-recent-tags">
                        {page && <MoodBadge mood={page.mood} />}
                        {page && store.shared[key] && <span className="dp-shared"><Check size={12} strokeWidth={2.4} />Shared with family</span>}
                        {!page && <span className="dp-recent-none">No page kept this day</span>}
                      </span>
                      {page && <span className={`dp-recent-text ${page.text ? "" : "is-quiet"}`}>{body}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {lbKey && lbPage && (
          <aside className="dp-lookback">
            <div><span className="dp-overline is-warm">{lbKey === addDays(viewKey, -7) ? "ONE WEEK AGO TODAY" : `LOOKING BACK · ${longDate(lbKey).toUpperCase()}`}</span><span className="dp-lookback-face"><MoodBadge mood={lbPage.mood} /></span></div>
            <p>{lbPage.text ? `“${lbPage.text}”` : "You left no words that day, only how it felt."}</p>
            <button type="button" onClick={reflect}>How does it feel now?<ArrowRight size={16} strokeWidth={2.2} /></button>
          </aside>
        )}
      </div>

      {dialog && (
        <div className="recovery-modal-backdrop dp-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
          <div ref={dialogRef} className="dp-dialog" role="dialog" aria-modal="true" aria-labelledby="dp-dialog-title" onKeyDown={onDialogKey}>
            <div className="dp-dialog-head">
              <div>
                <span className="dp-overline is-warm">
                  {dialog === "ask" ? (askKey === todayKey ? "TODAY’S PAGE" : "YOUR PAGE") : dialogFor === "one" ? "SHARE THIS PAGE" : dialog === "parts" ? "STEP 1 OF 2" : "STEP 2 OF 2"}
                </span>
                <h2 id="dp-dialog-title">
                  {dialog === "ask" ? (askKey === todayKey ? "Share today’s page with your family?" : "Share this page with your family?") : dialog === "parts" ? "What would you like to share?" : "Who should receive it?"}
                </h2>
              </div>
              <button type="button" aria-label="Close" className="dp-close" onClick={closeDialog}><X size={16} strokeWidth={2.2} /></button>
            </div>

            {dialog === "ask" && askKey && (
              <>
                <article className="dp-ask-page" style={{ background: askPage ? pageTint(askPage.mood, "#fffefa") : "#fffefa" }}>
                  <div><time>{longDate(askKey)}</time>{askPage && <MoodBadge mood={askPage.mood} />}</div>
                  <p>{askPage?.text ? `“${askPage.text}”` : askPage?.voice ? `Voice note · ${formatSeconds(askPage.voice)}` : "No words today, just how it felt."}</p>
                </article>
                <div className="dp-dialog-foot is-spread">
                  <button type="button" className="dp-text-button" onClick={shareAlways}>Share every page automatically</button>
                  <div>
                    <button type="button" className="dp-button-quiet" onClick={closeDialog}>Not now</button>
                    <button type="button" className="dp-button-warm" onClick={shareThis}><UsersRound size={16} />Share this page</button>
                  </div>
                </div>
              </>
            )}

            {dialog === "parts" && (
              <>
                <div className="dp-parts">
                  {SHARE_PARTS.map((part) => (
                    <div key={part.key} className="dp-part">
                      <div><b id={`dp-part-${part.key}`}>{part.name}</b><small>{part.desc}</small></div>
                      <Switch small on={draftParts[part.key]} labelledBy={`dp-part-${part.key}`} onToggle={() => setDraftParts((p) => ({ ...p, [part.key]: !p[part.key] }))} />
                    </div>
                  ))}
                </div>
                <div className="dp-dialog-foot">
                  <button type="button" className="dp-button-quiet" onClick={closeDialog}>Cancel</button>
                  <button type="button" className="dp-button-deep" disabled={draftCount === 0} onClick={() => setDialog("people")}>Next<ArrowRight size={16} strokeWidth={2.2} /></button>
                </div>
              </>
            )}

            {dialog === "people" && (
              <>
                <div className="dp-people">
                  {draftRows.map((row, index) => (
                    <div key={index} className="dp-person-row">
                      <input type="text" value={row.name} placeholder="Name (e.g. Mum)" aria-label="Family member name" onChange={(event) => setDraftRows((rows) => rows.map((r, i) => (i === index ? { ...r, name: event.target.value } : r)))} />
                      <input type="email" value={row.email} placeholder="Email address" aria-label="Family member email" onChange={(event) => setDraftRows((rows) => rows.map((r, i) => (i === index ? { ...r, email: event.target.value } : r)))} />
                      <button type="button" aria-label="Remove this person" disabled={draftRows.length <= 1} onClick={() => setDraftRows((rows) => rows.filter((_, i) => i !== index))}><X size={15} strokeWidth={2.2} /></button>
                    </div>
                  ))}
                  <button type="button" className="dp-add-person" onClick={() => setDraftRows((rows) => [...rows, { name: "", email: "" }])}><Plus size={14} strokeWidth={2.2} />Add another person</button>
                  <p>{dialogFor === "one" ? "They will get an email with a private link to this page. Nothing else is shared." : "They will get an email with a private link to the parts you chose. You can change this or stop sharing at any time from the Journal page."}</p>
                </div>
                <div className="dp-dialog-foot is-spread">
                  <button type="button" className="dp-button-quiet" onClick={() => setDialog(dialogFor === "one" ? "ask" : "parts")}>Back</button>
                  <button type="button" className="dp-button-warm" disabled={validRows.length === 0} onClick={finishPeople}>
                    <Check size={15} strokeWidth={2.4} />{dialogFor === "one" ? "Share this page" : store.share.configured ? "Save changes" : "Start sharing"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {toast && <div className="dp-toast" role="status" key={toast.id}><span><i><Check size={15} strokeWidth={2.4} /></i>{toast.text}</span></div>}
    </section>
  );
}
