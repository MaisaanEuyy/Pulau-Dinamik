import { BrowserWindow, app, screen } from 'electron'
import { join } from 'node:path'
import { IPC } from '../../shared/ipc'
import { ISLAND_LAYOUT } from '../../shared/layout'
import { getSettings } from '../settings'

export type IslandMode = 'collapsed' | 'expanded'

let islandWindow: BrowserWindow | null = null
let quitting = false
let mode: IslandMode = 'collapsed'
/**
 * Tracks whether the island is supposed to be on screen. A `hide()` that lands
 * before the first `ready-to-show` must win over the initial auto-show.
 */
let visibleIntent = false

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
      win.hide()
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
    if (visibleIntent && !quitting) win.showInactive()
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

export function showIsland(): void {
  if (!islandWindow || islandWindow.isDestroyed()) return
  visibleIntent = true
  repositionIsland()
  islandWindow.showInactive()
}

export function hideIsland(): void {
  if (!islandWindow || islandWindow.isDestroyed()) return
  visibleIntent = false
  // Reset the renderer state first so the next show starts collapsed.
  islandWindow.webContents.send(IPC.islandHidden)
  islandWindow.hide()
  setIslandMode('collapsed')
}

export function toggleIsland(): void {
  if (!islandWindow || islandWindow.isDestroyed()) return
  if (visibleIntent) hideIsland()
  else showIsland()
}

export function repositionIsland(): void {
  if (!islandWindow || islandWindow.isDestroyed()) return
  islandWindow.setBounds(computeIslandBounds())
}