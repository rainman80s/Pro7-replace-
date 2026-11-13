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
  /**
   * Show this screen in Volunteer mode too. Default false: a volunteer only sees Show
   * (plus anything that opts in, e.g. Bible). Screens that edit or configure should stay hidden.
   */
  volunteer?: boolean
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
  /**
   * Small health indicators in the status strip along the bottom of the window
   * ("2 screens connected", "Synced 2 min ago", "MIDI: none"). Render a <StatusItem> from app/status.
   * Keep them quiet when healthy; only use the warn/danger tone when the operator must act.
   */
  statusItems?: { id: string; order: number; component: ComponentType }[]
  /** Actions offered in quick search (⌘K), e.g. "Start 5 minute countdown", "Import from ProPresenter…". */
  commands?: QuickCommand[] | (() => QuickCommand[])
  /** Extra result sources for quick search (⌘K) — Bible references, media, Planning Center songs… */
  searchProviders?: QuickSearchProvider[]
  /** Rows added to the keyboard shortcuts overlay (?), so every feature's keys are listed in one place. */
  shortcuts?: { group: string; keys: string; label: string }[]
}

export interface QuickCommand {
  id: string
  title: string
  /** Extra words to match on. */
  keywords?: string
  /** Icon name from the UI kit icon set. */
  icon?: string
  /** Hidden in Volunteer mode (anything that edits, deletes or configures). */
  adminOnly?: boolean
  run: () => void | Promise<void>
}

export interface QuickSearchResult {
  id: string
  title: string
  subtitle?: string
  icon?: string
  /** First action runs on Enter, second on ⌘/Ctrl+Enter. Label them like a volunteer would: "Show now", "Add to service". */
  actions: { label: string; run: () => void | Promise<void> }[]
}

export interface QuickSearchProvider {
  id: string
  /** Section heading in the results, e.g. "Bible". */
  title: string
  search: (query: string) => QuickSearchResult[] | Promise<QuickSearchResult[]>
}

/**
 * A renderer feature module. Put it in src/renderer/src/features/<name>/index.tsx and
 * default-export defineFeature({...}); it is discovered automatically.
 */
export const defineFeature = (f: Feature): Feature => f
