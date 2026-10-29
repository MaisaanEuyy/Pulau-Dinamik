import { IPC } from '../../shared/ipc'
import type { MediaCommand, MediaState } from '../../shared/media'
import { getIslandWindow } from '../windows/island'
import {
  ensureBridge,
  onBridgeExit,
  onBridgeMessage,
  onBridgeStart,
  releaseBridge,
  retainBridge,
  sendBridge
} from './winrt'

/** Keep the warm helper around for a while so reopening the panel is instant. */
const IDLE_STOP_MS = 30_000
const FIRST_STATE_TIMEOUT_MS = 8_000

let latest: MediaState | null = null
let subscribers = 0
let idleTimer: NodeJS.Timeout | null = null
let firstStateWaiters: Array<() => void> = []
/** Whether this service currently holds the shared WinRT helper open. */
let holding = false
/** Whether the helper has been told to poll SMTC. */
let mediaOn = false

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function parseState(raw: Record<string, unknown>): MediaState | null {
  if (raw.type !== 'state' || typeof raw.active !== 'boolean' || typeof raw.playing !== 'boolean') {
    return null
  }

  return {
    active: raw.active,
    playing: raw.playing,
    title: asText(raw.title),
    artist: asText(raw.artist),
    album: asText(raw.album),
    app: asText(raw.app),
    canPlayPause: raw.canPlayPause === true,
    canNext: raw.canNext === true,
    canPrevious: raw.canPrevious === true,
    artwork: asText(raw.artwork)
  }
}

function sameState(a: MediaState | null, b: MediaState): boolean {
  if (!a) return false
  return (
    a.active === b.active &&
    a.playing === b.playing &&
    a.title === b.title &&
    a.artist === b.artist &&
    a.album === b.album &&
    a.app === b.app &&
    a.canPlayPause === b.canPlayPause &&
    a.canNext === b.canNext &&
    a.canPrevious === b.canPrevious &&
    a.artwork === b.artwork
  )
}

function emit(): void {
  const win = getIslandWindow()
  if (!latest || !win || win.isDestroyed()) return
  win.webContents.send(IPC.mediaUpdate, latest)
}

function settleFirstState(): void {
  const waiters = firstStateWaiters
  firstStateWaiters = []
  for (const resolve of waiters) resolve()
}

onBridgeMessage((raw) => {
  if (raw.type !== 'state') return
  const next = parseState(raw)
  if (!next) return
  if (sameState(latest, next)) return
  latest = next
  emit()
  settleFirstState()
})

// A restarted helper has forgotten that the media panel is open.
onBridgeStart(() => {
  if (mediaOn) sendBridge('media:on')
})

onBridgeExit(() => {
  latest = null
})

function activate(): void {
  if (mediaOn) return
  mediaOn = true
  holding = true
  retainBridge()
  sendBridge('media:on')
}

function deactivate(): void {
  if (!mediaOn) return
  mediaOn = false
  latest = null
  sendBridge('media:off')
  if (holding) {
    holding = false
    releaseBridge(0)
  }
}

/** Waits for the helper's first state line (cold start takes a moment). */
function waitForFirstState(): Promise<MediaState | null> {
  if (latest) return Promise.resolve(latest)
  return new Promise((resolve) => {
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(latest)
    }
    const timer = setTimeout(finish, FIRST_STATE_TIMEOUT_MS)
    firstStateWaiters.push(finish)
  })
}

function scheduleStop(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (subscribers > 0) return
    deactivate()
  }, IDLE_STOP_MS)
}

/** Starts the helper if needed and resolves with the latest known state. */
export function subscribeMedia(): Promise<MediaState | null> {
  subscribers += 1
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  // Covers the case where the shared process restarted (or was stopped while
  // this feature still had a hold).
  ensureBridge()
  activate()
  return waitForFirstState()
}

/** Called when the Media panel goes away; the helper stops after an idle period. */
export function unsubscribeMedia(): void {
  subscribers = Math.max(0, subscribers - 1)
  if (subscribers > 0) return
  scheduleStop()
}

/** Safety net for hiding the whole island while the panel is still mounted. */
export function releaseMedia(): void {
  subscribers = 0
  if (idleTimer) return
  scheduleStop()
}

export function getMediaState(): MediaState | null {
  return latest
}

export function sendMediaCommand(command: MediaCommand): void {
  if (!mediaOn) return
  if (command !== 'toggle' && command !== 'next' && command !== 'previous') return
  sendBridge(command)
}

export function stopMediaHelper(): void {
  subscribers = 0
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  deactivate()
}