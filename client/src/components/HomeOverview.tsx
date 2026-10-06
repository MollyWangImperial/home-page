import { useMemo, type ComponentType } from "react";
import { ArrowRight, Award, Clock3, CloudRain, Pencil, Puzzle, ShieldAlert, Type, Users, Volume2, Wind } from "lucide-react";
import HeartRateMark from "./HeartRateMark";
import { aliraCharacters } from "@/lib/alira-message-style";
import type { SurpriseId } from "@/lib/home-surprise";
import type { NextStep, ProgressArea, WeekDay } from "@/lib/home-overview";
import "./home-overview.css";

// The home page ("Home 1 · Settle and sway"): a staged reveal, a swaying plant on the next step,
// progress bars that fill, and Alira, the week and an optional activity alongside.

/** Alira's line types out after her card has settled, the same way her chat messages arrive. */
const TYPE_START_MS = 1700;

export type HomeActivity = { id: SurpriseId; title: string; body: string; duration: string | null; onOpen: () => void };

type HomeOverviewProps = {
  headline: string;
  next: NextStep;
  onStart: () => void;
  areas: ProgressArea[];
  /** Absent while the Journey is still locked. */
  onDetails?: () => void;
  alira: { line: string; animate: boolean; run: number; onReplay: () => void; onTalk: () => void };
  week: WeekDay[];
  activity: HomeActivity | null;
};

const ACTIVITY_ICONS: Record<SurpriseId, ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>> = {
  "alira-voice": Volume2, breathing: Wind, sounds: CloudRain, "memory-pairs": Puzzle, journal: Pencil,
  medals: Award, "warning-signs": ShieldAlert, "large-text": Type, sharing: Users,
};

function AreaIcon({ area }: { area: ProgressArea["key"] }) {
  const common = { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (area === "upper_limb") return <svg {...common}><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg>;
  if (area === "hand") return <svg {...common}><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12" /><path d="M11 11.5V4.5a1.5 1.5 0 0 1 3 0V12" /><path d="M14 11.5V6a1.5 1.5 0 0 1 3 0v7" /><path d="M8 12.5V9a1.5 1.5 0 0 0-3 0v5a7 7 0 0 0 14 0v-1" /></svg>;
  return <svg {...common}><path d="M3 12h4l2-5 4 10 2-5h6" /></svg>;
}

function Plant() {
  return (
    <svg className="ho-plant-art" viewBox="0 0 300 260" role="img" aria-label="A young plant in a terracotta pot">
      <ellipse className="ho-glow" cx="150" cy="130" rx="92" ry="92" fill="#e7f0e8" />
      <circle className="ho-glow" cx="150" cy="130" r="92" fill="none" stroke="#cfe0d4" strokeWidth="1.5" />
      <ellipse cx="150" cy="236" rx="56" ry="8" fill="#d8dcd3" />
      <g className="ho-sway">
        <path d="M150 212 C150 190 146 170 152 148 C156 134 150 118 150 104" fill="none" stroke="#2f7a58" strokeWidth="4" strokeLinecap="round" />
        <path d="M151 150 C120 150 106 128 104 108 C128 108 150 122 151 150 Z" fill="#3f8a63" />
        <path d="M151 150 C136 138 122 124 110 112" fill="none" stroke="#2a6a4a" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M150 106 C150 74 170 56 196 52 C198 80 184 102 150 106 Z" fill="#4b9a70" />
        <path d="M150 106 C164 92 178 76 190 62" fill="none" stroke="#2a6a4a" strokeWidth="1.6" strokeLinecap="round" />
      </g>
      <path d="M118 206 h64 l-7 30 a8 8 0 0 1 -8 7 h-34 a8 8 0 0 1 -8 -7 z" fill="#c9825f" />
      <rect x="112" y="200" width="76" height="12" rx="4" fill="#ad5a37" />
      <path d="M120 206 h60" stroke="#8a4a2c" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      <circle className="ho-mote" cx="92" cy="150" r="2.5" fill="#9cc7ad" />
      <circle className="ho-mote ho-m2" cx="196" cy="166" r="2" fill="#9cc7ad" />
      <circle className="ho-mote ho-m3" cx="160" cy="120" r="1.8" fill="#b8d8c4" />
    </svg>
  );
}

function Tick() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>;
}

