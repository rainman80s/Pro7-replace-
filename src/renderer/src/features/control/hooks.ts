import { useCallback, useEffect, useState } from 'react'
import type { ActionTypeInfo } from '@shared/control'
import type { MethodName, Res } from '@shared/api'
import { api } from '../../app/store'

/**
 * Load an RPC result and reload it when the given workspace doc changes (other computer, cloud sync, another panel).
 */
export function useRpc<K extends MethodName>(method: K, docName?: string | string[], extraEvent?: string): [Res<K> | null, () => void] {
  const [data, setData] = useState<Res<K> | null>(null)
  const load = useCallback(() => {
    void (api.invoke as (m: string) => Promise<Res<K>>)(method).then(setData).catch(() => {})
  }, [method])
  useEffect(() => {
    load()
    const names = Array.isArray(docName) ? docName : docName ? [docName] : []
    const offs = [api.on('workspace.docChanged', ({ name }) => { if (names.includes(name)) load() })]
    if (extraEvent) offs.push((api.on as (e: string, cb: () => void) => () => void)(extraEvent, load))
    return () => offs.forEach((o) => o())
  }, [load, docName, extraEvent])
  return [data, load]
}

let typesCache: Promise<ActionTypeInfo[]> | null = null
export function useActionTypes(): ActionTypeInfo[] {
  const [types, setTypes] = useState<ActionTypeInfo[]>([])
  useEffect(() => {
    typesCache ??= api.invoke('actions.types').catch(() => { typesCache = null; return [] })
    void typesCache.then(setTypes)
  }, [])
  return types
}

/** Run an RPC and show the error as a toast instead of throwing. */
export async function attempt<T>(p: Promise<T>, toastFn: (title: string, level: 'error', detail?: string) => void): Promise<T | undefined> {
  try { return await p } catch (e) { toastFn('That didn’t work', 'error', e instanceof Error ? e.message : String(e)); return undefined }
}
