import { randomUUID } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import { app } from 'electron'
import { DISCORD_ASSET_KEY, DISCORD_CLIENT_ID, DISCORD_FALLBACK_APP } from '../../shared/discord'
import type { MediaState } from '../../shared/media'
import { getMediaState, onMediaState, setMediaAlwaysOn } from './media'

/**
 * Minimal Discord RPC client: the desktop app exposes a named pipe, we say hello
 * and then push `SET_ACTIVITY`. No bot, no token, no network — the pipe is local.
 *
 * Frame layout: 4 bytes op (LE) + 4 bytes length (LE) + JSON body.
 */
const OP_HANDSHAKE = 0
const OP_FRAME = 1
const OP_CLOSE = 2
const OP_PING = 3
const OP_PONG = 4

/** Discord opens one pipe per running client. */
const PIPE_COUNT = 10
/** Discord allows 5 updates per 20 s; one every 5 s stays comfortably under. */
const UPDATE_MIN_MS = 5_000
/** Retry delay when Discord is closed or the pipe drops. */
const RETRY_MS = 5_000
/** A jump larger than this means the user seeked, so the timeline is resent. */
const SEEK_TOLERANCE_MS = 5_000
const FIELD_MAX = 128
/** `ActivityType.Listening`. */
const ACTIVITY_LISTENING = 2

interface Activity {
  type: number
  details?: string
  state?: string
  timestamps?: { start: number; end: number }
  assets?: { large_image: string; large_text: string }
  instance: boolean
}

interface Pending {
  activity: Activity | null
  /** Identity of the card without its timeline; equal keys mean "no update". */
  key: string
  /** Whether the card was built from a paused player. */
  paused: boolean
  /** Position (ms) baked into `timestamps`, or `-1` when there is none. */
  position: number
}

let running = false
/** Discord rejected our client id; retrying would only spam the log. */
let fatal = false
let socket: Socket | null = null
let ready = false
/** Last pipe that accepted us, so reconnects do not rescan all ten. */
let pipeIndex = 0
let incoming: Buffer = Buffer.alloc(0)
let retryTimer: NodeJS.Timeout | null = null
let trailingTimer: NodeJS.Timeout | null = null
let unsubscribeMedia: (() => void) | null = null

let pending: Pending | null = null
let sentKey = ''
let sentAt = 0
let sentPosition = -1

// ------------------------------------------------------------------ activity

function clamp(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > FIELD_MAX ? `${flat.slice(0, FIELD_MAX - 1)}…` : flat
}

/** "Song - YouTube Music" → "Song"; players append the site to the title. */
function cleanTitle(title: string): string {
  return title
    .replace(/\s+[-–—]\s+YouTube Music$/i, '')
    .replace(/\s+[-–—]\s+YouTube$/i, '')
    .replace(/\s*\|\s*YouTube( Music)?$/i, '')
    .trim()
}

function build(state: MediaState | null): Omit<Pending, 'key'> {
  if (!state || !state.active || !state.title) {
    return { activity: null, paused: false, position: -1 }
  }

  const paused = !state.playing
  const title = clamp(cleanTitle(state.title)) || (state.app ? clamp(state.app) : DISCORD_FALLBACK_APP)
  const artist = state.artist ? clamp(state.artist) : null
  const source = state.app ? clamp(state.app) : DISCORD_FALLBACK_APP

  const activity: Activity = {
    type: ACTIVITY_LISTENING,
    details: title,
    // Shows the track instead of the app name in the member list.
    instance: false
  }

  if (paused) {
    activity.state = artist ? clamp(`${artist} • Paused`) : 'Paused'
  } else if (artist) {
    activity.state = artist
  } else {
    activity.state = source
  }

  if (DISCORD_ASSET_KEY) {
    // Only uploaded asset keys work: Discord cannot take the SMTC data URL.
    activity.assets = {
      large_image: DISCORD_ASSET_KEY,
      large_text: paused ? clamp(`${source} • Paused`) : source
    }
  }

  const { durationMs, positionMs } = state
  if (!paused && durationMs !== null && durationMs > 0 && positionMs !== null) {
    const position = Math.min(positionMs, durationMs)
    const start = Date.now() - position
    activity.timestamps = { start, end: start + durationMs }
    return { activity, paused, position }
  }

  return { activity, paused, position: -1 }
}

function keyOf(activity: Activity | null, paused: boolean): string {
  if (!activity) return ''
  // `paused` is part of the identity: resuming must resend the timeline instead
  // of reusing the one Discord received before the pause.
  return [activity.details, activity.state, activity.assets?.large_image, paused].join('\u0000')
}

// -------------------------------------------------------------------- socket

function writeFrame(op: number, json: string): void {
  const sock = socket
  if (!sock || sock.destroyed) return
  const body = Buffer.from(json, 'utf8')
  const header = Buffer.alloc(8)
  header.writeInt32LE(op, 0)
  header.writeInt32LE(body.length, 4)
  try {
    sock.write(Buffer.concat([header, body]))
  } catch {
    // The close handler will reconnect.
  }
}

function send(op: number, payload: unknown): void {
  writeFrame(op, JSON.stringify(payload))
}

function scheduleRetry(): void {
  if (!running || fatal || retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    if (running && !socket) open(pipeIndex)
  }, RETRY_MS)
}

function drop(sock: Socket): void {
  if (socket !== sock) return
  socket = null
  ready = false
  sentKey = ''
  incoming = Buffer.alloc(0)
  sock.destroy()
  if (running) scheduleRetry()
}

