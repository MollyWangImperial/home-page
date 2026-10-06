import type { ReactNode } from "react";
import type { ThemeId } from "@/content/community-samples";

// The line drawings from the My community designs. Every one is decoration: the button or text
// beside it carries the meaning.

type IconProps = { size?: number; className?: string; fill?: string; stroke?: string; strokeWidth?: number };

function Icon({ size = 20, className, fill = "none", stroke = "currentColor", strokeWidth = 1.8, children }: IconProps & { children: ReactNode }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const HeartIcon = (props: IconProps) => <Icon {...props}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></Icon>;
export const StarIcon = (props: IconProps) => <Icon {...props}><path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8z" /></Icon>;
export const HandIcon = (props: IconProps) => <Icon {...props}><path d="M7 11V6a1.5 1.5 0 0 1 3 0v4m0-5.5a1.5 1.5 0 0 1 3 0V10m0-4a1.5 1.5 0 0 1 3 0v5m0-2.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L3.6 14a1.5 1.5 0 0 1 2.5-1.6L7 13.5" /></Icon>;
export const ChatIcon = (props: IconProps) => <Icon {...props}><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z" /></Icon>;
export const PhotoIcon = (props: IconProps) => <Icon {...props}><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="8.5" cy="10" r="1.6" /><path d="m21 15-4.5-4.5L8 19" /></Icon>;
export const MicIcon = (props: IconProps) => <Icon {...props}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></Icon>;
export const SmileIcon = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5c2 2.2 5 2.2 7 0" /><path d="M9 9.5v.5M15 9.5v.5" /></Icon>;
export const SearchIcon = (props: IconProps) => <Icon {...props}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Icon>;
export const PlusIcon = (props: IconProps) => <Icon strokeWidth={2.2} {...props}><path d="M12 5v14" /><path d="M5 12h14" /></Icon>;
export const ArrowIcon = (props: IconProps) => <Icon {...props}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></Icon>;
export const BackIcon = (props: IconProps) => <Icon strokeWidth={2} {...props}><path d="m15 6-6 6 6 6" /></Icon>;
export const NextIcon = (props: IconProps) => <Icon strokeWidth={2} {...props}><path d="m9 6 6 6-6 6" /></Icon>;
export const CupIcon = (props: IconProps) => <Icon {...props}><path d="M5 10h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z" /><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16" /><path d="M8 3.5c0 1.5 1.5 1.5 1.5 3M12 3.5c0 1.5 1.5 1.5 1.5 3" /></Icon>;
export const PulseIcon = (props: IconProps) => <Icon {...props}><path d="M3 12h4l2.5-6 4 12 2.5-6h5" /></Icon>;
export const UsersIcon = (props: IconProps) => <Icon {...props}><path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19" /><circle cx="10" cy="8" r="3.5" /><path d="M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4" /><path d="M15.5 4.7a3.5 3.5 0 0 1 0 6.6" /></Icon>;
export const ShieldIcon = (props: IconProps) => <Icon {...props}><path d="M12 3 5 6v5.5c0 4.3 2.9 7.6 7 9.5 4.1-1.9 7-5.2 7-9.5V6z" /><path d="m9 12 2.2 2.2L15 10.5" /></Icon>;
export const CheckIcon = (props: IconProps) => <Icon strokeWidth={3.2} {...props}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>;
export const LockIcon = (props: IconProps) => <Icon {...props}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Icon>;
export const CloseIcon = (props: IconProps) => <Icon strokeWidth={2} {...props}><path d="M6 6l12 12M18 6 6 18" /></Icon>;
export const PlayIcon = (props: IconProps) => <Icon fill="currentColor" strokeWidth={1.4} {...props}><path d="M8 5.6v12.8l10.5-6.4z" /></Icon>;
export const StopIcon = (props: IconProps) => <Icon fill="currentColor" strokeWidth={1.4} {...props}><rect x="7" y="7" width="10" height="10" rx="1.6" /></Icon>;
export const PauseIcon = (props: IconProps) => <Icon fill="currentColor" strokeWidth={1.2} {...props}><rect x="7" y="5.5" width="3.4" height="13" rx="1" /><rect x="13.6" y="5.5" width="3.4" height="13" rx="1" /></Icon>;
export const RingIcon = (props: IconProps) => (
  <Icon fill="currentColor" stroke="none" {...props}>
    <circle cx="12" cy="4" r="2" /><circle cx="18.9" cy="8" r="2" /><circle cx="18.9" cy="16" r="2" />
    <circle cx="12" cy="20" r="2" /><circle cx="5.1" cy="16" r="2" /><circle cx="5.1" cy="8" r="2" />
  </Icon>
);

const themePaths: Record<ThemeId, ReactNode> = {
  gardening: <><path d="M5 19c0-8 5-13 14-14 0 9-5 14-14 14z" /><path d="M5 19 13 11" /></>,
  walking: <><path d="m3 19 6-9 4 6 3-4 5 7z" /><circle cx="17" cy="6" r="2" /></>,
  cooking: <><path d="M5 11h14v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" /><path d="M3 11h18" /><path d="M9.5 7c0-1.5 1.5-1.5 1.5-3M13.5 7c0-1.5 1.5-1.5 1.5-3" /></>,
  music: <><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>,
  books: <><path d="M12 6.5c-1.6-1.4-3.8-2-7-2v13c3.2 0 5.4.6 7 2 1.6-1.4 3.8-2 7-2v-13c-3.2 0-5.4.6-7 2z" /><path d="M12 6.5v13" /></>,
  family: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  crafts: <><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" /><path d="m13.5 6.5 3 3" /></>,
  chatting: <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z" />,
};
export const ThemeIcon = ({ theme, ...props }: IconProps & { theme: ThemeId }) => <Icon {...props}>{themePaths[theme]}</Icon>;
