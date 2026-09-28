import { useId } from "react";

/** Inline artwork stays available without a remote image or storage service. */
export default function RecoverySeedling() {
  const id = useId();
  return (
    <svg className="recovery-seedling" viewBox="0 0 240 280" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-leaf`} x1="0" y1="1" x2="1" y2="0">
          <stop stopColor="#245b46" />
          <stop offset="1" stopColor="#81b58d" />
        </linearGradient>
        <linearGradient id={`${id}-pot`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#e7c5a6" />
          <stop offset="1" stopColor="#b77c5d" />
        </linearGradient>
        <radialGradient id={`${id}-light`}>
          <stop stopColor="#f7edbd" stopOpacity=".9" />
          <stop offset="1" stopColor="#f7edbd" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className="seedling-light" cx="152" cy="88" r="83" fill={`url(#${id}-light)`} />
      <circle cx="122" cy="128" r="91" fill="none" stroke="#8baf982c" />
      <circle cx="122" cy="128" r="75" fill="none" stroke="#8baf9820" />
      <ellipse cx="123" cy="241" rx="65" ry="10" fill="#426c4715" />
      <ellipse cx="122" cy="196" rx="48" ry="12" fill="#eacbae" />
      <ellipse cx="122" cy="195" rx="39" ry="7" fill="#695441" />
      <g className="seedling-growth">
        <path d="M122 197C113 166 132 133 124 99" fill="none" stroke="#4a7852" strokeWidth="4" strokeLinecap="round" />
        <path d="M123 151C82 153 67 125 70 100C106 102 126 121 123 151Z" fill={`url(#${id}-leaf)`} />
        <path d="M126 123C124 84 150 64 177 64C178 96 160 121 126 123Z" fill={`url(#${id}-leaf)`} />
        <path d="M122 148Q100 128 80 110M129 117Q148 91 168 74" fill="none" stroke="#d5e5b7" strokeOpacity=".6" strokeWidth="1.3" strokeLinecap="round" />
      </g>
      <path d="M75 196Q122 213 169 196L159 231Q122 250 85 231Z" fill={`url(#${id}-pot)`} />
      <path d="M88 207L94 229" stroke="#f6dfc4" strokeWidth="3" strokeLinecap="round" opacity=".55" />
      <g className="seedling-motes" fill="#93ac78">
        <circle cx="56" cy="159" r="2.5" />
        <circle cx="184" cy="135" r="2" />
        <circle cx="91" cy="66" r="2" />
      </g>
    </svg>
  );
}
