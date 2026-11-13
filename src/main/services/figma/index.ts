import type { Canvas, ID, MediaRef, Presentation, Slide } from '@shared/model'
import type { DocSlideChange, FigmaFileInfo, FigmaFrame, IntegrationStatus } from '@shared/integrations'
import { defineService, type ServiceContext } from '../../core/service'
import { newId } from '../../core/files'
import { newPresentation } from '../../core/library'
import { docSource, syncDocSlides, tidyPresentation, type GeneratedSlide } from '../integrations/docsync'
import { saveRemoteMedia } from '../integrations/attach'
import { FigmaClient, findNode, parseFigmaUrl, textOf } from './client'

export interface FigmaImportReq { url: string; frameIds?: string[]; scale?: number; smart?: boolean; presentationId?: ID; decisions?: Record<string, 'accept' | 'reject'> }

declare module '@shared/api' {
  interface ApiMethods {
    'figma.status': { req: void; res: IntegrationStatus & { linked: { id: ID; title: string; url?: string; syncedAt?: string }[] } }
    'figma.connect': { req: { token: string }; res: IntegrationStatus }
    'figma.disconnect': { req: void; res: void }
    'figma.inspect': { req: { url: string }; res: FigmaFileInfo & { containerName: string; nodeId?: string } }
    'figma.import': { req: FigmaImportReq; res: { presentation: Presentation; changes: DocSlideChange[]; warnings: string[] } }
    'figma.resync': { req: { presentationId: ID; decisions?: Record<string, 'accept' | 'reject'> }; res: { presentation: Presentation; changes: DocSlideChange[]; warnings: string[] } }
  }
}

/** "LED Top", "Lobby", "Main Screen / LED Top" → which canvas (and region) a frame is a variant for. */
export function variantTarget(name: string, canvases: Canvas[]): { canvas: Canvas; regionId?: string } | null {
  const tail = name.split('/').pop()!.trim().toLowerCase()
  for (const c of canvases) {
    if (c.name.toLowerCase() === tail) return { canvas: c }
    const r = c.regions.find((x) => x.name.toLowerCase() === tail)
    if (r) return { canvas: c, regionId: r.id }
  }
  return null
}

/** Frames → generated slides. Smart mode folds canvas/region-named frames into the previous slide as variants. */
export function framesToSlides(frames: FigmaFrame[], media: Record<string, MediaRef>, notes: Record<string, string>, opts: { smart?: boolean; canvases: Canvas[]; size: { width: number; height: number } }): GeneratedSlide[] {
  const out: GeneratedSlide[] = []
  for (const f of frames) {
    const m = media[f.id]
    if (!m) continue
    const target = opts.smart ? variantTarget(f.name, opts.canvases) : null
    const prev = out[out.length - 1]
    if (target && prev) {
      const { canvas, regionId } = target
      const region = canvas.regions.find((r) => r.id === regionId)
      const frame = region ? { ...region.rect } : { x: 0, y: 0, w: canvas.width, h: canvas.height }
      const existing = prev.slide.variants?.[canvas.id]?.elements ?? []
      prev.slide = { ...prev.slide, variants: { ...prev.slide.variants, [canvas.id]: { background: { type: 'color', color: '#000000' }, elements: [...existing, { id: newId(), type: 'image', name: f.name, media: m, fit: 'cover', frame, ...(regionId ? { regionId } : {}) }] } } }
      prev.key += `+${f.id}`
      prev.srcHash += f.hash ?? ''
      continue
    }
    const slide: Slide = {
      id: newId(), label: f.name, notes: notes[f.id] || undefined, background: { type: 'color', color: '#000000' },
      elements: [{ id: newId(), type: 'image', name: f.name, media: m, fit: 'contain', frame: { x: 0, y: 0, w: opts.size.width, h: opts.size.height } }]
    }
    out.push({ key: f.id, srcHash: f.hash ?? '', slide, label: f.name })
  }
  return out
}

