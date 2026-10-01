// Traced from the supplied brand reference: a low rise, deep dip, taller rise and round endpoint.
export const HEART_RATE_PATH = "M3.5 13.75H8L10.65 9.5L13.55 16.25L16.65 6.95L19.2 13.35L20.65 12.9";

export function HeartRateGlyph({ className }: { className?: string }) {
  return (
    <g className={className}>
      <path d={HEART_RATE_PATH} pathLength="32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="20.65" cy="12.9" r="1.3" fill="currentColor" stroke="none" />
    </g>
  );
}

/** The same mark inherits each existing logo container's colors. */
export default function HeartRateMark({ size = 24, pulseClassName }: { size?: number; pulseClassName?: string }) {
  return (
    <svg className="rehyn-heart-rate-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <HeartRateGlyph className={pulseClassName} />
    </svg>
  );
}
