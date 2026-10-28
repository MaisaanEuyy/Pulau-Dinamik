import { BrowserWindow, app, screen } from 'electron'
import { join } from 'node:path'
import { ISLAND_LAYOUT } from '../../shared/layout'
import { getSettings } from '../settings'

let islandWindow: BrowserWindow | null = null
let quitting = false

export function markQuitting(): void {
  quitting = true
}

export function getIslandWindow(): BrowserWindow | null {
  return islandWindow
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
  const { width, height } = ISLAND_LAYOUT.collapsed

  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + topOffset)
  }
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
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setSkipTaskbar(true)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

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
  win.once('ready-to-show', () => {
    if (options.showOnReady && !quitting) win.showInactive()
  })

  if (process.env['ELECTRON_RENDERER_URL'] && !app.isPackaged) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

export function showIsland(): void {
  if (!islandWindow || islandWindow.isDestroyed()) return
  repositionIsland()
  islandWindow.showInactive()
}

export function hideIsland(): void {
  if (!islandWindow || islandWindow.isDestroyed()) return
  islandWindow.hide()
}

export function toggleIsland(): void {
  if (!islandWindow || islandWindow.isDestroyed()) return
  if (islandWindow.isVisible()) hideIsland()
  else showIsland()
}

export function repositionIsland(): void {
  if (!islandWindow || islandWindow.isDestroyed()) return
  islandWindow.setBounds(computeIslandBounds())
}