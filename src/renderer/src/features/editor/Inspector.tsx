/** Right-hand inspector: element design, text styling, slide properties. Simple first, power below. */
import { useState, type ReactNode } from 'react'
import type { ID, Paragraph, Shadow, Slide, SlideElement, TextElement, TextStyle, Transition } from '@shared/model'
import { clearRunOverrides } from '@shared/editor-richtext'
import { linkedSource } from '@shared/editor-variants'
import { ROLE_LABELS } from '@shared/themes'
import { STAGE_TOKENS } from '@shared/editor-stagelayouts'
import { Button, Select, TextArea } from '@ui/index'
import { useApp } from '../../app/store'
import { ActionPicker } from '../control/ActionPicker'
import { uid } from '@shared/editor-util'
import { Color, FillEditor, MediaChip, Num, Row, Section, Seg, TextInput } from './controls'
import { activeText, currentSurface, patchElements, updateSlide, useDoc, useEditor, surfaceOf, audienceCanvases } from './store'
import { alignSelection, distribute, fillRegionSel } from './actions'

const FONTS = ['Reach Sans', 'Perfectly Nineties', 'TAY Birdie', 'Courier Prime', 'Marina Script', 'Inter', 'Helvetica Neue', 'Arial', 'Georgia', 'Times New Roman', 'Futura', 'Avenir Next', 'Gill Sans', 'Montserrat', 'Open Sans', 'Lato', 'Roboto']

export function Inspector(): ReactNode {
  const doc = useDoc()
  const selection = useEditor((s) => s.selection)
  const slideId = useEditor((s) => s.slideId)
  const canvasId = useEditor((s) => s.canvasId)
  const tab = useEditor((s) => s.tab)
  useApp((s) => s.workspace)
  const surf = surfaceOf(doc, slideId, canvasId, audienceCanvases())
  if (!doc || !surf) return <div className="ed-inspector empty">Nothing selected</div>
  const sel = surf.elements.filter((e) => selection.includes(e.id))
  const showSlide = tab === 'slide' || !sel.length
  return (
    <div className="ed-inspector" data-testid="inspector">
      <div className="ed-tabs">
        <button className={!showSlide ? 'on' : ''} disabled={!sel.length} onClick={() => useEditor.setState({ tab: 'design' })}>{sel.length > 1 ? `${sel.length} items` : sel[0] ? kindName(sel[0]) : 'Item'}</button>
        <button className={showSlide ? 'on' : ''} onClick={() => useEditor.setState({ tab: 'slide' })}>Slide</button>
      </div>
      <div className="ed-inspector-body scroll">
        {surf.inherited && <div className="ed-note">This screen is showing the main design. Customize it to edit here.</div>}
        {showSlide ? <SlideProps /> : <ElementProps els={sel} />}
      </div>
    </div>
  )
}

const kindName = (e: SlideElement): string => (e.type === 'text' ? (e.dynamic ? 'Live text' : 'Text') : e.type === 'shape' ? 'Shape' : e.type === 'image' ? 'Image' : e.type === 'video' ? 'Video' : 'Live input')

