import { HEART_RATE_PATH, HeartRateGlyph } from "./HeartRateMark";

export default function AliraAvatar() {
  return (
    <svg
      className="alira-avatar-image"
      viewBox="0 0 80 80"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="40" cy="40" r="39" fill="#dfe7df" />
      <circle cx="40" cy="40" r="34" fill="#285b49" />
      <g transform="translate(16.8 18) scale(1.9)" color="#f5faf3">
        <HeartRateGlyph className="alira-pulse-line" />
        <path
          className="alira-pulse-trace"
          d={HEART_RATE_PATH}
          pathLength="100"
          fill="none"
          stroke="#fff"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
