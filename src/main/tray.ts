import {
  Menu,
  Tray,
  app,
  nativeTheme,
  screen,
  type MenuItemConstructorOptions
} from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import { applyLoginItem } from './autostart'
import { getSettings, patchSettings } from './settings'
import { getIslandWindow, hideIsland, repositionIsland, showIsland } from './windows/island'

let tray: Tray | null = null

function resourcesDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'resources') : join(__dirname, '../../resources')
}

/**
 * `tray-dark.png` is the light glyph used on a dark taskbar and
 * `tray-light.png` is the dark glyph used on a light taskbar.
 */
function trayIconPath(): string {
  const variant = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  return join(resourcesDir(), `tray-${variant}.png`)
}

function selectDisplay(displayId: number | null): void {
  patchSettings({ displayId })
  repositionIsland()
}

function isVisible(): boolean {
  const win = getIslandWindow()
  return Boolean(win && !win.isDestroyed() && win.isVisible())
}

/** Brings the island back down (if tucked away) and opens a card section. */
function openSection(section: string): void {
  showIsland()
  const win = getIslandWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC.islandOpenSection, section)
}

function buildMenu(): Menu {
  const settings = getSettings()
  const displays = screen.getAllDisplays()
  const visible = isVisible()

  const displayItems: MenuItemConstructorOptions[] = [
    {
      label: 'Primary display',
      type: 'radio',
      checked: settings.displayId === null,
      click: () => selectDisplay(null)
    },
    ...displays.map<MenuItemConstructorOptions>((display, index) => ({
      label: `Display ${index + 1} (${display.size.width}×${display.size.height})`,
      type: 'radio',
      checked: settings.displayId === display.id,
      click: () => selectDisplay(display.id)
    }))
  ]

  return Menu.buildFromTemplate([
    {
      label: visible ? 'Hide island' : 'Show island',
      click: () => (visible ? hideIsland() : showIsland())
    },
    { label: 'Display', submenu: displayItems },
    { type: 'separator' },
    {
      label: 'Launch at login',
      type: 'checkbox',
      checked: settings.launchAtLogin,
      click: (item) => {
        const enabled = item.checked
        patchSettings({ launchAtLogin: enabled })
        applyLoginItem(enabled)
      }
    },
    { label: 'Settings…', click: () => openSection('settings') },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])
}

export function createTray(): void {
  if (tray) return

  tray = new Tray(trayIconPath())
  tray.setToolTip('Dynamic Island KW')

  tray.on('click', () => (isVisible() ? hideIsland() : showIsland()))
  // Build the menu on demand so checkboxes / labels are always current.
  tray.on('right-click', () => tray?.popUpContextMenu(buildMenu()))

  nativeTheme.on('updated', () => {
    if (tray && !tray.isDestroyed()) tray.setImage(trayIconPath())
  })
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = null
}