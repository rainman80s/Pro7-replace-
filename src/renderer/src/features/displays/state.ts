/** Displays feature state: receivers, health, discovery, safe mode, audio route — mirrored from main via events. */
import { create } from 'zustand'
import type { ReceiverInfo } from '@shared/api'
import type { Canvas, ID, Output } from '@shared/model'
import type { AudioRoute, DiscoveryState, NdiStatus, OutputHealth } from '@shared/outputs'
import type { DeckLinkDevice, DeckLinkStatus } from '@shared/decklink'
import { api, useApp } from '../../app/store'

interface DisplaysState {
  receivers: ReceiverInfo[]
  health: OutputHealth[]
  discovery: DiscoveryState | null
  safeMode: { on: boolean; shortcut: string }
  audio: AudioRoute
  ndi: NdiStatus | null
  decklink: DeckLinkStatus | null
  /** DeckLink SDI ports on this computer (connected + remembered). */
  ports: DeckLinkDevice[]
  /** UI selection. */
  selectedOutputId: ID | null
  selectedCanvasId: ID | null
  select(p: Partial<Pick<DisplaysState, 'selectedOutputId' | 'selectedCanvasId'>>): void
}

export const useDisplays = create<DisplaysState>((set) => ({
  receivers: [],
  health: [],
  discovery: null,
  safeMode: { on: false, shortcut: '' },
  audio: { device: 'operator' },
  ndi: null,
  decklink: null,
  ports: [],
  selectedOutputId: null,
  selectedCanvasId: null,
  select: (p) => set(p)
}))

let started = false
export function startDisplaysSync(): void {
  if (started) return
  started = true
  const set = useDisplays.setState
  const safe = <T,>(p: Promise<T>, then: (v: T) => void): void => void p.then(then).catch(() => {})
  api.on('outputs.receiversChanged', (receivers) => set({ receivers }))
  api.on('outputs.healthChanged', (health) => set({ health }))
  api.on('discovery.changed', (discovery) => set({ discovery }))
  api.on('outputs.safeModeChanged', ({ on }) => set((s) => ({ safeMode: { ...s.safeMode, on } })))
  api.on('outputs.audioRouteChanged', (audio) => set({ audio }))
  api.on('outputs.changed', () => safe(api.invoke('outputs.health'), (health) => set({ health })))
  safe(api.invoke('receivers.list'), (receivers) => set({ receivers }))
  safe(api.invoke('outputs.health'), (health) => set({ health }))
  safe(api.invoke('discovery.scan'), (discovery) => set({ discovery }))
  safe(api.invoke('outputs.safeMode'), (safeMode) => set({ safeMode }))
  safe(api.invoke('outputs.audioRoute'), (audio) => set({ audio }))
  safe(api.invoke('outputs.ndiStatus'), (ndi) => set({ ndi }))
  api.on('decklink.devicesChanged', (ports) => { set({ ports }); refreshDeckLinkStatus() })
  api.on('outputs.healthChanged', () => refreshDeckLinkStatus())
  safe(api.invoke('decklink.devices'), (ports) => set({ ports }))
  refreshDeckLinkStatus()
}

export function refreshDeckLinkStatus(): void {
  void api.invoke('decklink.status').then((decklink) => useDisplays.setState({ decklink })).catch(() => {})
}

/** Re-scan the DeckLink hardware ("Check again"). */
export function rescanDeckLink(): Promise<void> {
  return api.invoke('decklink.devices', { refresh: true }).then((ports) => { useDisplays.setState({ ports }); refreshDeckLinkStatus() }).catch(() => {})
}

/** Save the whole canvases list (synced workspace). */
export function saveCanvases(canvases: Canvas[]): Promise<unknown> {
  return api.invoke('workspace.update', { canvases })
}

export const saveOutput = (output: Output): Promise<Output[]> => api.invoke('outputs.save', { output })
export const removeOutput = (id: ID): Promise<Output[]> => api.invoke('outputs.remove', { id })

export function useCanvases(): Canvas[] {
  return useApp((s) => s.workspace?.canvases ?? [])
}

export const newLocalId = (): string => Math.random().toString(36).slice(2, 10)
