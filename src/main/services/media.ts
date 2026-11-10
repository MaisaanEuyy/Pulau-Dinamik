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
/**
 * The helper costs ~30-80 MB, so it is not worth keeping alive while nothing is
 * playing. Once playback has been paused this long it is released; the media
 * pill keeps showing the last track and the next sound wakes it again.
 */
const IDLE_RELEASE_MS = 90_000
const FIRST_STATE_TIMEOUT_MS = 8_000

let latest: MediaState | null = null
let subscribers = 0
let idleTimer: NodeJS.Timeout | null = null
let pauseTimer: NodeJS.Timeout | null = null
/** Click made while the helper was released; replayed on the first state. */
let pendingCommand: MediaCommand | null = null
let pendingTimer: NodeJS.Timeout | null = null
let firstStateWaiters: Array<() => void> = []
/** Whether this service currently holds the shared WinRT helper open. */
let holding = false
/** Whether the helper has been told to poll SMTC. */
let mediaOn = false
/** Another feature (Discord) needs the state even while the island is closed. */
let alwaysOn = false

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
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
    positionMs: asNumber(raw.positionMs),
    durationMs: asNumber(raw.durationMs),
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

/**
 * The bridge refreshes the position every poll, but only *different* tracks are
 * pushed to the island. Features that need the moving position (Discord) listen
 * here and do their own filtering.
 */
type MediaListener = (state: MediaState | null) => void
const listeners = new Set<MediaListener>()

export function onMediaState(listener: MediaListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
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
  const changed = !sameState(latest, next)
  latest = next
  if (next.playing) cancelIdleRelease()
  else scheduleIdleRelease()
  // A click that arrived while the helper was cold waits for the manager to be
  // ready; the first state line is that moment.
  if (pendingCommand) {
    const command = pendingCommand
    pendingCommand = null
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
    sendBridge(command)
  }
  for (const listener of listeners) listener(next)
  if (!changed) return
  emit()
  settleFirstState()
})

// A restarted helper has forgotten that the media panel is open.
onBridgeStart(() => {
  if (mediaOn) sendBridge('media:on')
})

onBridgeExit(() => {
  latest = null
  for (const listener of listeners) listener(null)
})

function activate(): void {
  if (mediaOn) return
  mediaOn = true
  holding = true
  cancelIdleRelease()
  retainBridge()
  sendBridge('media:on')
}

function deactivate(): void {
  cancelIdleRelease()
  if (!mediaOn) return
  mediaOn = false
  latest = null
  sendBridge('media:off')
  if (holding) {
    holding = false
    releaseBridge(0)
  }
}

function cancelIdleRelease(): void {
  if (!pauseTimer) return
  clearTimeout(pauseTimer)
  pauseTimer = null
}

/** Arms the release timer; Discord keeps the bridge alive on its own hold. */
function scheduleIdleRelease(): void {
  if (pauseTimer || alwaysOn) return
  pauseTimer = setTimeout(() => {
    pauseTimer = null
    if (alwaysOn || latest?.playing) return
    deactivate()
  }, IDLE_RELEASE_MS)
}

/**
 * Restarts SMTC polling after an idle release. Called when the audio meter hears
 * a sound, so the pill updates within a second of the next track instead of
 * waiting for the user to open the island.
 */
export function wakeMedia(): void {
  if (mediaOn) return
  ensureBridge()
  activate()
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
    if (subscribers > 0 || alwaysOn) return
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
  if (idleTimer || alwaysOn) return
  scheduleStop()
}

export function getMediaState(): MediaState | null {
  return latest
}

/**
 * Keeps SMTC polling alive while the island is collapsed or hidden. The Discord
 * card must keep moving even when nobody is looking at the panel, which the
 * normal subscribe/unsubscribe idle timer would otherwise stop after 30 s.
 */
export function setMediaAlwaysOn(on: boolean): void {
  if (alwaysOn === on) return
  alwaysOn = on
  if (on) {
    cancelIdleRelease()
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    ensureBridge()
    activate()
    return
  }
  if (subscribers === 0) scheduleStop()
}

export function sendMediaCommand(command: MediaCommand): void {
  if (command !== 'toggle' && command !== 'next' && command !== 'previous') return
  if (!mediaOn) {
    // The helper may have been released while idle. Wake it and replay the
    // click once the SMTC manager has handed back the session.
    wakeMedia()
    pendingCommand = command
    if (pendingTimer) clearTimeout(pendingTimer)
    pendingTimer = setTimeout(() => {
      pendingTimer = null
      pendingCommand = null
    }, 8_000)
    return
  }
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