/**
 * Built-in Reach themes (docs/brand): Charcoal / Paper foundations, Lakeside + Mustard used sparingly,
 * Perfectly Nineties for display, TAY Birdie caps for labels, Courier Prime for body.
 * Brand fonts fall back gracefully (see FONT_FALLBACKS in render/SlideView.tsx).
 * Ids are stable ("reach-…") so presentations and importers can reference them.
 */
import type { Slide, SlideElement, TextElement, TextStyle, Theme } from './model'

const W = 1920
const H = 1080
const CHARCOAL = '#292929'
const LAKESIDE = '#3886CE'
const MUSTARD = '#E6A20F'
const PAPER = '#F4F2EB'
const DISPLAY = 'Perfectly Nineties'
const LABEL = 'TAY Birdie'
const BODY = 'Courier Prime'
const SANS = 'Reach Sans'

const softShadow = { color: 'rgba(0,0,0,.55)', blur: 18, x: 0, y: 4 }

function text(id: string, role: string, name: string, sample: string, frame: [number, number, number, number], style: TextStyle, extra: Partial<TextElement> = {}): TextElement {
  return {
    id, type: 'text', role, name, frame: { x: frame[0], y: frame[1], w: frame[2], h: frame[3] },
    paragraphs: sample.split('\n').map((t) => ({ runs: [{ text: t }] })), style, align: 'center', verticalAlign: 'middle', autoFit: true, ...extra
  }
}
function rect(id: string, name: string, frame: [number, number, number, number], color: string, extra: Partial<SlideElement> = {}): SlideElement {
  return { id, type: 'shape', shape: 'rect', name, frame: { x: frame[0], y: frame[1], w: frame[2], h: frame[3] }, fill: { type: 'color', color }, ...extra } as SlideElement
}
const tpl = (id: string, name: string, slide: Omit<Slide, 'id'>): Theme['templates'][number] => ({ id, name, slide: { id: `${id}-slide`, ...slide } })
const label = (color: string, size = 30): TextStyle => ({ fontFamily: LABEL, fontSize: size, color, letterSpacing: size * 0.16, textTransform: 'uppercase', fontWeight: 500 })

