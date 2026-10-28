/** IPC channel names shared between the main process, preload and renderer. */
export const IPC = {
  settingsGet: 'settings:get',
  settingsPatch: 'settings:patch',
  settingsChanged: 'settings:changed',
  islandHide: 'island:hide',
  islandSetExpanded: 'island:set-expanded',
  islandHidden: 'island:hidden',
  appInfo: 'app:info',
  rendererReady: 'renderer:ready'
} as const