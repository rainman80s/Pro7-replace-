import { promptText, toast } from '@ui/index'
import { setLocked, useApp } from './store'

/**
 * Volunteer mode is a guard rail, not security: it stops accidents on a Sunday.
 * The PIN lives in this computer's local settings (`ui.volunteerPin`).
 */
export function lockForVolunteers(): void {
  setLocked(true)
  const s = useApp.getState()
  if (s.view !== 'show') s.setView('show')
  toast('Volunteer mode is on', 'info', 'Editing and settings are tucked away. Use the lock at the top right to switch back.')
}

/** Leave Volunteer mode, asking for the PIN when one is set. Resolves true if unlocked. */
export async function unlockForTechLead(): Promise<boolean> {
  const pin = useApp.getState().prefs.volunteerPin
  if (pin) {
    const entered = await promptText({
      title: 'Unlock full mode',
      message: 'Full mode shows editing, displays and settings. Enter the tech lead PIN to continue.',
      label: 'PIN', password: true, confirmLabel: 'Unlock',
      validate: (v) => (v === pin ? null : 'That PIN is not right.')
    })
    if (entered === null) return false
  }
  setLocked(false)
  return true
}

export function toggleLock(): void {
  if (useApp.getState().locked) void unlockForTechLead()
  else lockForVolunteers()
}
