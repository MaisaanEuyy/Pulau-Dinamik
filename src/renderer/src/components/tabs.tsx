import { Activity, Bell, Keyboard, Music2 } from 'lucide-react'
import type { ElementType } from 'react'
import type { MediaCommand, MediaState } from '@shared/media'
import type { IslandNotification } from '@shared/notifications'
import type { SystemSnapshot } from '@shared/system'
import type { KeyboardActivity } from '../hooks/useKeyboard'
import type { NotificationsStore } from '../hooks/useNotifications'
import { AlertsPanel } from './AlertsPanel'
import { KeysPanel } from './KeysPanel'
import { MediaPanel } from './MediaPanel'
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

/**
 * Data for every section is owned by the island itself, so the header mini view
 * and the full panel share one subscription instead of sampling twice.
 */
export interface TabData {
  media: { state: MediaState | null; send: (command: MediaCommand) => void }
  system: SystemSnapshot | null
  keyboard: KeyboardActivity
  alerts: NotificationsStore
}

export function TabPanel({
  tab,
  data,
  notifyPort,
  focusAlert = null
}: {
  tab: TabDefinition
  data: TabData
  notifyPort: number | null
  focusAlert?: IslandNotification | null
}) {
  if (tab.id === 'media') return <MediaPanel state={data.media.state} send={data.media.send} />
  if (tab.id === 'system') return <SystemPanel snapshot={data.system} />
  if (tab.id === 'keys') return <KeysPanel activity={data.keyboard} />

  return <AlertsPanel alerts={data.alerts} port={notifyPort} focus={focusAlert} />
}