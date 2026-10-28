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
import { subscribeKeyboard, unsubscribeKeyboard, isKeyboardHookActive } from './services/keyboard'
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
import {
  clearNotifications,
  getNotifications,
  getNotificationPort,
  startNotificationServer,
  stopNotificationServer,
  pushNotification
} from './services/notifications'
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
/** The mini view keeps a panel subscribed while collapsed, so both the mini
 * and the full panel can hold a subscription at the same time. */
let systemSubscribers = 0
let keyboardSubscribers = 0

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

  ipcMain.handle(IPC.islandGetVisible, () => {
    const win = getIslandWindow()
    return Boolean(win && !win.isDestroyed() && win.isVisible())
  })

  ipcMain.handle(IPC.systemSubscribe, () => {
    systemSubscribers += 1
    return startSystemSampler()
  })
  ipcMain.handle(IPC.systemUnsubscribe, () => {
    systemSubscribers = Math.max(0, systemSubscribers - 1)
    if (systemSubscribers === 0) stopSystemSampler()
  })

  ipcMain.handle(IPC.mediaSubscribe, () => subscribeMedia())
  ipcMain.handle(IPC.mediaUnsubscribe, () => {
    unsubscribeMedia()
  })
  ipcMain.handle(IPC.mediaCommand, (_event, command: MediaCommand) => {
    sendMediaCommand(command)
  })

  ipcMain.handle(IPC.keyboardSubscribe, () => {
    keyboardSubscribers += 1
    return subscribeKeyboard()
  })
  ipcMain.handle(IPC.keyboardUnsubscribe, () => {
    keyboardSubscribers = Math.max(0, keyboardSubscribers - 1)
    if (keyboardSubscribers === 0) unsubscribeKeyboard()
  })

  ipcMain.handle(IPC.notificationsGet, () => getNotifications())
  ipcMain.handle(IPC.notificationsClear, () => {
    clearNotifications()
  })

  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    isPackaged: app.isPackaged,
    notifyPort: getNotificationPort()
  }))

  ipcMain.on(IPC.rendererReady, () => {
    rendererReady = true
    const win = getIslandWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.islandVisibility, win.isVisible())
    }
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

  /** Reads the lock state and confirms the keyboard hook was installed. */
  const verifyKeyboard = async (): Promise<{
    ok: boolean
    hook: boolean
    caps: boolean | null
    num: boolean | null
    scroll: boolean | null
  }> => {
    const state = subscribeKeyboard()
    const hook = isKeyboardHookActive()
    unsubscribeKeyboard()

    return {
      ok: state !== null,
      hook,
      caps: state?.caps ?? null,
      num: state?.num ?? null,
      scroll: state?.scroll ?? null
    }
  }

  /** Drives the shell through hover → pin → escape → double-click hide. */
  const verifyInteractions = async (): Promise<{
    hoverStaysCollapsed: boolean
    clickExpands: boolean
    pinHoldsOpen: boolean
    escapeCollapses: boolean
    hideOnDoubleClick: boolean
    resetOnHide: boolean
  }> => {
    const result = {
      hoverStaysCollapsed: false,
      clickExpands: false,
      pinHoldsOpen: false,
      escapeCollapses: false,
      hideOnDoubleClick: false,
      resetOnHide: false
    }
    if (!rendererReady) return result

    const point = headerPoint()
    // The pill now hosts quick controls, so hovering it must not expand it.
    win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
    await wait(350)
    result.hoverStaysCollapsed = (await islandState())?.expanded === false

    click(point.x, point.y, 1)
    await wait(320)
    result.clickExpands = (await islandState())?.expanded === true

    // A second click on the header pins the island.
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

  /** Posts to the local API over HTTP and checks the notification was stored. */
  const verifyNotifications = async (): Promise<{
    ok: boolean
    port: number | null
    health: boolean
    posted: boolean
    count: number
  }> => {
    const notifyPort = await startNotificationServer()
    if (!notifyPort) return { ok: false, port: null, health: false, posted: false, count: 0 }

    const base = `http://127.0.0.1:${notifyPort}`
    let health = false
    let posted = false
    try {
      const response = await fetch(`${base}/health`)
      const body = (await response.json()) as { ok?: boolean; app?: string }
      health = response.ok && body.ok === true && body.app === 'dynamic-island-kw'

      const post = await fetch(`${base}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Smoke test',
          message: 'notifications are wired up',
          app: 'smoke',
          level: 'success'
        })
      })
      const payload = (await post.json()) as { ok?: boolean; id?: string }
      posted = post.ok && payload.ok === true && typeof payload.id === 'string'
    } catch (error) {
      console.warn('[smoke] notification API request failed', error)
    }

    // Keep one entry in the list so the renderer has something to show.
    if (!posted) pushNotification({ title: 'Smoke test', app: 'smoke', level: 'success' })
    const count = getNotifications().length

    return { ok: health && posted && count > 0, port: notifyPort, health, posted, count }
  }

  const finish = (interactions: {
    hoverStaysCollapsed: boolean
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
  }, keyboard: {
    ok: boolean
    hook: boolean
    caps: boolean | null
    num: boolean | null
    scroll: boolean | null
  }, notifications: {
    ok: boolean
    port: number | null
    health: boolean
    posted: boolean
    count: number
  }): void => {
    const bounds = win.getBounds()
    console.log(
      `[smoke] ${JSON.stringify({
        ok:
          rendererReady &&
          interactions.hoverStaysCollapsed &&
          interactions.clickExpands &&
          interactions.pinHoldsOpen &&
          interactions.escapeCollapses &&
          interactions.hideOnDoubleClick &&
          interactions.resetOnHide &&
          system.ok &&
          media.ok &&
          volume.ok &&
          keyboard.ok &&
          notifications.ok,
        rendererReady,
        ...interactions,
        system,
        media,
        volume,
        keyboard,
        notifications,
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
        const keyboard = await verifyKeyboard()
        const notifications = await verifyNotifications()
        const interactions = await verifyInteractions()
        finish(interactions, system, media, volume, keyboard, notifications)
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

  registerIpc()
  // The notification API must be listening before the renderer asks for the
  // app info (the Alerts section shows the port).
  await startNotificationServer()

  const win = createIslandWindow({ showOnReady: !launchedHidden })
  // Safety net: the renderer normally unsubscribes, but hiding must always idle us.
  win.on('hide', () => {
    systemSubscribers = 0
    keyboardSubscribers = 0
    stopSystemSampler()
    releaseMedia()
    unsubscribeKeyboard()
  })
  createTray()
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
    stopNotificationServer()
    stopVolumeWatcher()
    unsubscribeKeyboard()
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