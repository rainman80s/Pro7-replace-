import type { MediaRef } from './model'

/**
 * Turn a MediaRef.src into a URL the current page can load.
 * Media is always served by the app's built-in HTTP server (/media route).
 */
export function mediaUrl(ref: Pick<MediaRef, 'src'> | string | undefined | null): string {
  if (!ref) return ''
  const src = typeof ref === 'string' ? ref : ref.src
  if (!src) return ''
  if (/^(https?|data|blob):/i.test(src)) return src
  // Inside the desktop app media comes from the built-in server on localhost (range requests work for video);
  // in a browser it comes from the same origin that served the page.
  const base = ((typeof window !== 'undefined' && window.reachBridge?.mediaBase) || '') + '/media'
  if (src.startsWith('workspace:')) return `${base}/w/${src.slice('workspace:'.length).split('/').map(encodeURIComponent).join('/')}`
  const abs = src.startsWith('file://') ? decodeURIComponent(src.slice('file://'.length)) : src.startsWith('file:') ? src.slice(5) : src
  return `${base}/f/${encodeURIComponent(abs)}`
}

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'heic', 'tif', 'tiff']
const VIDEO = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'mpg', 'mpeg', 'ogv']
const AUDIO = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'aif', 'aiff', 'opus']

export function mediaKindFromPath(p: string): MediaRef['kind'] | null {
  const ext = p.split('?')[0].split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE.includes(ext)) return 'image'
  if (VIDEO.includes(ext)) return 'video'
  if (AUDIO.includes(ext)) return 'audio'
  return null
}
export const MEDIA_EXTENSIONS = { IMAGE, VIDEO, AUDIO }