export const BUILTIN_THEMES: Theme[] = [
  {
    id: 'reach-lyrics', name: 'Reach · Lyrics', size: { width: W, height: H },
    templates: [
      tpl('reach-lyrics-main', 'Lyrics', {
        elements: [text('l', 'lyrics', 'Lyrics', 'Amazing grace how sweet the sound\nThat saved a wretch like me', [150, 120, 1620, 840], { fontFamily: SANS, fontSize: 92, fontWeight: 600, color: '#FFFFFF', lineHeight: 1.22, shadow: softShadow })]
      }),
      tpl('reach-lyrics-title', 'Song title', {
        elements: [
          text('t', 'title', 'Title', 'Amazing Grace', [160, 300, 1600, 300], { fontFamily: DISPLAY, fontSize: 170, color: PAPER, lineHeight: 1.05, shadow: softShadow }),
          rect('r', 'Rule', [900, 630, 120, 6], MUSTARD),
          text('s', 'subtitle', 'Subtitle', 'John Newton', [260, 670, 1400, 90], label(PAPER, 34))
        ]
      })
    ]
  },
  {
    id: 'reach-lower-third', name: 'Reach · Lyrics lower third', size: { width: W, height: H },
    templates: [
      tpl('reach-lower-third-main', 'Lower third', {
        elements: [
          rect('bar', 'Bar', [0, 790, W, 290], 'rgba(41,41,41,.88)'),
          rect('rule', 'Rule', [0, 790, W, 5], MUSTARD),
          text('l', 'lyrics', 'Lyrics', 'Amazing grace how sweet the sound\nThat saved a wretch like me', [110, 815, 1700, 240], { fontFamily: SANS, fontSize: 68, fontWeight: 600, color: '#FFFFFF', lineHeight: 1.2 })
        ]
      })
    ]
  },
  {
    // Assigned as `canvas.themeId` on the "Livestream (16:9)" screen: every lyrics slide, whatever the LED-wall
    // layout it was designed for, gets a 16:9 lower third (text + soft plate, no background) without editing slides.
    id: 'reach-livestream', name: 'Livestream lower third', size: { width: W, height: H },
    templates: [
      tpl('reach-livestream-main', 'Lyrics lower third', {
        elements: [
          rect('plate', 'Plate', [160, 790, 1600, 230], 'rgba(0,0,0,.42)', { cornerRadius: 18 } as Partial<SlideElement>),
          text('l', 'lyrics', 'Lyrics', 'Amazing grace how sweet the sound\nThat saved a wretch like me', [200, 805, 1520, 200], { fontFamily: SANS, fontSize: 66, fontWeight: 600, color: '#FFFFFF', lineHeight: 1.2, shadow: { color: 'rgba(0,0,0,.8)', blur: 14, x: 0, y: 3 } })
        ]
      })
    ]
  },
  {
    id: 'reach-scripture', name: 'Reach · Scripture', size: { width: W, height: H },
    templates: [
      tpl('reach-scripture-main', 'Scripture', {
        background: { type: 'color', color: PAPER },
        elements: [
          rect('rule', 'Rule', [160, 150, 96, 8], MUSTARD),
          text('b', 'body', 'Verse', 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.', [160, 200, 1600, 640], { fontFamily: DISPLAY, fontSize: 84, color: CHARCOAL, lineHeight: 1.22 }, { align: 'left', verticalAlign: 'top' }),
          text('r', 'reference', 'Reference', 'John 3:16 NIV', [160, 880, 1600, 70], label(LAKESIDE, 36), { align: 'left', autoFit: true })
        ]
      })
    ]
  },
  {
    id: 'reach-sermon', name: 'Reach · Sermon point', size: { width: W, height: H },
    templates: [
      tpl('reach-sermon-point', 'Point', {
        background: { type: 'color', color: CHARCOAL },
        elements: [
          text('c', 'caption', 'Section', 'Point one', [160, 170, 1600, 60], label(MUSTARD, 30), { align: 'left' }),
          text('t', 'title', 'Point', 'Grace finds us where we are', [160, 250, 1600, 420], { fontFamily: DISPLAY, fontSize: 150, color: PAPER, lineHeight: 1.05 }, { align: 'left', verticalAlign: 'top' }),
          text('b', 'body', 'Supporting text', 'It does not wait for us to tidy up first.', [160, 700, 1500, 240], { fontFamily: BODY, fontSize: 50, color: 'rgba(244,242,235,.82)', lineHeight: 1.35 }, { align: 'left', verticalAlign: 'top' })
        ]
      }),
      tpl('reach-sermon-title', 'Title', {
        background: { type: 'color', color: CHARCOAL },
        elements: [
          text('t', 'title', 'Title', 'Sermon title', [160, 280, 1600, 360], { fontFamily: DISPLAY, fontSize: 190, color: PAPER, lineHeight: 1.02 }),
          rect('rule', 'Rule', [900, 680, 120, 6], MUSTARD),
          text('s', 'subtitle', 'Subtitle', 'Series · Week 1', [260, 720, 1400, 80], label(PAPER, 32))
        ]
      })
    ]
  },
  {
    id: 'reach-announcement', name: 'Reach · Announcement', size: { width: W, height: H },
    templates: [
      tpl('reach-announcement-main', 'Announcement', {
        background: { type: 'color', color: PAPER },
        elements: [
          rect('band', 'Band', [0, 0, 56, H], LAKESIDE),
          text('c', 'caption', 'Label', 'This week', [180, 180, 1560, 60], label(LAKESIDE, 32), { align: 'left' }),
          text('t', 'title', 'Headline', 'Family Night', [180, 260, 1560, 330], { fontFamily: DISPLAY, fontSize: 180, color: CHARCOAL, lineHeight: 1.02 }, { align: 'left', verticalAlign: 'top' }),
          text('b', 'body', 'Details', 'Friday 6pm · Dinner provided\nBring a friend', [180, 620, 1500, 300], { fontFamily: BODY, fontSize: 54, color: CHARCOAL, lineHeight: 1.35 }, { align: 'left', verticalAlign: 'top' })
        ]
      })
    ]
  }
]
