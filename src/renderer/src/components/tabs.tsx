import { Activity, Bell, Keyboard, Music2 } from 'lucide-react'
import type { ElementType } from 'react'
import { SystemPanel } from './SystemPanel'

export interface TabDefinition {
  id: string
  label: string
  headline: string
  description: string
  milestone: string
  icon: ElementType
}

export const TABS: readonly TabDefinition[] = [
  {
    id: 'media',
    label: 'Media',
    headline: 'Media playback',
    description: 'Now playing from YouTube, Spotify and any other player that speaks SMTC.',
    milestone: 'Milestone 4',
    icon: Music2
  },
  {
    id: 'system',
    label: 'System',
    headline: 'System monitoring',
    description: 'CPU, memory, GPU, disk, network and battery at a glance.',
    milestone: 'Milestone 3',
    icon: Activity
  },
  {
    id: 'keys',
    label: 'Keys',
    headline: 'Keyboard indicator',
    description: 'Key presses and lock states — without ever logging what you type.',
    milestone: 'Milestone 5',
    icon: Keyboard
  },
  {
    id: 'alerts',
    label: 'Alerts',
    headline: 'Notifications',
    description: 'Toasts from your own scripts and tools through the local notification API.',
    milestone: 'Milestone 6',
    icon: Bell
  }
]

export type TabId = (typeof TABS)[number]['id']

export function TabPanel({ tab, active }: { tab: TabDefinition; active: boolean }) {
  if (tab.id === 'system') return <SystemPanel active={active} />

  const Icon = tab.icon

  return (
    <div className="tab-panel">
      <span className="tab-panel-icon">
        <Icon size={16} strokeWidth={1.7} />
      </span>
      <span className="tab-panel-title">{tab.headline}</span>
      <span className="tab-panel-text">{tab.description}</span>
      <span className="tab-panel-badge">arrives in {tab.milestone}</span>
    </div>
  )
}