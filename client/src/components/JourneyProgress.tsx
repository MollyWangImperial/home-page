// The Journey's Progress tab, from the design canvas board "Day 1 — interactive: complete sessions
// to watch it evolve". It renders only once the Journey is unlocked (see lib/journey.ts): the
// twelve-day path, the starting point, then the progress card that grows one point per session,
// today's session from Alira's plan, everyday wins, Alira's notes, the next medal and sharing.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation } from "wouter";
import { ArrowRight, ArrowUpRight, Check, ChevronRight, FlaskConical, Footprints, Hand, LockKeyhole, Plus, Sparkles, Users, X } from "lucide-react";
import AliraAvatar from "@/components/AliraAvatar";
import MedalArtwork from "@/components/MedalArtwork";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { loadRememberedAssessment } from "@/lib/assessment";
import { patientExerciseReady } from "@/lib/exercise-engine/config";
import { affectedSideFrom, loadOnboardingAnswers } from "@/lib/alira-onboarding";
import { dayKey, PATIENT_NAME } from "@/lib/home-stage";
import { FamilyInvite } from "@/components/FamilyInvite";
import { nextInvite, recordInvite, type InviteMoment } from "@/lib/family-invite";
import { currentSafety } from "@/lib/alira-learning-store";
import { loadPlanReview, planReviewVersion, subscribePlanReview } from "@/lib/plan-review-store";
import {
  allSectionsOn, AREA_LABEL, AREA_ORDER, buildJourney, clearJourneyRecords, dayMonth, demoDayOffset, EMAIL_PATTERN,
  ensureJourneyRecords, journeyNow, loadSessionStore, loadShareSettings, loadWins, recordExerciseResult, saveShareSettings,
  saveWins, setDemoDayOffset, SHARE_SECTIONS, shortDate, type AreaKey, type Chart, type ChartRange, type JourneyExercise,
  type JourneyModel, type SessionStore, type ShareSectionKey, type SharePerson, type ShareSettings, type Win,
} from "@/lib/journey";
import { journeyDemoEnabled } from "@/lib/journey-demo";
import "./journey-progress.css";

const WIN_OPTIONS = [
  "Held a full mug of tea steadily", "Opened a jar of jam on my own", "Brushed my hair using my affected hand", "Buttoned my shirt without help",
  "Walked to the letterbox and back", "Tied my shoelaces", "Turned a door key", "Stood up without pushing off",
];

type AliraRefs = { disc: Set<HTMLElement>; ring: Set<HTMLElement>; dot: Set<HTMLElement> };
type Props = { animateEntrance?: boolean; reveal?: boolean; revealShare?: boolean; onShowMedals?: () => void };