function ElementProps({ els }: { els: SlideElement[] }): ReactNode {
  const ids = els.map((e) => e.id)
  const el = els[0]
  const one = els.length === 1 ? el : null
  const surf = currentSurface()
  const patch = (p: Partial<SlideElement> | ((e: SlideElement) => SlideElement), label: string, key?: string): void => patchElements(ids, p, label, key)
  const texts = els.filter((e): e is TextElement => e.type === 'text')
  const region = surf?.regions.find((r) => r.id === el.regionId)
  return (
    <>
      {surf?.regions.length ? (
        <Section title="Screen region">
          <div className="dim" style={{ marginBottom: 6 }}>{region ? `In ${region.name}` : 'Not inside a region'}</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {surf.regions.map((r) => <Button key={r.id} size="sm" data-testid={`fill-region-${r.name}`} onClick={() => fillRegionSel(r)}>Fill {r.name}</Button>)}
          </div>
          <div className="row" style={{ gap: 4, marginTop: 6 }}>
            <span className="dim" style={{ width: 70 }}>Centre in</span>
            <Button size="sm" onClick={() => { alignSelection('hcenter', 'region'); alignSelection('vcenter', 'region') }}>its region</Button>
          </div>
        </Section>
      ) : null}

      {texts.length > 0 && <TextProps els={texts} />}

      <Section title="Position & size">
        {one ? (
          <div className="ed-grid2">
            <Num title="X" value={one.frame.x} onChange={(x) => patch({ frame: { ...one.frame, x } }, 'Move')} testid="insp-x" />
            <Num title="Y" value={one.frame.y} onChange={(y) => patch({ frame: { ...one.frame, y } }, 'Move')} testid="insp-y" />
            <Num title="W" value={one.frame.w} min={1} onChange={(w) => patch({ frame: { ...one.frame, w } }, 'Resize')} testid="insp-w" />
            <Num title="H" value={one.frame.h} min={1} onChange={(h) => patch({ frame: { ...one.frame, h } }, 'Resize')} testid="insp-h" />
            <Num title="°" value={one.rotation ?? 0} onChange={(rotation) => patch({ rotation: rotation || undefined }, 'Rotate')} />
          </div>
        ) : <div className="dim">{els.length} items selected</div>}
        <div className="ed-align">
          {(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map((op) => (
            <button key={op} title={`Align ${op}`} onClick={() => alignSelection(op, els.length > 1 ? 'selection' : 'slide')}><AlignIcon op={op} /></button>
          ))}
          {els.length > 2 && <><button title="Distribute horizontally" onClick={() => distribute('x')}>⇹</button><button title="Distribute vertically" onClick={() => distribute('y')}>⇳</button></>}
        </div>
      </Section>

      {(el.type === 'shape' || el.type === 'text') && (
        <Section title={el.type === 'text' ? 'Box' : 'Fill'}>
          {(el.type !== 'shape' || el.shape !== 'line') && <FillEditor fill={(el as TextElement).fill} onChange={(fill) => patch((e) => ({ ...e, fill }) as SlideElement, 'Fill')} />}
          {el.type === 'shape' && el.shape === 'line' && <div className="dim">Lines use the outline colour and width.</div>}
        </Section>
      )}
      {(el.type === 'image' || el.type === 'video') && one && (
        <Section title={el.type === 'image' ? 'Image' : 'Video'}>
          <MediaChip media={el.media} onReplace={(media) => patch((e) => ({ ...e, media }) as SlideElement, 'Replace media')} />
          <Row label="Scaling"><Seg value={el.fit ?? (el.type === 'video' ? 'cover' : 'contain')} options={[{ v: 'contain', label: 'Fit' }, { v: 'cover', label: 'Fill' }, { v: 'stretch', label: 'Stretch' }]} onChange={(fit) => patch((e) => ({ ...e, fit }) as SlideElement, 'Scaling')} /></Row>
          {el.type === 'video' && (
            <>
              <Row label="Loop"><input type="checkbox" checked={el.loop ?? false} onChange={(e) => patch((x) => ({ ...x, loop: e.target.checked }) as SlideElement, 'Loop')} /></Row>
              <Row label="Sound"><input type="checkbox" checked={!(el.muted ?? true)} onChange={(e) => patch((x) => ({ ...x, muted: !e.target.checked }) as SlideElement, 'Sound')} /></Row>
            </>
          )}
        </Section>
      )}
      {el.type === 'live' && one && (
        <Section title="Live input">
          <Row label="Source"><Select value={el.source.kind} onChange={(e) => patch((x) => ({ ...x, source: { ...(x as typeof el).source, kind: e.target.value as typeof el.source.kind } }) as SlideElement, 'Live source')}>
            <option value="camera">Camera / capture card</option><option value="ndi">NDI source</option><option value="screen">Screen</option><option value="web">Web page</option>
          </Select></Row>
          <Row label={el.source.kind === 'web' ? 'URL' : 'Device'}><TextInput value={el.source.ref} placeholder={el.source.kind === 'web' ? 'https://…' : 'Default'} onChange={(ref) => patch((x) => ({ ...x, source: { ...(x as typeof el).source, ref } }) as SlideElement, 'Live source')} /></Row>
        </Section>
      )}

      <Section title="Style">
        <Row label="Opacity"><input type="range" min={0} max={1} step={0.01} value={el.opacity ?? 1} onChange={(e) => patch({ opacity: Number(e.target.value) === 1 ? undefined : Number(e.target.value) }, 'Opacity', 'opacity')} /><span className="dim">{Math.round((el.opacity ?? 1) * 100)}%</span></Row>
        <Row label="Outline">
          <input type="checkbox" checked={!!el.stroke} onChange={(e) => patch({ stroke: e.target.checked ? { color: '#FFFFFF', width: 4 } : undefined }, 'Outline')} />
          {el.stroke && <><Color value={el.stroke.color} onChange={(color) => patch({ stroke: { ...el.stroke!, color } }, 'Outline', 'stroke')} /><Num value={el.stroke.width} min={0} width={52} onChange={(width) => patch({ stroke: { ...el.stroke!, width } }, 'Outline')} /></>}
        </Row>
        {(el.type !== 'shape' || el.shape === 'rect') && <Row label="Corners"><Num value={el.cornerRadius ?? 0} min={0} onChange={(cornerRadius) => patch({ cornerRadius: cornerRadius || undefined }, 'Corner radius')} /></Row>}
        <ShadowRow label="Shadow" value={el.shadow} onChange={(shadow) => patch({ shadow }, 'Shadow', 'shadow')} />
      </Section>

      <Section title="More">
        {one && <Row label="Name"><TextInput value={one.name ?? ''} placeholder={kindName(one)} onChange={(name) => patch({ name: name || undefined }, 'Rename')} /></Row>}
        <Row label="Appears">
          <Select value={String(el.buildIn ?? 0)} onChange={(e) => patch({ buildIn: Number(e.target.value) || undefined }, 'Build order')} data-testid="build-in">
            <option value="0">With the slide</option>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>On click {n}</option>)}
          </Select>
        </Row>
        <Row label="Lock"><input type="checkbox" checked={!!el.locked} onChange={(e) => patch({ locked: e.target.checked || undefined }, e.target.checked ? 'Lock' : 'Unlock')} /></Row>
        <Row label="Hidden"><input type="checkbox" checked={!!el.hidden} onChange={(e) => patch({ hidden: e.target.checked || undefined }, e.target.checked ? 'Hide' : 'Show')} /></Row>
      </Section>
    </>
  )
}

