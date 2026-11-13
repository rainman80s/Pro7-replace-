/**
 * Shared types for the exterior integrations (Planning Center, Notion, Figma, cloud workspace).
 * Pure types + tiny helpers — safe to import from main, renderer and tests.
 */
import type { ID, Playlist } from './model'

/* ───────────── Integration hub ───────────── */

export type IntegrationId = 'pco' | 'notion' | 'bible' | 'cloud' | 'figma' | 'obs' | 'slack'

export interface IntegrationStatus {
  id: IntegrationId
  connected: boolean
  /** Who/what we're connected as ("Reach Church"). */
  account?: string
  lastSync?: string
  error?: string
  detail?: string
}

/* ───────────── Planning Center (normalised) ───────────── */

export interface PcoServiceType { id: string; name: string; sequence: number }

export interface PcoTime { id: string; type: 'service' | 'rehearsal' | 'other'; name?: string; startsAt: string; endsAt?: string }

export interface PcoPlanSummary {
  id: string
  serviceTypeId: string
  title?: string
  seriesTitle?: string
  dates: string
  sortDate: string
  updatedAt?: string
  itemsCount?: number
  url?: string
  times: PcoTime[]
}

export interface PcoSong { id: string; title: string; author?: string; ccli?: string; copyright?: string }
export interface PcoArrangement { id: string; name?: string; bpm?: number; meter?: string; length?: number; sequence?: string[] }

export interface PcoItem {
  id: string
  sequence: number
  type: 'header' | 'song' | 'item' | 'media'
  title: string
  length: number
  description?: string
  /** html_details stripped to plain text. */
  details?: string
  servicePosition?: 'pre' | 'during' | 'post'
  keyName?: string
  notes: { category: string; content: string }[]
  song?: PcoSong
  arrangement?: PcoArrangement
  /** Item-level override of the arrangement's sequence. */
  customSequence?: string[]
}

export interface PcoPerson { name: string; position: string; team: string; status: 'confirmed' | 'unconfirmed' | 'declined' }

export interface PcoPlan extends PcoPlanSummary {
  items: PcoItem[]
  people: PcoPerson[]
}

export type PcoItemKind = 'header' | 'song' | 'sermon' | 'announcements' | 'media' | 'scripture' | 'generic'

/** The Planning-Center-derived values we last wrote into an item — the "base" of the three-way merge. */
export interface ItemBase {
  title: string
  length?: number
  notes?: string
  people?: string[]
  /** `${songId}:${arrangementId}` for songs. */
  songKey?: string
}

export interface ItemOrigin {
  pcoItemId: string
  kind: PcoItemKind
  base: ItemBase
  songId?: string
  arrangementId?: string
  ccli?: string
  key?: string
  position?: 'pre' | 'during' | 'post'
}

/** What we store in `playlist.source` for a plan pulled from Planning Center. */
export interface PcoPlaylistSource {
  type: 'pco'
  ref: string
  serviceTypeId: string
  syncedAt: string
  planUpdatedAt?: string
  title?: string
  seriesTitle?: string
  url?: string
  times: PcoTime[]
  /** Plan-level roles: "Speaker" → ["Sam"]. */
  roles: Record<string, string[]>
  /** PlaylistItem.id → where it came from. Entries whose item no longer exists = removed locally on purpose. */
  origins: Record<ID, ItemOrigin>
  /** Planning Center item order at the last sync. */
  baseOrder: string[]
  [k: string]: unknown
}

export interface PlanChange {
  id: string
  type: 'added' | 'removed' | 'updated' | 'moved' | 'conflict' | 'song'
  title: string
  detail: string
  /** What happens if the operator just clicks "Accept". Conflicts default to keeping the local edit. */
  default: 'accept' | 'reject'
}

export interface SongMatch {
  pcoItemId: string
  song: PcoSong
  arrangement?: PcoArrangement
  /** Library presentation we matched, if any. */
  presentationId?: ID
  presentationTitle?: string
  confidence?: 'linked' | 'ccli' | 'title' | 'fuzzy'
  /** Other close candidates for the picker. */
  candidates: { id: ID; title: string; score: number }[]
}

export type SongDecision = { action: 'use'; presentationId: ID } | { action: 'import' } | { action: 'placeholder' }

export interface PlanPullPreview {
  plan: PcoPlanSummary
  playlistId?: ID
  playlistExists: boolean
  changes: PlanChange[]
  songs: SongMatch[]
  itemCount: number
  /** Order of service as it will be pulled. */
  items: { id: string; title: string; kind: PcoItemKind; length?: number; people?: string[]; key?: string; position?: string }[]
  roles: Record<string, string[]>
  timerSuggestions: { id: string; name: string; target: string; exists: boolean }[]
}

