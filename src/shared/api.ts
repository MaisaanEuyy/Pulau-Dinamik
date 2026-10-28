import type { Settings } from './settings'
import type { SystemSnapshot } from './system'

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
  /** Expands the window's interactive region so the island can grow. */
  setExpanded(expanded: boolean): Promise<void>
  /** Starts the sampler if needed and returns the latest snapshot. */
  subscribeSystem(): Promise<SystemSnapshot | null>
  /** Stops the sampler; called when the System panel is no longer visible. */
  unsubscribeSystem(): Promise<void>
  getAppInfo(): Promise<AppInfo>
  onSettingsChanged(callback: (settings: Settings) => void): () => void
  /** Fired when the island is hidden (hotkey, tray or the close button). */
  onHidden(callback: () => void): () => void
  onSystemUpdate(callback: (snapshot: SystemSnapshot) => void): () => void
  /** Lets the main process know the UI mounted (used by `--smoke-test`). */
  reportReady(): void
}