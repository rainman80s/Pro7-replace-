import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'

/**
 * Machine-local settings (NOT synced): display assignments, window state,
 * workspace location, integration credentials (encrypted with the OS keychain).
 */
class LocalStore {
  private data: Record<string, unknown> = {}
  private path = ''

  init(): void {
    this.path = join(app.getPath('userData'), 'local.json')
    try {
      this.data = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch {
      this.data = {}
    }
  }

  get<T>(key: string, fallback: T): T {
    return (key in this.data ? this.data[key] : fallback) as T
  }

  set(key: string, value: unknown): void {
    if (value === undefined) delete this.data[key]
    else this.data[key] = value
    mkdirSync(app.getPath('userData'), { recursive: true })
    const tmp = this.path + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    renameSync(tmp, this.path)
  }

  /** Secrets (API tokens) — encrypted at rest via the OS keychain when available. */
  getSecret(key: string): string | null {
    const v = this.get<string | null>(`secret:${key}`, null)
    if (!v) return null
    try {
      if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'))
      return v.startsWith('raw:') ? v.slice(4) : null
    } catch {
      return null
    }
  }

  setSecret(key: string, value: string | null): void {
    if (!value) return this.set(`secret:${key}`, undefined)
    const enc = safeStorage.isEncryptionAvailable()
      ? 'enc:' + safeStorage.encryptString(value).toString('base64')
      : 'raw:' + value
    this.set(`secret:${key}`, enc)
  }
}

export const local = new LocalStore()