export default defineService({
  name: 'figma',
  order: 70,
  async setup(ctx: ServiceContext) {
    const { api, local, library, workspace } = ctx
    let account = local.get<string>('figma.account', '')
    let lastError = ''
    const token = (): string | null => local.getSecret('figma.token')
    const client = (): FigmaClient => { const t = token(); if (!t) throw new Error('Figma is not connected — add a personal access token in Integrations.'); return new FigmaClient(t) }
    const linked = (): { id: ID; title: string; url?: string; syncedAt?: string }[] => library.all().filter((p) => docSource(p, 'figma')).map((p) => { const s = docSource(p, 'figma')!; return { id: p.id, title: p.title, url: s.url as string | undefined, syncedAt: s.syncedAt } })

    async function doImport(req: FigmaImportReq): Promise<{ presentation: Presentation; changes: DocSlideChange[]; warnings: string[] }> {
      const ref = parseFigmaUrl(req.url)
      if (!ref) throw new Error('That doesn’t look like a Figma link. Copy it from Figma: Share → Copy link (or right-click a frame → Copy link to selection).')
      const c = client()
      const info = await c.inspect(ref.fileKey, ref.nodeId)
      const existing = req.presentationId ? library.get(req.presentationId) : library.all().find((p) => { const s = docSource(p, 'figma'); return s?.ref === `${ref.fileKey}:${info.container.id}` }) ?? null
      const prevSrc = docSource(existing, 'figma')
      const wanted = req.frameIds ?? (prevSrc?.frameIds as string[] | undefined)
      const frames = info.frames.filter((f) => !wanted || wanted.includes(f.id))
      if (!frames.length) throw new Error('No frames found on that page — Reach imports top-level frames (one frame = one slide).')
      const scale = req.scale ?? (prevSrc?.scale as number | undefined) ?? 1
      const smart = req.smart ?? (prevSrc?.smart as boolean | undefined) ?? true
      const warnings: string[] = []
      // Only render frames whose content changed since the last sync (or that we don't have yet).
      const media: Record<string, MediaRef> = {}
      const oldRecords = prevSrc?.slides ?? {}
      const known = new Map<string, string>()
      for (const [key, rec] of Object.entries(oldRecords)) for (const id of key.split('+')) known.set(id, rec.srcHash)
      const oldMedia = (prevSrc?.media ?? {}) as Record<string, MediaRef & { hash?: string }>
      const toRender = frames.filter((f) => !oldMedia[f.id] || oldMedia[f.id].hash !== f.hash)
      const urls = toRender.length ? await c.render(ref.fileKey, toRender.map((f) => f.id), scale) : {}
      for (const f of frames) {
        if (oldMedia[f.id] && oldMedia[f.id].hash === f.hash) { media[f.id] = oldMedia[f.id]; continue }
        const u = urls[f.id]
        if (!u) { warnings.push(`Figma didn’t render “${f.name}” (empty or hidden frame?)`); continue }
        const m = await saveRemoteMedia(ctx, `figma/${ref.fileKey}`, `${f.id.replace(/[^\w]/g, '-')}-${(f.hash ?? '').slice(0, 8)}`, () => c.http.download(u, { auth: false }), { name: f.name, ext: '.png' })
        media[f.id] = { ...m, width: f.width * scale, height: f.height * scale, hash: f.hash } as MediaRef
      }
      const notes: Record<string, string> = {}
      for (const f of frames) { const n = findNode(info.container, f.id); if (n) notes[f.id] = textOf(n).join('\n') }
      const first = frames[0]
      const size = existing?.size ?? { width: first.width, height: first.height }
      const gen = framesToSlides(frames, media, notes, { smart, canvases: workspace.config.canvases, size })
      const sync = syncDocSlides(existing, 'figma', `${ref.fileKey}:${info.container.id}`, gen, {
        decisions: req.decisions, extra: { fileKey: ref.fileKey, nodeId: info.container.id, version: info.version, url: req.url, frameIds: wanted, scale, smart, media }
      })
      const base = existing ?? newPresentation(`${info.name} — ${info.containerName}`, 'generic')
      const p = tidyPresentation({ ...base, size, slides: sync.slides, meta: { ...base.meta, category: 'Figma', source: { ...sync.source, importedAt: new Date().toISOString() } } })
      const saved = await library.save(p)
      lastError = ''
      return { presentation: saved, changes: sync.changes.filter((x) => x.type !== 'same'), warnings }
    }

    api.handle('figma.status', () => ({ id: 'figma' as const, connected: !!token(), account: account || undefined, error: lastError || undefined, linked: linked() }), 'local')
    api.handle('figma.connect', async ({ token: t }) => {
      account = await new FigmaClient(t.trim()).me()
      local.setSecret('figma.token', t.trim()); local.set('figma.account', account)
      return { id: 'figma' as const, connected: true, account }
    }, 'local')
    api.handle('figma.disconnect', () => { local.setSecret('figma.token', null); local.set('figma.account', undefined); account = '' }, 'local')
    api.handle('figma.inspect', async ({ url }) => {
      const ref = parseFigmaUrl(url)
      if (!ref) throw new Error('That doesn’t look like a Figma link.')
      const { container: _c, ...info } = await client().inspect(ref.fileKey, ref.nodeId)
      return { ...info, nodeId: ref.nodeId }
    }, 'local')
    api.handle('figma.import', (req) => doImport(req).catch((e) => { lastError = String(e?.message ?? e); throw e }), 'local')
    api.handle('figma.resync', async ({ presentationId, decisions }) => {
      const src = docSource(library.get(presentationId), 'figma')
      if (!src) throw new Error('This presentation didn’t come from Figma.')
      return doImport({ url: String(src.url), presentationId, decisions })
    }, 'local')
  }
})
