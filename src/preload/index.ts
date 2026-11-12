import { contextBridge, ipcRenderer } from 'electron'

const listeners = new Set<(event: string, payload: unknown) => void>()
ipcRenderer.on('reach:event', (_e, event: string, payload: unknown) => {
  for (const l of listeners) l(event, payload)
})

contextBridge.exposeInMainWorld('reachBridge', {
  invoke: (method: string, payload: unknown) => ipcRenderer.invoke('reach:invoke', method, payload),
  on: (cb: (event: string, payload: unknown) => void) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  /** Base URL of the built-in server on this machine — media is loaded from here. */
  mediaBase: ipcRenderer.sendSync('reach:mediaBase') as string,
  platform: process.platform
})
