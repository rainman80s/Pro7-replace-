import { useMemo, type ReactNode } from 'react'
import qrcode from 'qrcode-generator'

/** A QR code as crisp inline SVG. Dark modules on Paper, with a quiet zone, so phones read it from a dark UI. */
export function QRCode({ value, size = 148, title }: { value: string; size?: number; title?: string }): ReactNode {
  const path = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`
    return { d, n: n + 4 }
  }, [value])
  return (
    <svg width={size} height={size} viewBox={`0 0 ${path.n} ${path.n}`} role="img" aria-label={title ?? `QR code for ${value}`} shapeRendering="crispEdges" style={{ display: 'block', borderRadius: 8 }}>
      <rect width={path.n} height={path.n} fill="#F4F2EB" />
      <path d={path.d} fill="#292929" />
    </svg>
  )
}
