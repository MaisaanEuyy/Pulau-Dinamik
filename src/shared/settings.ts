import { DEFAULT_FEATURES, type FeatureFlags } from './features'

/** Colour scheme of the island. */
export type ThemeMode = 'dark' | 'light'

export const THEME_MODES: readonly ThemeMode[] = ['dark', 'light']

/**
 * Persisted user settings. Keep this list flat and small – it is written to
 * `%APPDATA%/dynamic-island-kw/settings.json`.
 */
export interface Settings {
  /** Distance (in DIP) between the top of the work area and the island. */
  topOffset: number
  /** Electron display id, or `null` for the primary display. */
  displayId: number | null
  /** Electron accelerator used to toggle the island globally. */
  hotkey: string
  /** Start the app when the user signs in to Windows. */
  launchAtLogin: boolean
  /** Mirror the current track to the Discord profile as a "Listening" card. */
  discordPresence: boolean
  /** Let the smiley be poked and dragged, and let it doze off when idle. */
  smileyInteractive: boolean
  /**
   * Optional modules that may be switched off to save CPU and memory. A disabled
   * module stops its background work, it is not merely hidden.
   */
  features: FeatureFlags
  /** Light or dark island chrome. */
  theme: ThemeMode
  /**
   * Trade animation smoothness for memory: hardware acceleration is disabled at
   * startup (software compositing, a much smaller GPU process) and the renderer
   * may throttle while hidden. Read once before `app.whenReady()`, so a change
   * needs a restart.
   */
  lowMemoryMode: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  topOffset: 6,
  displayId: null,
  hotkey: 'Control+Alt+Space',
  launchAtLogin: false,
  discordPresence: true,
  smileyInteractive: true,
  features: { ...DEFAULT_FEATURES },
  theme: 'dark',
  lowMemoryMode: false
}
