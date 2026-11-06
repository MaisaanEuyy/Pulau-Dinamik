import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { sanitizeFeatures, DEFAULT_FEATURES } from '../shared/features'
import { DEFAULT_SETTINGS, THEME_MODES, type Settings, type ThemeMode } from '../shared/settings'

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
  const discordPresence =
    typeof raw.discordPresence === 'boolean'
      ? raw.discordPresence
      : DEFAULT_SETTINGS.discordPresence
  const smileyInteractive =
    typeof raw.smileyInteractive === 'boolean'
      ? raw.smileyInteractive
      : DEFAULT_SETTINGS.smileyInteractive
  const theme = THEME_MODES.includes(raw.theme as ThemeMode)
    ? (raw.theme as ThemeMode)
    : DEFAULT_SETTINGS.theme
  const features = sanitizeFeatures(raw.features)

  return {
    topOffset,
    displayId,
    hotkey,
    launchAtLogin,
    discordPresence,
    smileyInteractive,
    features,
    theme
  }
}

export function getSettings(): Settings {
  if (!cache) {
    try {
      cache = sanitize(JSON.parse(readFileSync(settingsFilePath(), 'utf8')))
    } catch {
      cache = { ...DEFAULT_SETTINGS, features: { ...DEFAULT_FEATURES } }
    }
  }
  return { ...cache, features: { ...cache.features } }
}

export function patchSettings(patch: Partial<Settings>): Settings {
  const current = getSettings()
  // `features` is the only nested object; merge it so a caller may send just the
  // switches it touched instead of a whole copy.
  const features = sanitizeFeatures({ ...current.features, ...(patch.features ?? {}) })
  const next = sanitize({ ...current, ...patch, features })
  cache = next
  persist(next)
  return { ...next, features: { ...next.features } }
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