export default function JourneyProgress({ animateEntrance = true, reveal = false, revealShare = false, onShowMedals }: Props) {
  const [, navigate] = useLocation();
  const [assessment] = useState(loadRememberedAssessment);
  const [store, setStore] = useState<SessionStore>(loadSessionStore);
  const [wins, setWinsState] = useState<Win[]>(loadWins);
  const [share, setShareState] = useState<ShareSettings>(loadShareSettings);
  const [now, setNow] = useState(journeyNow);
  const [range, setRange] = useState<ChartRange>("all");
  const [showEx, setShowEx] = useState(false);
  const [selected, setSelected] = useState<JourneyExercise | null>(null);
  const [underDevelopment, setUnderDevelopment] = useState<JourneyExercise | null>(null);
  const [winOpen, setWinOpen] = useState(false);
  const [winDraft, setWinDraft] = useState("");
  const [winPick, setWinPick] = useState("");
  const [shareStep, setShareStep] = useState<0 | 1 | 2>(0);
  const [draftSections, setDraftSections] = useState<Record<ShareSectionKey, boolean>>(allSectionsOn);
  const [draftRows, setDraftRows] = useState<SharePerson[]>([{ name: "", email: "" }]);
  const planHeading = useRef<HTMLHeadingElement>(null);
  const shareCard = useRef<HTMLElement>(null);

  const [records, setRecords] = useState(() => (assessment ? ensureJourneyRecords(assessment) : null));
  // The daily plan review's levels, rest days and changes (lib/plan-review.ts).
  const reviewVersion = useSyncExternalStore(subscribePlanReview, planReviewVersion, planReviewVersion);
  const planReview = useMemo(() => loadPlanReview(), [reviewVersion]);
  const model = useMemo(
    () => (assessment && records ? buildJourney({ assessment, start: records.start, assessments: records.assessments, store, now, range, planReview }) : null),
    [assessment, records, store, now, range, planReview],
  );

  // Alira's invitation to share with family, decided once per visit at a moment worth sharing.
  const [invite, setInvite] = useState<InviteMoment | null | undefined>(undefined);
  useEffect(() => {
    if (invite !== undefined || !model) return;
    const today = dayKey(model.today);
    const columns = model.assessments.filter(column => column.scores);
    const first = columns[0]?.scores;
    const last = columns[columns.length - 1]?.scores;
    const improved = columns.length >= 2 && !!first && !!last && AREA_ORDER.some(area => (last[area] ?? -1) > (first[area] ?? Infinity));
    let hardDay = false;
    try { hardDay = currentSafety().easierOnly; } catch { /* no reports */ }
    const moment = nextInvite(
      { today, sessions: model.sessions.length, streak: model.streak, wins: wins.length, daysSinceStart: model.day, improvedOnReassessment: improved },
      { sharing: share.on, hardDay },
    );
    if (moment) recordInvite(moment, today, "shown");
    setInvite(moment);
  }, [invite, model, share.on, wins.length]);

  // Numbers count up from the previous session's values when a new session has arrived.
  const [tween, setTween] = useState(1);
  const tweenRaf = useRef(0);
  const runTween = useCallback(() => {
    cancelAnimationFrame(tweenRaf.current);
    const started = performance.now();
    const step = (time: number) => {
      const t = Math.min(1, (time - started) / 900);
      setTween(t);
      if (t < 1) tweenRaf.current = requestAnimationFrame(step);
    };
    tweenRaf.current = requestAnimationFrame(step);
  }, []);
  const sessionCount = model?.sessions.length ?? 0;
  const previousSessionCount = useRef(sessionCount);
  const [animateUpdate, setAnimateUpdate] = useState(animateEntrance);
  useEffect(() => {
    const newSession = sessionCount > previousSessionCount.current;
    previousSessionCount.current = sessionCount;
    if (newSession) setAnimateUpdate(true);
    if (sessionCount > 0 && (animateEntrance || newSession)) runTween();
    return () => cancelAnimationFrame(tweenRaf.current);
  }, [sessionCount, runTween, animateEntrance]);

  // Alira's mark is always alive: a breathing glow, a turning ring and a pulse at the edge.
  const aliraRefs = useRef<AliraRefs>({ disc: new Set(), ring: new Set(), dot: new Set() });
  const register = useCallback((kind: keyof AliraRefs) => (el: HTMLElement | null) => { if (el) aliraRefs.current[kind].add(el); }, []);
  useEffect(() => {
    let raf = 0;
    const live = (set: Set<HTMLElement>) => { for (const el of set) if (!el.isConnected) set.delete(el); return set; };
    const loop = (t: number) => {
      const s = (Math.sin((t / 3000) * Math.PI * 2) + 1) / 2;
      const d = (t % 1800) / 1800;
      for (const el of live(aliraRefs.current.ring)) el.style.transform = `rotate(${(((t / 2600) * 360) % 360).toFixed(1)}deg)`;
      for (const el of live(aliraRefs.current.disc)) {
        el.style.boxShadow = `0 0 ${(22 * s).toFixed(1)}px ${(5 * s).toFixed(1)}px rgba(188,211,198,${(0.6 * s).toFixed(2)})`;
        el.style.transform = `scale(${(1 + 0.06 * s).toFixed(3)})`;
      }
      for (const el of live(aliraRefs.current.dot)) el.style.boxShadow = `0 0 0 ${(9 * d).toFixed(1)}px rgba(233,162,126,${(0.65 * (1 - d)).toFixed(2)})`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!reveal && !revealShare) return;
    const timer = window.setTimeout(() => {
      const target = revealShare ? shareCard.current : planHeading.current;
      target?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      target?.focus({ preventScroll: true });
    }, 80);
    return () => clearTimeout(timer);
  }, [reveal, revealShare]);

  if (!assessment || !records || !model) return null;
  const m = model;
  const n = m.sessions.length;
  const par = n % 2 ? "b" : "a";
  const ease = 1 - Math.pow(1 - tween, 3);
  const tw = (from: number, to: number) => Math.round(from + (to - from) * ease);
  const prevWeekAvg = avg(m.thisWeek.filter(session => session.day !== m.latest?.day));
  const side = affectedSideFrom(loadOnboardingAnswers());

  const startExercise = (exercise: JourneyExercise) => {
    setSelected(null);
    if (!patientExerciseReady(exercise.id)) {
      setUnderDevelopment(exercise);
      return;
    }
    if (m.planRows.find(row => row.exercise.id === exercise.id)?.resting) return;
    const query = new URLSearchParams({ rung: "1", side, from: "journey" });
    navigate(`/exercise/${exercise.id}?${query}`);
  };
  const startNext = () => {
    const row = m.planRows.find(r => r.exercise.launchable && !r.doneToday && !r.resting);
    if (row) startExercise(row.exercise);
  };

  const setWins = (next: Win[]) => { setWinsState(next); saveWins(next); };
  const saveWin = () => {
    const text = winDraft.trim() || winPick;
    if (!text) return;
    setWins([{ text, on: dayKey(m.today) }, ...wins]);
    setWinOpen(false); setWinDraft(""); setWinPick("");
  };

  const setShare = (next: ShareSettings) => { setShareState(next); saveShareSettings(next); };
  const openShareSetup = (fromSaved: boolean) => {
    setDraftSections(fromSaved ? { ...share.sections } : allSectionsOn());
    setDraftRows(fromSaved && share.people.length ? share.people.map(p => ({ ...p })) : [{ name: "", email: "" }]);
    setShareStep(1);
  };
  // Once set up, sharing stays on through new weeks and re-assessments until the patient turns it off.
  const toggleShare = () => {
    if (share.on) { setShare({ ...share, on: false }); return; }
    if (share.configured) { setShare({ ...share, on: true }); return; }
    openShareSetup(false);
  };
  const validRows = draftRows.filter(r => r.name.trim() && EMAIL_PATTERN.test(r.email.trim()));
  const draftCount = SHARE_SECTIONS.filter(section => draftSections[section.key]).length;
  const shareCount = SHARE_SECTIONS.filter(section => share.sections[section.key]).length;
  const finishShare = () => {
    if (!validRows.length || !draftCount) return;
    setShare({ on: true, configured: true, sections: { ...draftSections }, people: validRows.map(r => ({ name: r.name.trim(), email: r.email.trim() })) });
    setShareStep(0);
  };

  const refreshFromStorage = () => { setRecords(ensureJourneyRecords(assessment)); setStore(loadSessionStore()); setWinsState(loadWins()); setShareState(loadShareSettings()); setNow(journeyNow()); };
  const noPlan = m.exercises.length === 0;
  const noLaunchable = !noPlan && !m.exercises.some(e => e.launchable);
  const report = assessment.report;
  const domains = report?.function_rehab_plan?.caregiver_domains ?? [];

  return (
    <div className={`jp jp-${par}`} data-day={m.day} data-entrance={animateUpdate ? "first" : "seen"}>
      {journeyDemoEnabled() && <DemoStrip model={m} onChange={refreshFromStorage} />}

      <section className="jp-path" aria-label="Your twelve-week path">
        <h2>{m.headline}</h2>
        <div className="jp-timeline">
          <span className="jp-timeline-line" aria-hidden="true" />
          {m.timeline.map(day => (
            <div className="jp-day" key={day.day}>
              {day.state === "done" && <span className="jp-dot jp-dot-done" aria-label={`Day ${day.n}, done`}><Check size={14} strokeWidth={3} /></span>}
              {day.state === "today" && <span className="jp-dot jp-dot-today jp-here" aria-current="date" aria-label={`Day ${day.n}, today`}>{day.n}</span>}
              {day.state === "today-done" && <span className="jp-dot jp-dot-today-done jp-here" aria-current="date" aria-label={`Day ${day.n}, today, done`}><Check size={16} strokeWidth={3} /></span>}
              {day.state === "missed" && <span className="jp-dot jp-dot-missed" aria-label={`Day ${day.n}, missed`}><X size={12} strokeWidth={2.5} /></span>}
              {day.state === "future" && <span className="jp-dot jp-dot-future" aria-label={`Day ${day.n}`}>{day.n}</span>}
              {day.weekLabel && <small>{day.weekLabel}</small>}
              {day.reassessment && <em>Reassessment</em>}
            </div>
          ))}
        </div>
      </section>

      <div className="jp-grid">
        <div className="jp-main">
          {invite && !share.on && <FamilyInvite moment={invite} day={dayKey(m.today)} name={PATIENT_NAME} onShare={() => openShareSetup(false)} />}
          {n === 0 && (
            <section className="jp-card" aria-labelledby="jp-start-title">
              <div className="jp-card-head">
                <h2 id="jp-start-title">Your starting point</h2>
                <span className="jp-chip">Assessed {dayMonth(records.start)}</span>
              </div>
              <div className="jp-areas">
                {AREA_ORDER.map(area => <AreaBar key={area} area={area} score={m.startingScores[area]} />)}
              </div>
            </section>
          )}

          {n > 0 && m.latest && (
            <section className={`jp-card jp-flash-${par}`} aria-labelledby="jp-progress-title">
              <div className="jp-card-head">
                <h2 id="jp-progress-title">Your progress</h2>
                <div className="jp-range" role="group" aria-label="Chart range">
                  {([["7d", "7 days"], ["4w", "4 weeks"], ["all", "Since day one"]] as [ChartRange, string][]).map(([key, label]) => (
                    <button key={key} type="button" className={range === key ? "is-on" : ""} aria-pressed={range === key} onClick={() => setRange(key)}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="jp-tiles">
                <article className="jp-tile-latest"><span>Latest session</span><b className={`jp-rise-${par}`}>{tw(m.previous?.score ?? 0, m.latest.score)}</b></article>
                <article className="jp-tile-avg"><span>This week’s average</span><b className={`jp-rise-${par}`}>{m.thisWeek.length ? tw(prevWeekAvg, m.thisWeekAvg) : "—"}</b></article>
                <article className="jp-tile-sessions"><span>Sessions</span><b className={`jp-rise-${par}`}>{tw(Math.max(0, n - 1), n)}</b></article>
              </div>
              <div className="jp-chart-block">
                <div className="jp-chart-title">Session score</div>
                <ScoreChart chart={m.chart} par={par} label={m.latest ? `${shortDate(m.latest.date)} · ${m.latest.score}` : ""} ariaLabel={`Session score for every session since day one, ${n} sessions`} />
              </div>
              <div className="jp-expander">
                <button type="button" onClick={() => setShowEx(open => !open)} aria-expanded={showEx}><span>By exercise</span><span>{showEx ? "Hide" : "Show"}</span></button>
                {showEx && (
                  <div className="jp-by-exercise">
                    {m.byExercise.map(trend => (
                      <div className="jp-ex-row" key={trend.exercise.id}>
                        <div className="jp-ex-head"><span className="jp-ex-name">{trend.exercise.name}</span><AreaTag area={trend.exercise.area} /></div>
                        <ScoreChart chart={trend.chart} par={par} small label={trend.latest === null ? "" : String(trend.latest)} ariaLabel={`${trend.exercise.name} score for every session since day one, ${trend.count} sessions`} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {n > 0 && (
            <section className="jp-card jp-assessments" aria-labelledby="jp-assess-title">
              <div className="jp-card-head"><h2 id="jp-assess-title">Assessments</h2></div>
              <table>
                <thead>
                  <tr><th scope="col">Score</th>{m.assessments.map((column, i) => <th scope="col" key={i} className={column.scores ? "" : "is-pending"}><b>{column.label}</b><small>{column.date}</small></th>)}</tr>
                </thead>
                <tbody>
                  {AREA_ORDER.map(area => (
                    <tr key={area}><th scope="row">{AREA_LABEL[area]}</th>{m.assessments.map((column, i) => <td key={i}>{column.scores && column.scores[area] !== null ? <b>{column.scores[area]}</b> : <span>—</span>}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="jp-card jp-plan" id="exercises" aria-labelledby="jp-plan-title">
            <div className="jp-card-head">
              <h2 id="jp-plan-title" ref={planHeading} tabIndex={-1}>{m.planTitle}</h2>
              <div className="jp-weekdays" aria-label={`Week ${m.week}`}>
                {m.weekDays.map(day => (
                  <div key={day.day} className={day.state === "today" ? "is-today" : ""}>
                    {day.state === "done" && <span className="jp-wd jp-wd-done"><Check size={14} strokeWidth={3} /></span>}
                    {day.state === "today" && <span className="jp-wd jp-wd-today jp-here">{day.day - (m.week - 1) * 7 + 1}</span>}
                    {day.state === "missed" && <span className="jp-wd jp-wd-missed"><X size={12} strokeWidth={2.5} /></span>}
                    {day.state === "future" && <span className="jp-wd jp-wd-future" />}
                    <small>{day.label}</small>
                  </div>
                ))}
              </div>
            </div>
            {m.doneToday && (
              <div className={`jp-done jp-check-${par}`}>
                <AliraMark size={88} register={register} />
                <p>Rest well. Tomorrow’s session will be here in the morning.</p>
              </div>
            )}
            {noPlan ? (
              <p className="jp-plan-empty">{domains.length ? "We’ll start with supported movement. The next step is to review suitable movements with your carer or rehabilitation clinician." : "No camera exercises were selected from these results. Alira can help you review the next step."} <a href="/alira">Talk to Alira</a></p>
            ) : (
              <>
                <div className="jp-plan-rows">
                  {m.planRows.map(row => (
                    <div className={`jp-plan-row ${row.doneToday ? "is-done" : ""} ${row.exercise.launchable && row.resting ? "is-resting" : ""}`} key={row.exercise.id}>
                      <span className={`jp-plan-icon jp-area-${row.exercise.area}`} aria-hidden="true"><AreaIcon area={row.exercise.area} /></span>
                      <button type="button" className="jp-plan-name" onClick={() => setSelected(row.exercise)}>{row.exercise.name}<ChevronRight size={16} aria-hidden="true" /></button>
                      <span className="jp-plan-end">
                        {row.levelChange && !row.doneToday && !row.resting && (
                          <span className={`jp-level-change is-${row.levelChange}`}>{row.levelChange === "easier" ? "Easier today" : "Harder today"}</span>
                        )}
                        {row.doneToday && <span className="jp-plan-score"><Check size={14} strokeWidth={3} aria-hidden="true" /> {row.score}</span>}
                        {row.exercise.launchable && row.resting ? <span className="jp-plan-rest">Resting today</span>
                          : <button type="button" className="jp-plan-start" aria-label={`Start ${row.exercise.name}`} onClick={() => startExercise(row.exercise)}>Start</button>}
                      </span>
                    </div>
                  ))}
                </div>
                {!noLaunchable && !m.doneToday && (
                  <button type="button" className="jp-cta" onClick={startNext} disabled={!m.nextExercise}>
                    <span className="jp-cta-sheen" aria-hidden="true" />
                    <span>{m.nextExercise && m.planRows.some(r => r.doneToday) ? `Continue · ${m.nextExercise.name}` : "Start today’s session"}</span>
                    <ArrowRight className="jp-cta-arrow" size={18} aria-hidden="true" />
                  </button>
                )}
                {noLaunchable && <p className="jp-plan-empty">These movements are done with your carer. Alira can talk you through them. <a href="/alira">Talk to Alira</a></p>}
                <p className="jp-safety"><ShieldIcon /> Stop and rest if you feel dizzy or unwell. Alira checks in with you during every session.</p>
              </>
            )}
          </section>

          {m.winsUnlocked && (
            <section className="jp-card jp-wins" aria-labelledby="jp-wins-title">
              <div className="jp-card-head">
                <div><h2 id="jp-wins-title">Everyday wins</h2><p>Small things that matter in real life.</p></div>
                <button type="button" className="jp-add-win" onClick={() => { setWinOpen(true); setWinDraft(""); setWinPick(""); }}><Plus size={16} aria-hidden="true" /> Add a win</button>
              </div>
              {wins.length === 0 ? (
                <div className="jp-win-example"><span className="jp-win-star" aria-hidden="true"><Sparkles size={14} /></span><i>Held a full mug of tea steadily</i><em>Example</em></div>
              ) : (
                <div className="jp-win-list">
                  {wins.map((win, i) => <article key={`${win.on}-${i}`}><span className="jp-win-star" aria-hidden="true"><Sparkles size={14} /></span><b>{win.text}</b><time>{winDate(win.on)}</time></article>)}
                </div>
              )}
              {wins.length > 0 && !share.on && (
                <div className="jp-share-nudge">
                  <span className="jp-nudge-icon" aria-hidden="true"><Users size={18} /></span>
                  <div><b>Share your wins with your family</b><p>Moments like these are worth celebrating together.</p></div>
                  <button type="button" onClick={toggleShare}>Share <ArrowRight size={14} aria-hidden="true" /></button>
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="jp-side">
          <section className={`jp-alira-card jp-alira-${m.alira.kind}`} aria-label={m.alira.label}>
            {m.alira.kind === "letter" && <>
              <span className="jp-letter-sheen" aria-hidden="true" />
              <Sparkles className="jp-spark jp-spark-1" size={14} aria-hidden="true" />
              <Sparkles className="jp-spark jp-spark-2" size={9} aria-hidden="true" />
            </>}
            <AliraMark size={44} register={register} />
            <span className="jp-overline">{m.alira.label}</span>
            {m.alira.changes && m.alira.changes.length > 0 && (
              <div className="jp-plan-changes">
                <p>{m.alira.changesLead}</p>
                <ul>{m.alira.changes.map(line => <li key={line}>{line}</li>)}</ul>
              </div>
            )}
            <p className={`jp-rise-${par}`}>{m.alira.text}</p>
            {m.alira.tips.length > 0 && (
              <div className="jp-tips">
                <span className="jp-overline">For today’s session</span>
                {m.alira.tips.map(tip => <div key={tip}><Check size={14} strokeWidth={2.4} aria-hidden="true" /><span>{tip}</span></div>)}
              </div>
            )}
            <button type="button" onClick={() => navigate("/alira")}>Reply to Alira <ArrowRight size={16} aria-hidden="true" /></button>
          </section>

          <section className="jp-card jp-medal" aria-labelledby="jp-medal-title">
            <span className="jp-overline" id="jp-medal-title">Next medal</span>
            <div className="jp-medal-row">
              <span className="jp-medal-art">
                <span className={`jp-medal-disc jp-medal-${m.nextMedal.id}`}><MedalArtwork icon={m.nextMedal.id} /><i className="jp-shine" aria-hidden="true" /></span>
                <Sparkles className="jp-spark jp-spark-1" size={13} aria-hidden="true" />
                <Sparkles className="jp-spark jp-spark-2" size={9} aria-hidden="true" />
              </span>
              <div><h2>{m.nextMedal.name}</h2><p>{m.nextMedal.description}</p></div>
            </div>
            <div className="jp-progress-bar" role="progressbar" aria-valuenow={m.nextMedal.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${m.nextMedal.name} progress`}><span style={{ width: `${m.nextMedal.pct}%` }} /></div>
            <button type="button" className="jp-link" onClick={() => (onShowMedals ? onShowMedals() : navigate("/journey?tab=medals"))}>See all medals <ChevronRight size={14} aria-hidden="true" /></button>
          </section>

          <section className="jp-card jp-share" id="sharing" ref={shareCard} tabIndex={-1} aria-labelledby="jp-share-title">
            <span className="jp-overline" id="jp-share-title">Share with family</span>
            <div className="jp-share-row">
              <span className="jp-nudge-icon" aria-hidden="true"><Users size={20} /></span>
              <b>Share my journey</b>
              <button type="button" role="switch" aria-checked={share.on} aria-label="Share my journey with family" className={`jp-switch ${share.on ? "is-on" : ""}`} onClick={toggleShare}><span /></button>
            </div>
            {share.on && (
              <div className="jp-share-people">
                {share.people.map(person => <div key={person.email}><span>{person.name.charAt(0).toUpperCase()}</span><div><b>{person.name}</b><small>{person.email}</small></div></div>)}
                <div className="jp-share-foot"><small>Sharing {shareCount} of {SHARE_SECTIONS.length} sections</small><button type="button" onClick={() => openShareSetup(true)}>Edit</button></div>
              </div>
            )}
          </section>

          {(m.unlocks.progress || m.unlocks.wins || m.unlocks.letter) && (
            <section className="jp-unlocks" aria-labelledby="jp-unlocks-title">
              <span className="jp-overline" id="jp-unlocks-title">Unlocks as you go</span>
              {m.unlocks.progress && <div><LockKeyhole size={16} aria-hidden="true" /><div><b>Your progress</b><small>After your first session: scores, chart, by exercise</small></div></div>}
              {m.unlocks.wins && <div><LockKeyhole size={16} aria-hidden="true" /><div><b>Everyday wins</b><small>From day 2, add the small things that got easier</small></div></div>}
              {m.unlocks.letter && <div><LockKeyhole size={16} aria-hidden="true" /><div><b>Sunday letter from Alira</b><small>{m.unlocks.letterWhen}</small></div></div>}
            </section>
          )}
        </aside>
      </div>

      <Dialog open={selected !== null} onOpenChange={open => { if (!open) setSelected(null); }}>
        <DialogContent className="jp-dialog">{selected && <>
          <span className="jp-overline"><AreaTag area={selected.area} /></span>
          <DialogTitle>{selected.name}</DialogTitle>
          <DialogDescription>{selected.plan.description}</DialogDescription>
          <p className="jp-dialog-dose">{selected.plan.sets} {selected.plan.sets === 1 ? "set" : "sets"} · {selected.plan.reps} repetitions · {selected.plan.frequency}</p>
          {selected.plan.selection_reason && <p>{selected.plan.selection_reason}</p>}
          {selected.plan.safety_note && <p className="jp-note">{selected.plan.safety_note}</p>}
          {selected.launchable && m.planRows.find(r => r.exercise.id === selected.id)?.resting ? <p className="jp-note">This exercise is resting after how you felt last time. It will come back gently.</p>
            : <button type="button" className="jp-primary" onClick={() => startExercise(selected)}>{selected.launchable && m.planRows.find(r => r.exercise.id === selected.id)?.doneToday ? "Do it again" : "Start this exercise"} <ArrowRight size={16} aria-hidden="true" /></button>}
        </>}</DialogContent>
      </Dialog>

      <Dialog open={underDevelopment !== null} onOpenChange={open => { if (!open) setUnderDevelopment(null); }}>
        <DialogContent className="jp-dialog">
          <DialogTitle>Under development</DialogTitle>
          <DialogDescription>{underDevelopment?.name} is being prepared. You can try Graded Forward Reach now.</DialogDescription>
          <button type="button" className="jp-primary" onClick={() => setUnderDevelopment(null)}>Got it</button>
        </DialogContent>
      </Dialog>

      <Dialog open={winOpen} onOpenChange={open => { if (!open) setWinOpen(false); }}>
        <DialogContent className="jp-dialog">
          <DialogTitle>What felt easier today?</DialogTitle>
          <DialogDescription className="sr-only">Pick a win or write your own.</DialogDescription>
          <div className="jp-win-options">
            {WIN_OPTIONS.map(option => <button type="button" key={option} className={winPick === option ? "is-on" : ""} aria-pressed={winPick === option} onClick={() => { setWinPick(pick => (pick === option ? "" : option)); setWinDraft(""); }}>{winPick === option && <Check size={13} strokeWidth={3} aria-hidden="true" />}{option}</button>)}
          </div>
          <label className="jp-field">Or in your own words
            <input type="text" value={winDraft} onChange={event => { setWinDraft(event.target.value); setWinPick(""); }} placeholder="e.g. Poured the kettle with my right hand" />
          </label>
          <div className="jp-dialog-actions">
            <button type="button" className="jp-secondary" onClick={() => setWinOpen(false)}>Cancel</button>
            <button type="button" className="jp-primary jp-terracotta" onClick={saveWin} disabled={!(winDraft.trim() || winPick)}><Sparkles size={15} aria-hidden="true" /> Save win</button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={shareStep > 0} onOpenChange={open => { if (!open) setShareStep(0); }}>
        <DialogContent className="jp-dialog jp-dialog-wide">
          <span className="jp-overline">Step {shareStep} of 2</span>
          <DialogTitle>{shareStep === 1 ? "What would you like to share?" : "Who should receive it?"}</DialogTitle>
          <DialogDescription className="sr-only">{shareStep === 1 ? "Choose which parts of your journey to share." : "Add your family members' names and email addresses."}</DialogDescription>
          {shareStep === 1 ? <>
            <div className="jp-share-sections">
              {SHARE_SECTIONS.map(section => (
                <div key={section.key}>
                  <div><b>{section.name}</b><small>{section.desc}</small></div>
                  <button type="button" role="switch" aria-checked={draftSections[section.key]} aria-label={section.name} className={`jp-switch jp-switch-sm ${draftSections[section.key] ? "is-on" : ""}`} onClick={() => setDraftSections(current => ({ ...current, [section.key]: !current[section.key] }))}><span /></button>
                </div>
              ))}
            </div>
            <div className="jp-dialog-actions">
              <button type="button" className="jp-secondary" onClick={() => setShareStep(0)}>Cancel</button>
              <button type="button" className="jp-primary" onClick={() => draftCount && setShareStep(2)} disabled={!draftCount}>Next <ArrowRight size={16} aria-hidden="true" /></button>
            </div>
          </> : <>
            <div className="jp-share-rows">
              {draftRows.map((row, i) => (
                <div key={i}>
                  <input type="text" value={row.name} placeholder="Name (e.g. Mum)" aria-label="Family member name" onChange={event => setDraftRows(rows => rows.map((r, j) => (j === i ? { ...r, name: event.target.value } : r)))} />
                  <input type="email" value={row.email} placeholder="Email address" aria-label="Family member email" onChange={event => setDraftRows(rows => rows.map((r, j) => (j === i ? { ...r, email: event.target.value } : r)))} />
                  <button type="button" aria-label="Remove" disabled={draftRows.length <= 1} onClick={() => setDraftRows(rows => rows.filter((_, j) => j !== i))}><X size={14} aria-hidden="true" /></button>
                </div>
              ))}
              <button type="button" className="jp-add-row" onClick={() => setDraftRows(rows => [...rows, { name: "", email: "" }])}><Plus size={14} aria-hidden="true" /> Add another person</button>
              <p>They will get an email with a private link to the parts you chose. You can change this or stop sharing at any time from the Journey page.</p>
            </div>
            <div className="jp-dialog-actions jp-between">
              <button type="button" className="jp-secondary" onClick={() => setShareStep(1)}>Back</button>
              <button type="button" className="jp-primary jp-terracotta" onClick={finishShare} disabled={!validRows.length || !draftCount}><Check size={15} strokeWidth={2.4} aria-hidden="true" /> {share.configured ? "Save changes" : "Start sharing"}</button>
            </div>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function avg(sessions: { score: number }[]): number {
  return sessions.length ? Math.round(sessions.reduce((total, s) => total + s.score, 0) / sessions.length) : 0;
}

function winDate(on: string): string {
  const [y, mo, d] = on.split("-").map(Number);
  const date = new Date(y, mo - 1, d);
  return Number.isNaN(date.getTime()) ? on : dayMonth(date);
}

function AreaBar({ area, score }: { area: AreaKey; score: number | null }) {
  return (
    <div className={`jp-area jp-area-${area}`}>
      <b>{AREA_LABEL[area]}</b>
      <div className="jp-bar" aria-hidden="true"><span style={{ width: score === null ? "0%" : `${score}%` }} /></div>
      <strong>{score === null ? <small>Not measured</small> : score}</strong>
    </div>
  );
}

function AreaTag({ area }: { area: AreaKey }) {
  return <span className={`jp-tag jp-area-${area}`}>{AREA_LABEL[area]}</span>;
}

function AreaIcon({ area }: { area: AreaKey }) {
  return area === "hand" ? <Hand size={22} /> : area === "lower_limb" ? <Footprints size={22} /> : <ArrowUpRight size={22} />;
}

function ShieldIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" /></svg>;
}

/** Alira's own mark, kept alive by the page's animation loop so she feels present everywhere on the journey. */
function AliraMark({ size, register }: { size: number; register: (kind: keyof AliraRefs) => (el: HTMLElement | null) => void }) {
  return (
    <span className="jp-alira" style={{ width: size, height: size }} ref={register("disc")} aria-hidden="true">
      <AliraAvatar />
      <span className="jp-alira-ring" ref={register("ring")} />
      <span className="jp-alira-dot" ref={register("dot")} />
    </span>
  );
}

/** The score line on a 736-wide canvas; labels live inside the SVG so the chart scales with the card. */
function ScoreChart({ chart, par, small = false, label, ariaLabel }: { chart: Chart; par: string; small?: boolean; label: string; ariaLabel: string }) {
  const height = small ? 100 : 212;
  const latest = chart.latest;
  const labelHeight = small ? 24 : 36;
  const labelWidth = label.length * (small ? 6.8 : 12.5) + (small ? 20 : 28);
  const labelX = latest ? Math.min(736 - labelWidth / 2 - 6, Math.max(labelWidth / 2 + 30, latest.x)) : 0;
  const labelY = latest ? (latest.y < (small ? 36 : 54) ? latest.y + (small ? 12 : 14) : latest.y - (small ? 32 : 50)) : 0;
  return (
    <svg className={`jp-chart ${small ? "is-small" : ""}`} viewBox={`0 0 736 ${height}`} role="img" aria-label={ariaLabel}>
      {chart.axis.labels.map(tick => <text key={tick.text} x="26" y={tick.y + 7} textAnchor="end" className="jp-axis">{tick.text}</text>)}
      <path d={chart.dividersD} className="jp-divider" />
      <path d={chart.lineD} className={`jp-line jp-line-${par}`} />
      <path d={chart.dotsD} className="jp-dots" />
      {latest && <>
        {!small && <><circle className="jp-halo" cx={latest.x} cy={latest.y} r="6" /><circle className="jp-halo jp-halo-2" cx={latest.x} cy={latest.y} r="6" /></>}
        <circle className={`jp-latest jp-latest-${par}`} cx={latest.x} cy={latest.y} r={small ? 4.5 : 5.5} />
        {label && <g className={`jp-chart-label jp-fade-${par}`}>
          <rect x={labelX - labelWidth / 2} y={labelY} width={labelWidth} height={labelHeight} rx="7" />
          <text x={labelX} y={labelY + (small ? 16 : 25)} textAnchor="middle">{label}</text>
        </g>}
      </>}
    </svg>
  );
}

/** Local testing only: set scores, complete the day, move to the next day. Not part of the patient UI. */
function DemoStrip({ model, onChange }: { model: JourneyModel; onChange: () => void }) {
  const launchable = model.exercises.filter(exercise => exercise.launchable);
  const [scores, setScores] = useState<Record<string, number>>(() => Object.fromEntries(launchable.map((exercise, i) => [exercise.id, model.latest?.scores[exercise.id] ?? [78, 66, 82, 70][i % 4]])));
  const preview = launchable.length ? Math.round(launchable.reduce((total, exercise) => total + (scores[exercise.id] ?? 0), 0) / launchable.length) : 0;
  const complete = () => {
    if (model.doneToday) return;
    // An exercise resting today after a warning sign isn't done, as in real use.
    const resting = new Set(model.planRows.filter(row => row.resting).map(row => row.exercise.id));
    for (const exercise of launchable) if (!resting.has(exercise.id)) recordExerciseResult(exercise.id, scores[exercise.id] ?? 0, model.today);
    setScores(current => Object.fromEntries(launchable.map((exercise, i) => [exercise.id, Math.max(0, Math.min(97, (current[exercise.id] ?? 0) + 1 + (((model.day * 5 + i) % 3) - 1)))])));
    onChange();
  };
  return (
    <div className="jp-demo" role="region" aria-label="Local testing controls">
      <div className="jp-demo-intro"><FlaskConical size={14} aria-hidden="true" /><b>TESTING ONLY, WILL REMOVE ONCE LAUNCH</b></div>
      <div className="jp-demo-fields">
        {launchable.map(exercise => (
          <label key={exercise.id}>{exercise.name}
            <input type="number" min={0} max={100} value={scores[exercise.id] ?? 0} onChange={event => setScores(current => ({ ...current, [exercise.id]: Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0))) }))} />
          </label>
        ))}
        <div className="jp-demo-score"><span>Session score</span><b>{preview}</b></div>
      </div>
      <div className="jp-demo-actions">
        <button type="button" className="jp-primary jp-terracotta" onClick={complete} disabled={model.doneToday || !launchable.length}>{model.doneToday ? "Today is done" : "Complete today’s session"}</button>
        <button type="button" className="jp-secondary" onClick={() => { setDemoDayOffset(demoDayOffset() + 1); onChange(); }}>Next day</button>
        <button type="button" className="jp-secondary" onClick={() => { clearJourneyRecords(); onChange(); }}>Reset</button>
      </div>
    </div>
  );
}
