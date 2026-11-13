import type { ComponentType } from 'react'
import { CloudCard } from './Cloud'
import { FigmaCard } from './Figma'
import { ObsCard } from './Obs'
/** Extra integration cards, in display order. */
export const extraCards: ComponentType[] = [FigmaCard, ObsCard, CloudCard]
