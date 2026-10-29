import { IPC } from '../../shared/ipc'
import type { ToastAccess } from '../../shared/toast'
import { getIslandWindow } from '../windows/island'
import { pushNotification } from './notifications'
import { onBridgeMessage, releaseBridge, retainBridge } from './winrt'

/** The listener runs for the app's lifetime: a hidden island still pops open for
 * notifications. The idle stop only applies once the renderer unsubscribes. */
const IDLE_STOP_MS = 30_000
/** Windows notification keys are tiny, but the app can run for days. */
const SEEN_LIMIT = 512

let subscribers = 0
let idleTimer: NodeJS.Timeout | null = null
let access: ToastAccess = 'unknown'
/** Whether this service currently holds the shared WinRT helper open. */
let holding = false

/** Windows toast keys (`aumid|id|created`) we already forwarded. */
const seen = new Set<string>()
const seenOrder: string[] = []
/**
 * Toasts that landed before the app started are history, not news: they would
 * flood the list on every launch.
 */
const importAfter = Date.now()

function markSeen(key: string): void {
  seen.add(key)
  seenOrder.push(key)
  while (seenOrder.length > SEEN_LIMIT) {
    const oldest = seenOrder.shift()
    if (oldest) seen.delete(oldest)
  }
}

function mapAccess(value: string): ToastAccess {
  return value === 'Allowed' ? 'allowed' : 'denied'
}

function sendAccess(): void {
  const win = getIslandWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC.toastsAccess, access)
}

onBridgeMessage((raw) => {
  if (raw.type === 'access' && typeof raw.access === 'string') {
    access = mapAccess(raw.access)
    if (access !== 'allowed') console.warn('[toasts] notification access:', raw.access)
    sendAccess()
    return
  }

  if (raw.type !== 'toast') return

  const key = typeof raw.key === 'string' ? raw.key : null
  if (!key || seen.has(key)) return
  markSeen(key)

  const created = typeof raw.created === 'number' ? raw.created : Date.now()
  if (created < importAfter) return

  const texts = Array.isArray(raw.texts)
    ? raw.texts.filter((entry): entry is string => typeof entry === 'string')
    : []
  const appName = typeof raw.app === 'string' && raw.app.trim() ? raw.app.trim() : 'Windows'
  const title = texts[0]?.trim() || appName
  const message = texts
    .slice(1)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(' · ')

  pushNotification({
    title,
    message: message || undefined,
    app: appName,
    level: 'info'
  })
})

/** Starts the listener if needed and reports whether Windows lets us read toasts. */
export function subscribeToasts(): Promise<ToastAccess> {
  subscribers += 1
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (!holding) {
    holding = true
    retainBridge()
  }
  return Promise.resolve(access)
}

export function unsubscribeToasts(): void {
  subscribers = Math.max(0, subscribers - 1)
  if (subscribers > 0) return
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (subscribers > 0 || !holding) return
    holding = false
    releaseBridge(0)
  }, IDLE_STOP_MS)
}

export function getToastAccess(): ToastAccess {
  return access
}

export function stopToastHelper(): void {
  subscribers = 0
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (holding) {
    holding = false
    releaseBridge(0)
  }
}