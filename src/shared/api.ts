import type { Settings } from './settings'

export interface AppInfo {
  version: string
  electron: string
  platform: string
  isPackaged: boolean
}

/** API exposed to the renderer through `window.island` (see preload/index.ts). */
export interface IslandApi {
  getSettings(): Promise<Settings>
  patchSettings(patch: Partial<Settings>): Promise<Settings>
  hideIsland(): Promise<void>
  /** Grows/shrinks the window so the animated pill never gets clipped. */
  setExpanded(expanded: boolean): Promise<void>
  getAppInfo(): Promise<AppInfo>
  onSettingsChanged(callback: (settings: Settings) => void): () => void
  /** Fired when the island is hidden (hotkey, tray or the close button). */
  onHidden(callback: () => void): () => void
  /** Lets the main process know the UI mounted (used by `--smoke-test`). */
  reportReady(): void
}