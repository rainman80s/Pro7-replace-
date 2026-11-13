/**
 * Import / export — shared types and the RPC contract (declaration-merged into @shared/api).
 * Pure types: safe to import from the renderer, main process, CLI and tests.
 */
import type { ID } from './model'

/** What a file turned out to be. */
export type ImportFormat =
  | 'pp7-presentation' | 'pp7-bundle' | 'pp7-playlist' | 'pp7-playlist-doc' | 'pp7-config' | 'pp7-theme'
  | 'pp6-presentation' | 'pp6-playlist' | 'pp6-bundle'
  | 'reach' | 'reach-bundle'
  | 'chordpro' | 'openlyrics' | 'opensong' | 'songselect-usr' | 'songselect-txt' | 'text' | 'rtf'
  | 'pptx' | 'pdf' | 'image' | 'image-folder' | 'media'
  | 'unknown'

/** ProPresenter workspace generation, as detected from the folder layout. */
export type PPGeneration =
  | 'pp7-files'     // ProPresenter 7.x – 21: Libraries/**.pro + Configuration/* + Playlists/* (importable)
  | 'pp22-database' // ProPresenter 22+: presentations/playlists inside a database (not loose files) — export first
  | 'pp6'           // ProPresenter 6 (.pro6 documents)
  | 'mixed'         // loose .pro files AND database files
  | 'unknown'

export interface CensusEntry { ext: string; count: number; bytes: number; examples: string[] }

export interface ImportScanItem {
  /** Absolute path of the file (or of the folder for config docs). */
  path: string
  /** Path relative to the scanned root, for display. */
  rel: string
  format: ImportFormat
  /** Library / folder it belongs to ("Default", "Hymns"…). */
  group?: string
  size: number
  /** Short title when cheap to know (file name). */
  title?: string
}

export interface ImportScan {
  root: string
  generation: PPGeneration
  /** Human explanation of what was found, and (for v22) what to do. */
  advice: string[]
  /** One line per detected workspace (v20+ can have several under LocalWorkspaces). */
  workspaces: { path: string; name: string; generation: PPGeneration }[]
  counts: {
    presentations: number
    playlists: number
    media: number
    themes: number
    configs: number
    legacy: number
    other: number
  }
  libraries: { name: string; count: number }[]
  items: ImportScanItem[]
  /** File-type census of the whole tree (extension → count/bytes). */
  census: CensusEntry[]
  /** Files that look like databases (v22) — reported, not imported. */
  databases: { path: string; kind: string; size: number; detail?: string }[]
  mediaRoots: string[]
  scannedFiles: number
  truncated: boolean
  durationMs: number
}

export type ImportCategory = 'presentations' | 'playlists' | 'media' | 'themes' | 'macros' | 'props' | 'stageLayouts' | 'timers' | 'messages' | 'canvases' | 'devices' | 'groups' | 'labels'

export interface ImportOptions {
  /** Which categories to import (default: all). */
  include?: Partial<Record<ImportCategory, boolean>>
  /** Only these library names (default: all). */
  libraries?: string[]
  /** Copy referenced media into the workspace (default true). */
  copyMedia?: boolean
  /** Extra folders searched for missing media by file name. */
  mediaSearchPaths?: string[]
  /** What to do when an already-imported presentation was edited in Reach since: skip (default), overwrite or keep both. */
  onConflict?: 'skip' | 'overwrite' | 'duplicate'
  /** Library name → Reach category (default: the library name). */
  categoryFromLibrary?: boolean
  /** Dry run: convert everything and report, write nothing. */
  dryRun?: boolean
}

export type FileStatus = 'imported' | 'updated' | 'unchanged' | 'skipped' | 'failed' | 'partial'

export interface FileReport {
  path: string
  rel?: string
  format: ImportFormat
  status: FileStatus
  title?: string
  presentationId?: ID
  /** e.g. slides/groups/arrangements counts. */
  stats?: Record<string, number | string>
  warnings: string[]
  /** ProPresenter features seen that Reach can't represent (yet), with counts. */
  unmapped?: Record<string, number>
  /** Protobuf fields our schema doesn't know (newer ProPresenter). */
  unknownFields?: Record<string, number>
  missingMedia?: string[]
  error?: string
  ms?: number
}

