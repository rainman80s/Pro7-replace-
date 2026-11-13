/**
 * Reach UI kit — the primitives every feature uses, so the whole app looks and behaves
 * consistently. Use these (and the CSS variables in tokens.css) rather than inventing your own
 * buttons/inputs/modals. Usage examples for every export: docs/design/ui-kit.md
 */
import './fonts.css'
import './tokens.css'
import './ui.css'

export { Icon, iconNames, type IconName } from './icons'
export { Logo, logoScreenSvg, LOGO_SCREEN_DATA_URI } from './Logo'
export {
  Button, IconButton, Field, Input, TextArea, Select, SearchInput, NumberInput, Slider, Toggle, ColorInput, BRAND_SWATCHES,
  Tabs, SegmentedControl, Panel, List, ListItem, Badge, Dot, Kbd, Spinner, Empty, formatKeys, isMac,
  type ButtonProps, type TabDef
} from './controls'
export {
  Modal, Drawer, Tooltip, Menu, openContextMenu, openMenuAt, toast, ToastHost, confirm, promptText, UIHost, overlayOpen, uiZoom,
  type MenuItem, type MenuItems, type ToastLevel
} from './overlays'
export { useDragReorder, dragSource, moveItem } from './reorder'
export { ErrorBoundary } from './ErrorBoundary'
