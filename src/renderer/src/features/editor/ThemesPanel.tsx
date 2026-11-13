/**
 * Themes dialog. Applying a theme keeps every slide's words and swaps its look (by text role),
 * including per-screen layouts in the theme. It is reversible ("Remove theme") and re-appliable
 * ("Update from theme" after the theme was edited) — no one-way paste.
 */
import { useState, type ReactNode } from 'react'
import type { Theme } from '@shared/model'
import { isBuiltinTheme, themedSlideCount } from '@shared/themes'
import { SlideThumb } from '@shared/render/SlideView'
import { Button, Input, Modal, Select } from '@ui/index'
import { useApp } from '../../app/store'
import { applyThemeTo, deleteTheme, ensureEditableTheme, removeThemeFrom, saveSlideAsTheme, setCanvasTheme, setWorkspaceDefaultTheme } from './actions'
import { openDoc, themeList, useDoc, useEditor } from './store'

export function ThemesPanel({ onClose }: { onClose: () => void }): ReactNode {
  const doc = useDoc()
  const kind = useEditor((s) => s.kind)
  const slideIds = useEditor((s) => s.slideIds)
  useEditor((s) => s.themes)
  const workspace = useApp((s) => s.workspace)
  const themes = themeList()
  const [sel, setSel] = useState<string>(doc?.themeId ?? themes[0]?.id ?? '')
  const [tpl, setTpl] = useState<string>('')
  const [name, setName] = useState('')
  const theme = themes.find((t) => t.id === sel)
  const current = themes.find((t) => t.id === doc?.themeId)
  const themed = doc ? themedSlideCount(doc) : 0
  const isPres = kind === 'presentation'
  const edit = async (t: Theme): Promise<void> => {
    await ensureEditableTheme(t)
    onClose()
    await openDoc('theme', t.id)
    useEditor.setState({ mode: 'design' })
  }
  return (
    <Modal title="Themes" onClose={onClose} width={900}
      footer={<Button onClick={onClose}>Done</Button>}>
      {isPres && current && (
        <div className="ed-note row" style={{ marginBottom: 12 }}>
          <span>This presentation uses <b>{current.name}</b> on {themed} slide{themed === 1 ? '' : 's'}.</span>
          <div className="grow" />
          <Button size="sm" onClick={() => applyThemeTo(current, 'all')} title="Re-apply after the theme was edited">Update from theme</Button>
          <Button size="sm" variant="ghost" data-testid="remove-theme" onClick={() => removeThemeFrom('all')}>Remove theme (restore original look)</Button>
        </div>
      )}
      <div className="ed-themes">
        <div className="ed-theme-list scroll">
          {themes.map((t) => (
            <button key={t.id} className={`ed-theme ${t.id === sel ? 'on' : ''}`} onClick={() => { setSel(t.id); setTpl('') }} data-testid={`theme-${t.name}`}>
              <SlideThumb elements={t.templates[0]?.slide.elements ?? []} background={t.templates[0]?.slide.background} size={t.size} />
              <span>{t.name}{isBuiltinTheme(t.id) ? '' : ' ★'}</span>
            </button>
          ))}
        </div>
        {theme && (
          <div className="ed-theme-detail col">
            <h3 style={{ margin: 0, font: '22px/1.2 var(--font-display)' }}>{theme.name}</h3>
            <div className="ed-theme-templates">
              {theme.templates.map((t) => (
                <button key={t.id} className={`ed-theme-tpl ${tpl === t.id ? 'on' : ''}`} onClick={() => setTpl(tpl === t.id ? '' : t.id)} title="Use only this template">
                  <SlideThumb elements={t.slide.elements} background={t.slide.background} size={theme.size} />
                  <span>{t.name}{t.slide.variants && Object.keys(t.slide.variants).length ? ` · ${Object.keys(t.slide.variants).length} screen layout${Object.keys(t.slide.variants).length > 1 ? 's' : ''}` : ''}</span>
                </button>
              ))}
            </div>
            <div className="dim">{tpl ? 'Uses the selected template for every slide.' : 'Each slide gets the best-matching template by its text roles (lyrics, title, body…).'}</div>
            {isPres && (
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <Button variant="primary" data-testid="apply-theme-all" onClick={() => { applyThemeTo(theme, 'all', tpl || undefined); onClose() }}>Apply to whole presentation</Button>
                <Button onClick={() => { applyThemeTo(theme, 'selected', tpl || undefined); onClose() }} disabled={!slideIds.length}>Apply to {slideIds.length} selected slide{slideIds.length === 1 ? '' : 's'}</Button>
              </div>
            )}
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <Button onClick={() => void edit(theme)}>{isBuiltinTheme(theme.id) ? 'Customize this theme' : 'Edit theme'}</Button>
              {!isBuiltinTheme(theme.id) && <Button variant="ghost" onClick={() => void deleteTheme(theme.id).then(() => setSel(themes[0]?.id ?? ''))}>Delete</Button>}
              {isBuiltinTheme(theme.id) && themes.some((t) => t.id === theme.id && !isBuiltinTheme(t.id)) && <span className="dim">customized</span>}
            </div>
            <hr />
            <div className="ed-grid-form">
              <span>New presentations</span>
              <label className="row"><input type="checkbox" checked={workspace?.defaultThemeId === theme.id} onChange={(e) => setWorkspaceDefaultTheme(e.target.checked ? theme.id : undefined)} /> Default theme for new presentations</label>
              {(workspace?.canvases ?? []).filter((c) => c.kind !== 'stage').map((c) => (
                <FragmentRow key={c.id} label={`On ${c.name}`}>
                  <Select value={c.themeId ?? ''} onChange={(e) => setCanvasTheme(c.id, e.target.value || undefined)}>
                    <option value="">Slides as designed</option>
                    {themes.map((t) => <option key={t.id} value={t.id}>Always restyle with {t.name}</option>)}
                  </Select>
                </FragmentRow>
              ))}
            </div>
            <div className="dim">A screen theme restyles slides that don't have their own layout for that screen (e.g. lower-thirds on the livestream).</div>
          </div>
        )}
      </div>
      {isPres && (
        <div className="row" style={{ marginTop: 14 }}>
          <span className="dim">Save the current slide's look as a new theme:</span>
          <Input placeholder="Theme name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button disabled={!name.trim()} onClick={() => void saveSlideAsTheme(name.trim()).then((t) => { if (t) { setSel(t.id); setName('') } })}>Save as theme</Button>
        </div>
      )}
    </Modal>
  )
}

function FragmentRow({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return <><span>{label}</span>{children}</>
}
