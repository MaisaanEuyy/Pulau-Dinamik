import { contextBridge, ipcRenderer } from 'electron'
import type { AppInfo, IslandApi } from '../shared/api'
import { IPC } from '../shared/ipc'
import type { Settings } from '../shared/settings'
import type { SystemSnapshot } from '../shared/system'

const api: IslandApi = {
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<Settings>,
  patchSettings: (patch) => ipcRenderer.invoke(IPC.settingsPatch, patch) as Promise<Settings>,
  hideIsland: () => ipcRenderer.invoke(IPC.islandHide) as Promise<void>,
  setExpanded: (expanded) => ipcRenderer.invoke(IPC.islandSetExpanded, expanded) as Promise<void>,
  subscribeSystem: () => ipcRenderer.invoke(IPC.systemSubscribe) as Promise<SystemSnapshot | null>,
  unsubscribeSystem: () => ipcRenderer.invoke(IPC.systemUnsubscribe) as Promise<void>,
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
  reportReady: () => {
    ipcRenderer.send(IPC.rendererReady)
  }
}

contextBridge.exposeInMainWorld('island', api)