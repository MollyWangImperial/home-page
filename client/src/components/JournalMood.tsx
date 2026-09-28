import { useState, type CSSProperties } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type MoodIndex = -1 | 0 | 1 | 2 | 3 | 4;
export const moodOptions = [
  { label: "Tough", color: "#a64c36" },
  { label: "Low", color: "#b16c48" },
  { label: "Okay", color: "#8a7424" },
  { label: "Good", color: "#3e7457" },
  { label: "Great", color: "#2f5e48" },
] as const;

/** Shared expressions keep the picker and saved mood badges consistent. */
export function MoodFace({ mood }: { mood: Exclude<MoodIndex, -1> }) {
  return (
    <svg className={`journal-mood-face expression-${mood}`} viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="20" cy="20" r="16.5" fill="currentColor" fillOpacity=".07" />
      <g className="mood-expression">
        {mood === 0 && <><path d="m11 13 5-2m8 0 5 2" /><circle cx="14" cy="18" r="1.3" fill="currentColor" stroke="none" /><circle cx="26" cy="18" r="1.3" fill="currentColor" stroke="none" /><path d="M12 28q8-9 16 0" /></>}
        {mood === 1 && <><path d="M11 17q3 2 6 0m6 0q3 2 6 0M14 27q6-5 12 0" /></>}
        {mood === 2 && <><circle cx="14" cy="17" r="1.5" fill="currentColor" stroke="none" /><circle cx="26" cy="17" r="1.5" fill="currentColor" stroke="none" /><path d="M14 26h12" /></>}
        {mood === 3 && <><circle cx="14" cy="16.5" r="1.5" fill="currentColor" stroke="none" /><circle cx="26" cy="16.5" r="1.5" fill="currentColor" stroke="none" /><path d="M12 23q8 10 16 0" /></>}
        {mood === 4 && <><path d="M10.5 17q3.5-5 7 0m5 0q3.5-5 7 0" /><path d="M11.5 22.5h17q-1 9-8.5 9t-8.5-9Z" fill="currentColor" fillOpacity=".18" /><path d="M13 25h14" /></>}
      </g>
    </svg>
  );
}

export function MoodHistory({ moods }: { moods: MoodIndex[] }) {
  const [openDay, setOpenDay] = useState<number | null>(null);

  return (
    <section className="journal-streak" aria-labelledby="journal-progress-title">
      <div><h3 id="journal-progress-title">Your progress over last two weeks</h3></div>
      <div className="streak-dots" aria-label="Daily mood scores, from 1 for Tough to 5 for Great">
        {moods.map((value, index) => {
          // This reference journey ends on 24 September, matching the shell's date.
          const date = index === moods.length - 1 ? "Today, 24 September" : `${index + 11} September`;
          const option = value === -1 ? null : moodOptions[value];
          const description = option ? `Mood score ${value + 1} of 5, ${option.label}` : "No check-in";
          return (
            <Tooltip key={index} open={openDay === index} onOpenChange={(open) => setOpenDay((current) => open ? index : current === index ? null : current)}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={`journal-score-dot ${option ? "" : "is-empty"}`}
                  style={{ "--dot": option?.color ?? "#8a938a" } as CSSProperties}
                  aria-label={`${date}: ${description}`}
                  onClick={(event) => { event.preventDefault(); setOpenDay(index); }}
                ><span /></button>
              </TooltipTrigger>
              <TooltipContent className="journal-score-tooltip" side="top" sideOffset={7} collisionPadding={16}>
                <span className="journal-score-date">{date}</span>
                <strong>{option ? <>Mood score <b>{value + 1}<small>/5</small></b> · {option.label}</> : "No check-in"}</strong>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <small><time dateTime="2026-09-11">11 Sep</time><time dateTime="2026-09-24">Today</time></small>
    </section>
  );
}
