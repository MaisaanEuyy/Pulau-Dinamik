/**
 * Notifications posted through the local HTTP API (Milestone 6). They live in
 * memory only — nothing is written to disk and nothing leaves the machine.
 */
export type NotificationLevel = 'info' | 'success' | 'warning' | 'error'

export const NOTIFICATION_LEVELS: readonly NotificationLevel[] = [
  'info',
  'success',
  'warning',
  'error'
]

export const NOTIFICATION_LIMIT = 24

export interface IslandNotification {
  id: string
  title: string
  message: string | null
  /** Optional source label, e.g. `build` or `spotify`. */
  app: string | null
  level: NotificationLevel
  createdAt: number
}

/** Body accepted by `POST /notify`. */
export interface NotifyPayload {
  title: string
  message?: string
  app?: string
  level?: NotificationLevel
}

/** First port the local API tries; it walks up from here if it is taken. */
export const NOTIFY_PORT_START = 43110
export const NOTIFY_PORT_TRIES = 10