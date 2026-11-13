/**
 * Media helpers for the Media view.
 * 'media.upload' — chunked import of files dropped from Finder/Explorer when the renderer can't see their
 * path (contextIsolation hides File.path). Chunks are written straight into the workspace media folder,
 * then registered with the normal media.import.
 */
import { promises as fs, createWriteStream, type WriteStream } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { MediaItem } from '@shared/model'
import { mediaKindFromPath } from '@shared/media'
import { defineService } from '../../core/service'

declare module '@shared/api' {
  interface ApiMethods {
    /** Send a dropped file in chunks (IPC only). `done` on the last chunk returns the imported item. */
    /** Merge metadata (thumbnails, size, duration) into many media items with ONE write of the bin. */
    'media.updateMany': { req: { items: (Partial<MediaItem> & { id: string })[] }; res: void }
    'media.upload': { req: { uploadId: string; name: string; folder?: string; chunk: Uint8Array; done: boolean }; res: MediaItem | null }
  }
}

export default defineService({
  name: 'media',
  setup(ctx) {
    ctx.api.handle('media.updateMany', async ({ items }) => {
      const byId = new Map(items.map((i) => [i.id, i]))
      const list = ctx.library.listMedia().map((m) => (byId.has(m.id) ? { ...m, ...byId.get(m.id) } : m))
      await ctx.library.replaceMedia(list)
    })
    const open = new Map<string, { path: string; stream: WriteStream }>()
    ctx.api.handle('media.upload', async ({ uploadId, name, folder, chunk, done }) => {
      let up = open.get(uploadId)
      if (!up) {
        const clean = basename(name).replace(/[^\w.\- ()]/g, '_') || 'file'
        if (!mediaKindFromPath(clean)) throw new Error('Not a media file')
        const dir = join(ctx.workspace.mediaDir, folder ?? '')
        await fs.mkdir(dir, { recursive: true })
        let file = clean
        let n = 1
        while (await fs.stat(join(dir, file)).then(() => true, () => false)) file = `${basename(clean, extname(clean))}-${++n}${extname(clean)}`
        const path = join(dir, file)
        ctx.workspace.markOwnWrite(path)
        up = { path, stream: createWriteStream(path) }
        open.set(uploadId, up)
      }
      const s = up.stream
      await new Promise<void>((res, rej) => s.write(Buffer.from(chunk), (e) => (e ? rej(e) : res())))
      if (!done) return null
      open.delete(uploadId)
      await new Promise<void>((res) => s.end(res))
      const [item] = await ctx.library.importMedia([up.path], folder)
      return item ?? null
    }, 'local')
  }
})