export interface PcoSettings {
  serviceTypeId?: string
  /** Minutes between automatic re-checks of pulled plans (0 = off). */
  autoRefreshMinutes: number
  includePrePost: boolean
  personNoteCategories: string[]
  /** PCO song id → presentation id (remembered matches). */
  songLinks: Record<string, ID>
  /** Follow the operator in PCO Services Live (advances the Live session). Off by default — it WRITES to Planning Center. */
  liveFollow: boolean
}

export const defaultPcoSettings = (): PcoSettings => ({
  autoRefreshMinutes: 15,
  includePrePost: true,
  personNoteCategories: ['Person', 'People', 'Leader', 'Speaker', 'Who'],
  songLinks: {},
  liveFollow: false
})

export function pcoSource(p: Playlist | null | undefined): PcoPlaylistSource | null {
  return p?.source?.type === 'pco' ? (p.source as unknown as PcoPlaylistSource) : null
}

/* ───────────── Notion ───────────── */

export interface NotionDbInfo {
  id: string
  title: string
  url?: string
  properties: { name: string; type: string; options?: string[] }[]
}

export interface NotionMapping {
  databaseId: string
  title?: string
  date?: string
  speaker?: string
  status?: string
  series?: string
  /** Optional multi-select/select filter: property must contain this option. */
  filterProp?: string
  filterValue?: string
  /** Only pages whose title contains this ("Sunday Highlights" pages in a general comms database). */
  titleContains?: string
  /** Skip pages in these statuses ("Scrapped/Missed"). */
  excludeStatus?: string[]
}

export interface NotionSettings {
  sermons?: NotionMapping
  announcements?: NotionMapping
  /** Translation assumed for scripture references without one. Reach's convention: CSB. */
  defaultTranslation: string
  /** Offline/API translation actually used to auto-fill references that have no pasted text. */
  fillTranslation: string
  slideMode: 'auto' | 'dividers' | 'headings'
  scriptureMaxChars: number
  emphasis: 'underline' | 'bold'
  announcementSeconds: number
  themeId?: string
  /** Read Notion comments as operator notes (needs the "Read comments" capability). */
  readComments: boolean
}

export const defaultNotionSettings = (): NotionSettings => ({
  defaultTranslation: 'CSB', fillTranslation: 'BSB', slideMode: 'auto', scriptureMaxChars: 340,
  emphasis: 'underline', announcementSeconds: 10, readComments: true
})

export interface NotionPageSummary {
  id: string
  title: string
  date?: string
  speaker?: string[]
  status?: string
  series?: string
  url?: string
  lastEdited?: string
}

/** One generated slide in an import preview. */
export interface SlideDraft {
  key: string
  srcHash: string
  kind: 'title' | 'point' | 'points' | 'scripture' | 'quote' | 'image' | 'text' | 'announcement'
  label: string
  text: string
  notes?: string
  warnings?: string[]
}

export interface DocSlideChange {
  key: string
  type: 'added' | 'removed' | 'changed' | 'conflict' | 'same'
  label: string
  /** For conflicts: the operator restyled/edited this slide locally. */
  detail?: string
  slideId?: ID
}

/* ───────────── Figma ───────────── */

export interface FigmaFrame { id: string; name: string; width: number; height: number; page: string; section?: string; hash?: string }
export interface FigmaFileInfo { key: string; name: string; version: string; lastModified: string; frames: FigmaFrame[]; pages: { id: string; name: string }[] }

/* ───────────── Cloud workspace ───────────── */

export interface SyncConflict {
  id: string
  path: string
  at: string
  /** Where the losing version was kept. */
  backup: string
  winner: 'local' | 'remote' | 'copy' | 'original'
  reason: string
  resolved?: boolean
}

export interface SyncPeer { id: string; name: string; onAir: boolean; editing: string[]; lastSeen: number; version?: string; host?: boolean }

export interface CloudStatus {
  mode: 'local' | 'folder' | 'host' | 'replica' | 's3'
  workspacePath: string
  /** Detected folder-sync provider for the workspace path. */
  provider?: 'icloud' | 'dropbox' | 'gdrive' | 'onedrive' | 'syncthing' | 'network' | null
  health: 'ok' | 'syncing' | 'warning' | 'offline' | 'error'
  message: string
  lastSync?: string
  pending: number
  conflicts: SyncConflict[]
  placeholders: string[]
  peers: SyncPeer[]
  hostUrl?: string
  machineName: string
  machineId: string
  progress?: { file: string; done: number; total: number }
}

export interface HistoryEntry { id: string; at: string; size: number; title?: string; slideCount?: number; reason?: string }
