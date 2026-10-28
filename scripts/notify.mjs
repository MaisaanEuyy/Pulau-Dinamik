#!/usr/bin/env node
/**
 * Posts a notification to the Dynamic Island local API.
 *
 *   npm run notify -- -t "Build done" -m "3.2 s · 42 tests" -l success -a build
 *
 * Flags: -t/--title (required), -m/--message, -a/--app, -l/--level,
 *        -p/--port (skips discovery), -h/--help.
 * Positional form: `npm run notify -- "Build done" "3.2 s"`.
 *
 * The API listens on 127.0.0.1 starting at port 43110; when that port is busy
 * the app walks up a few ports, so the CLI probes /health to find it.
 */

const PORT_START = 43110
const PORT_TRIES = 10
const LEVELS = new Set(['info', 'success', 'warning', 'error'])

const HELP = `Post a notification to Dynamic Island KW.

Usage:
  npm run notify -- -t "Title" [-m "Message"] [-a app] [-l level] [-p port]

Options:
  -t, --title    Notification title (required)
  -m, --message  Optional body text
  -a, --app      Optional source label, e.g. "build"
  -l, --level    info | success | warning | error (default: info)
  -p, --port     API port (default: discovered from 43110-43119)
  -h, --help     Show this help

Examples:
  npm run notify -- -t "Build done" -m "42 tests passed" -l success -a ci
  npm run notify -- "Coffee is ready"
`

function parseArgs(argv) {
  const options = { title: null, message: null, app: null, level: 'info', port: null, help: false }
  const positional = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      index += 1
      return argv[index]
    }

    if (arg === '-h' || arg === '--help') options.help = true
    else if (arg === '-t' || arg === '--title') options.title = next() ?? null
    else if (arg === '-m' || arg === '--message') options.message = next() ?? null
    else if (arg === '-a' || arg === '--app') options.app = next() ?? null
    else if (arg === '-l' || arg === '--level') options.level = next() ?? 'info'
    else if (arg === '-p' || arg === '--port') options.port = Number(next())
    else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`)
    else positional.push(arg)
  }

  if (!options.title && positional.length > 0) options.title = positional.shift()
  if (!options.message && positional.length > 0) options.message = positional.join(' ')
  return options
}

async function healthy(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(800)
    })
    if (!response.ok) return false
    const body = await response.json()
    return body?.app === 'dynamic-island-kw'
  } catch {
    return false
  }
}

async function findPort(explicit) {
  if (explicit) {
    if (!Number.isInteger(explicit) || explicit < 1 || explicit > 65535) {
      throw new Error(`invalid port ${explicit}`)
    }
    return explicit
  }
  for (let index = 0; index < PORT_TRIES; index += 1) {
    const port = PORT_START + index
    if (await healthy(port)) return port
  }
  throw new Error(
    `no Dynamic Island API found on 127.0.0.1:${PORT_START}-${PORT_START + PORT_TRIES - 1} — is the app running?`
  )
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(HELP)
    return
  }
  if (!options.title || !options.title.trim()) {
    throw new Error('a title is required (use -t "Title")')
  }
  if (!LEVELS.has(options.level)) {
    throw new Error(`invalid level "${options.level}" (use info, success, warning or error)`)
  }

  const port = await findPort(options.port)
  const payload = {
    title: options.title,
    level: options.level
  }
  if (options.message) payload.message = options.message
  if (options.app) payload.app = options.app

  const response = await fetch(`http://127.0.0.1:${port}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(3000)
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.ok !== true) {
    throw new Error(body.error ? `${body.error} (HTTP ${response.status})` : `HTTP ${response.status}`)
  }

  process.stdout.write(`notified ${port}: ${payload.title}${body.id ? ` (${body.id})` : ''}\n`)
}

main().catch((error) => {
  process.stderr.write(`notify: ${error.message}\n`)
  process.exit(1)
})