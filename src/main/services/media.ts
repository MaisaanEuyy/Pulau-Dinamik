import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { IPC } from '../../shared/ipc'
import type { MediaCommand, MediaState } from '../../shared/media'
import smtcScript from './smtc.ps1?raw'
import { getIslandWindow } from '../windows/island'

const SCRIPT_NAME = 'smtc-helper.ps1'
/** Keep the warm helper around for a while so reopening the panel is instant. */
const IDLE_STOP_MS = 30_000
const FIRST_STATE_TIMEOUT_MS = 8_000

let helper: ChildProcessWithoutNullStreams | null = null
let latest: MediaState | null = null
let subscribers = 0
let idleTimer: NodeJS.Timeout | null = null
let firstStateWaiters: Array<() => void> = []
let logBuffer = ''

function scriptPath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, SCRIPT_NAME)
}

/** Writes the inlined script next to the settings file so PowerShell can run it. */
function ensureScript(): string {
  const path = scriptPath()
  try {
    if (readFileSync(path, 'utf8') !== smtcScript) writeFileSync(path, smtcScript, 'utf8')
  } catch {
    writeFileSync(path, smtcScript, 'utf8')
  }
  return path
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function parseState(line: string): MediaState | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const raw = parsed as Record<string, unknown>
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

function handleLine(line: string): void {
  const next = parseState(line)
  if (!next) return
  if (sameState(latest, next)) return
  latest = next
  emit()
  settleFirstState()
}

function killHelper(): void {
  const proc = helper
  helper = null
  latest = null
  if (!proc) return
  try {
    proc.stdin.end()
  } catch {
    // Already gone.
  }
  try {
    proc.kill()
  } catch {
    // Already gone.
  }
}

function startHelper(): void {
  if (helper) return

  const path = ensureScript()
  const proc = spawn(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path
    ],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
  )
  helper = proc
  logBuffer = ''

  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (chunk: string) => {
    logBuffer += chunk
    let newline = logBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = logBuffer.slice(0, newline).replace(/\r$/, '').trim()
      logBuffer = logBuffer.slice(newline + 1)
      if (line) handleLine(line)
      newline = logBuffer.indexOf('\n')
    }
  })

  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (chunk: string) => {
    console.warn('[media] helper:', chunk.trim())
  })

  proc.on('error', (error) => {
    console.warn('[media] helper failed to start', error)
    if (helper === proc) helper = null
    settleFirstState()
  })

  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) console.warn('[media] helper exited with', code)
    if (helper === proc) {
      helper = null
      latest = null
    }
    settleFirstState()
  })
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

/** Starts the helper if needed and resolves with the latest known state. */
export function subscribeMedia(): Promise<MediaState | null> {
  subscribers += 1
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  startHelper()
  return waitForFirstState()
}

/** Called when the Media panel goes away; the helper stops after an idle period. */
export function unsubscribeMedia(): void {
  subscribers = Math.max(0, subscribers - 1)
  if (subscribers > 0) return
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (subscribers === 0) killHelper()
  }, IDLE_STOP_MS)
}

/** Safety net for hiding the whole island while the panel is still mounted. */
export function releaseMedia(): void {
  subscribers = 0
  if (idleTimer) return
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (subscribers === 0) killHelper()
  }, IDLE_STOP_MS)
}

export function getMediaState(): MediaState | null {
  return latest
}

export function sendMediaCommand(command: MediaCommand): void {
  if (!helper) return
  if (command !== 'toggle' && command !== 'next' && command !== 'previous') return
  try {
    helper.stdin.write(`${command}\n`)
  } catch {
    // Broken pipe: the exit handler will clean up.
  }
}

export function stopMediaHelper(): void {
  subscribers = 0
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  killHelper()
}