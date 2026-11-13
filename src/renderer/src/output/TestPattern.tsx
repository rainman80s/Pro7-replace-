import type { CSSProperties, ReactNode } from 'react'
import type { Canvas, Rect } from '@shared/model'
import type { TestPatternId } from '@shared/outputs'

/**
 * Test patterns drawn in the DESTINATION's real pixels (grid, pixels, focus) or in canvas space
 * (regions), so a volunteer can line up projectors, spot scaling, and see which region is which.
 */
export function TestPattern({ pattern, canvas, crop, title, width, height }: { pattern: TestPatternId; canvas?: Canvas | null; crop?: Rect; title: string; width: number; height: number }): ReactNode {
  const full: CSSProperties = { position: 'absolute', inset: 0 }
  const dpr = window.devicePixelRatio || 1
  const px = { w: Math.round(width * dpr), h: Math.round(height * dpr) }
  const label = (
    <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', background: 'rgba(0,0,0,.75)', color: '#fff', padding: '1.2vmin 2.4vmin', borderRadius: '1vmin', font: '600 3.4vmin/1.35 system-ui', textAlign: 'center', whiteSpace: 'nowrap' }}>
      <div>{title}</div>
      <div style={{ fontSize: '2.4vmin', opacity: 0.8, fontVariantNumeric: 'tabular-nums' }}>{px.w} × {px.h} px{crop ? ` · showing ${crop.w}×${crop.h} at ${crop.x},${crop.y}` : ''}</div>
    </div>
  )
  if (pattern === 'white' || pattern === 'black') return <div data-test-pattern={pattern} style={{ ...full, background: pattern === 'white' ? '#fff' : '#000' }} />
  if (pattern === 'bars') {
    const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0']
    return (
      <div data-test-pattern="bars" style={{ ...full, display: 'grid', gridTemplateRows: '67% 8% 25%' }}>
        <div style={{ display: 'flex' }}>{bars.map((c) => <div key={c} style={{ flex: 1, background: c }} />)}</div>
        <div style={{ display: 'flex' }}>{['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'].map((c, i) => <div key={i} style={{ flex: 1, background: c }} />)}</div>
        <div style={{ background: 'linear-gradient(90deg,#000,#fff)' }} />
        {label}
      </div>
    )
  }
  if (pattern === 'focus') {
    return (
      <div data-test-pattern="focus" style={{ ...full, background: 'repeating-conic-gradient(#fff 0 5deg, #000 5deg 10deg)' }}>
        {label}
      </div>
    )
  }
  if (pattern === 'regions' && canvas) {
    const src = crop ?? { x: 0, y: 0, w: canvas.width, h: canvas.height }
    const k = Math.min(width / src.w, height / src.h)
    const colors = ['#3886CE', '#E6A20F', '#4fa88b', '#d8523f', '#9b6bd1', '#e0739c']
    return (
      <div data-test-pattern="regions" style={{ ...full, background: '#111' }}>
        <div style={{ position: 'absolute', left: (width - src.w * k) / 2, top: (height - src.h * k) / 2, width: src.w * k, height: src.h * k, overflow: 'hidden', outline: '2px solid #fff', outlineOffset: -2 }}>
          {(canvas.regions.length ? canvas.regions : [{ id: 'all', name: canvas.name, rect: { x: 0, y: 0, w: canvas.width, h: canvas.height } }]).map((r, i) => (
            <div key={r.id} style={{ position: 'absolute', left: (r.rect.x - src.x) * k, top: (r.rect.y - src.y) * k, width: r.rect.w * k, height: r.rect.h * k, background: colors[i % colors.length] + '55', border: `${Math.max(2, 6 * k)}px solid ${colors[i % colors.length]}`, display: 'grid', placeItems: 'center', color: '#fff', font: `700 ${Math.max(14, r.rect.h * k * 0.12)}px/1.2 system-ui`, textAlign: 'center' }}>
              <div>{r.name}<div style={{ fontSize: '0.4em', opacity: 0.85 }}>{r.rect.w}×{r.rect.h} at {r.rect.x},{r.rect.y}</div></div>
            </div>
          ))}
        </div>
        <div style={{ position: 'absolute', left: 12, bottom: 10, color: '#fff', font: '600 2.2vmin system-ui', opacity: 0.85 }}>{title} — {px.w}×{px.h} px</div>
      </div>
    )
  }
  // grid + pixels: a 1-device-pixel-accurate grid with edge markers and a centre cross.
  const step = pattern === 'pixels' ? 10 : Math.max(40, Math.round(Math.min(width, height) / 12))
  const line = 1 / dpr
  return (
    <div data-test-pattern={pattern} style={{
      ...full, background: '#000',
      backgroundImage: `linear-gradient(#fff ${line}px, transparent ${line}px), linear-gradient(90deg, #fff ${line}px, transparent ${line}px)`,
      backgroundSize: `${step}px ${step}px`, backgroundPosition: '-0.5px -0.5px'
    }}>
      <div style={{ ...full, border: `${Math.max(2, 4 / dpr)}px solid #d8523f` }} />
      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, marginLeft: -1, background: '#E6A20F' }} />
      <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 2, marginTop: -1, background: '#E6A20F' }} />
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: Math.min(width, height) * 0.6, height: Math.min(width, height) * 0.6, transform: 'translate(-50%,-50%)', border: '2px solid #3886CE', borderRadius: '50%' }} />
      {label}
    </div>
  )
}