export default function HomeOverview({ headline, next, onStart, areas, onDetails, alira, week, activity }: HomeOverviewProps) {
  const typed = useMemo(() => aliraCharacters(alira.line), [alira.line]);
  const practised = week.filter(day => day.state === "done" || day.state === "today-done").length;
  const ActivityIcon = activity ? ACTIVITY_ICONS[activity.id] : null;

  return (
    <div className="ho">
      <div className="ho-hello ho-rise">
        <h1>{headline}</h1>
        <p>Your recovery, at a glance.</p>
      </div>

      <div className="ho-grid">
        <div className="ho-left">
          <section className="ho-next ho-rise" style={{ animationDelay: "250ms" }} aria-labelledby="ho-next-title">
            <div className="ho-next-body">
              <div className="ho-next-copy">
                <span className="ho-eyebrow"><span className="ho-breathe ho-eyebrow-dot" aria-hidden="true" />Next step</span>
                <h2 id="ho-next-title">{next.title}</h2>
                <div className="ho-actions">
                  <button type="button" className="ho-cta" onClick={onStart}>{next.cta}<ArrowRight size={16} strokeWidth={2} aria-hidden="true" /></button>
                  {next.note && <span className="ho-note">{next.timed && <Clock3 size={15} strokeWidth={1.8} aria-hidden="true" />}{next.note}</span>}
                </div>
              </div>
              <div className="ho-plant"><Plant /></div>
            </div>
            {next.step && (
              <div className="ho-steps">
                <div className="ho-steps-track" role="progressbar" aria-label={next.step.label} aria-valuemin={0} aria-valuemax={next.step.total} aria-valuenow={next.step.current}>
                  <span className="ho-fill" style={{ width: `${Math.round((next.step.current / next.step.total) * 100)}%`, animationDelay: "1300ms" }} />
                </div>
                <span className="ho-steps-label" aria-hidden="true">{next.step.label}</span>
              </div>
            )}
          </section>

          <div className="ho-progress-head ho-rise" style={{ animationDelay: "900ms" }}>
            <h2 id="ho-progress-title">Your progress</h2>
            {onDetails && <button type="button" className="ho-link" onClick={onDetails}>See details<ArrowRight size={16} strokeWidth={2} aria-hidden="true" /></button>}
          </div>
          <div className="ho-areas" role="list" aria-labelledby="ho-progress-title">
            {areas.map((area, index) => (
              <article key={area.key} role="listitem" className={`ho-area ho-lift ho-rise is-${area.tone}`} style={{ animationDelay: `${1000 + index * 120}ms` }}>
                <div className="ho-area-head">
                  <span className="ho-area-icon ho-ic"><AreaIcon area={area.key} /></span>
                  <span className="ho-area-status"><span aria-hidden="true" />{area.status}</span>
                </div>
                <h3>{area.label}</h3>
                <div className="ho-bar" role="progressbar" aria-label={`${area.label}, from your latest movement check`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={area.value ?? undefined} aria-valuetext={area.value === null ? "Not measured yet" : `${area.value} out of 100`}>
                  {area.value !== null && <span className="ho-fill" style={{ width: `${area.value}%`, animationDelay: `${1500 + index * 150}ms` }} />}
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="ho-right">
          <section className="ho-alira ho-rise" style={{ animationDelay: "500ms" }} aria-label="Alira">
            <div className="ho-alira-head">
              <button type="button" className="ho-alira-mark ho-halo" onClick={alira.onReplay} aria-label="Replay Alira's message" title="Replay Alira's message">
                <span className="ho-inhale"><HeartRateMark size={18} /></span>
                <span className="ho-breathe ho-alira-online" aria-hidden="true" />
              </button>
              <span className="ho-alira-name">Alira</span>
            </div>
            <p key={alira.run} className="ho-alira-line" data-typing={alira.animate ? "on" : "off"}>
              <span className="ho-sr">Alira: {alira.line}</span>
              {alira.animate && <span className="ho-dots" aria-hidden="true"><i /><i /><i /><span>Alira is typing</span></span>}
              <span aria-hidden="true">
                {alira.animate
                  ? typed.chars.map((c, i) => <span key={i} className="ho-ch" style={{ animationDelay: `${TYPE_START_MS + c.d}ms` }}>{c.ch}</span>)
                  : alira.line}
              </span>
            </p>
            <button type="button" className="ho-talk ho-lift" onClick={alira.onTalk}>Talk with Alira<span className="ho-grow" /><ArrowRight size={16} strokeWidth={2} aria-hidden="true" /></button>
          </section>

          <section className="ho-week ho-rise ho-lift" style={{ animationDelay: "650ms" }} aria-labelledby="ho-week-title">
            <h3 id="ho-week-title">This week</h3>
            <ol className="ho-days" aria-label={practised ? `Practised on ${practised} ${practised === 1 ? "day" : "days"} this week` : "No practice yet this week"}>
              {week.map((day, index) => (
                <li key={day.key} aria-current={day.state === "today" || day.state === "today-done" ? "date" : undefined}>
                  <span className="ho-sr">{day.label}</span>
                  <span className="ho-day-letter" aria-hidden="true">{day.letter}</span>
                  <span className={`ho-day is-${day.state}`} aria-hidden="true" style={day.state === "done" || day.state === "today-done" ? { animationDelay: `${900 + index * 120}ms` } : undefined}>
                    {day.state === "done" || day.state === "today-done" ? <Tick /> : day.date}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {activity && ActivityIcon && (
            <section className="ho-activity ho-rise ho-lift" style={{ animationDelay: "800ms" }} aria-labelledby="ho-activity-title">
              <div className="ho-activity-top">
                <span className="ho-activity-eyebrow">Optional activity</span>
                {activity.duration && <span className="ho-chip"><Clock3 size={12} strokeWidth={1.8} aria-hidden="true" />{activity.duration}</span>}
              </div>
              <span className="ho-activity-icon"><ActivityIcon size={18} strokeWidth={1.8} aria-hidden={true} /></span>
              <h3 id="ho-activity-title"><button type="button" className="ho-activity-open" onClick={activity.onOpen}>{activity.title}</button></h3>
              <p>{activity.body}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
