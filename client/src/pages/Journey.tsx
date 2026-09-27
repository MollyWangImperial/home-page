import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Award,
  BookOpenCheck,
  Check,
  ChevronRight,
  Hand,
  Heart,
  Mic,
  Plus,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import RecoveryShell from "@/components/RecoveryShell";
import { useLocation } from "wouter";

type Tab = "Progress" | "Journal" | "Medals";
type MoodIndex = -1 | 0 | 1 | 2 | 3 | 4;
type JournalEntry = { date: string; mood: 0 | 1 | 2 | 3 | 4; text: string; voice?: number; tags: string[]; shared?: boolean };
type Medal = { name: string; symbol: string; done?: boolean; date?: string; current?: number; total?: number; unit?: string; description: string };
type MedalCategory = { name: string; tone: string; earned: string; medals: Medal[] };

const moodOptions = [
  { label: "Tough", color: "#b5502f", face: "☹" },
  { label: "Low", color: "#b86a3f", face: "◔" },
  { label: "Okay", color: "#8a7424", face: "•" },
  { label: "Good", color: "#3e7457", face: "◡" },
  { label: "Great", color: "#2f5e48", face: "⌣" },
] as const;
const journalTags = ["Win", "Pain", "Sleep", "Mood", "Question for my therapist"];
const referenceEntries: JournalEntry[] = [
  { date: "Tuesday 22 September", mood: 3, text: "Brushed my hair with my left hand this morning. Slow, but I did it.", tags: ["Win"] },
  { date: "Sunday 20 September", mood: 1, text: "Felt tired all day, so I only did a short session.", voice: 48, tags: ["Sleep", "Mood"], shared: true },
  { date: "Thursday 17 September", mood: 2, text: "Is it normal for my shoulder to ache after reaching exercises?", tags: ["Question for my therapist"], shared: true },
];
const streakMoods = [2, 3, 1, 2, 3, 3, -1, 2, 4, 1, 3, 3, 2];
const medalCategories: MedalCategory[] = [
  { name: "Consistency", tone: "consistency", earned: "2 of 4", medals: [
    { name: "First Step", symbol: "⇧", done: true, date: "8 Sep", description: "Complete your very first session." },
    { name: "Seven Sunrises", symbol: "☼", current: 5, total: 7, unit: "days", description: "Practise seven days in a row." },
    { name: "Weekend Warrior", symbol: "↔", done: true, date: "20 Sep", description: "Practise on a Saturday and a Sunday." },
    { name: "Month of Mornings", symbol: "▣", current: 5, total: 30, unit: "days", description: "Practise on thirty different days." },
  ] },
  { name: "Milestones", tone: "milestones", earned: "2 of 4", medals: [
    { name: "Baseline Set", symbol: "⚑", done: true, date: "8 Sep", description: "Complete your first assessment." },
    { name: "Ten Up", symbol: "↑", done: true, date: "21 Sep", description: "Raise any recovery score by ten points." },
    { name: "Steady Hand", symbol: "✋", current: 80, total: 90, unit: "points", description: "Reach a hand control score of 90." },
    { name: "Reassessment Ready", symbol: "◎", current: 3, total: 5, unit: "weeks", description: "Reach your week 5 reassessment." },
  ] },
  { name: "Courage", tone: "courage", earned: "3 of 4", medals: [
    { name: "Found My Voice", symbol: "◉", done: true, date: "20 Sep", description: "Record your first voice note." },
    { name: "Asked Alira", symbol: "▢", done: true, date: "17 Sep", description: "Ask Alira your first question." },
    { name: "Honest Day", symbol: "♡", done: true, date: "20 Sep", description: "Write about a hard day in your journal." },
    { name: "Shared It", symbol: "⌘", current: 0, total: 1, unit: "shares", description: "Share a win with someone you love." },
  ] },
  { name: "Everyday life", tone: "everyday", earned: "2 of 4", medals: [
    { name: "First Win", symbol: "☆", done: true, date: "16 Sep", description: "Log your first everyday win." },
    { name: "Self Care", symbol: "≡", done: true, date: "22 Sep", description: "Log a win with grooming or getting ready." },
    { name: "Five Wins", symbol: "✓", current: 3, total: 5, unit: "wins", description: "Log five everyday wins." },
    { name: "Kitchen Helper", symbol: "☕", current: 0, total: 1, unit: "wins", description: "Log a win in the kitchen." },
  ] },
] as const;

