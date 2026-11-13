/** Content-based format detection for single files (extensions lie: `.pro` is both ProPresenter 7 and ChordPro). */
import { extname } from 'node:path'
import type { ImportFormat } from '@shared/import'
import { isPresentationBytes } from '../pp7/proto'
import { isZip } from '../util/zip'

const head = (b: Uint8Array, n = 4096): string => new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, n)).replace(/^﻿/, '')

export function isChordPro(text: string): boolean {
  return /\{\s*(title|t|subtitle|st|artist|start_of_chorus|soc|start_of_verse|sov|comment|c|key|tempo|ccli)\s*[:}]/i.test(text) ||
    (/\[[A-G][#b]?(m|maj|min|sus|dim|aug|add)?\d*(\/[A-G][#b]?)?\]/.test(text) && /\{[a-z_]+/.test(text))
}

export function detectFormat(path: string, bytes: Uint8Array): ImportFormat {
  const ext = extname(path).toLowerCase()
  if (!bytes.length) return 'unknown'
  if (ext === '.reach') return 'reach'
  if (ext === '.reachbundle') return 'reach-bundle'
  if (isZip(bytes)) {
    if (ext === '.probundle') return 'pp7-bundle'
    if (ext === '.proplaylist') return 'pp7-playlist'
    if (ext === '.pptx' || ext === '.potx' || ext === '.ppsx') return 'pptx'
    if (ext === '.pro6plx') return 'pp6-playlist'
    if (ext === '.pro6x') return 'pp6-bundle'
    if (ext === '.reachbundle') return 'reach-bundle'
    const txt = new TextDecoder('latin1').decode(bytes.subarray(0, 2048))
    if (txt.includes('ppt/')) return 'pptx'
    if (txt.includes('manifest.json')) return 'reach-bundle'
    if (txt.includes('.pro')) return ext === '.zip' ? 'pp7-bundle' : 'pp7-bundle'
    return 'unknown'
  }
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf'
  const h = head(bytes)
  if (/^\s*<\?xml|^\s*</.test(h)) {
    if (/<RVPresentationDocument/i.test(h)) return 'pp6-presentation'
    if (/<RVPlaylistDocument|<RVPlaylistNode/i.test(h)) return 'pp6-playlist'
    if (/<song[\s>][^]*openlyrics|xmlns="http:\/\/openlyrics\.info/i.test(h)) return 'openlyrics'
    if (/<song[\s>]/i.test(h) && /<lyrics/i.test(h + head(bytes, 65536))) return 'opensong'
    return 'unknown'
  }
  if (/^\s*\{\\rtf/.test(h)) return 'rtf'
  if (/^\s*\{\s*"/.test(h) && ext === '.json') return 'reach'
  if (ext === '.usr' || /^\s*\[File\][\s\S]*Type=SongSelect/i.test(h) || /\[S A?\d+\]/.test(h) && /Words=/.test(h)) return 'songselect-usr'
  if (['.cho', '.chopro', '.chordpro', '.crd'].includes(ext)) return 'chordpro'
  if (ext === '.pro' || ext === '') {
    // ProPresenter 7 binary first; ChordPro text second.
    const binaryish = bytes.subarray(0, 512).some((c) => c < 9 || (c > 13 && c < 32))
    if (binaryish && isPresentationBytes(bytes)) return 'pp7-presentation'
    if (!binaryish && isChordPro(h)) return 'chordpro'
    if (isPresentationBytes(bytes)) return 'pp7-presentation'
    if (!binaryish && ext === '.pro') return 'text'
    return 'unknown'
  }
  if (['.pro6', '.pro5', '.pro4'].includes(ext)) return 'pp6-presentation'
  if (ext === '.txt' || ext === '.text' || ext === '.lyrics') {
    if (isChordPro(h)) return 'chordpro'
    if (/CCLI (Song|License)\s*#?\s*\d+/i.test(head(bytes, 65536))) return 'songselect-txt'
    return 'text'
  }
  if (/\.(png|jpe?g|gif|webp|bmp|heic|avif|tiff?)$/i.test(ext)) return 'image'
  if (/\.(mp4|mov|m4v|webm|mkv|mp3|wav|m4a|aac|flac|ogg)$/i.test(ext)) return 'media'
  return 'unknown'
}
