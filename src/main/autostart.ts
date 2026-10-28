import { app } from 'electron'
import { getSettings } from './settings'

/**
 * Mirrors the stored preference into the Windows "run at login" entry.
 * In development we only keep the preference, because registering
 * `electron.exe` as a login item would be confusing.
 */
export function applyLoginItem(enabled: boolean): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
}

export function syncLoginItem(): void {
  applyLoginItem(getSettings().launchAtLogin)
}