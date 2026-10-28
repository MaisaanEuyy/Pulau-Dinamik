/** IPC channel names shared between the main process, preload and renderer. */
export const IPC = {
  settingsGet: 'settings:get',
  settingsPatch: 'settings:patch',
  settingsChanged: 'settings:changed',
  islandHide: 'island:hide',
  appInfo: 'app:info',
  rendererReady: 'renderer:ready'
} as const