/** Auto-discovers every feature in src/renderer/src/features/<name>/index.tsx. */
import type { ComponentType } from 'react'
import type { Feature, FeatureView, QuickCommand, QuickSearchProvider, SettingsSection } from './feature'

const mods = import.meta.glob<{ default: Feature }>('../features/*/index.tsx', { eager: true })
export const features: Feature[] = Object.values(mods).map((m) => m.default).filter(Boolean)
export const allViews = (): FeatureView[] => features.flatMap((f) => f.views ?? []).sort((a, b) => a.order - b.order)
export const allSettings = (): SettingsSection[] => features.flatMap((f) => f.settings ?? []).sort((a, b) => a.order - b.order)
export const allShowPanels = () => features.flatMap((f) => f.showPanels ?? []).sort((a, b) => a.order - b.order)
export const allToolbar = () => features.flatMap((f) => f.toolbar ?? []).sort((a, b) => a.order - b.order)
export const allBackground = (): ComponentType[] => features.flatMap((f) => f.background ?? [])
export const allStatusItems = () => features.flatMap((f) => f.statusItems ?? []).sort((a, b) => a.order - b.order)
export const allCommands = (): QuickCommand[] => features.flatMap((f) => (typeof f.commands === 'function' ? f.commands() : f.commands ?? []))
export const allSearchProviders = (): QuickSearchProvider[] => features.flatMap((f) => f.searchProviders ?? [])
export const allShortcuts = () => features.flatMap((f) => f.shortcuts ?? [])
