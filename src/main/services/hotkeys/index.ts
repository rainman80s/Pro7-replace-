/**
 * App keyboard shortcuts (workspace doc `hotkeys`). The keys themselves are caught in the operator
 * window (features/control/Hotkeys.tsx); this service only stores the bindings.
 */
import { defaultHotkeys, type HotkeysDoc } from '@shared/control'
import { defineService } from '../../core/service'
import { api } from '../../core/api'
import { DocStore } from '../macros/lib'

export const hotkeysDoc = new DocStore<HotkeysDoc>('hotkeys', defaultHotkeys, (d) => ({ clicker: true, slideHotKeys: true, ...d, bindings: d.bindings ?? [] }))

export default defineService({
  name: 'hotkeys',
  order: 45,
  async setup() {
    await hotkeysDoc.get()
    api.handle('hotkeys.get', () => hotkeysDoc.get(), 'control')
    api.handle('hotkeys.set', (patch) => hotkeysDoc.update((d) => { Object.assign(d, patch) }))
  }
})
