import type { MediaCommand, MediaState } from './media'
import type { Settings } from './settings'
import type { SystemSnapshot } from './system'
import type { VolumeState } from './volume'

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
  /** Starts the SMTC helper if needed and returns the latest now-playing state. */
  subscribeMedia(): Promise<MediaState | null>
  /** Releases the helper; it stops after a short idle period. */
  unsubscribeMedia(): Promise<void>
  /** Sends a transport command to the current media session. */
  sendMediaCommand(command: MediaCommand): Promise<void>
  getAppInfo(): Promise<AppInfo>
  onSettingsChanged(callback: (settings: Settings) => void): () => void
  /** Fired when the island is hidden (hotkey, tray or the close button). */
  onHidden(callback: () => void): () => void
  onSystemUpdate(callback: (snapshot: SystemSnapshot) => void): () => void
  onMediaUpdate(callback: (state: MediaState) => void): () => void
  /** Fired whenever the system volume or mute state changes. */
  onVolumeUpdate(callback: (state: VolumeState) => void): () => void
  /** Lets the main process know the UI mounted (used by `--smoke-test`). */
  reportReady(): void
}