function handleFrame(sock: Socket, op: number, body: string): void {
  if (op === OP_PING) {
    writeFrame(OP_PONG, body)
    return
  }
  if (op === OP_CLOSE) {
    drop(sock)
    return
  }
  if (op !== OP_FRAME) return

  let payload: { cmd?: string; evt?: string; data?: unknown }
  try {
    payload = JSON.parse(body)
  } catch {
    return
  }

  if (payload.evt === 'READY') {
    ready = true
    sentKey = ''
    if (!app.isPackaged) console.log(`[discord] connected on pipe ${pipeIndex}`)
    push(getMediaState())
    return
  }

  if (payload.evt === 'ERROR') {
    const data = (payload.data ?? {}) as { code?: number; message?: string }
    console.warn(`[discord] ${data.code ?? '?'} ${data.message ?? 'unknown error'}`)
    if (data.code === 4000) {
      fatal = true
      console.warn('[discord] the client id was rejected; check DISCORD_CLIENT_ID')
      stopDiscordPresence()
    }
  }
}

function onData(sock: Socket, chunk: Buffer): void {
  incoming = incoming.length === 0 ? chunk : Buffer.concat([incoming, chunk])
  while (incoming.length >= 8) {
    const op = incoming.readInt32LE(0)
    const length = incoming.readInt32LE(4)
    if (length < 0 || length > 1 << 20) {
      drop(sock)
      return
    }
    if (incoming.length < 8 + length) return
    const body = incoming.subarray(8, 8 + length).toString('utf8')
    incoming = incoming.subarray(8 + length)
    handleFrame(sock, op, body)
  }
}

function open(index: number): void {
  if (!running || fatal || socket) return
  if (index >= PIPE_COUNT) {
    // Discord is not running (or every pipe is busy): try again later.
    scheduleRetry()
    return
  }

  const sock = createConnection(`\\\\.\\pipe\\discord-ipc-${index}`)
  let opened = false
  let advanced = false

  const nextPipe = (): void => {
    if (opened || advanced) return
    advanced = true
    sock.destroy()
    open(index + 1)
  }

  sock.once('connect', () => {
    opened = true
    socket = sock
    pipeIndex = index
    ready = false
    sentKey = ''
    incoming = Buffer.alloc(0)
    sock.on('data', (chunk: Buffer) => onData(sock, chunk))
    sock.on('error', () => drop(sock))
    sock.on('close', () => drop(sock))
    send(OP_HANDSHAKE, { v: 1, client_id: DISCORD_CLIENT_ID })
  })

  sock.once('error', nextPipe)
  sock.once('close', nextPipe)
}

// ------------------------------------------------------------------- pushing

function seeked(state: MediaState | null): boolean {
  if (!state || !state.playing || state.positionMs === null) return false
  if (sentPosition < 0) return false
  const projected = sentPosition + (Date.now() - sentAt)
  return Math.abs(projected - state.positionMs) > SEEK_TOLERANCE_MS
}

function flush(): void {
  if (!ready || !pending) return

  const wait = UPDATE_MIN_MS - (Date.now() - sentAt)
  if (wait > 0) {
    if (!trailingTimer) {
      trailingTimer = setTimeout(() => {
        trailingTimer = null
        flush()
      }, wait)
    }
    return
  }

  const { activity, key, position } = pending
  pending = null
  sentKey = key
  sentAt = Date.now()
  sentPosition = position

  if (!app.isPackaged) {
    const timeline = activity?.timestamps ? ' +timeline' : ''
    console.log(`[discord] ${activity?.details ?? '(cleared)'} | ${activity?.state ?? ''}${timeline}`)
  }
  send(OP_FRAME, {
    cmd: 'SET_ACTIVITY',
    args: activity ? { pid: process.pid, activity } : { pid: process.pid },
    nonce: randomUUID()
  })
}

function push(state: MediaState | null): void {
  if (!running) return
  const draft = build(state)
  const key = keyOf(draft.activity, draft.paused)
  // Same card and the timeline is still where Discord expects it: nothing to
  // send. Pause/resume flips the key, so those always go through.
  if (key === sentKey && !seeked(state)) return
  pending = { ...draft, key }
  flush()
}

function clearActivity(): void {
  if (!ready) return
  send(OP_FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid }, nonce: randomUUID() })
}

// ---------------------------------------------------------------- lifecycle

export function startDiscordPresence(): void {
  if (running) return
  running = true
  fatal = false
  unsubscribeMedia = onMediaState((state) => push(state))
  setMediaAlwaysOn(true)
  push(getMediaState())
  open(pipeIndex)
}

export function stopDiscordPresence(): void {
  if (!running) return
  running = false

  // Let Discord know the card is gone instead of leaving a stale track behind.
  clearActivity()

  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  if (trailingTimer) {
    clearTimeout(trailingTimer)
    trailingTimer = null
  }
  unsubscribeMedia?.()
  unsubscribeMedia = null
  setMediaAlwaysOn(false)

  pending = null
  sentKey = ''
  sentPosition = -1
  ready = false

  const sock = socket
  socket = null
  if (sock) {
    sock.removeAllListeners('data')
    sock.removeAllListeners('close')
    sock.removeAllListeners('error')
    sock.on('error', () => {})
    // `end()` flushes the clear frame before the pipe closes.
    sock.end()
    setTimeout(() => sock.destroy(), 250)
  }
}

export function isDiscordConnected(): boolean {
  return ready
}

/** One call site for both the Settings toggle and the tray checkbox. */
export function syncDiscordPresence(enabled: boolean): void {
  if (enabled) startDiscordPresence()
  else stopDiscordPresence()
}
