import type { ComponentType, ReactNode } from 'react'

export interface FeatureView {
  id: string
  title: string
  /** Small inline SVG/emoji-free icon node. */
  icon?: ReactNode
  /** Sort order in the nav rail. Show=10, Edit=20, Media=30, Bible=40, ... Settings last. */
  order: number
  component: ComponentType
  /** Keyboard shortcut hint, e.g. "⌘1". */
  shortcut?: string
}

export interface SettingsSection {
  id: string
  title: string
  order: number
  component: ComponentType
}

export interface Feature {
  id: string
  /** Top-level screens in the nav rail. */
  views?: FeatureView[]
  /** Sections inside the Settings screen. */
  settings?: SettingsSection[]
  /** Panels docked on the right side of the Show screen (timers, messages, props, stage...). */
  showPanels?: { id: string; title: string; order: number; component: ComponentType }[]
  /** Buttons/menus added to the top bar. */
  toolbar?: { id: string; order: number; component: ComponentType }[]
  /** Always-mounted invisible components (hotkeys, audio host, background sync...). */
  background?: ComponentType[]
}

/**
 * A renderer feature module. Put it in src/renderer/src/features/<name>/index.tsx and
 * default-export defineFeature({...}); it is discovered automatically.
 */
export const defineFeature = (f: Feature): Feature => f
