/**
 * Stage layouts (doc 'stageLayouts' = StageLayout[]): ordinary slides made of dynamic text boxes.
 * A text element with `dynamic: true` has {tokens} replaced live (see liveTokens in render/LiveCanvas.tsx).
 */
import type { SlideElement, StageLayout, TextElement, TextStyle } from './model'

export const STAGE_LAYOUTS_DOC = 'stageLayouts'

/** Tokens offered by the editor's "Insert live text" menu. `{timer:Name}` is added per timer. */
export const STAGE_TOKENS: { token: string; label: string; sample: string }[] = [
  { token: 'current.text', label: 'Current slide text', sample: 'Amazing grace how sweet the sound\nThat saved a wretch like me' },
  { token: 'next.text', label: 'Next slide text', sample: 'I once was lost but now am found\nWas blind but now I see' },
  { token: 'current.notes', label: 'Slide notes', sample: 'Speaker notes for this slide appear here.' },
  { token: 'current.label', label: 'Slide label / group', sample: 'Verse 1' },
  { token: 'next.label', label: 'Next slide label', sample: 'Chorus' },
  { token: 'current.title', label: 'Presentation title', sample: 'Amazing Grace' },
  { token: 'clock', label: 'Clock', sample: '10:42 AM' },
  { token: 'clock.seconds', label: 'Clock with seconds', sample: '10:42:07 AM' },
  { token: 'date', label: 'Date', sample: 'Sunday, November 15' },
  { token: 'timer', label: 'Main timer', sample: '4:59' },
  { token: 'stageMessage', label: 'Stage message', sample: 'Wrap it up — 2 minutes' },
  { token: 'message', label: 'Audience message', sample: 'Parent of child #42 please come to the lobby' }
]
export const sampleTokens = (): Record<string, string> => Object.fromEntries(STAGE_TOKENS.map((t) => [t.token, t.sample]))

const SANS = 'Reach Sans'
function dyn(id: string, name: string, token: string, frame: [number, number, number, number], style: TextStyle, extra: Partial<TextElement> = {}): TextElement {
  return {
    id, type: 'text', dynamic: true, name, frame: { x: frame[0], y: frame[1], w: frame[2], h: frame[3] },
    paragraphs: [{ runs: [{ text: token }] }], style: { fontFamily: SANS, color: '#FFFFFF', ...style }, align: 'left', verticalAlign: 'middle', autoFit: true, ...extra
  }
}
const rule = (id: string, y: number): SlideElement => ({ id, type: 'shape', shape: 'rect', name: 'Divider', frame: { x: 60, y, w: 1800, h: 3 }, fill: { type: 'color', color: '#3a3a3a' } })
const black = { type: 'color' as const, color: '#000000' }

export const BUILTIN_STAGE_LAYOUTS: StageLayout[] = [
  {
    id: 'reach-stage-lyrics', name: 'Lyrics confidence', size: { width: 1920, height: 1080 },
    slide: {
      id: 'reach-stage-lyrics-slide', background: black,
      elements: [
        dyn('clock', 'Clock', '{clock}', [60, 30, 420, 90], { fontSize: 64, fontWeight: 700 }),
        dyn('title', 'Song', '{current.title}  ·  {current.label}', [500, 30, 920, 90], { fontSize: 34, color: '#9a9a9a' }, { align: 'center' }),
        dyn('timer', 'Timer', '{timer}', [1440, 30, 420, 90], { fontSize: 64, fontWeight: 700, color: '#E6A20F' }, { align: 'right' }),
        dyn('current', 'Current', '{current.text}', [60, 150, 1800, 500], { fontSize: 104, fontWeight: 700, lineHeight: 1.15 }),
        rule('rule', 672),
        dyn('nextlabel', 'Next label', 'NEXT  {next.label}', [60, 690, 1800, 40], { fontSize: 24, color: '#E6A20F', letterSpacing: 4 }),
        dyn('next', 'Next', '{next.text}', [60, 736, 1800, 220], { fontSize: 60, color: '#9a9a9a', lineHeight: 1.15 }, { verticalAlign: 'top' }),
        dyn('msg', 'Stage message', '{stageMessage}', [60, 970, 1800, 90], { fontSize: 56, fontWeight: 700, color: '#E6A20F' }, { align: 'center' })
      ]
    }
  },
  {
    id: 'reach-stage-speaker', name: 'Speaker notes + timer', size: { width: 1920, height: 1080 },
    slide: {
      id: 'reach-stage-speaker-slide', background: black,
      elements: [
        dyn('notes', 'Notes', '{current.notes}', [60, 50, 1180, 760], { fontSize: 64, lineHeight: 1.25 }, { verticalAlign: 'top' }),
        dyn('timerlabel', 'Timer label', 'TIME LEFT', [1300, 50, 560, 40], { fontSize: 24, color: '#E6A20F', letterSpacing: 4 }, { align: 'right' }),
        dyn('timer', 'Timer', '{timer}', [1300, 96, 560, 240], { fontSize: 200, fontWeight: 700 }, { align: 'right' }),
        dyn('clock', 'Clock', '{clock}', [1300, 350, 560, 90], { fontSize: 60, color: '#9a9a9a' }, { align: 'right' }),
        dyn('curlabel', 'On screen label', 'ON SCREEN', [1300, 500, 560, 40], { fontSize: 24, color: '#E6A20F', letterSpacing: 4 }, { align: 'right' }),
        dyn('current', 'On screen', '{current.text}', [1300, 546, 560, 264], { fontSize: 40, color: '#cfcfcf', lineHeight: 1.2 }, { align: 'right', verticalAlign: 'top' }),
        rule('rule', 838),
        dyn('next', 'Next', 'Next: {next.text}', [60, 856, 1800, 90], { fontSize: 40, color: '#9a9a9a' }),
        dyn('msg', 'Stage message', '{stageMessage}', [60, 960, 1800, 96], { fontSize: 60, fontWeight: 700, color: '#E6A20F' }, { align: 'center' })
      ]
    }
  },
  {
    id: 'reach-stage-countdown', name: 'Countdown only', size: { width: 1920, height: 1080 },
    slide: {
      id: 'reach-stage-countdown-slide', background: black,
      elements: [
        dyn('clock', 'Clock', '{clock}', [60, 40, 1800, 90], { fontSize: 60, color: '#9a9a9a' }, { align: 'center' }),
        dyn('timer', 'Timer', '{timer}', [160, 180, 1600, 640], { fontSize: 520, fontWeight: 700 }, { align: 'center' }),
        dyn('msg', 'Stage message', '{stageMessage}', [60, 880, 1800, 140], { fontSize: 80, fontWeight: 700, color: '#E6A20F' }, { align: 'center' })
      ]
    }
  }
]

export function allStageLayouts(doc: StageLayout[] | null | undefined): StageLayout[] {
  const mine = Array.isArray(doc) ? doc : []
  const ids = new Set(mine.map((l) => l.id))
  return [...mine, ...BUILTIN_STAGE_LAYOUTS.filter((l) => !ids.has(l.id))]
}
