import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { app } from 'electron'
import { IPC } from '../../shared/ipc'
import {
  NOTIFICATION_LIMIT,
  NOTIFICATION_LEVELS,
  NOTIFY_PORT_START,
  NOTIFY_PORT_TRIES,
  type IslandNotification,
  type NotificationLevel,
  type NotifyPayload
} from '../../shared/notifications'
import { getIslandWindow } from '../windows/island'

const HOST = '127.0.0.1'
const BODY_LIMIT = 16 * 1024

const items: IslandNotification[] = []
let server: Server | null = null
let port: number | null = null
let startedAt = 0
let starting: Promise<number | null> | null = null

function send(channel: string, payload: unknown): void {
  const win = getIslandWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(channel, payload)
}

function trim(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > 0 ? text.slice(0, max) : null
}

function asLevel(value: unknown): NotificationLevel {
  return typeof value === 'string' && (NOTIFICATION_LEVELS as readonly string[]).includes(value)
    ? (value as NotificationLevel)
    : 'info'
}

/** Adds a notification, caps the list and tells the renderer about it. */
export function pushNotification(input: NotifyPayload): IslandNotification | null {
  const title = trim(input.title, 120)
  if (!title) return null

  const notification: IslandNotification = {
    id: randomUUID(),
    title,
    message: trim(input.message, 480),
    app: trim(input.app, 48),
    level: asLevel(input.level),
    createdAt: Date.now()
  }

  items.unshift(notification)
  if (items.length > NOTIFICATION_LIMIT) items.length = NOTIFICATION_LIMIT
  send(IPC.notification, notification)
  return notification
}

export function getNotifications(): IslandNotification[] {
  return [...items]
}

export function clearNotifications(): void {
  items.length = 0
}

export function getNotificationPort(): number | null {
  return port
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store'
  })
  response.end(text)
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    let text = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk)
      if (size > BODY_LIMIT) {
        reject(new Error('payload too large'))
        request.destroy()
        return
      }
      text += chunk
    })
    request.on('end', () => resolve(text))
    request.on('error', reject)
  })
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = (request.url ?? '/').split('?')[0]

  if (request.method === 'GET' && (url === '/health' || url === '/')) {
    json(response, 200, {
      ok: true,
      app: 'dynamic-island-kw',
      version: app.getVersion(),
      port,
      notifications: items.length,
      uptimeMs: Date.now() - startedAt
    })
    return
  }

  if (request.method === 'POST' && url === '/notify') {
    let payload: unknown
    try {
      payload = JSON.parse(await readBody(request))
    } catch (error) {
      json(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : 'invalid JSON body'
      })
      return
    }
    if (!payload || typeof payload !== 'object') {
      json(response, 400, { ok: false, error: 'expected a JSON object' })
      return
    }

    const notification = pushNotification(payload as NotifyPayload)
    if (!notification) {
      json(response, 400, { ok: false, error: '"title" is required' })
      return
    }

    json(response, 200, { ok: true, id: notification.id })
    return
  }

  json(response, 404, { ok: false, error: 'not found' })
}

function listen(instance: Server, candidate: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      instance.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      instance.off('error', onError)
      resolve()
    }
    instance.once('error', onError)
    instance.once('listening', onListening)
    instance.listen(candidate, HOST)
  })
}

async function bind(): Promise<number | null> {
  for (let index = 0; index < NOTIFY_PORT_TRIES; index += 1) {
    const candidate = NOTIFY_PORT_START + index
    const instance = createServer((request, response) => {
      void handle(request, response).catch((error) => {
        console.warn('[notify] request failed', error)
        if (!response.headersSent) json(response, 500, { ok: false, error: 'internal error' })
        else response.end()
      })
    })

    try {
      await listen(instance, candidate)
      server = instance
      port = candidate
      startedAt = Date.now()
      console.log(`[notify] listening on http://${HOST}:${candidate}`)
      return candidate
    } catch (error) {
      instance.close()
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EADDRINUSE') {
        console.warn(`[notify] could not listen on ${candidate}`, error)
        return null
      }
    }
  }

  console.warn('[notify] no free port in the 43110-43119 range')
  return null
}

/** Starts the local API once; resolves with the port (or null when unavailable). */
export function startNotificationServer(): Promise<number | null> {
  if (port !== null) return Promise.resolve(port)
  if (starting) return starting
  starting = bind().finally(() => {
    starting = null
  })
  return starting
}

export function stopNotificationServer(): void {
  const instance = server
  server = null
  port = null
  if (instance) instance.close()
}