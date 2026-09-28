import type { ReactNode } from "react";

export type MedalIcon = "first-step" | "sunrise" | "weekend" | "month" | "baseline" | "ten-up" | "steady-hand" | "reassessment" | "voice" | "alira" | "honest-day" | "shared" | "first-win" | "self-care" | "five-wins" | "kitchen";

const star = "m0-7 2.2 4.5 5 .7-3.6 3.5.9 5L0 4.4l-4.5 2.3.9-5-3.6-3.5 5-.7Z";
const illustrations: Record<MedalIcon, ReactNode> = {
  "first-step": <>
    <path className="medal-art-accent" d="M18 30c-6-1-9 5-8 11 1 5 4 10 8 9 4-1 5-5 3-9-2-4 2-10-3-11Z" />
    <ellipse className="medal-art-warm" cx="17" cy="22" rx="4" ry="5" transform="rotate(-16 17 22)" />
    <circle cx="9" cy="27" r="2" className="medal-art-warm" />
    <path className="medal-art-accent" d="M41 22c6-1 9 5 8 11-1 5-4 10-8 9-4-1-5-5-3-9 2-4-2-10 3-11Z" />
    <ellipse className="medal-art-warm" cx="42" cy="14" rx="4" ry="5" transform="rotate(16 42 14)" />
    <circle cx="50" cy="19" r="2" className="medal-art-warm" />
  </>,
  sunrise: <>
    <g className="medal-art-rays"><path d="M32 7v6M12 16l4 4M52 16l-4 4M6 31h6m40 0h6M20 9l2 5m22-5-2 5" /></g>
    <path className="medal-art-warm" d="M17 35a15 15 0 0 1 30 0Z" />
    <path d="M8 36h48M14 43h36M23 50h18" />
    <path className="medal-art-paper" d="m28 29 4-4 4 4m-4-4v9" />
  </>,
  weekend: <>
    <rect className="medal-art-paper" x="9" y="14" width="46" height="39" rx="7" />
    <path className="medal-art-accent" d="M16 14h32a7 7 0 0 1 7 7v4H9v-4a7 7 0 0 1 7-7Z" />
    <path d="M21 9v10M43 9v10" />
    <rect className="medal-art-warm" x="15" y="31" width="14" height="14" rx="4" />
    <rect className="medal-art-warm" x="35" y="31" width="14" height="14" rx="4" />
    <path d="m18 38 3 3 5-6m12 3 3 3 5-6" />
  </>,
  month: <>
    <rect className="medal-art-paper" x="8" y="12" width="43" height="40" rx="6" />
    <path className="medal-art-accent" d="M14 12h31a6 6 0 0 1 6 6v6H8v-6a6 6 0 0 1 6-6Z" />
    <path d="M19 8v9M40 8v9M17 32h2m7 0h2m7 0h2M17 40h2m7 0h2" />
    <circle className="medal-art-warm" cx="46" cy="45" r="10" />
    <path d="M46 31v3m0 22v3M32 45h3m22 0h3m-4-10-2 2m-18 18 2-2m18 2-2-2" />
  </>,
  baseline: <>
    <rect className="medal-art-paper" x="14" y="12" width="36" height="44" rx="5" />
    <rect className="medal-art-accent" x="23" y="7" width="18" height="10" rx="4" />
    <circle className="medal-art-accent" cx="26" cy="31" r="8" />
    <path d="m22 31 3 3 5-6M39 28h5m-5 6h5M22 45h20M22 50h12" />
  </>,
  "ten-up": <>
    <rect className="medal-art-accent" x="9" y="39" width="10" height="15" rx="2" />
    <rect className="medal-art-accent" x="26" y="30" width="10" height="24" rx="2" />
    <rect className="medal-art-warm" x="43" y="21" width="10" height="33" rx="2" />
    <path d="m11 29 18-16 9 4L52 7m-9 0h9v9" />
  </>,
  "steady-hand": <>
    <path className="medal-art-accent" d="M21 50c-4-5-7-9-10-16-2-5 3-8 6-3l4 5V17c0-5 7-5 7 0v14-19c0-5 7-5 7 0v19-16c0-5 7-5 7 0v17-11c0-5 7-5 7 0v18c0 9-5 17-14 17h-5c-4 0-7-2-9-6Z" />
    <path d="M29 40h12m-6-6v12" />
    <path className="medal-art-warm" d="m53 6 1.5 4.5L59 12l-4.5 1.5L53 18l-1.5-4.5L47 12l4.5-1.5Z" />
  </>,
  reassessment: <>
    <rect className="medal-art-paper" x="11" y="12" width="34" height="42" rx="5" />
    <rect className="medal-art-accent" x="19" y="7" width="18" height="10" rx="4" />
    <path d="m18 27 3 3 5-6M32 27h6m-20 10 3 3 5-6" />
    <circle className="medal-art-warm" cx="45" cy="44" r="13" />
    <path d="M45 36v8l5 3" />
  </>,
  voice: <>
    <rect className="medal-art-warm" x="24" y="9" width="16" height="31" rx="8" />
    <path d="M18 29v4a14 14 0 0 0 28 0v-4M32 47v8m-8 0h16M29 17h6m-6 6h6" />
    <path d="M12 21q-5 8 0 16m40-16q5 8 0 16" />
  </>,
  alira: <>
    <path className="medal-art-accent" d="M14 12h36a7 7 0 0 1 7 7v22a7 7 0 0 1-7 7H29L16 57v-9h-2a7 7 0 0 1-7-7V19a7 7 0 0 1 7-7Z" />
    <path className="medal-art-warm" d="m31 19 3.5 9.5L44 32l-9.5 3.5L31 45l-3.5-9.5L18 32l9.5-3.5Z" />
    <path d="M46 19v7m-3.5-3.5h7" />
  </>,
  "honest-day": <>
    <path className="medal-art-paper" d="M9 14q12-5 23 0 11-5 23 0v39q-12-5-23 0-11-5-23 0Z" />
    <path d="M32 40v13M16 43h9m14 0h9" />
    <path className="medal-art-warm" d="M32 36S19 29 19 23c0-7 9-8 13-2 4-6 13-5 13 2 0 6-13 13-13 13Z" />
  </>,
  shared: <>
    <path d="m21 31 22-13M21 33l22 13" />
    <circle className="medal-art-accent" cx="16" cy="32" r="10" />
    <circle className="medal-art-warm" cx="47" cy="14" r="9" />
    <circle className="medal-art-warm" cx="47" cy="50" r="9" />
    <path d="m12 32 3 3 5-6m29-17-2-2-2 2m-2 38h8" />
  </>,
  "first-win": <>
    <path className="medal-art-accent" d="M17 15H9v8c0 9 7 12 13 12m25-20h8v8c0 9-7 12-13 12" />
    <path className="medal-art-warm" d="M17 10h30v14c0 11-6 18-15 18s-15-7-15-18Z" />
    <path d="M32 42v10m-10 3h20" />
    <path className="medal-art-paper" d={star} transform="translate(32 25)" />
  </>,
  "self-care": <>
    <ellipse className="medal-art-accent" cx="23" cy="23" rx="13" ry="16" />
    <ellipse className="medal-art-paper" cx="23" cy="23" rx="8" ry="11" />
    <path className="medal-art-accent" d="M19 39h8v14a4 4 0 0 1-8 0Z" />
    <path className="medal-art-warm" d="M42 10h6v23h-6Z" />
    <path d="M48 13h8m-8 5h8m-8 5h8m-8 5h8" />
    <path className="medal-art-warm" d="M42 33h6v20a3 3 0 0 1-6 0Z" />
    <path d="m20 18 6 10" />
  </>,
  "five-wins": <>
    <path className="medal-art-warm" d={star} transform="translate(32 14)" />
    <path className="medal-art-accent" d={star} transform="translate(13 29)" />
    <path className="medal-art-accent" d={star} transform="translate(51 29)" />
    <path className="medal-art-warm" d={star} transform="translate(20 50)" />
    <path className="medal-art-warm" d={star} transform="translate(44 50)" />
    <path d="m27 33 4 4 7-8" />
  </>,
  kitchen: <>
    <path className="medal-art-accent" d="M9 31h43c0 14-8 23-21.5 23S9 45 9 31Z" />
    <path d="M9 36h43M24 57h15" />
    <path className="medal-art-warm" d="M43 30 50 17c-4-3-2-11 2-13 5-2 9 4 6 8-1 2-2 4-4 5l-7 13Z" />
    <path d="M21 23c-5-5 5-6 0-11m11 11c-5-5 5-6 0-11" />
  </>,
};

export default function MedalArtwork({ icon }: { icon: MedalIcon }) {
  return <svg className={`medal-artwork medal-artwork-${icon}`} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{illustrations[icon]}</svg>;
}
