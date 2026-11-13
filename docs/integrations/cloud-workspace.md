# Cloud workspace ("Cloud Spaces")

The workspace is a plain folder (JSON + media, atomic writes, file watchers). Three ways to share it between the Reach
computers — all keep a **full local copy on every computer** so Sunday never depends on the internet.

## 1. Built-in sync (recommended; no third-party account)
* On the booth computer: Integrations → Cloud workspace → **Share this computer's workspace**. It shows its URL and PIN
  (the same PIN as the phone remote). For an always-on hub: run the app headless on any spare Mac/PC/NUC:
  `REACH_HEADLESS=1 REACH_SYNC_HOST=1 "Reach Presenter"`.
* On the other computers: **Join** (or *Find nearby*, Bonjour `_reach-sync._tcp`) with URL + PIN. The joining computer's
  old files are moved to `.history/before-join-…` (nothing deleted) and it downloads everything.
* Protocol (over the existing HTTP server, `/sync/*`, header `x-reach-pin`): `manifest` (path → sha256/size/mtime, ETag),
  `file` GET with Range (resumable chunked download), `file` PUT in 8 MB chunks with `offset` (resumable upload, verified
  hash, optimistic `base` check → 409 on conflict), `file` DELETE with `base`, `presence`.
* Engine: three-way merge per file against the last synced manifest. Only-remote → download; only-local → upload;
  both → **newest wins, the other version is saved in `.history/conflicts/` and reported**; an edit always beats a
  delete; deletions go to `.history` first. Offline: keeps working, retries with backoff, catches up.
* Presence: each computer reports its name, whether it is **on air**, and what is open in the editor; a warning appears
  when two computers edit the same presentation.

## 2. Cloud folder (iCloud Drive / Dropbox / Google Drive / OneDrive / Syncthing / NAS)
*Move workspace to a folder…* copies it and restarts. The app detects the provider, auto-resolves conflict copies
(`name (X's conflicted copy …)`, `name 2`, `name (1)`, `name-MACHINE`, `.sync-conflict-…`; JSON copies must have the
same `id`) by `updatedAt` (loser kept in `.history/conflicts`), skips `.tmp/.part` and dataless/online-only placeholder
files, and warns while files are still downloading. Tip: mark the folder "Always keep on this device".

## 3. S3-compatible bucket (Cloudflare R2 / Backblaze B2 / AWS) — designed, not implemented
Implement `Remote` (`src/main/services/sync/engine.ts`) with: `manifest.json` object (conditional PUT with `If-Match`
ETag for atomic updates), content-addressed blobs `blobs/<sha256>`, SigV4 via plain `fetch`, multipart upload for large
media. Credentials via `local.setSecret`. The engine, history and conflict handling are reused unchanged.

## Version history
Every presentation save is snapshotted to `.history/library/<id>.reach/` (coalesced to one per 2 min while editing,
60 kept), plus every version sync replaces or deletes. Integrations → Cloud workspace → **Version history** → Restore
(restoring snapshots the current version first, so it can be undone).