export default function Journey() {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<Tab>("Progress");
  const [activeWeek, setActiveWeek] = useState(3);
  const [addedWin, setAddedWin] = useState(false);
  const [mood, setMood] = useState<MoodIndex>(-1);
  const [entryText, setEntryText] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [shareWithTherapist, setShareWithTherapist] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [voiceNote, setVoiceNote] = useState(0);
  const [entries, setEntries] = useState<JournalEntry[]>(referenceEntries);
  const [selectedMedal, setSelectedMedal] = useState(1);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setVoiceSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const allMedals = useMemo(() => medalCategories.flatMap((category) => category.medals.map((medal) => ({ ...medal, category: category.name, tone: category.tone }))), []);
  const selectedMedalDetails = allMedals[selectedMedal] ?? allMedals[1];
  const earnedCount = allMedals.filter((medal) => medal.done || (medal.current && medal.total && medal.current >= medal.total)).length;

  const addWin = () => setAddedWin(true);
  const toggleTag = (tag: string) => setSelectedTags((current) => current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag]);
  const toggleRecording = () => {
    if (recording) {
      setRecording(false);
      setVoiceNote(Math.max(1, voiceSeconds));
    } else {
      setVoiceSeconds(0);
      setRecording(true);
    }
  };
  const saveEntry = () => {
    if (mood === -1 && !entryText.trim() && !voiceNote && !recording) return;
    setEntries((current) => [{ date: "Today", mood: mood === -1 ? 2 : mood, text: entryText.trim() || "Voice note", voice: recording ? Math.max(1, voiceSeconds) : voiceNote, tags: selectedTags, shared: shareWithTherapist }, ...current]);
    setMood(-1); setEntryText(""); setSelectedTags([]); setShareWithTherapist(false); setVoiceNote(0); setVoiceSeconds(0); setRecording(false);
  };

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
            {(["Progress", "Journal", "Medals"] as Tab[]).map((name) => <button key={name} className={tab === name ? "is-active" : ""} onClick={() => setTab(name)} role="tab" aria-selected={tab === name}>{name}{name === "Medals" && <b>9/16</b>}</button>)}
          </div>
        </section>

        {tab === "Progress" && <>
          <section className="journey-path-card" aria-labelledby="path-heading"><div className="journey-path-copy"><span className="recovery-overline">YOUR PATH · 12 WEEKS</span><h2 id="path-heading">Three weeks in. Your path is taking shape.</h2></div><span className="journey-path-hint">Tap a week to look back</span><div className="journey-weeks" aria-label="Twelve-week recovery path">{Array.from({ length: 12 }, (_, index) => index + 1).map((week) => <button key={week} className={`journey-week ${week < 3 ? "is-done" : ""} ${week === activeWeek ? "is-current" : ""} ${week > 3 ? "is-future" : ""}`} onClick={() => setActiveWeek(week)} aria-label={week === 3 ? "Week 3, current week" : `Week ${week}`}>{week < 3 ? <Check size={14} /> : week}{week === 3 && <small>You are here</small>}{week === 6 && <em>Reassessment · 8 Oct</em>}{week === 12 && <em className="end-review">12 week review</em>}</button>)}</div></section>
          <div className="journey-content-grid"><div className="journey-main-column"><section className="journey-overview-card" aria-labelledby="week-overview-title"><div className="journey-card-heading"><h2 id="week-overview-title">Week {activeWeek} at a glance</h2><span>22 to 28 September · in progress</span></div><div className="journey-stat-row"><article><span>Sessions</span><b>3 of 7</b><small>So far this week</small></article><article><span>Active minutes</span><b>41</b><small>So far this week</small></article><article><span>Check ins</span><b>3 of 7</b><small>So far this week</small></article></div><div className="journey-skill-list"><Skill icon={<TrendingUp size={19} />} name="Reaching" value="100" change="+6 this week" width="83%" tone="green" /><Skill icon={<Hand size={19} />} name="Hand control" value="80" change="+4 this week" width="67%" tone="rust" /><Skill icon={<Sparkles size={18} />} name="Walking" value="68" change="+3 this week" width="55%" tone="ochre" /></div><p className="journey-baseline-note">The thin mark on each bar is your baseline from 8 September.</p></section><section className="journey-wins-card" aria-labelledby="wins-title"><div className="journey-card-heading"><div><h2 id="wins-title">Everyday wins</h2><p>Small things that matter in real life.</p></div><button className={addedWin ? "is-added" : ""} onClick={addWin}>{addedWin ? <><Check size={16} /> Added</> : <><Plus size={17} /> Add a win</>}</button></div><div className="journey-win-list"><article><span>✦</span><b>Brushed my hair using my left hand</b><time>22 Sep</time></article><article><span>✦</span><b>Opened a jar of jam on my own</b><time>19 Sep</time></article><article><span>✦</span><b>Held a full mug of tea steadily</b><time>16 Sep</time></article>{addedWin && <article className="journey-new-win"><span>✦</span><b>Took a moment for myself today</b><time>Today</time></article>}</div></section></div><aside className="journey-side-column"><section className="journey-letter-card"><div className="journey-letter-icon"><BookOpenCheck size={19} /></div><span className="recovery-overline">SUNDAY LETTER FROM ALIRA</span><p>Molly, last week you showed up six times and your reaching rose by six points. This week, let’s keep the grip slow and steady.</p><button onClick={() => setLocation("/alira")}>Reply to Alira <ArrowRight size={16} /></button></section><section className="journey-next-medal"><span className="recovery-overline">NEXT MEDAL</span><div><span className="medal-sun"><Award size={27} /></span><h2>Seven Sunrises</h2><p>Practise seven days in a row.</p></div><div className="medal-progress"><span style={{ width: "71%" }} /></div><b>5 of 7 days. Two more mornings to go.</b><button onClick={() => { setTab("Medals"); setSelectedMedal(1); }}>See all medals <ChevronRight size={16} /></button></section></aside></div>
        </>}

        {tab === "Journal" && <section className="reference-journal" aria-labelledby="journal-title">
          <div className="reference-journal-editor">
            <div><span className="reference-eyebrow">TODAY’S PROMPT</span><h2 id="journal-title">What felt a little easier this week?</h2></div>
            <fieldset className="mood-picker"><legend>How are you feeling?</legend><div>{moodOptions.map((option, index) => <button type="button" key={option.label} aria-pressed={mood === index} className={mood === index ? "is-selected" : ""} style={{ "--mood": option.color } as React.CSSProperties} onClick={() => setMood(index as MoodIndex)}><i>{option.face}</i><span>{option.label}</span></button>)}</div></fieldset>
            <label className="journal-text-label" htmlFor="journal-entry">Write it down, or say it<textarea id="journal-entry" value={entryText} onChange={(event) => setEntryText(event.target.value)} placeholder="A few words is plenty." /></label>
            <button className={`voice-note-button ${recording ? "is-recording" : ""}`} onClick={toggleRecording}><Mic size={16} /> {recording ? `Stop recording · ${formatTime(voiceSeconds)}` : voiceNote ? `Record again · ${formatTime(voiceNote)}` : "Record a voice note"}</button>
            <div className="journal-tag-area"><b>Add a tag</b><div>{journalTags.map((tag) => <button type="button" key={tag} className={selectedTags.includes(tag) ? "is-selected" : ""} onClick={() => toggleTag(tag)}>{tag}</button>)}</div></div>
            <button className={`therapist-share ${shareWithTherapist ? "is-on" : ""}`} onClick={() => setShareWithTherapist(!shareWithTherapist)}><span><b>Share with my therapist</b><small>They will see this entry before your next session.</small></span><i><em /></i></button>
            <button className="journal-save" onClick={saveEntry}>Save entry</button>
          </div>
          <div className="reference-journal-feed">
            <section className="journal-streak"><div><h3>Your last two weeks</h3><span>One dot per day</span></div><div className="streak-dots">{streakMoods.map((value, index) => <i key={index} className={value === -1 ? "is-empty" : ""} style={{ "--dot": value === -1 ? "transparent" : moodOptions[value].color } as React.CSSProperties} />)}</div><small><time>11 Sep</time><time>Today</time></small></section>
            <h2>Your entries</h2>
            <div className="journal-entry-list">{entries.map((entry, index) => <article key={`${entry.date}-${index}`} className={index === 0 && entry.date === "Today" ? "is-new" : ""}><div className="entry-meta"><time>{entry.date}</time><span className={`entry-mood mood-${entry.mood}`}>{moodOptions[entry.mood].face} {moodOptions[entry.mood].label}</span></div><p>{entry.text}</p>{entry.voice ? <div className="entry-audio"><button aria-label="Play recorded voice note">▶</button><span>{Array.from({ length: 14 }, (_, bar) => <i key={bar} style={{ height: `${7 + ((bar * 7) % 16)}px` }} />)}</span><b>{formatTime(entry.voice)}</b></div> : null}<div className="entry-tags">{entry.tags.map((tag) => <span key={tag}>{tag}</span>)}{entry.shared && <span className="shared-tag"><Check size={11} /> Shared with therapist</span>}</div></article>)}</div>
          </div>
        </section>}

        {tab === "Medals" && <section className="reference-medals" aria-labelledby="medals-title">
          <div className="medal-catalog">{medalCategories.map((category) => <section key={category.name} className={`medal-category ${category.tone}`}><h2><i />{category.name} <small>{category.earned}</small></h2><div>{category.medals.map((medal, index) => { const flatIndex = allMedals.findIndex((current) => current.name === medal.name); const isEarned = Boolean(medal.done || (medal.current && medal.total && medal.current >= medal.total)); const progress = medal.total ? Math.round(((medal.current ?? 0) / medal.total) * 100) : 100; return <button key={medal.name} className={`${selectedMedal === flatIndex ? "is-selected" : ""} ${isEarned ? "is-earned" : "is-locked"}`} onClick={() => setSelectedMedal(flatIndex)}><span className="medal-symbol">{medal.symbol}</span><b>{medal.name}</b>{isEarned ? <small>Earned {medal.date}</small> : <><i className="medal-lock">⌁</i><em><span style={{ width: `${progress}%` }} /></em><small>{medal.current} of {medal.total} {medal.unit}</small></>}</button>; })}</div></section>)}</div>
          <aside className="medal-reference-panel"><section className="collection-summary"><span>YOUR COLLECTION</span><h2>{earnedCount} <small>of 16 earned</small></h2><div><i style={{ width: "56.25%" }} /></div><p>Next up: Seven Sunrises, two days away.</p></section><section className="selected-medal-card"><span className="selected-medal-symbol">{selectedMedalDetails.symbol}</span><p>{selectedMedalDetails.category.toUpperCase()}</p><h2>{selectedMedalDetails.name}</h2><strong>{selectedMedalDetails.description}</strong>{selectedMedalDetails.total ? <><div className="selected-medal-progress"><i style={{ width: `${Math.round(((selectedMedalDetails.current ?? 0) / selectedMedalDetails.total) * 100)}%` }} /></div><b>{selectedMedalDetails.current} of {selectedMedalDetails.total} {selectedMedalDetails.unit}</b></> : <b>Earned {selectedMedalDetails.date}</b>}<button onClick={() => setTab("Progress")}>Go to today’s session</button></section></aside>
        </section>}
      </div>
    </RecoveryShell>
  );
}

function Skill({ icon, name, value, change, width, tone }: { icon: React.ReactNode; name: string; value: string; change: string; width: string; tone: string }) {
  return <div className={`journey-skill ${tone}`}><span className="journey-skill-icon">{icon}</span><b>{name}</b><div className="journey-bar"><span style={{ width }} /><i style={{ left: width }} /></div><strong>{value}</strong><em>{change}</em></div>;
}

function formatTime(value: number) { return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`; }
