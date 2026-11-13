/** Synthetic Notion API blocks shaped like Reach's real pages (structure only — invented text). */
import type { NBlock } from '@main/services/notion/client'

let n = 0
const id = (): string => `blk-${String(++n).padStart(4, '0')}`
export const reset = (): void => { n = 0 }
type RT = { text: string; bold?: boolean; italic?: boolean; underline?: boolean }
const rt = (parts: (string | RT)[]) => parts.map((p) => {
  const x = typeof p === 'string' ? { text: p } : p
  return { type: 'text', plain_text: x.text, text: { content: x.text }, annotations: { bold: !!x.bold, italic: !!x.italic, underline: !!x.underline, strikethrough: false, code: false, color: 'default' } }
})
const blk = (type: string, value: Record<string, unknown>, children?: NBlock[]): NBlock => ({ object: 'block', id: id(), type, has_children: !!children?.length, [type]: value, ...(children ? { children } : {}) })
export const p = (...parts: (string | RT)[]): NBlock => blk('paragraph', { rich_text: rt(parts), color: 'default' })
export const h1 = (t: string, children?: NBlock[]): NBlock => blk('heading_1', { rich_text: rt([t]), is_toggleable: !!children }, children)
export const h2 = (t: string): NBlock => blk('heading_2', { rich_text: rt([t]), is_toggleable: false })
export const h3 = (t: string): NBlock => blk('heading_3', { rich_text: rt([t]), is_toggleable: false })
export const bullet = (t: string | RT, children?: NBlock[]): NBlock => blk('bulleted_list_item', { rich_text: rt([t]) }, children)
export const numbered = (t: string): NBlock => blk('numbered_list_item', { rich_text: rt([t]) })
export const quote = (t: string): NBlock => blk('quote', { rich_text: rt([t]) })
export const callout = (t: string, children?: NBlock[]): NBlock => blk('callout', { rich_text: rt([t]), icon: { type: 'emoji', emoji: '💡' } }, children)
export const toggle = (t: string, children: NBlock[]): NBlock => blk('toggle', { rich_text: rt([t]) }, children)
export const divider = (): NBlock => blk('divider', {})
export const image = (name: string, caption = ''): NBlock => blk('image', { type: 'file', file: { url: `https://files.example.test/secure/${name}?X-Amz-Expires=3600`, expiry_time: '2026-11-15T00:00:00.000Z' }, caption: rt(caption ? [caption] : []) })
export const synced = (children: NBlock[]): NBlock => blk('synced_block', { synced_from: null }, children)
export const childPage = (title: string): NBlock => blk('child_page', { title })
export const b = (text: string): RT => ({ text, bold: true })
export const i = (text: string): RT => ({ text, italic: true })

/** A sermon page in Reach's template: two boilerplate synced blocks + child pages, then divider-separated slides. */
export function sermonPage(): NBlock[] {
  reset()
  return [
    synced([h1('Reflection Comments'), callout('Add your comments inside the pages below!')]),
    childPage('What can we celebrate?'),
    childPage('What can we improve?'),
    synced([h1('Sermon Slide Requests'), h3('Due: Thursday 3pm'), callout('REMINDERS', [toggle('Critical Formatting Reminders', [bullet('Divide slides with a divider line')])])]),
    h1('Key Text'),
    p(''),
    divider(),
    p('Hosea 6:1-3 (ESV)'),
    p('“1 Come, let us return to the river; for it has torn us, that it may heal us. 2 After two days it will revive us.'),
    p(''),
    p('Leader: This is the Word of the Lord!\nChurch: Thanks be to God!'),
    divider(),
    h2('LOOK UP'),
    h2('LOOK IN'),
    h2('LOOK OUT'),
    divider(),
    h2('WHAT IS THIS LETTER?'),
    h3('1. A LETTER'),
    h3('2. A PROMISE'),
    divider(),
    p('“You can learn more from a river than from a library.”'),
    p('Example Author'),
    divider(),
    divider(),
    image('image.png'),
    p(''),
    divider(),
    p('Acts 16:14'),
    divider(),
    p('Hebrews 12:29 (ESV)'),
    p('“For our God is a ', b('consuming fire'), '.”'),
    p('Malachi 3:2–3 (ESV)'),
    p('“For he is like a refiner’s fire.”'),
    divider(),
    h1('1. SEE THE RIVER'),
    divider(),
    p('IDOLATRY = WORSHIPPING JESUS + WORSHIPPING ______.'),
    toggle('Notes', [p('Pause here and let it land.')]),
    divider(),
    p('')
  ]
}

/** A "Sunday Highlights" page from the Comms Channels database. */
export function highlightsPage(): NBlock[] {
  reset()
  return [
    h1('Slide 1'),
    image('IMG_0001.heic'),
    bullet(b('HEADING: Annual Report')),
    bullet(b('DETAILS:'), [bullet('Read the stories of what God is doing'), bullet('Pick one up in the lobby')]),
    h1('Slide 2'),
    image('photo-two.jpg'),
    bullet(b('HEADING: Family Brunch')),
    bullet(b('DETAILS:'), [bullet('Dec. 5 at the offices'), bullet('Register at example.test')]),
    divider(),
    p(i('Talking Points')),
    p(b('ANNUAL REPORT')),
    bullet('First one in a few years'),
    bullet('Stories are the story'),
    p(''),
    p(b('FAMILY BRUNCH')),
    p('Volunteers needed to bring food.')
  ]
}