function ShadowRow({ label, value, onChange }: { label: string; value: Shadow | undefined; onChange: (s: Shadow | undefined) => void }): ReactNode {
  return (
    <>
      <Row label={label}>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked ? { color: 'rgba(0,0,0,0.6)', blur: 16, x: 0, y: 4 } : undefined)} />
        {value && <Color value={value.color} onChange={(color) => onChange({ ...value, color })} />}
      </Row>
      {value && (
        <Row label="">
          <Num title="Blur" value={value.blur} min={0} width={56} onChange={(blur) => onChange({ ...value, blur })} />
          <Num title="X" value={value.x} width={52} onChange={(x) => onChange({ ...value, x })} />
          <Num title="Y" value={value.y} width={52} onChange={(y) => onChange({ ...value, y })} />
        </Row>
      )}
    </>
  )
}

/** Text styling: applies to the highlighted words while editing, else to the whole box(es). */
function TextProps({ els }: { els: TextElement[] }): ReactNode {
  const editingId = useEditor((s) => s.editingId)
  const textSel = useEditor((s) => s.textSel)
  const kind = useEditor((s) => s.kind)
  const ids = els.map((e) => e.id)
  const el = els[0]
  const surf = currentSurface()
  const inRange = !!editingId && !!textSel?.range
  const shown: TextStyle = inRange ? { ...el.style, ...textSel!.style } : el.style
  const style = (p: Partial<TextStyle>, label: string, key?: string): void => {
    if (inRange && activeText.current?.applyStyle(p)) return
    const keys = Object.keys(p) as (keyof TextStyle)[]
    patchElements(ids, (e) => {
      const t = e as TextElement
      const s: TextStyle = { ...t.style, ...p }
      for (const k of keys) if (s[k] === undefined) delete s[k]
      return { ...t, style: s, paragraphs: clearRunOverrides(t.paragraphs, keys) }
    }, label, key)
  }
  const box = (p: Partial<TextElement>, label: string): void => patchElements(ids, (e) => ({ ...e, ...p }) as SlideElement, label)
  const align = (a: Paragraph['align']): void => {
    if (editingId && activeText.current) { activeText.current.setAlign(undefined); }
    patchElements(ids, (e) => ({ ...(e as TextElement), align: a, paragraphs: (e as TextElement).paragraphs.map((p) => { const n = { ...p }; delete n.align; return n }) }), 'Align text')
  }
  const linked = surf?.isVariant && els.length === 1 ? linkedSource(surf.slide.elements, surf.elements, el.id) : undefined
  return (
    <Section title={inRange ? 'Text — selected words' : 'Text'}>
      <Row label="Font">
        <input className="input" list="ed-fonts" value={shown.fontFamily ?? ''} placeholder="Reach Sans" style={{ flex: 1, minWidth: 0 }}
          onChange={(e) => style({ fontFamily: e.target.value || undefined }, 'Font', 'font')} data-testid="font-family" />
        <datalist id="ed-fonts">{FONTS.map((f) => <option key={f} value={f} />)}</datalist>
      </Row>
      <Row label="Size">
        <Num value={shown.fontSize} min={4} max={1000} onChange={(fontSize) => style({ fontSize }, 'Font size')} testid="font-size" />
        <Select value={String(shown.fontWeight ?? 400)} onChange={(e) => style({ fontWeight: Number(e.target.value) }, 'Weight')} style={{ flex: 1 }}>
          {[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{({ 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' } as Record<number, string>)[w]}</option>)}
        </Select>
      </Row>
      <Row label="">
        <div className="ed-seg">
          <button title="Bold (⌘B)" data-testid="bold" className={Number(shown.fontWeight ?? 400) >= 700 ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => style({ fontWeight: Number(shown.fontWeight ?? 400) >= 700 ? 400 : 700 }, 'Bold')}><b>B</b></button>
          <button title="Italic (⌘I)" className={shown.italic ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => style({ italic: shown.italic ? undefined : true }, 'Italic')}><i>I</i></button>
          <button title="Underline (⌘U)" className={shown.underline ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => style({ underline: shown.underline ? undefined : true }, 'Underline')}><u>U</u></button>
        </div>
        <Color value={shown.color ?? '#FFFFFF'} onChange={(color) => style({ color }, 'Text colour', 'color')} testid="text-color" />
      </Row>
      <Row label="Align">
        <Seg value={el.align ?? 'center'} options={[{ v: 'left', label: '⯇', title: 'Left' }, { v: 'center', label: '≡', title: 'Centre' }, { v: 'right', label: '⯈', title: 'Right' }, { v: 'justify', label: '☰', title: 'Justify' }]} onChange={align} />
        <Seg value={el.verticalAlign ?? 'middle'} options={[{ v: 'top', label: '⤒', title: 'Top' }, { v: 'middle', label: '↕', title: 'Middle' }, { v: 'bottom', label: '⤓', title: 'Bottom' }]} onChange={(verticalAlign) => box({ verticalAlign }, 'Vertical align')} />
      </Row>
      <Row label="Shrink to fit"><input type="checkbox" data-testid="autofit" checked={!!el.autoFit} onChange={(e) => box({ autoFit: e.target.checked || undefined }, 'Shrink to fit')} /><span className="dim">Text gets smaller if it doesn't fit</span></Row>
      {kind !== 'stage' && (
        <Row label="Role">
          <Select value={el.role ?? ''} onChange={(e) => box({ role: e.target.value || undefined }, 'Text role')} data-testid="role">
            <option value="">— none —</option>
            {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Row>
      )}
      {surf?.isVariant && el.role && !el.dynamic && els.length === 1 && (
        <Row label="Words">
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" data-testid="linked" checked={el.linked !== false} onChange={(e) => box({ linked: e.target.checked ? undefined : false }, e.target.checked ? 'Link text' : 'Unlink text')} />
            <span className="dim">{linked || el.linked !== false ? 'Same as main design (type once)' : 'Own text on this screen'}</span>
          </label>
        </Row>
      )}
      <details className="ed-more">
        <summary>Spacing, case, outline, shadow</summary>
        <Row label="Line height"><Num value={shown.lineHeight ?? 1.2} step={0.05} min={0.5} max={4} onChange={(lineHeight) => style({ lineHeight }, 'Line height')} /></Row>
        <Row label="Letter spacing"><Num value={shown.letterSpacing ?? 0} step={0.5} onChange={(v) => style({ letterSpacing: v || undefined }, 'Letter spacing')} /></Row>
        <Row label="Case"><Seg value={shown.textTransform ?? 'none'} options={[{ v: 'none', label: 'Aa' }, { v: 'uppercase', label: 'AA' }, { v: 'lowercase', label: 'aa' }, { v: 'capitalize', label: 'Ab' }]} onChange={(t) => style({ textTransform: t === 'none' ? undefined : t }, 'Case')} /></Row>
        <Row label="Text outline">
          <input type="checkbox" checked={!!shown.strokeWidth} onChange={(e) => style({ strokeWidth: e.target.checked ? 3 : undefined, strokeColor: e.target.checked ? shown.strokeColor ?? '#000000' : undefined }, 'Text outline')} />
          {!!shown.strokeWidth && <><Color value={shown.strokeColor ?? '#000000'} onChange={(strokeColor) => style({ strokeColor }, 'Text outline', 'tstroke')} /><Num value={shown.strokeWidth} min={0} width={50} onChange={(strokeWidth) => style({ strokeWidth }, 'Text outline')} /></>}
        </Row>
        <ShadowRow label="Text shadow" value={shown.shadow} onChange={(shadow) => style({ shadow }, 'Text shadow', 'tshadow')} />
        <Row label="Padding"><Num value={el.padding ?? 0} min={0} onChange={(padding) => box({ padding: padding || undefined }, 'Padding')} /></Row>
      </details>
      {(el.dynamic || kind === 'stage') && <TokenMenu el={el} />}
    </Section>
  )
}

function TokenMenu({ el }: { el: TextElement }): ReactNode {
  const timers = useApp((s) => s.live.timers)
  const editingId = useEditor((s) => s.editingId)
  const insert = (token: string): void => {
    if (editingId === el.id && activeText.current) return activeText.current.insertText(`{${token}}`)
    patchElements([el.id], (e) => ({ ...(e as TextElement), dynamic: true, paragraphs: [{ runs: [{ text: `{${token}}` }] }] }), 'Insert live text')
  }
  return (
    <Row label="Live text">
      <Select value="" onChange={(e) => e.target.value && insert(e.target.value)} data-testid="insert-token">
        <option value="">Insert…</option>
        {STAGE_TOKENS.map((t) => <option key={t.token} value={t.token}>{t.label}</option>)}
        {timers.map((t) => <option key={t.id} value={`timer:${t.name}`}>Timer: {t.name}</option>)}
      </Select>
      {kind(el)}
    </Row>
  )
}
const kind = (el: TextElement): ReactNode => <label className="row dim" style={{ gap: 4 }} title="Replace {tokens} with live values"><input type="checkbox" checked={!!el.dynamic} onChange={(e) => patchElements([el.id], (x) => ({ ...x, dynamic: e.target.checked || undefined }) as SlideElement, 'Live text')} />live</label>

const TRANSITIONS: Transition['type'][] = ['cut', 'fade', 'dissolve', 'slide', 'push', 'zoom']

function SlideProps(): ReactNode {
  const doc = useDoc()
  const slideId = useEditor((s) => s.slideId)
  const canvasId = useEditor((s) => s.canvasId)
  const kindDoc = useEditor((s) => s.kind)
  const surf = currentSurface()
  const slide = doc?.slides.find((s) => s.id === slideId)
  const [notes, setNotes] = useState<{ id: ID; text: string } | null>(null)
  if (!doc || !slide || !surf) return null
  const up = (fn: (s: Slide) => Slide, label: string, key?: string): void => updateSlide(slide.id, fn, label, key)
  const bgTarget = surf.isVariant && canvasId ? 'variant' : 'base'
  const bg = bgTarget === 'variant' ? slide.variants![canvasId!].background : slide.background
  const setBg = (f: typeof bg): void => up((s) => {
    if (bgTarget === 'variant') {
      const v = { ...s.variants![canvasId!] }
      if (f) v.background = f
      else delete v.background
      return { ...s, variants: { ...s.variants, [canvasId!]: v } }
    }
    const n = { ...s, background: f }
    if (!f) delete n.background
    return n
  }, 'Background')
  const notesText = notes?.id === slide.id ? notes.text : slide.notes ?? ''
  return (
    <>
      <Section title={bgTarget === 'variant' ? `Background on ${surf.canvas?.name}` : 'Background'}>
        <FillEditor fill={bg} onChange={setBg} />
        {bgTarget === 'variant' && !bg && <div className="dim">Uses the main design's background.</div>}
        <div className="dim" style={{ marginTop: 4 }}>Tip: looping videos usually go on the media layer (Media tab) so they keep playing between slides.</div>
      </Section>
      {kindDoc !== 'stage' && (
        <Section title={kindDoc === 'theme' ? 'Template' : 'Slide'}>
          <Row label={kindDoc === 'theme' ? 'Name' : 'Label'}><TextInput value={slide.label ?? ''} placeholder={kindDoc === 'theme' ? 'Template name' : 'e.g. Chorus 1'} onChange={(label) => up((s) => ({ ...s, label: label || undefined }), 'Label')} testid="slide-label" /></Row>
          {kindDoc === 'presentation' && (
            <>
              <Row label="Show">
                <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={slide.enabled !== false} onChange={(e) => up((s) => ({ ...s, enabled: e.target.checked ? undefined : false }), e.target.checked ? 'Enable slide' : 'Skip slide')} /><span className="dim">Include when presenting</span></label>
              </Row>
              <Row label="Transition">
                <Select value={slide.transition?.type ?? ''} onChange={(e) => up((s) => ({ ...s, transition: e.target.value ? { type: e.target.value as Transition['type'], duration: s.transition?.duration ?? 0.4 } : undefined }), 'Transition')}>
                  <option value="">Default</option>
                  {TRANSITIONS.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
                </Select>
                {slide.transition && slide.transition.type !== 'cut' && <Num value={slide.transition.duration} step={0.1} min={0} max={10} suffix="s" width={64} onChange={(duration) => up((s) => ({ ...s, transition: { ...s.transition!, duration } }), 'Transition')} />}
              </Row>
              <Row label="Auto-advance"><Num value={slide.autoAdvance ?? 0} min={0} step={1} suffix="s" width={70} onChange={(v) => up((s) => ({ ...s, autoAdvance: v || undefined }), 'Auto-advance')} /><span className="dim">0 = manual</span></Row>
              <Row label="Hot key"><TextInput value={slide.hotKey ?? ''} placeholder="e.g. C" onChange={(hotKey) => up((s) => ({ ...s, hotKey: hotKey.slice(0, 1).toUpperCase() || undefined }), 'Hot key')} /></Row>
            </>
          )}
        </Section>
      )}
      {kindDoc === 'presentation' && (
        <Section title="When this slide goes live">
          {(slide.actions ?? []).map((a, i) => (
            <div key={a.id} className="row" style={{ alignItems: 'flex-start', gap: 4 }}>
              <div className="grow"><ActionPicker compact showDelay value={a} onChange={(n) => up((s) => ({ ...s, actions: (s.actions ?? []).map((x, j) => (j === i ? { ...x, ...n } : x)) }), 'Slide action')} /></div>
              <Button size="sm" variant="ghost" onClick={() => up((s) => { const actions = (s.actions ?? []).filter((_, j) => j !== i); return { ...s, actions: actions.length ? actions : undefined } }, 'Remove action')}>×</Button>
            </div>
          ))}
          <Button size="sm" onClick={() => up((s) => ({ ...s, actions: [...(s.actions ?? []), { id: uid(), type: 'media.play', params: {} }] }), 'Add action')}>+ Add action</Button>
        </Section>
      )}
      {kindDoc === 'presentation' && (
        <Section title="Notes (for the stage display)">
          <TextArea rows={4} value={notesText} placeholder="Notes for the speaker or band" style={{ width: '100%', resize: 'vertical' }}
            onChange={(e) => setNotes({ id: slide.id, text: e.target.value })}
            onBlur={() => { if (notes?.id === slide.id && notes.text !== (slide.notes ?? '')) up((s) => ({ ...s, notes: notes.text || undefined }), 'Notes'); setNotes(null) }} data-testid="slide-notes" />
        </Section>
      )}
    </>
  )
}

function AlignIcon({ op }: { op: string }): ReactNode {
  const p: Record<string, string> = {
    left: 'M3 2v16M6 6h10M6 12h6', hcenter: 'M10 2v16M4 6h12M6 12h8', right: 'M17 2v16M4 6h10M8 12h6',
    top: 'M2 3h16M6 6v10M12 6v6', vcenter: 'M2 10h16M6 4v12M12 6v8', bottom: 'M2 17h16M6 4v10M12 8v6'
  }
  return <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d={p[op]} /></svg>
}
