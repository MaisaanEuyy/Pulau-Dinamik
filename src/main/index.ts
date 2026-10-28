import { app, globalShortcut, ipcMain, screen, type BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import type { Settings } from '../shared/settings'
import { syncLoginItem, applyLoginItem } from './autostart'
import { getSettings, patchSettings, settingsFilePath } from './settings'
import { createTray, destroyTray } from './tray'
import {
  createIslandWindow,
  getIslandWindow,
  hideIsland,
  markQuitting,
  repositionIsland,
  showIsland,
  toggleIsland
} from './windows/island'

const APP_USER_MODEL_ID = 'com.kodingan.dynamicisland'
const launchedHidden = process.argv.includes('--hidden')
const smokeTest = process.argv.includes('--smoke-test')

let hotkeyRegistered = false
let rendererReady = false

app.setAppUserModelId(APP_USER_MODEL_ID)

function registerHotkey(): void {
  globalShortcut.unregisterAll()
  const { hotkey } = getSettings()
  try {
    hotkeyRegistered = globalShortcut.register(hotkey, toggleIsland)
    if (!hotkeyRegistered) {
      console.warn(`[hotkey] "${hotkey}" is already in use by another application`)
    }
  } catch (error) {
    hotkeyRegistered = false
    console.warn(`[hotkey] invalid accelerator "${hotkey}"`, error)
  }
}

function broadcastSettings(settings: Settings): void {
  const win = getIslandWindow()
  if (win && !win.isDestroyed()) win.webContents.send(IPC.settingsChanged, settings)
}

function registerIpc(): void {
  ipcMain.handle(IPC.settingsGet, () => getSettings())

  ipcMain.handle(IPC.settingsPatch, (_event, patch: Partial<Settings>) => {
    const previous = getSettings()
    const next = patchSettings(patch ?? {})

    if (previous.hotkey !== next.hotkey) registerHotkey()
    if (previous.topOffset !== next.topOffset || previous.displayId !== next.displayId) {
      repositionIsland()
    }
    if (previous.launchAtLogin !== next.launchAtLogin) applyLoginItem(next.launchAtLogin)

    broadcastSettings(next)
    return next
  })

  ipcMain.handle(IPC.islandHide, () => {
    hideIsland()
  })

  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    isPackaged: app.isPackaged
  }))

  ipcMain.on(IPC.rendererReady, () => {
    rendererReady = true
    console.log('[island] renderer ready')
  })
}

/** Prints diagnostics and exits. Used by `npm run smoke`. */
function runSmokeTest(win: BrowserWindow): void {
  const startedAt = Date.now()
  const finish = (): void => {
    const bounds = win.getBounds()
    console.log(
      `[smoke] ${JSON.stringify({
        ok: rendererReady,
        rendererReady,
        visible: win.isVisible(),
        alwaysOnTop: win.isAlwaysOnTop(),
        hotkeyRegistered,
        bounds,
        settingsFile: settingsFilePath(),
        displays: screen.getAllDisplays().map((display) => ({
          id: display.id,
          size: display.workArea,
          scaleFactor: display.scaleFactor
        })),
        elapsedMs: Date.now() - startedAt
      })}`
    )
    markQuitting()
    app.quit()
  }

  const deadline = Date.now() + 8000
  const timer = setInterval(() => {
    if (rendererReady || Date.now() > deadline) {
      clearInterval(timer)
      setTimeout(finish, 500)
    }
  }, 100)
}

function handleDisplays(): void {
  repositionIsland()

  const { displayId } = getSettings()
  if (displayId !== null && !screen.getAllDisplays().some((display) => display.id === displayId)) {
    // The selected monitor was unplugged – hop back to the primary one.
    patchSettings({ displayId: null })
  }
}

async function bootstrap(): Promise<void> {
  await app.whenReady()

  const win = createIslandWindow({ showOnReady: !launchedHidden })
  createTray()
  registerIpc()
  registerHotkey()
  syncLoginItem()

  screen.on('display-metrics-changed', handleDisplays)
  screen.on('display-added', handleDisplays)
  screen.on('display-removed', handleDisplays)

  if (smokeTest) runSmokeTest(win)
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => showIsland())

  // The app is a tray resident: never quit when the island is hidden.
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => {
    markQuitting()
    globalShortcut.unregisterAll()
    destroyTray()
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => {
      const devUrl = process.env['ELECTRON_RENDERER_URL']
      if (devUrl && url.startsWith(devUrl)) return
      event.preventDefault()
    })
  })

  bootstrap().catch((error) => {
    console.error('[island] failed to start', error)
    app.exit(1)
  })
}