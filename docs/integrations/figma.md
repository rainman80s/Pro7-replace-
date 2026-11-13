# Figma

Token: Figma → Settings → Security → **Personal access tokens** → scope *File content: read*. Paste a link to a page,
section or frame → **Find frames** → pick → **Import**. One page/section = one presentation; each top-level frame = one
image slide (reading order: rows then columns), frame name = slide label, frame text = operator notes. Rendered via
`GET /v1/images/:key?ids=…&format=png&scale=1|2`, downloaded into `media/figma/<fileKey>/`.
Link kept in `meta.source` (`type:'figma'`, fileKey, nodeId, version, per-frame content hash). **Re-sync from Figma**
re-renders only frames whose node subtree changed (moving a frame doesn't count); restyled slides are not overwritten
without asking. Smart mode: a frame named like a canvas ("Lobby") or region ("LED Top") becomes that screen's variant
of the slide before it. Rate limits: ≤2 req/s, 429/Retry-After honoured. Stretch (not done): converting text layers to
editable text elements (needs font mapping + auto-layout → absolute frames; `GET /v1/files/:key/nodes` has what's needed).
