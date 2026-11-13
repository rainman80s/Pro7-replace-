import type { ServerResponse } from 'node:http'
import type { ReadStream } from 'node:fs'

/**
 * Pipe a file to the response such that NO error can become an uncaught exception.
 * A bare `createReadStream().pipe(res)` has no 'error' handler on the file stream: when the read fails
 * (ETIMEDOUT/EIO from a cloud-synced or network-backed workspace whose files are not downloaded yet,
 * a disk that went away...) Node throws it as an uncaught exception. Also handles client aborts and
 * response socket errors (ECONNRESET/EPIPE) by closing the file handle.
 */
export function streamTo(res: ServerResponse, rs: ReadStream, file: string): void {
  const done = (): void => { if (!rs.destroyed) rs.destroy() }
  rs.on('error', (e) => {
    console.warn(`[server] read failed for ${file}: ${(e as NodeJS.ErrnoException).code ?? e.message}`)
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Read error')
    } else res.destroy()
  })
  res.on('error', done)
  res.on('close', done)
  rs.pipe(res)
}
