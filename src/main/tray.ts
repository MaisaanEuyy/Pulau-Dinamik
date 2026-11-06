import {
  Menu,
  Tray,
  app,
  nativeTheme,
  screen,
  type MenuItemConstructorOptions
} from 'electron'
import { join } from 'node:path'
import {
  ALL_FEATURES,
  AUDIO_ONLY_FEATURES,
  FEATURE_KEYS,
  FEATURE_META,
  allFeaturesOn,
  isAudioOnly
} from '../shared/features'
import { IPC } from '../shared/ipc'
import { applyLoginItem } from './autostart'
import { applyProfile, commitSettings } from './features'
import { getSettings } from './settings'
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
  commitSettings({ displayId })
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
  const audioOnly = isAudioOnly(settings.features, settings.discordPresence)
  const everything = allFeaturesOn(settings.features, settings.discordPresence)

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

  // The module submenu mirrors the Modules section, so the island can get
  // lighter without opening the card at all.
  const moduleItems: MenuItemConstructorOptions[] = [
    ...FEATURE_KEYS.map<MenuItemConstructorOptions>((key) => ({
      label: FEATURE_META[key].label,
      type: 'checkbox',
      checked: settings.features[key],
      click: (item) => {
        commitSettings({ features: { ...settings.features, [key]: item.checked } })
      }
    })),
    { type: 'separator' },
    {
      label: 'Audio only',
      type: 'checkbox',
      checked: audioOnly,
      click: () => {
        applyProfile({ ...AUDIO_ONLY_FEATURES }, false)
      }
    },
    {
      label: 'Everything on',
      type: 'checkbox',
      checked: everything,
      click: () => {
        applyProfile({ ...ALL_FEATURES }, true)
      }
    }
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
        commitSettings({ launchAtLogin: enabled })
        applyLoginItem(enabled)
      }
    },
    {
      label: 'Show in Discord',
      type: 'checkbox',
      checked: settings.discordPresence,
      click: (item) => {
        commitSettings({ discordPresence: item.checked })
      }
    },
    {
      label: 'Playful smiley',
      type: 'checkbox',
      checked: settings.smileyInteractive,
      click: (item) => {
        commitSettings({ smileyInteractive: item.checked })
      }
    },
    { label: 'Modules', submenu: moduleItems },
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
