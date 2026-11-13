/**
 * Reach icon set — inline SVG, 24px grid, round 1.75 stroke, drawn with currentColor.
 * Use <Icon name="play" /> (or size={20}). Never use emoji as icons.
 * Add new icons here so the whole app keeps one stroke weight and corner style.
 */
import type { CSSProperties, ReactNode } from 'react'

const P: Record<string, ReactNode> = {
  /* navigation / screens */
  show: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></>,
  media: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="M21 15l-5-5-8 9" /></>,
  bible: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z" /><path d="M5 17a3 3 0 0 1 3-3h11M12 7v5M9.5 9h5" /></>,
  displays: <><rect x="2" y="5" width="13" height="9" rx="1.5" /><path d="M18 9h2.5A1.5 1.5 0 0 1 22 10.500V17.500A1.5 1.5 0 0 1 20.5 19H11.500A1.5 1.5 0 0 1 10 17.500V17" /><path d="M6 18h3" /></>,
  integrations: <><path d="M9 3v5M15 3v5M7 8h10v4a5 5 0 0 1-10 0V8zM12 17v4" /></>,
  settings: <><path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="17" r="2" /></>,
  /* transport */
  play: <path d="M7 5l12 7-12 7V5z" />,
  pause: <><path d="M8 5v14M16 5v14" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  next: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  prev: <><path d="M19 12H5M11 6l-6 6 6 6" /></>,
  skipNext: <><path d="M6 5l9 7-9 7V5zM18 5v14" /></>,
  /* actions */
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.500l4.5 4.500L19 7.5" />,
  search: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  rename: <><path d="M4 18h16M7 14l2-6 2 6M7.7 12.500h2.600M15 8v6M13.5 8h3M13.5 14h3" /></>,
  more: <><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></>,
  drag: <><circle cx="9" cy="7" r="1.1" fill="currentColor" /><circle cx="15" cy="7" r="1.1" fill="currentColor" /><circle cx="9" cy="12" r="1.1" fill="currentColor" /><circle cx="15" cy="12" r="1.1" fill="currentColor" /><circle cx="9" cy="17" r="1.1" fill="currentColor" /><circle cx="15" cy="17" r="1.1" fill="currentColor" /></>,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronUp: <path d="M6 15l6-6 6 6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
  external: <><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  download: <><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></>,
  upload: <><path d="M12 16V5M7 9l5-5 5 5M5 20h14" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.600M20 4v5h-5" /></>,
  undo: <><path d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 0 12" transform="translate(0 -3)" /></>,
  /* state */
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  unlock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
  eyeOff: <><path d="M4 4l16 16M10 6a9 9 0 0 1 2-.500c6 0 9.5 6.5 9.5 6.500a15 15 0 0 1-2.7 3.400M6.3 7.700A15 15 0 0 0 2.5 12S6 18.5 12 18.500a9 9 0 0 0 3.5-.7" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.500v.5" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.500a2.5 2.5 0 1 1 3.5 2.300c-.7.4-1 .9-1 1.700M12 17v.5" /></>,
  warning: <><path d="M12 4l9.5 16h-19L12 4z" /><path d="M12 10v4.500M12 17v.5" /></>,
  error: <><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></>,
  success: <><circle cx="12" cy="12" r="9" /><path d="M8 12.500l3 3 5-6" /></>,
  wifi: <><path d="M3 9.500a13 13 0 0 1 18 0M6 13a8.5 8.5 0 0 1 12 0M9 16.500a4 4 0 0 1 6 0" /><circle cx="12" cy="19.5" r=".8" fill="currentColor" /></>,
  cloud: <path d="M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 10.500a3.8 3.8 0 0 1-.5 7.500H7z" />,
  /* content */
  music: <><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></>,
  slides: <><rect x="3" y="5" width="14" height="10" rx="1.5" /><path d="M7 19h13a1 1 0 0 0 1-1V9" /></>,
  text: <path d="M5 6h14M12 6v13M9 19h6" />,
  image: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="M21 15l-5-5-8 9" /></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10.500l5-3v9l-5-3" /></>,
  audio: <><path d="M4 10v4h3l5 4V6L7 10H4zM16 9a4 4 0 0 1 0 6M18.5 6.500a8 8 0 0 1 0 11" /></>,
  header: <path d="M4 7h16M4 12h10M4 17h6" />,
  placeholder: <rect x="4" y="6" width="16" height="12" rx="2" strokeDasharray="3 3" />,
  note: <><path d="M5 4h14v11l-5 5H5V4z" /><path d="M14 20v-5h5M8.5 9h7M8.5 12.500h4" /></>,
  people: <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6a3 3 0 0 1 0 5.500M17.5 14a5 5 0 0 1 3 5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M8.5 3v4M15.5 3v4" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2.500h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />,
  layers: <><path d="M12 4l9 4.5-9 4.5-9-4.500L12 4z" /><path d="M3 13l9 4.5 9-4.5" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  list: <path d="M8 7h12M8 12h12M8 17h12M4 7h.500M4 12h.500M4 17h.5" />,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6.5 10h.500M10 10h.500M13.5 10h.500M17 10h.500M7 14h10" /></>,
  phone: <><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 18h2" /></>,
  qr: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2.500v2.500M20 14v.500M14 20h.500M17.5 20H20v-3" /></>,
  clearSlide: <><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M9.5 8.500l5 5M14.5 8.500l-5 5M8 21h8" /></>,
  blackout: <><rect x="3" y="5" width="18" height="12" rx="2" fill="currentColor" /><path d="M8 21h8" /></>,
  logo: <><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M10 8.500h1.500v2.500H10zM12.5 8.500h.500a1.2 1.2 0 0 1 0 2.500h-.500zM10 12h1.500v2.500H10zM12.5 12h.300a1.4 1.4 0 0 1 1.4 1.400v1.100h-.300a1.4 1.4 0 0 1-1.4-1.400z" fill="currentColor" stroke="none" /><path d="M8 21h8" /></>,
  send: <path d="M4 12l16-7-6 16-3-6.500L4 12z" />,
  star: <path d="M12 4l2.5 5.2 5.7.800-4.1 4 1 5.700L12 17l-5.1 2.7 1-5.7-4.1-4 5.7-.800L12 4z" />,
  sparkle: <path d="M12 4l1.8 5.200L19 11l-5.2 1.800L12 18l-1.8-5.200L5 11l5.2-1.800L12 4zM19 4v3M17.5 5.500h3" />
}

export type IconName = keyof typeof P
export const iconNames = Object.keys(P) as IconName[]

export function Icon({ name, size = 16, className = '', style, title }: { name: IconName | (string & {}); size?: number; className?: string; style?: CSSProperties; title?: string }): ReactNode {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {P[name] ?? <rect x="5" y="5" width="14" height="14" rx="3" strokeDasharray="3 3" />}
    </svg>
  )
}
