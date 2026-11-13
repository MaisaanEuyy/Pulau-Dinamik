import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import script from './winrt.ps1?raw'

const SCRIPT_NAME = 'winrt-helper.ps1'

/**
 * The WinRT servers live out of process, so a 32-bit Windows PowerShell can run
 * both bridges while using roughly half the private memory of the 64-bit host
 * (~33 MB vs ~52 MB). Fall back to the default host when SysWOW64 is missing.
 */
const WOW64_POWERSHELL =
  process.platform === 'win32' && process.arch === 'x64'
    ? join(
        process.env['SystemRoot'] ?? 'C:\\Windows',
        'SysWOW64',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      )
    : null

const POWERSHELL_HOSTS = [
  ...(WOW64_POWERSHELL && existsSync(WOW64_POWERSHELL) ? [WOW64_POWERSHELL] : []),
  'powershell.exe'
]

let hostIndex = 0

type BridgeMessage = Record<string, unknown>
type MessageHandler = (message: BridgeMessage) => void
type LifecycleHandler = () => void

/**
 * One PowerShell process serves both the SMTC media bridge and the Windows
 * notification listener. A second process would mean a second CLR + Windows
 * PowerShell baseline (~45 MB), so both features share this helper.
 */
let helper: ChildProcessWithoutNullStreams | null = null
let logBuffer = ''
/** Number of feature holds on the process (media and/or toasts). */
let refs = 0
let idleTimer: NodeJS.Timeout | null = null

const messageHandlers = new Set<MessageHandler>()
const startHandlers = new Set<LifecycleHandler>()
const exitHandlers = new Set<LifecycleHandler>()

function scriptPath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, SCRIPT_NAME)
}

/** Writes the inlined script next to the settings file so PowerShell can run it. */
function ensureScript(): string {
  const path = scriptPath()
  try {
    if (readFileSync(path, 'utf8') !== script) writeFileSync(path, script, 'utf8')
  } catch {
    writeFileSync(path, script, 'utf8')
  }
  return path
}

function dispatch(line: string): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return
  }
  if (!parsed || typeof parsed !== 'object') return
  for (const handler of messageHandlers) handler(parsed as BridgeMessage)
}

function startHelper(): void {
  if (helper) return

  const path = ensureScript()
  const host = POWERSHELL_HOSTS[hostIndex]
  const proc = spawn(
    host,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path,
      // Lets the helper notice a crashed host and exit instead of lingering as
      // a ~30-80 MB orphan.
      '-ParentPid',
      String(process.pid)
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
      if (line) dispatch(line)
      newline = logBuffer.indexOf('\n')
    }
  })

  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (chunk: string) => {
    console.warn('[winrt] helper:', chunk.trim())
  })

  const handleGone = (): void => {
    if (helper !== proc) return
    helper = null
    // Drop the pipes so a late write cannot reach a dead child.
    for (const stream of [proc.stdin, proc.stdout, proc.stderr]) stream.destroy()
    for (const handler of exitHandlers) handler()
  }

  // A dead helper surfaces as EPIPE on its streams, not as a throw from the
  // write call: without these listeners Node treats it as an uncaught
  // exception and shows the "A JavaScript error occurred in the main process"
  // dialog. Idle release and a force-quit timer both race the pipes.
  proc.stdin.on('error', handleGone)
  proc.stdout.on('error', handleGone)
  proc.stderr.on('error', handleGone)

  proc.on('error', (error) => {
    console.warn(`[winrt] ${host} failed to start`, error)
    if (helper !== proc) return
    handleGone()
    if (hostIndex < POWERSHELL_HOSTS.length - 1) {
      // A missing or blocked 32-bit host: retry with the default one.
      hostIndex += 1
      startHelper()
    }
  })

  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) console.warn('[winrt] helper exited with', code)
    handleGone()
  })

  for (const handler of startHandlers) handler()
}

/** Starts the process if needed without taking a hold (used by re-subscribes). */
export function ensureBridge(): void {
  startHelper()
}

/** Takes a feature hold and (re)starts the shared helper. */
export function retainBridge(): void {
  refs += 1
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  startHelper()
}

/** Drops a hold; the process stops after `idleMs` when no hold is left. */
export function releaseBridge(idleMs: number): void {
  refs = Math.max(0, refs - 1)
  if (refs > 0) return
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (refs === 0) stopBridge()
  }, idleMs)
}

/** Writes a command line to the helper. Returns false when it is not running. */
export function sendBridge(command: string): boolean {
  if (!helper) return false
  // The exit event and the pipe error arrive a tick apart; the writable check
  // covers that window so a released helper never gets a buffered write.
  if (helper.stdin.destroyed || !helper.stdin.writable) return false
  try {
    helper.stdin.write(`${command}\n`)
    return true
  } catch {
    // Broken pipe: the error handler on the stream cleans up.
    return false
  }
}

export function onBridgeMessage(handler: MessageHandler): () => void {
  messageHandlers.add(handler)
  return () => messageHandlers.delete(handler)
}

/** Fires after every spawn, so feature state can be re-sent after a restart. */
export function onBridgeStart(handler: LifecycleHandler): () => void {
  startHandlers.add(handler)
  return () => startHandlers.delete(handler)
}

export function onBridgeExit(handler: LifecycleHandler): () => void {
  exitHandlers.add(handler)
  return () => exitHandlers.delete(handler)
}

export function isBridgeRunning(): boolean {
  return helper !== null
}

export function stopBridge(): void {
  refs = 0
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }

  const proc = helper
  helper = null
  if (!proc) return
  // Destroy the pipes first: `kill()` closes the child end, and any byte still
  // queued in stdin would otherwise surface as EPIPE a tick later.
  for (const stream of [proc.stdin, proc.stdout, proc.stderr]) {
    try {
      stream.destroy()
    } catch {
      // Already gone.
    }
  }
  try {
    proc.kill()
  } catch {
    // Already gone.
  }
}