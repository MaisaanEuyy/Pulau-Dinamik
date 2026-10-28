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
}

export const DEFAULT_SETTINGS: Settings = {
  topOffset: 6,
  displayId: null,
  hotkey: 'Control+Alt+Space',
  launchAtLogin: false
}