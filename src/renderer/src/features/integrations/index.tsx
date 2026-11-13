import type { ReactNode } from 'react'
import { defineFeature } from '../../app/feature'
import { PcoCard, ServiceSyncPanel } from './Pco'
import { NotionCard } from './Notion'
import { BibleCard } from './BibleCard'
import { extraCards } from './cards'
import { EditingGuard } from './Cloud'
import './integrations.css'

function IntegrationsView(): ReactNode {
  return (
    <div className="ix" data-testid="integrations">
      <h2>Integrations</h2>
      <div className="ix-sub">Connect the places Reach already plans Sunday. Everything you pull in is saved to the workspace, so the service still runs if the internet drops.</div>
      <div className="ix-grid">
        <PcoCard />
        <NotionCard />
        <BibleCard />
        {extraCards.map((C, i) => <C key={i} />)}
      </div>
    </div>
  )
}

export default defineFeature({
  id: 'integrations',
  views: [{ id: 'integrations', title: 'Integrations', order: 70, component: IntegrationsView }],
  background: [EditingGuard],
  showPanels: [{ id: 'service-sync', title: 'Planning Center & Notion', order: 15, component: ServiceSyncPanel }]
})
