import { BrowserWindow, app, screen, systemPreferences } from 'electron'
import { join } from 'node:path'
import { IPC } from '../../shared/ipc'
import { ISLAND_LAYOUT } from '../../shared/layout'
import { getSettings } from '../settings'

export type IslandMode = 'collapsed' | 'expanded'

/** How far the window travels while tucking into the top edge, in DIP. */
const TUCK_DISTANCE = 78
const HIDE_SLIDE_MS = 260
const SHOW_SLIDE_MS = 260

let islandWindow: BrowserWindow | null = null
let quitting = false
let mode: IslandMode = 'collapsed'
/**
 * Tracks whether the island is supposed to be on screen. A `hide()` that lands
 * before the first `ready-to-show` must win over the initial auto-show.
 */
let visibleIntent = false
/** Bumped whenever a show/hide starts, so an in-flight slide gives up. */
let slideToken = 0

export function markQuitting(): void {
  quitting = true
}

export function getIslandWindow(): BrowserWindow | null {
  return islandWindow
}

export function getIslandMode(): IslandMode {
  return mode
}

/** Picks the configured display, falling back to the primary one. */
function resolveDisplay(displayId: number | null): Electron.Display {
  if (displayId !== null) {
    const match = screen.getAllDisplays().find((display) => display.id === displayId)
    if (match) return match
  }
  return screen.getPrimaryDisplay()
}

export function computeIslandBounds(): Electron.Rectangle {
  const { topOffset, displayId } = getSettings()
  const { workArea } = resolveDisplay(displayId)
  // The window always keeps the expanded footprint so it never has to be
  // resized. Resizing/moving a visible transparent window makes Windows
  // present one stale frame at the new origin, which reads as a blink.
  const { width, height } = ISLAND_LAYOUT.expanded

  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + topOffset)
  }
}

/** Only the pill stays interactive while collapsed — everything around it must
 * let clicks through to the desktop. */
function collapsedShape(): Electron.Rectangle[] {
  const { collapsed, expanded, inset } = ISLAND_LAYOUT
  return [
    {
      x: Math.round((expanded.width - collapsed.width) / 2),
      y: inset,
      width: collapsed.width,
      height: collapsed.height
    }
  ]
}

function applyShape(): void {
  if (process.platform !== 'win32') return
  if (!islandWindow || islandWindow.isDestroyed()) return
  islandWindow.setShape(mode === 'collapsed' ? collapsedShape() : [])
}

export function createIslandWindow(options: { showOnReady: boolean }): BrowserWindow {
  const win = new BrowserWindow({
    ...computeIslandBounds(),
    show: false,
    title: 'Dynamic Island',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    thickFrame: false,
    roundedCorners: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  })

  islandWindow = win
  visibleIntent = options.showOnReady
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setSkipTaskbar(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  applyShape()

  if (!app.isPackaged) {
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error' || event.level === 'warning') {
        console.log(`[renderer:${event.level}] ${event.message}`)
      }
    })
    win.webContents.on('render-process-gone', (_event, details) => {
      console.error('[renderer] process gone', details.reason)
    })
  }

  win.on('close', (event) => {
    if (!quitting) {
      // Closing the window should only hide the island, the app lives in the tray.
      event.preventDefault()
      void hideIsland()
    }
  })
  win.on('closed', () => {
    if (islandWindow === win) islandWindow = null
  })
  // The renderer pauses sampling while the island is hidden and re-subscribes
  // when it is shown again.
  win.on('show', () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.islandVisibility, true)
  })
  win.on('hide', () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.islandVisibility, false)
  })
  win.once('ready-to-show', () => {
    // `showIsland` also plays the short slide down from the top edge.
    if (visibleIntent && !quitting) showIsland()
  })

  if (process.env['ELECTRON_RENDERER_URL'] && !app.isPackaged) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

export function setIslandMode(next: IslandMode): void {
  if (mode === next) return
  mode = next
  applyShape()
}