export interface SuggestedCanvas {
  name: string
  kind: 'audience' | 'stage'
  width: number
  height: number
  regions: { name: string; rect: { x: number; y: number; w: number; h: number } }[]
  /** From which ProPresenter screen. */
  from: string
  devices: string[]
  exists?: boolean
  /** Reach suggests this one first (e.g. a stacked LED wall combining two outputs of one SDI card). */
  recommended?: boolean
  /** Why it is suggested, in plain words. */
  note?: string
}

export interface ImportReport {
  id: ID
  root: string
  generation?: PPGeneration
  startedAt: string
  finishedAt?: string
  dryRun?: boolean
  totals: Record<FileStatus, number>
  files: FileReport[]
  media: { copied: number; linked: number; missing: string[]; bytes: number }
  docs: Record<string, { added: number; updated: number; skipped: number }>
  playlists: { name: string; items: number; unresolved: string[] }[]
  suggestedCanvases: SuggestedCanvas[]
  /** Aggregate of all files' unmapped features (feature → count). */
  unmapped: Record<string, number>
  unknownFields: Record<string, number>
  notes: string[]
  cancelled?: boolean
}

export interface ImportProgress {
  jobId: ID
  phase: 'scan' | 'presentations' | 'media' | 'playlists' | 'config' | 'finish'
  done: number
  total: number
  current?: string
  /** Running totals. */
  totals?: Partial<Record<FileStatus, number>>
}

export interface ExportRequest {
  presentationIds?: ID[]
  playlistIds?: ID[]
  format: 'reachbundle' | 'reach' | 'text' | 'lyrics-plain' | 'json' | 'csv' | 'pro' | 'openlyrics' | 'chordpro-less'
  path: string
  includeMedia?: boolean
  includeThemes?: boolean
}

export interface FileImportResult {
  reports: FileReport[]
  presentationIds: ID[]
  playlistIds: ID[]
}

declare module './api' {
  interface ApiMethods {
    /** Default ProPresenter folders on this computer that exist. */
    'import.guessFolders': { req: void; res: { path: string; label: string; exists: boolean }[] }
    /** Dry-run scan of a ProPresenter folder (no writes). */
    'import.scan': { req: { root: string }; res: ImportScan }
    /** Start a whole-library migration in the background; progress via 'import.progress', result via 'import.done'. */
    'import.start': { req: { root: string; options?: ImportOptions }; res: { jobId: ID } }
    'import.cancel': { req: { jobId: ID }; res: void }
    /** Import individual files (drag and drop / File > Import): .pro, .probundle, .proplaylist, .pro6, .reach, .reachbundle, lyrics, PDF, images… */
    'import.files': { req: { paths: string[]; options?: ImportOptions & { playlistId?: ID; asImages?: boolean } }; res: FileImportResult }
    /** Pasted / typed lyrics → presentation. */
    /** File bytes from the renderer (drag & drop): written to a temp file and imported like import.files. */
    'import.data': { req: { name: string; base64: string }; res: FileImportResult }
    'import.text': { req: { title: string; text: string; meta?: Record<string, unknown> }; res: { id: ID } }
    /** Saved reports (newest first). */
    'import.reports': { req: void; res: { id: ID; root: string; startedAt: string; totals: ImportReport['totals'] }[] }
    'import.report': { req: { id: ID }; res: ImportReport | null }
    /** Create the suggested canvases from a report (never overwrites existing ones). */
    'import.createCanvases': { req: { reportId: ID; names: string[] }; res: { created: string[] } }
    /** Exports. */
    'export.run': { req: ExportRequest; res: { path: string; bytes: number; warnings: string[] } }
    'export.reportText': { req: { id: ID; path: string }; res: void }
  }
  interface ApiEvents {
    'import.progress': ImportProgress
    /** A file opened from Finder / the command line was imported. */
    'import.opened': FileImportResult
    'import.done': { jobId: ID; reportId: ID; totals: ImportReport['totals']; cancelled?: boolean; error?: string }
  }
}
