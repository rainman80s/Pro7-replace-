/**
 * Editing slides straight from the Show screen (backgrounds, actions) without opening the editor.
 * Every change is saved with library.save and can be undone from the toast.
 */
import type { Fill, ID, MediaRef, Presentation, Slide, SlideAction } from '@shared/model'
import { uid } from '@shared/control'
import { toast } from '@ui/index'
import { api, useApp } from '../../app/store'

/** Apply `fn` to the chosen slides, save, and offer Undo (restores the whole previous slide list). */
export async function editSlides(presentationId: ID, slideIds: ID[], fn: (s: Slide) => Slide, message: string, detail?: string): Promise<boolean> {
  const app = useApp.getState()
  const before: Presentation | null = await app.loadPresentation(presentationId)
  if (!before || !slideIds.length) return false
  const ids = new Set(slideIds)
  const save = async (slides: Slide[]): Promise<Presentation | null> => {
    const fresh = (await useApp.getState().loadPresentation(presentationId, true)) ?? before
    const saved = await api.invoke('library.save', { presentation: { ...fresh, slides } })
    useApp.setState((s) => ({ presentations: { ...s.presentations, [presentationId]: saved } }))
    return saved
  }
  try {
    await save(before.slides.map((s) => (ids.has(s.id) ? fn(s) : s)))
  } catch (e) {
    toast("Couldn't save the change", 'error', e instanceof Error ? e.message : String(e))
    return false
  }
  const old = new Map(before.slides.filter((s) => ids.has(s.id)).map((s) => [s.id, s]))
  toast(message, 'success', detail, {
    label: 'Undo',
    onClick: () => {
      void useApp.getState().loadPresentation(presentationId, true).then((cur) => cur && save(cur.slides.map((s) => old.get(s.id) ?? s)))
    }
  })
  return true
}

export const mediaBackground = (media: MediaRef): Fill => ({ type: 'media', media: toRef(media), fit: 'cover' })

export const setBackground = (presentationId: ID, slideIds: ID[], media: MediaRef | undefined, scope: string): Promise<boolean> =>
  editSlides(presentationId, slideIds, (s) => ({ ...s, background: media ? mediaBackground(media) : undefined }),
    media ? `Background set on ${scope}` : `Background cleared on ${scope}`, media?.name)

export const addMacroAction = (presentationId: ID, slideIds: ID[], macroId: string, macroName: string, scope: string, detail?: string): Promise<boolean> =>
  editSlides(presentationId, slideIds, (s) => ({ ...s, actions: [...(s.actions ?? []), { id: uid('a'), type: 'macro.run', label: macroName, params: { id: macroId } } as SlideAction] }),
    `Macro "${macroName}" added to ${scope}`, detail)

/** MediaItem → the plain MediaRef stored on a slide (no thumbnail data). */
export const toRef = (m: MediaRef): MediaRef => {
  const r: MediaRef = { id: m.id, kind: m.kind, src: m.src, name: m.name, width: m.width, height: m.height, duration: m.duration }
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) as unknown as MediaRef
}
