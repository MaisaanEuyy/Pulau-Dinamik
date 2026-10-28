import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { IPC } from '../../shared/ipc'
import type { ToastAccess } from '../../shared/toast'
import toastsScript from './toasts.ps1?raw'
import { getIslandWindow } from '../windows/island'
import { pushNotification } from './notifications'

const SCRIPT_NAME = 'toast-helper.ps1'
/** The listener runs for the app's lifetime: a hidden island still pops open for
 * notifications. The idle stop only applies once the renderer unsubscribes. */
const IDLE_STOP_MS = 30_000

let helper: ChildProcessWithoutNullStreams | null = null
let subscribers = 0
let idleTimer: NodeJS.Timeout | null = null
let access: ToastAccess = 'unknown'
let logBuffer = ''

/** Windows toast keys (`aumid|id|created`) we already forwarded. */
const seen = new Set<string>()
/**
 * Toasts that landed before the app started are history, not news: they would
 * flood the list on every launch. Everything newer (including the ones that
 * arrived while the island was hidden) is imported once.
 */
const importAfter = Date.now()

function scriptPath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, SCRIPT_NAME)
}

function ensureScript(): string {
  const path = scriptPath()
  try {
    if (readFileSync(path, 'utf8') !== toastsScript) writeFileSync(path, toastsScript, 'utf8')
  } catch {
    writeFileSync(path, toastsScript, 'utf8')
  }
  return path
}

function mapAccess(value: string): ToastAccess {
  return value === 'Allowed' ? 'allowed' : 'denied'
}

function sendAccess(): void {
  const win = getIslandWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC.toastsAccess, access)
}

function handleLine(line: string): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return
  }
  if (!parsed || typeof parsed !== 'object') return

  const raw = parsed as Record<string, unknown>

  if (raw.type === 'access' && typeof raw.access === 'string') {
    access = mapAccess(raw.access)
    if (access !== 'allowed') console.warn('[toasts] notification access:', raw.access)
    sendAccess()
    return
  }

  if (raw.type !== 'toast') return

  const key = typeof raw.key === 'string' ? raw.key : null
  if (!key || seen.has(key)) return
  seen.add(key)

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
}

function killHelper(): void {
  const proc = helper
  helper = null
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
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path],
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
    console.warn('[toasts] helper:', chunk.trim())
  })

  proc.on('error', (error) => {
    console.warn('[toasts] helper failed to start', error)
    if (helper === proc) helper = null
  })

  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) console.warn('[toasts] helper exited with', code)
    if (helper === proc) helper = null
  })
}

/** Starts the listener if needed and reports whether Windows lets us read toasts. */
export function subscribeToasts(): Promise<ToastAccess> {
  subscribers += 1
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  startHelper()
  return Promise.resolve(access)
}

export function unsubscribeToasts(): void {
  subscribers = Math.max(0, subscribers - 1)
  if (subscribers > 0) return
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (subscribers === 0) killHelper()
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
  killHelper()
}