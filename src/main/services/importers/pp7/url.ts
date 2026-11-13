import type { PB } from './proto'
import type { PP7Url } from './context'

/** rv.data.URL → PP7Url. Handles file:// URLs (macOS), raw Windows paths, and web URLs. */
export function parsePP7Url(u: PB | undefined | null): PP7Url | null {
  if (!u) return null
  const out: PP7Url = { basename: '' }
  const abs: string = u.absolute_string ?? ''
  if (u.platform) out.platform = u.platform
  if (/^https?:\/\//i.test(abs)) out.web = abs
  else if (abs) out.absolute = fileUrlToPath(abs)
  if (u.local && (u.local.path || u.local.root)) {
    out.root = u.local.root ?? 'ROOT_UNKNOWN'
    out.relative = String(u.local.path ?? '')
  } else if (u.external) {
    out.relative = String(u.external.path ?? '')
    out.root = 'EXTERNAL'
    out.volume = u.external.macos?.volume_name ?? u.external.win32?.volume_name ?? u.external.win32?.drive_letter
  } else if (u.relative_path) {
    out.relative = String(u.relative_path)
  }
  const pick = out.relative || out.absolute || out.web || ''
  out.basename = baseName(pick)
  if (!out.absolute && !out.web && !out.relative) return null
  return out
}

/** "file:///Users/a/My%20Song.png" → "/Users/a/My Song.png"; Windows paths and plain paths pass through. */
export function fileUrlToPath(s: string): string {
  if (/^file:/i.test(s)) {
    let p = s.replace(/^file:\/\/(localhost)?/i, '').replace(/^file:/i, '')
    try { p = decodeURIComponent(p) } catch { /* keep raw */ }
    // file:///C:/x → C:/x
    if (/^\/[A-Za-z]:[\\/]/.test(p)) p = p.slice(1)
    return p
  }
  return s
}

/** Last component of a POSIX or Windows path / URL, without query string. Never contains a separator. */
export function baseName(p: string): string {
  const clean = p.split(/[?#]/)[0].replace(/[\\/]+$/, '')
  const i = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))
  return clean.slice(i + 1)
}

export const isWindowsPath = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')
