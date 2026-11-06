import { app } from 'electron'
import type { AppInfo } from '../shared/api'
import { ALL_FEATURES, AUDIO_ONLY_FEATURES, type FeatureFlags } from '../shared/features'
import { IPC } from '../shared/ipc'
import type { Settings } from '../shared/settings'
import type { SystemSnapshot } from '../shared/system'
import { startBeatWatcher, stopBeatWatcher } from './services/audio'
import { syncDiscordPresence } from './services/discord'
import { subscribeKeyboard, unsubscribeKeyboard } from './services/keyboard'
import {
  getNotificationPort,
  startNotificationServer,
  stopNotificationServer
} from './services/notifications'
import { startSystemSampler, stopSystemSampler } from './services/system'
import { stopToastHelper } from './services/toasts'
import { getSettings, patchSettings } from './settings'
import { getIslandWindow } from './windows/island'

/**
 * The mini view keeps a panel subscribed while the island is collapsed, so the
 * mini and the full card can hold a subscription at the same time. Switching a
 * module off resets these counters: the module is off, not merely unsubscribed.
 */
let systemSubscribers = 0
let keyboardSubscribers = 0
let beatSubscribers = 0

function broadcastSettings(settings: Settings): void {
  const win = getIslandWindow()
  if (win && !win.isDestroyed()) win.webContents.send(IPC.settingsChanged, settings)
}

/** The Alerts card prints the local API port, and that port moves with the
 * Notifications module. */
function broadcastAppInfo(): void {
  const win = getIslandWindow()
  if (!win || win.isDestroyed()) return
  const info: AppInfo = {
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    isPackaged: app.isPackaged,
    notifyPort: getNotificationPort()
  }
  win.webContents.send(IPC.appInfoChanged, info)
}

/**
 * Every subscribe is gated on the module flag. A renderer that still asks for a
 * disabled module (a stale section, a race with the hotkey) must not start its
 * timer or hook — otherwise the switch would only hide the UI.
 */
export function subscribeSystem(): Promise<SystemSnapshot | null> | null {
  if (!getSettings().features.system) return null
  systemSubscribers += 1
  return startSystemSampler()
}

export function unsubscribeSystem(): void {
  systemSubscribers = Math.max(0, systemSubscribers - 1)
  if (systemSubscribers === 0) stopSystemSampler()
}

export function subscribeBeat(): void {
  if (!getSettings().features.beat) return
  beatSubscribers += 1
  startBeatWatcher()
}

export function unsubscribeBeat(): void {
  beatSubscribers = Math.max(0, beatSubscribers - 1)
  if (beatSubscribers === 0) stopBeatWatcher()
}

export function subscribeKeys(): ReturnType<typeof subscribeKeyboard> | null {
  if (!getSettings().features.keyboard) return null
  keyboardSubscribers += 1
  return subscribeKeyboard()
}

export function unsubscribeKeys(): void {
  keyboardSubscribers = Math.max(0, keyboardSubscribers - 1)
  if (keyboardSubscribers === 0) unsubscribeKeyboard()
}

/**
 * The island was hidden: everything the renderer held is gone with it. Unlike a
 * module switch this only stops the work, so the next show starts it fresh.
 */
export function resetSubscriptions(): void {
  systemSubscribers = 0
  keyboardSubscribers = 0
  beatSubscribers = 0
  stopSystemSampler()
  stopBeatWatcher()
  unsubscribeKeyboard()
}

/**
 * Stops the work of a module that was switched off. Turning one back on is left
 * to the lazy path — a section subscribes when it is opened — so a re-enabled
 * module costs nothing until the user actually looks at it.
 */
function applyFeatures(previous: Settings, next: Settings): void {
  const before = previous.features
  const after = next.features

  if (before.system && !after.system) {
    systemSubscribers = 0
    stopSystemSampler()
  }
  if (before.keyboard && !after.keyboard) {
    keyboardSubscribers = 0
    unsubscribeKeyboard()
  }
  if (before.beat && !after.beat) {
    beatSubscribers = 0
    stopBeatWatcher()
  }
  if (before.notifications !== after.notifications) {
    if (after.notifications) {
      // The renderer prints the port, so tell it once the server is bound.
      void startNotificationServer().then(broadcastAppInfo)
    } else {
      // The WinRT helper is shared with the media bridge, so this only drops the
      // notification hold; a playing song is untouched.
      stopToastHelper()
      stopNotificationServer()
      broadcastAppInfo()
    }
  }
  if (previous.discordPresence !== next.discordPresence) {
    syncDiscordPresence(next.discordPresence)
  }
}

/**
 * The single settings writer: persists the patch, stops the modules it turned
 * off, keeps Discord in step and pushes the merged settings to the renderer.
 * The tray rebuilds its menu on demand, so it needs no broadcast of its own.
 */
export function commitSettings(patch: Partial<Settings>): Settings {
  const previous = getSettings()
  const next = patchSettings(patch)
  applyFeatures(previous, next)
  broadcastSettings(next)
  return next
}

/** Applies a whole module profile in one go (the presets). */
export function applyProfile(features: FeatureFlags, discordPresence: boolean): Settings {
  return commitSettings({ features, discordPresence })
}

/** Media, the transport controls and the face only — everything else stops. */
export function applyAudioOnly(): Settings {
  return applyProfile({ ...AUDIO_ONLY_FEATURES }, false)
}

/** Every module back on, Discord included. */
export function applyEverything(): Settings {
  return applyProfile({ ...ALL_FEATURES }, true)
}
