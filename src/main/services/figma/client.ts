/** Figma REST API (https://www.figma.com/developers/api): personal access token in X-Figma-Token. */
import type { FigmaFileInfo, FigmaFrame } from '@shared/integrations'
import { HttpClient, hashOf } from '../integrations/http'

export const FIGMA_API = (): string => process.env.REACH_FIGMA_API || 'https://api.figma.com/v1'

export interface FNode { id: string; name: string; type: string; children?: FNode[]; absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null; characters?: string; visible?: boolean; [k: string]: unknown }

/** figma.com/design/KEY/Name?node-id=1-2 · /file/KEY · /proto/KEY · branch URLs. */
export function parseFigmaUrl(input: string): { fileKey: string; nodeId?: string } | null {
  const s = input.trim()
  if (/^[A-Za-z0-9]{15,40}$/.test(s)) return { fileKey: s }
  let u: URL
  try { u = new URL(s) } catch { return null }
  if (!/(^|\.)figma\.com$/.test(u.hostname)) return null
  const parts = u.pathname.split('/').filter(Boolean)
  const i = parts.findIndex((p) => ['design', 'file', 'proto', 'board', 'slides'].includes(p))
  if (i < 0 || !parts[i + 1]) return null
  const fileKey = parts[i + 2] === 'branch' && parts[i + 3] ? parts[i + 3] : parts[i + 1]
  const node = u.searchParams.get('node-id')
  return { fileKey, ...(node ? { nodeId: decodeURIComponent(node).replace(/-/g, ':') } : {}) }
}

const FRAMEISH = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'GROUP'])

/** Frames to import under a page or section: top-level frames (sections are walked, their name kept). */
export function framesOf(container: FNode, page: string, section?: string): FigmaFrame[] {
  const out: FigmaFrame[] = []
  for (const c of container.children ?? []) {
    if (c.visible === false) continue
    if (c.type === 'SECTION') { out.push(...framesOf(c, page, c.name)); continue }
    if (!FRAMEISH.has(c.type) || !c.absoluteBoundingBox) continue
    const { absoluteBoundingBox: bb, ...rest } = c
    out.push({ id: c.id, name: c.name, width: Math.round(bb.width), height: Math.round(bb.height), page, section, hash: hashOf({ ...rest, w: Math.round(bb.width), h: Math.round(bb.height) }) })
  }
  // Reading order: top-to-bottom rows, then left-to-right.
  const pos = new Map((container.children ?? []).flatMap((c) => (c.type === 'SECTION' ? c.children ?? [] : [c])).map((c) => [c.id, c.absoluteBoundingBox]))
  return out.sort((a, b) => { const A = pos.get(a.id)!, B = pos.get(b.id)!; return Math.abs(A.y - B.y) > Math.min(A.height, B.height) / 2 ? A.y - B.y : A.x - B.x })
}

export function textOf(n: FNode): string[] {
  const out: string[] = []
  const walk = (x: FNode): void => { if (x.visible === false) return; if (x.type === 'TEXT' && x.characters?.trim()) out.push(x.characters.trim()); x.children?.forEach(walk) }
  walk(n)
  return out
}

export function findNode(n: FNode, id: string): FNode | null {
  if (n.id === id) return n
  for (const c of n.children ?? []) { const r = findNode(c, id); if (r) return r }
  return null
}

export class FigmaClient {
  http: HttpClient
  constructor(token: string | (() => string)) {
    this.http = new HttpClient({ name: 'Figma', baseUrl: FIGMA_API(), headers: () => ({ 'x-figma-token': typeof token === 'function' ? token() : token }), perSecond: 2 })
  }
  async me(): Promise<string> { const m = await this.http.get<{ handle?: string; email?: string }>('/me'); return m.handle ?? m.email ?? 'Figma' }

  /** Whole document (pages + every node). For big files we still need the subtree to detect changed frames. */
  async file(fileKey: string): Promise<{ name: string; version: string; lastModified: string; document: FNode }> {
    return this.http.get(`/files/${fileKey}`, undefined, { timeout: 60000 })
  }

  async inspect(fileKey: string, nodeId?: string): Promise<FigmaFileInfo & { container: FNode; containerName: string }> {
    const f = await this.file(fileKey)
    const pages = (f.document.children ?? []).filter((p) => p.type === 'CANVAS')
    let container: FNode = pages[0]
    let page = pages[0]
    if (nodeId) {
      for (const p of pages) {
        const n = findNode(p, nodeId)
        if (!n) continue
        page = p
        // A link to a single frame → import its parent page/section, pre-selecting that frame (UI).
        container = n.type === 'CANVAS' || n.type === 'SECTION' ? n : p
        if (n.type !== 'CANVAS' && n.type !== 'SECTION') { const sec = (p.children ?? []).find((c) => c.type === 'SECTION' && findNode(c, nodeId)); if (sec) container = sec }
        break
      }
    }
    if (!container) throw new Error('That Figma file has no pages.')
    return {
      key: fileKey, name: f.name, version: f.version, lastModified: f.lastModified, pages: pages.map((p) => ({ id: p.id, name: p.name })),
      frames: framesOf(container, page.name, container.type === 'SECTION' ? container.name : undefined), container, containerName: container.name
    }
  }

  /** Render frames to PNG URLs (valid ~30 days; we download immediately). Batches of 50 ids. */
  async render(fileKey: string, ids: string[], scale = 1): Promise<Record<string, string | null>> {
    const out: Record<string, string | null> = {}
    for (let i = 0; i < ids.length; i += 50) {
      const r = await this.http.get<{ err: string | null; images: Record<string, string | null> }>(`/images/${fileKey}`, { ids: ids.slice(i, i + 50).join(','), format: 'png', scale }, { timeout: 120000 })
      if (r.err) throw new Error(`Figma couldn’t render the frames: ${r.err}`)
      Object.assign(out, r.images)
    }
    return out
  }
}
