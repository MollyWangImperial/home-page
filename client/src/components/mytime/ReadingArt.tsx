import type { StoryTint, StoryVoice } from "@/content/my-time-stories";

/** A small picture for each article in Learn, drawn so no image files are needed. */
export function ArticleGlyph({ id }: { id: string }) {
  return <svg className={`learn-glyph learn-glyph-${id}`} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    {id === "rewiring" && <>
      <circle cx="32" cy="32" r="30" fill="#dfede5" />
      <path d="M14 40C22 40 22 24 32 24S42 40 50 40" stroke="#b9cdbd" strokeWidth="3" strokeLinecap="round" />
      <path className="learn-glyph-path" d="M14 40C20 52 44 52 50 40" stroke="#2f6851" strokeWidth="3" strokeLinecap="round" strokeDasharray="4 6" />
      <circle cx="14" cy="40" r="5" fill="#2f6851" /><circle cx="50" cy="40" r="5" fill="#2f6851" /><circle cx="32" cy="24" r="4" fill="#b9cdbd" />
    </>}
    {id === "fatigue" && <>
      <circle cx="32" cy="32" r="30" fill="#f8e3d6" />
      <rect x="13" y="22" width="34" height="20" rx="5" stroke="#9b5b42" strokeWidth="3" /><path d="M51 28v8" stroke="#9b5b42" strokeWidth="4" strokeLinecap="round" />
      <rect className="learn-glyph-charge" x="18" y="27" width="8" height="10" rx="2" fill="#e58a5c" />
    </>}
    {id === "emotions" && <>
      <circle cx="32" cy="32" r="30" fill="#dfe8f3" />
      <path className="learn-glyph-drop" d="M32 14c8 10 12 16 12 22a12 12 0 0 1-24 0c0-6 4-12 12-22Z" fill="#a9c3df" stroke="#56789e" strokeWidth="3" strokeLinejoin="round" />
      <path d="M26 36a6 6 0 0 0 6 6" stroke="#fffefa" strokeWidth="2.5" strokeLinecap="round" />
    </>}
    {id === "hand" && <>
      <circle cx="32" cy="32" r="30" fill="#efe6f5" />
      <path d="M22 46V28a3 3 0 0 1 6 0v-7a3 3 0 0 1 6 0v-2a3 3 0 0 1 6 0v9a3 3 0 0 1 6 0v12c0 7-5 11-12 11s-10-3-12-5Z" fill="#d7c7e6" stroke="#6e5a8f" strokeWidth="3" strokeLinejoin="round" />
      <path className="learn-glyph-spark" d="M12 20l3 3M10 30h4M16 12l2 4" stroke="#6e5a8f" strokeWidth="2.5" strokeLinecap="round" />
    </>}
    {id === "words" && <>
      <circle cx="32" cy="32" r="30" fill="#f7efd5" />
      <path d="M14 20a6 6 0 0 1 6-6h24a6 6 0 0 1 6 6v14a6 6 0 0 1-6 6H30l-10 9v-9a6 6 0 0 1-6-6Z" fill="#fffefa" stroke="#8a6a1f" strokeWidth="3" strokeLinejoin="round" />
      <g className="learn-glyph-dots" fill="#c99a2e"><circle cx="24" cy="27" r="2.6" /><circle cx="32" cy="27" r="2.6" /><circle cx="40" cy="27" r="2.6" /></g>
    </>}
    {id === "again" && <>
      <circle cx="32" cy="32" r="30" fill="#dfede5" />
      <path d="M32 12 48 18v12c0 11-7 18-16 22-9-4-16-11-16-22V18Z" fill="#fffefa" stroke="#2f6851" strokeWidth="3" strokeLinejoin="round" />
      <path className="learn-glyph-tick" d="m24 32 6 6 11-12" stroke="#2f6851" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </>}
  </svg>;
}

const voiceColours: Record<StoryVoice, StoryTint> = { survivor: { background: "#f0c5ad", ink: "#5c3324" }, carer: { background: "#cfe3d2", ink: "#234c3c" } };

type StoryInitialProps = {
  name: string;
  voice: StoryVoice;
  /** The person's own colours (a story's `tint`). Without them, the colours of their side are used. */
  tint?: StoryTint;
  /** Extra classes, for a larger or smaller circle. */
  className?: string;
};

/** A plain initial in a circle: these are not real people, so they are given no faces. */
export function StoryInitial({ name, voice, tint, className }: StoryInitialProps) {
  const { background, ink } = tint ?? voiceColours[voice];
  return <span className={className ? `story-initial ${className}` : "story-initial"} style={{ background, color: ink }} aria-hidden="true">{name.charAt(0)}</span>;
}
