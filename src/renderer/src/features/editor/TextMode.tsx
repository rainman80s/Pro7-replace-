/**
 * "Text" mode (ProPresenter's Reflow): the whole presentation as one plain document.
 * Blank line = new slide, a section name on its own line ("Chorus", "[Tag]") = a group.
 * Edits map back onto the existing slides so styling and per-screen layouts are kept.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { applyReflow, parseReflow, presentationToText, splitLongBlocks } from '@shared/editor-reflow'
import { SlideThumb } from '@shared/render/SlideView'
import { Button } from '@ui/index'
import { Num } from './controls'
import { FormatSong } from './FormatSong'
import { commit, selectSlide, useDoc, useEditor } from './store'

export function TextMode(): ReactNode {
  const doc = useDoc()
  const [text, setText] = useState(() => (doc ? presentationToText(doc) : ''))
  const [maxLines, setMaxLines] = useState<number>(() => Number(localStorage.getItem('reach.reflow.maxLines') ?? 0) || 0)
  const produced = useRef(doc)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)

  // Follow outside changes (undo, another computer) — but never fight the person typing.
  useEffect(() => {
    if (doc && doc !== produced.current) {
      produced.current = doc
      setText(presentationToText(doc))
    }
  }, [doc])

  const apply = (t: string, lines = maxLines): void => {
    let out = doc
    commit((d) => (out = applyReflow(d, t, { maxLines: lines || undefined })), 'Edit text', 'reflow')
    produced.current = useEditor.getState().history?.present ?? out
  }
  const onChange = (t: string): void => {
    setText(t)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => apply(t), 450)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const items = useMemo(() => parseReflow(maxLines ? splitLongBlocks(text, maxLines) : text), [text, maxLines])
  const count = items.filter((i) => i.type === 'slide').length
  if (!doc) return null

  // Caret → slide: select the slide the caret is in so the preview highlights it.
  const syncCaret = (): void => {
    const el = area.current
    if (!el) return
    const before = el.value.slice(0, el.selectionStart)
    const idx = parseReflow(before + 'x').filter((i) => i.type === 'slide').length - 1
    const s = useEditor.getState().history?.present.slides[idx]
    if (s && s.id !== useEditor.getState().slideId) selectSlide(s.id)
  }

  return (
    <div className="ed-textmode" data-testid="textmode">
      <div className="ed-textmode-doc">
        <div className="ed-textmode-bar">
          <span className="dim">Blank line = new slide · a line like <b>Chorus</b> or <b>[Tag]</b> starts a section</span>
          <div className="grow" />
          <FormatSong />
          <label className="row" style={{ gap: 6 }} title="Split long slides automatically">
            <span className="dim">Max lines per slide</span>
            <Num value={maxLines} min={0} max={20} width={54} testid="max-lines" onChange={(v) => { setMaxLines(v); localStorage.setItem('reach.reflow.maxLines', String(v)) }} />
          </label>
          {maxLines > 0 && <Button size="sm" onClick={() => { const t = splitLongBlocks(text, maxLines); setText(t); apply(t, 0) }}>Split now</Button>}
        </div>
        <textarea ref={area} className="ed-textmode-area" data-testid="reflow-text" spellCheck value={text}
          onChange={(e) => onChange(e.target.value)} onKeyUp={syncCaret} onClick={syncCaret}
          onBlur={() => { if (timer.current) { clearTimeout(timer.current); timer.current = null; apply(text) } }} />
      </div>
      <div className="ed-textmode-preview scroll">
        <div className="dim" style={{ padding: '6px 4px' }}>{count} slide{count === 1 ? '' : 's'}</div>
        <Preview />
      </div>
    </div>
  )
}

function Preview(): ReactNode {
  const doc = useDoc()
  const slideId = useEditor((s) => s.slideId)
  if (!doc) return null
  let prev: string | undefined
  return (
    <div className="col" style={{ gap: 8 }}>
      {doc.slides.map((s, i) => {
        const g = doc.groups.find((x) => x.slideIds.includes(s.id))
        const head = g && g.id !== prev ? g : null
        prev = g?.id
        return (
          <div key={s.id}>
            {head && <div className="ed-film-group" style={{ ['--group' as string]: head.color ?? '#555' }}>{head.name}</div>}
            <button className={`ed-textmode-thumb ${s.id === slideId ? 'on' : ''}`} onClick={() => selectSlide(s.id)}>
              <span className="ed-film-n">{i + 1}</span>
              <SlideThumb elements={s.elements} background={s.background} size={doc.size} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
