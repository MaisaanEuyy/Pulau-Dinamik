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
  mediaSubscribe: 'media:subscribe',
  mediaUnsubscribe: 'media:unsubscribe',
  mediaCommand: 'media:command',
  mediaUpdate: 'media:update',
  volumeUpdate: 'volume:update',
  appInfo: 'app:info',
  rendererReady: 'renderer:ready'
} as const
