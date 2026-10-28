import { app, globalShortcut, ipcMain, screen, type BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import type { MediaCommand, MediaState } from '../shared/media'
import type { Settings } from '../shared/settings'
import { syncLoginItem, applyLoginItem } from './autostart'
import {
  getVolumeState,
  startVolumeWatcher,
  stopVolumeWatcher
} from './services/audio'
import {
  getMediaState,
  releaseMedia,
  sendMediaCommand,
  stopMediaHelper,
  subscribeMedia,
  unsubscribeMedia
} from './services/media'
import {
  getSystemSnapshot,
  startSystemSampler,
  stopSystemSampler
} from './services/system'
import { getSettings, patchSettings, settingsFilePath } from './settings'
import { createTray, destroyTray } from './tray'
import {
  createIslandWindow,
  getIslandWindow,
  hideIsland,
  markQuitting,
  repositionIsland,
  setIslandMode,
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

  ipcMain.handle(IPC.islandSetExpanded, (_event, expanded: boolean) => {
    setIslandMode(expanded ? 'expanded' : 'collapsed')
  })

  ipcMain.handle(IPC.systemSubscribe, () => startSystemSampler())
  ipcMain.handle(IPC.systemUnsubscribe, () => {
    stopSystemSampler()
  })

  ipcMain.handle(IPC.mediaSubscribe, () => subscribeMedia())
  ipcMain.handle(IPC.mediaUnsubscribe, () => {
    unsubscribeMedia()
  })
  ipcMain.handle(IPC.mediaCommand, (_event, command: MediaCommand) => {
    sendMediaCommand(command)
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
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  const click = (x: number, y: number, clickCount: number): void => {
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount })
    win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount })
  }

  /** The header spans the full width in both modes, so it is a safe click
   * target for the collapsed pill and the expanded island alike. */
  const headerPoint = (): { x: number; y: number } => ({
    x: Math.round(win.getBounds().width / 2),
    y: 22
  })

  const islandState = async (): Promise<{ expanded: boolean; pinned: boolean } | null> =>
    (await win.webContents
      .executeJavaScript(
        `(() => {
          const el = document.querySelector('.island')
          return el
            ? { expanded: el.dataset.expanded === 'true', pinned: el.dataset.pinned === 'true' }
            : null
        })()`
      )
      .catch(() => null)) as { expanded: boolean; pinned: boolean } | null

  /** Runs the sampler outside the UI and checks every collector produced data. */
  const verifySystem = async (): Promise<{
    ok: boolean
    cpuLoad: number | null
    memoryPercent: number | null
    gpu: string | null
    disk: string | null
    battery: number | null
    rxPerSec: number | null
  }> => {
    await startSystemSampler()
    // Two ticks: the first one only primes the CPU/network deltas.
    await wait(2400)
    const snapshot = getSystemSnapshot()
    stopSystemSampler()

    const memoryPercent =
      snapshot && snapshot.memory.totalBytes > 0
        ? Math.round((snapshot.memory.usedBytes / snapshot.memory.totalBytes) * 100)
        : null

    return {
      ok: Boolean(snapshot && snapshot.memory.totalBytes > 0 && snapshot.cpu.threads > 0),
      cpuLoad: snapshot?.cpu.load ?? null,
      memoryPercent,
      gpu: snapshot?.gpu?.name ?? null,
      disk: snapshot?.disk?.mount ?? null,
      battery: snapshot?.battery?.percent ?? null,
      rxPerSec: snapshot?.network?.rxPerSec ?? null
    }
  }

  /** Cold-starts the SMTC helper and checks it reported a state line. */
  const verifyMedia = async (): Promise<{
    ok: boolean
    active: boolean
    app: string | null
    title: string | null
    artwork: boolean
  }> => {
    let state: MediaState | null = await subscribeMedia()
    const deadline = Date.now() + 2000
    while (!state && Date.now() < deadline) {
      await wait(100)
      state = getMediaState()
    }
    unsubscribeMedia()

    return {
      ok: state !== null,
      active: state?.active ?? false,
      app: state?.app ?? null,
      title: state?.title ?? null,
      artwork: Boolean(state?.artwork)
    }
  }

  /** Waits for the Core Audio watcher to report the default endpoint volume. */
  const verifyVolume = async (): Promise<{
    ok: boolean
    level: number | null
    muted: boolean | null
  }> => {
    let state = getVolumeState()
    const deadline = Date.now() + 1500
    while (!state && Date.now() < deadline) {
      await wait(100)
      state = getVolumeState()
    }

    return {
      ok: state !== null,
      level: state ? Math.round(state.level * 100) : null,
      muted: state?.muted ?? null
    }
  }

  /** Drives the shell through hover → pin → escape → double-click hide. */
  const verifyInteractions = async (): Promise<{
    clickExpands: boolean
    pinHoldsOpen: boolean
    escapeCollapses: boolean
    hideOnDoubleClick: boolean
    resetOnHide: boolean
  }> => {
    const result = {
      clickExpands: false,
      pinHoldsOpen: false,
      escapeCollapses: false,
      hideOnDoubleClick: false,
      resetOnHide: false
    }
    if (!rendererReady) return result

    const point = headerPoint()
    win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
    await wait(300)
    result.clickExpands = (await islandState())?.expanded === true

    click(point.x, point.y, 1)
    await wait(250)

    // Pinned islands must stay open after the pointer leaves.
    win.webContents.sendInputEvent({ type: 'mouseLeave', x: 0, y: 0 })
    await wait(500)
    result.pinHoldsOpen = (await islandState())?.expanded === true

    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    await wait(600)
    result.escapeCollapses = (await islandState())?.expanded === false

    const collapsedPoint = headerPoint()
    click(collapsedPoint.x, collapsedPoint.y, 1)
    click(collapsedPoint.x, collapsedPoint.y, 2)
    await wait(400)
    result.hideOnDoubleClick = !win.isVisible()
    if (result.hideOnDoubleClick) {
      // Renderer state must be reset while hidden, otherwise the next show
      // would render an expanded pill inside the collapsed window.
      const hiddenState = (await win.webContents
        .executeJavaScript(
          `(() => {
            const el = document.querySelector('.island')
            return el ? { pinned: el.dataset.pinned, expanded: el.dataset.expanded } : null
          })()`
        )
        .catch(() => null)) as { pinned?: string; expanded?: string } | null
      result.resetOnHide = hiddenState?.pinned === 'false' && hiddenState?.expanded === 'false'

      showIsland()
      await wait(300)
    }

    return result
  }

  const finish = (interactions: {
    clickExpands: boolean
    pinHoldsOpen: boolean
    escapeCollapses: boolean
    hideOnDoubleClick: boolean
    resetOnHide: boolean
  }, system: {
    ok: boolean
    cpuLoad: number | null
    memoryPercent: number | null
    gpu: string | null
    disk: string | null
    battery: number | null
    rxPerSec: number | null
  }, media: {
    ok: boolean
    active: boolean
    app: string | null
    title: string | null
    artwork: boolean
  }, volume: {
    ok: boolean
    level: number | null
    muted: boolean | null
  }): void => {
    const bounds = win.getBounds()
    console.log(
      `[smoke] ${JSON.stringify({
        ok:
          rendererReady &&
          interactions.clickExpands &&
          interactions.pinHoldsOpen &&
          interactions.escapeCollapses &&
          interactions.hideOnDoubleClick &&
          interactions.resetOnHide &&
          system.ok &&
          media.ok &&
          volume.ok,
        rendererReady,
        ...interactions,
        system,
        media,
        volume,
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
      void (async () => {
        const system = await verifySystem()
        const media = await verifyMedia()
        const volume = await verifyVolume()
        const interactions = await verifyInteractions()
        finish(interactions, system, media, volume)
      })()
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
  // Safety net: the renderer normally unsubscribes, but hiding must always idle us.
  win.on('hide', () => {
    stopSystemSampler()
    releaseMedia()
  })
  createTray()
  registerIpc()
  registerHotkey()
  syncLoginItem()
  startVolumeWatcher()

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
    stopSystemSampler()
    stopMediaHelper()
    stopVolumeWatcher()
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