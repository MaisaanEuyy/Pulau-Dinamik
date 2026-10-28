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
  getAppInfo(): Promise<AppInfo>
  onSettingsChanged(callback: (settings: Settings) => void): () => void
  /** Lets the main process know the UI mounted (used by `--smoke-test`). */
  reportReady(): void
}