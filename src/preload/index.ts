import { contextBridge, ipcRenderer } from 'electron'
import type { AppInfo, IslandApi } from '../shared/api'
import { IPC } from '../shared/ipc'
import type { KeyboardPulse, KeyboardState } from '../shared/keyboard'
import type { MediaCommand, MediaState } from '../shared/media'
import type { Settings } from '../shared/settings'
import type { SystemSnapshot } from '../shared/system'
import type { VolumeState } from '../shared/volume'

const api: IslandApi = {
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<Settings>,
  patchSettings: (patch) => ipcRenderer.invoke(IPC.settingsPatch, patch) as Promise<Settings>,
  hideIsland: () => ipcRenderer.invoke(IPC.islandHide) as Promise<void>,
  setExpanded: (expanded) => ipcRenderer.invoke(IPC.islandSetExpanded, expanded) as Promise<void>,
  subscribeSystem: () => ipcRenderer.invoke(IPC.systemSubscribe) as Promise<SystemSnapshot | null>,
  unsubscribeSystem: () => ipcRenderer.invoke(IPC.systemUnsubscribe) as Promise<void>,
  subscribeMedia: () => ipcRenderer.invoke(IPC.mediaSubscribe) as Promise<MediaState | null>,
  unsubscribeMedia: () => ipcRenderer.invoke(IPC.mediaUnsubscribe) as Promise<void>,
  sendMediaCommand: (command: MediaCommand) =>
    ipcRenderer.invoke(IPC.mediaCommand, command) as Promise<void>,
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo) as Promise<AppInfo>,
  onSettingsChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: Settings): void =>
      callback(settings)
    ipcRenderer.on(IPC.settingsChanged, handler)
    return () => {
      ipcRenderer.removeListener(IPC.settingsChanged, handler)
    }
  },
  onHidden: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC.islandHidden, handler)
    return () => {
      ipcRenderer.removeListener(IPC.islandHidden, handler)
    }
  },
  onSystemUpdate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: SystemSnapshot): void =>
      callback(snapshot)
    ipcRenderer.on(IPC.systemUpdate, handler)
    return () => {
      ipcRenderer.removeListener(IPC.systemUpdate, handler)
    }
  },
  onMediaUpdate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, state: MediaState): void =>
      callback(state)
    ipcRenderer.on(IPC.mediaUpdate, handler)
    return () => {
      ipcRenderer.removeListener(IPC.mediaUpdate, handler)
    }
  },
  onVolumeUpdate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, state: VolumeState): void =>
      callback(state)
    ipcRenderer.on(IPC.volumeUpdate, handler)
    return () => {
      ipcRenderer.removeListener(IPC.volumeUpdate, handler)
    }
  },
  subscribeKeyboard: () =>
    ipcRenderer.invoke(IPC.keyboardSubscribe) as Promise<KeyboardState | null>,
  unsubscribeKeyboard: () =>
    ipcRenderer.invoke(IPC.keyboardUnsubscribe) as Promise<void>,
  onKeyboardUpdate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, state: KeyboardState): void =>
      callback(state)
    ipcRenderer.on(IPC.keyboardUpdate, handler)
    return () => {
      ipcRenderer.removeListener(IPC.keyboardUpdate, handler)
    }
  },
  onKeyboardPulse: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, pulse: KeyboardPulse): void =>
      callback(pulse)
    ipcRenderer.on(IPC.keyboardPulse, handler)
    return () => {
      ipcRenderer.removeListener(IPC.keyboardPulse, handler)
    }
  },
  reportReady: () => {
    ipcRenderer.send(IPC.rendererReady)
  }
}

contextBridge.exposeInMainWorld('island', api)