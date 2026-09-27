import { useState } from "react";
import {
  ArrowRight,
  Award,
  BookOpenCheck,
  Check,
  ChevronRight,
  Hand,
  Heart,
  Plus,
  Sparkles,
  Trophy,
  TrendingUp,
} from "lucide-react";
import RecoveryShell from "@/components/RecoveryShell";
import { useLocation } from "wouter";

type Tab = "Progress" | "Journal" | "Medals";

const wins = [
  ["Brushed my hair using my left hand", "22 Sep", "✦"],
  ["Opened a jar of jam on my own", "19 Sep", "✦"],
  ["Held a full mug of tea steadily", "16 Sep", "✦"],
];

export default function Journey() {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<Tab>("Progress");
  const [activeWeek, setActiveWeek] = useState(3);
  const [addedWin, setAddedWin] = useState(false);

  return (
    <RecoveryShell active="Journey">
      <div className="recovery-page journey-page">
        <section className="recovery-page-heading journey-heading">
          <div>
            <span className="recovery-overline"><i /> YOUR PATH</span>
            <h1>Your journey<span>.</span></h1>
            <p>Week 3 of 12 · Goal: <b>Grooming &amp; hand tasks</b></p>
          </div>
          <div className="journey-tabs" role="tablist" aria-label="Journey sections">
            {(["Progress", "Journal", "Medals"] as Tab[]).map((name) => (
              <button key={name} className={tab === name ? "is-active" : ""} onClick={() => setTab(name)} role="tab" aria-selected={tab === name}>
                {name}{name === "Medals" && <b>9/16</b>}
              </button>
            ))}
          </div>
        </section>

        {tab === "Progress" && <>
          <section className="journey-path-card" aria-labelledby="path-heading">
            <div className="journey-path-copy"><span className="recovery-overline">YOUR PATH · 12 WEEKS</span><h2 id="path-heading">Three weeks in. Your path is taking shape.</h2></div>
            <span className="journey-path-hint">Tap a week to look back</span>
            <div className="journey-weeks" aria-label="Twelve-week recovery path">
              {Array.from({ length: 12 }, (_, index) => index + 1).map((week) => (
                <button key={week} className={`journey-week ${week < 3 ? "is-done" : ""} ${week === activeWeek ? "is-current" : ""} ${week > 3 ? "is-future" : ""}`} onClick={() => setActiveWeek(week)} aria-label={week === 3 ? "Week 3, current week" : `Week ${week}`}>
                  {week < 3 ? <Check size={14} /> : week}
                  {week === 3 && <small>You are here</small>}
                  {week === 6 && <em>Reassessment · 8 Oct</em>}
                  {week === 12 && <em className="end-review">12 week review</em>}
                </button>
              ))}
            </div>
          </section>

          <div className="journey-content-grid">
            <div className="journey-main-column">
              <section className="journey-overview-card" aria-labelledby="week-overview-title">
                <div className="journey-card-heading"><h2 id="week-overview-title">Week {activeWeek} at a glance</h2><span>22 to 28 September · in progress</span></div>
                <div className="journey-stat-row">
                  <article><span>Sessions</span><b>3 of 7</b><small>So far this week</small></article>
                  <article><span>Active minutes</span><b>41</b><small>So far this week</small></article>
                  <article><span>Check ins</span><b>3 of 7</b><small>So far this week</small></article>
                </div>
                <div className="journey-skill-list">
                  <Skill icon={<TrendingUp size={19} />} name="Reaching" value="100" change="+6 this week" width="83%" tone="green" />
                  <Skill icon={<Hand size={19} />} name="Hand control" value="80" change="+4 this week" width="67%" tone="rust" />
                  <Skill icon={<Sparkles size={18} />} name="Walking" value="68" change="+3 this week" width="55%" tone="ochre" />
                </div>
                <p className="journey-baseline-note">The thin mark on each bar is your baseline from 8 September.</p>
              </section>
              <section className="journey-wins-card" aria-labelledby="wins-title">
                <div className="journey-card-heading"><div><h2 id="wins-title">Everyday wins</h2><p>Small things that matter in real life.</p></div><button className={addedWin ? "is-added" : ""} onClick={() => setAddedWin(true)}>{addedWin ? <><Check size={16} /> Added</> : <><Plus size={17} /> Add a win</>}</button></div>
                <div className="journey-win-list">
                  {wins.map(([title, date, icon]) => <article key={title}><span>{icon}</span><b>{title}</b><time>{date}</time></article>)}
                  {addedWin && <article className="journey-new-win"><span>✦</span><b>Took a moment for myself today</b><time>Today</time></article>}
                </div>
              </section>
            </div>
            <aside className="journey-side-column">
              <section className="journey-letter-card"><div className="journey-letter-icon"><BookOpenCheck size={19} /></div><span className="recovery-overline">SUNDAY LETTER FROM ALIRA</span><p>Molly, last week you showed up six times and your reaching rose by six points. This week, let’s keep the grip slow and steady.</p><button onClick={() => setLocation("/alira")}>Reply to Alira <ArrowRight size={16} /></button></section>
              <section className="journey-next-medal"><span className="recovery-overline">NEXT MEDAL</span><div><span className="medal-sun"><Award size={27} /></span><h2>Seven Sunrises</h2><p>Practise seven days in a row.</p></div><div className="medal-progress"><span style={{ width: "71%" }} /></div><b>5 of 7 days. Two more mornings to go.</b><button onClick={() => setTab("Medals")}>See all medals <ChevronRight size={16} /></button></section>
            </aside>
          </div>
        </>}

        {tab === "Journal" && <section className="journey-tab-panel journey-journal-panel" aria-labelledby="journal-title"><div className="journey-tab-intro"><span className="recovery-overline">YOUR JOURNAL</span><h2 id="journal-title">Everyday wins</h2><p>Small things that matter in real life.</p></div><div className="journal-timeline">{wins.map(([title, date, icon]) => <article key={title}><span>{icon}</span><div><time>{date}</time><h3>{title}</h3></div></article>)}{addedWin && <article><span>✦</span><div><time>Today</time><h3>Took a moment for myself today</h3></div></article>}</div><button className={addedWin ? "journal-add is-added" : "journal-add"} onClick={() => setAddedWin(true)}>{addedWin ? <><Check size={18} /> Win added</> : <><Plus size={18} /> Add a win</>}</button></section>}

        {tab === "Medals" && <section className="journey-tab-panel journey-medals-panel" aria-labelledby="medals-title"><div className="journey-tab-intro"><span className="recovery-overline">9 OF 16 MEDALS</span><h2 id="medals-title">Moments worth noticing.</h2><p>Every medal marks something you showed up for.</p></div><div className="medal-grid">{["First check-in", "Seven Sunrises", "Steady hand", "Gentle return", "Three weeks in", "Small steps"].map((medal, index) => <article key={medal} className={index === 1 ? "is-next" : index > 2 ? "is-locked" : ""}><span><Trophy size={22} /></span><h3>{medal}</h3><p>{index === 1 ? "5 of 7 days" : index > 2 ? "Keep going" : "Collected"}</p></article>)}</div></section>}
      </div>
    </RecoveryShell>
  );
}

function Skill({ icon, name, value, change, width, tone }: { icon: React.ReactNode; name: string; value: string; change: string; width: string; tone: string }) {
  return <div className={`journey-skill ${tone}`}><span className="journey-skill-icon">{icon}</span><b>{name}</b><div className="journey-bar"><span style={{ width }} /><i style={{ left: width }} /></div><strong>{value}</strong><em>{change}</em></div>;
}