/**
 * Tweens the window's Y position. The main process has no `requestAnimationFrame`
 * and the island is a small always-on-top window, so a `setBounds` per frame is
 * smooth enough for a sub-second slide. (`setPosition` is not used: on Windows
 * every call on a transparent frameless window nudges its reported size by a
 * pixel, which would visibly grow the island over a slide.) The token makes the
 * tween abandon itself as soon as another show/hide/reposition takes over.
 */
function slideTo(
  win: BrowserWindow,
  rect: Electron.Rectangle,
  y: number,
  duration: number,
  token: number
): Promise<void> {
  const { x, width, height } = rect
  const from = win.getBounds().y
  if (duration <= 0 || from === y) {
    win.setBounds({ x, y, width, height })
    return Promise.resolve()
  }

  const startedAt = Date.now()
  return new Promise((resolve) => {
    const step = (): void => {
      if (win.isDestroyed() || token !== slideToken) {
        resolve()
        return
      }
      const progress = Math.min(1, (Date.now() - startedAt) / duration)
      // easeOutCubic: fast off the edge, soft landing.
      const eased = 1 - Math.pow(1 - progress, 3)
      win.setBounds({ x, y: Math.round(from + (y - from) * eased), width, height })
      if (progress >= 1) {
        resolve()
        return
      }
      setTimeout(step, 12)
    }
    step()
  })
}

function shouldAnimate(): boolean {
  return !systemPreferences.getAnimationSettings().prefersReducedMotion
}

/**
 * Tucks the island into the top edge instead of making it blink out: the window
 * slides up out of the work area while the renderer folds the island toward its
 * top edge. Every hide path (close button, hotkey, tray) runs through here.
 */
export async function hideIsland(): Promise<void> {
  const win = islandWindow
  if (!win || win.isDestroyed()) return

  visibleIntent = false
  const token = ++slideToken
  const base = computeIslandBounds()
  const animate = shouldAnimate()

  if (win.isVisible()) {
    // The renderer folds the island toward its top edge while the window itself
    // slides up behind it — the two run together so the motion reads as the
    // island being tucked into the notch, not as a fade followed by a jump.
    win.webContents.send(IPC.islandHiding)
    if (animate) {
      await slideTo(win, base, base.y - TUCK_DISTANCE, HIDE_SLIDE_MS, token)
    }
    if (win.isDestroyed() || token !== slideToken) return
    win.hide()
    // Park it back at rest so the next show starts from the same spot.
    win.setBounds(base)
    setIslandMode('collapsed')
  }

  if (win.isDestroyed() || token !== slideToken) return
  // Reset the renderer state while the window is off screen so the next show
  // starts collapsed.
  win.webContents.send(IPC.islandHidden)
}

export function showIsland(): void {
  const win = islandWindow
  if (!win || win.isDestroyed()) return

  visibleIntent = true
  const token = ++slideToken
  const base = computeIslandBounds()
  const animate = shouldAnimate()

  if (win.isVisible()) {
    void slideTo(win, base, base.y, SHOW_SLIDE_MS, token)
    return
  }

  // Park the window just above the work area, then slide it down into place
  // while the renderer springs the island back in from its top edge.
  win.setBounds(animate ? { ...base, y: base.y - TUCK_DISTANCE } : base)
  win.webContents.send(IPC.islandShowing)
  setIslandMode('collapsed')
  win.showInactive()

  if (animate) void slideTo(win, base, base.y, SHOW_SLIDE_MS, token)
}

export function toggleIsland(): void {
  if (!islandWindow || islandWindow.isDestroyed()) return
  if (visibleIntent) void hideIsland()
  else showIsland()
}

export function repositionIsland(): void {
  if (!islandWindow || islandWindow.isDestroyed()) return
  // A hidden island is positioned again by `showIsland`; moving it now would
  // fight an in-flight tuck animation.
  if (!visibleIntent) return
  slideToken += 1
  islandWindow.setBounds(computeIslandBounds())
}