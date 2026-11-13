import { createServer } from 'node:http'
import { createReadStream, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { describe, expect, it } from 'vitest'
import { streamTo } from '../src/main/core/stream-file'

const file = join(mkdtempSync(join(tmpdir(), 'reach-stream-')), 'big.bin')
writeFileSync(file, Buffer.alloc(8 * 1024 * 1024, 1))

const uncaught: unknown[] = []
process.on('uncaughtException', (e) => uncaught.push(e))

function serve(onStream: (rs: ReturnType<typeof createReadStream>) => void): Promise<{ port: number; close: () => void }> {
  return new Promise((ok) => {
    const srv = createServer((_req, res) => {
      const rs = createReadStream(file)
      onStream(rs)
      res.writeHead(200, { 'content-length': 8 * 1024 * 1024 })
      streamTo(res, rs, file)
    }).listen(0, () => ok({ port: (srv.address() as { port: number }).port, close: () => srv.close() }))
  })
}

describe('streamTo', () => {
  it('turns a read ETIMEDOUT into a closed response, not an uncaught exception', async () => {
    const s = await serve((rs) => rs.once('data', () => rs.destroy(Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' }))))
    const outcome = await new Promise<string>((ok) => {
      request({ port: s.port }, (r) => { r.on('error', () => ok('aborted')); r.on('close', () => ok('closed')); r.resume() }).on('error', () => ok('error')).end()
    })
    expect(['aborted', 'closed', 'error']).toContain(outcome)
    await new Promise((r) => setTimeout(r, 50))
    expect(uncaught).toEqual([])
    s.close()
  })
  it('closes the file when the client aborts', async () => {
    let stream: ReturnType<typeof createReadStream> | undefined
    const s = await serve((rs) => { stream = rs })
    await new Promise<void>((ok) => {
      const req = request({ port: s.port }, (r) => { r.once('data', () => { req.destroy(); ok() }) })
      req.on('error', () => undefined)
      req.end()
    })
    await new Promise((r) => setTimeout(r, 100))
    expect(stream?.destroyed).toBe(true)
    expect(uncaught).toEqual([])
    s.close()
  })
})
