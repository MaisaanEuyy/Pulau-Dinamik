/** IPC channel names shared between the main process, preload and renderer. */
export const IPC = {
  settingsGet: 'settings:get',
  settingsPatch: 'settings:patch',
  settingsChanged: 'settings:changed',
  islandHide: 'island:hide',
  islandSetExpanded: 'island:set-expanded',
  islandHidden: 'island:hidden',
  systemSubscribe: 'system:subscribe',
  systemUnsubscribe: 'system:unsubscribe',
  systemUpdate: 'system:update',
  appInfo: 'app:info',
  rendererReady: 'renderer:ready'
} as const