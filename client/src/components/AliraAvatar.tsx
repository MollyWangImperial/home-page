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
      <path
        className="alira-pulse-line"
        d="M24 40h9l6-10 9 20 6-10h5"
        fill="none"
        stroke="#f5faf3"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="alira-pulse-trace"
        d="M24 40h9l6-10 9 20 6-10h5"
        pathLength="100"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
