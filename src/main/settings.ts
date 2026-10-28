import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings'

let cache: Settings | null = null

export function settingsFilePath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Drops unknown keys and fixes wrong types coming from a hand-edited file. */
function sanitize(input: unknown): Settings {
  const raw = (input ?? {}) as Record<string, unknown>
  const topOffset =
    typeof raw.topOffset === 'number' && Number.isFinite(raw.topOffset)
      ? clamp(Math.round(raw.topOffset), 0, 120)
      : DEFAULT_SETTINGS.topOffset
  const displayId =
    typeof raw.displayId === 'number' && Number.isFinite(raw.displayId) ? raw.displayId : null
  const hotkey =
    typeof raw.hotkey === 'string' && raw.hotkey.trim().length > 0
      ? raw.hotkey.trim()
      : DEFAULT_SETTINGS.hotkey
  const launchAtLogin =
    typeof raw.launchAtLogin === 'boolean' ? raw.launchAtLogin : DEFAULT_SETTINGS.launchAtLogin

  return { topOffset, displayId, hotkey, launchAtLogin }
}

export function getSettings(): Settings {
  if (!cache) {
    try {
      cache = sanitize(JSON.parse(readFileSync(settingsFilePath(), 'utf8')))
    } catch {
      cache = { ...DEFAULT_SETTINGS }
    }
  }
  return { ...cache }
}

export function patchSettings(patch: Partial<Settings>): Settings {
  const next = sanitize({ ...getSettings(), ...patch })
  cache = next
  persist(next)
  return { ...next }
}

function persist(settings: Settings): void {
  const file = settingsFilePath()
  try {
    mkdirSync(dirname(file), { recursive: true })
    const temp = `${file}.tmp`
    writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
    renameSync(temp, file)
  } catch (error) {
    console.warn('[settings] could not persist settings', error)
  }
}