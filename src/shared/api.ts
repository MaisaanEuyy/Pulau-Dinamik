import type { MediaCommand, MediaState } from './media'
import type { KeyboardPulse, KeyboardState } from './keyboard'
import type { IslandNotification } from './notifications'
import type { Settings } from './settings'
import type { SystemSnapshot } from './system'
import type { ToastAccess } from './toast'
import type { VolumeState } from './volume'

export interface AppInfo {
  version: string
  electron: string
  platform: string
  isPackaged: boolean
  /** Port the local notification API is listening on, or `null` if it failed. */
  notifyPort: number | null
}

/** API exposed to the renderer through `window.island` (see preload/index.ts). */
export interface IslandApi {
  getSettings(): Promise<Settings>
  patchSettings(patch: Partial<Settings>): Promise<Settings>
  hideIsland(): Promise<void>
  /** Slides the island back down (used when a notification arrives while hidden). */
  showIsland(): Promise<void>
  /** Expands the window's interactive region so the island can grow. */
  setExpanded(expanded: boolean): Promise<void>
  /** Current visibility of the island window (false while hidden in the tray). */
  getVisibility(): Promise<boolean>
  /** Fired when the tray (or another entry point) asks for a section to open. */
  onOpenSection(callback: (section: string) => void): () => void
  /** Fired on show/hide so panels can pause sampling while invisible. */
  onVisibilityChanged(callback: (visible: boolean) => void): () => void
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
  /** Fired just before the window slides up into the top edge. */
  onHiding(callback: () => void): () => void
  /** Fired when the window slides back down into place. */
  onShowing(callback: () => void): () => void
  onSystemUpdate(callback: (snapshot: SystemSnapshot) => void): () => void
  onMediaUpdate(callback: (state: MediaState) => void): () => void
  /** Fired whenever the system volume or mute state changes. */
  onVolumeUpdate(callback: (state: VolumeState) => void): () => void
  /** Starts the Core Audio peak meter that drives the beat visualiser. */
  subscribeBeat(): Promise<void>
  /** Stops the peak meter. */
  unsubscribeBeat(): Promise<void>
  /** Fired ~60×/s with the current output peak (0..1). */
  onBeatUpdate(callback: (peak: number) => void): () => void
  /** Starts the keyboard watcher if needed and returns the current state. */
  subscribeKeyboard(): Promise<KeyboardState | null>
  /** Stops the watcher and removes the keyboard hook. */
  unsubscribeKeyboard(): Promise<void>
  onKeyboardUpdate(callback: (state: KeyboardState) => void): () => void
  /** Anonymous key-down counts; the key codes never leave the main process. */
  onKeyboardPulse(callback: (pulse: KeyboardPulse) => void): () => void
  /** Notifications posted through the local API since the app started. */
  getNotifications(): Promise<IslandNotification[]>
  /** Empties the in-memory notification list. */
  clearNotifications(): Promise<void>
  /** Fired for every notification accepted by the local API. */
  onNotification(callback: (notification: IslandNotification) => void): () => void
  /** Starts the Windows notification bridge and reports whether it may read toasts. */
  subscribeToasts(): Promise<ToastAccess>
  /** Stops the bridge after a short idle period. */
  unsubscribeToasts(): Promise<void>
  /** Fired when the Windows toast access state is (re)reported. */
  onToastAccess(callback: (access: ToastAccess) => void): () => void
  /** Lets the main process know the UI mounted (used by `--smoke-test`). */
  reportReady(): void
}