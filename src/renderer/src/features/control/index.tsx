import { defineFeature } from '../../app/feature'
import { AudioPanel } from './AudioPanel'
import { HotkeysHost, HotkeysSettings } from './Hotkeys'
import { MacrosPanel, MacrosSettings } from './Macros'
import { MessagesPanel } from './MessagesPanel'
import { MidiSettings } from './Midi'
import { PropsPanel } from './PropsPanel'
import { RemoteSettings } from './RemoteSettings'
import { TimersPanel } from './TimersPanel'
import './control.css'

export { ActionPicker } from './ActionPicker'

export default defineFeature({
  id: 'control',
  showPanels: [
    { id: 'timers', title: 'Timers', order: 10, component: TimersPanel },
    { id: 'messages', title: 'Messages', order: 20, component: MessagesPanel },
    { id: 'props', title: 'Props', order: 30, component: PropsPanel },
    { id: 'macros', title: 'Macros', order: 40, component: MacrosPanel },
    { id: 'audio', title: 'Audio', order: 50, component: AudioPanel }
  ],
  settings: [
    { id: 'control-midi', title: 'MIDI', order: 60, component: MidiSettings },
    { id: 'control-hotkeys', title: 'Keyboard shortcuts', order: 61, component: HotkeysSettings },
    { id: 'control-remote', title: 'Remote & API', order: 62, component: RemoteSettings },
    { id: 'control-macros', title: 'Macros & automations', order: 63, component: MacrosSettings }
  ],
  background: [HotkeysHost]
})
