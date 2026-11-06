/**
 * Tier-1 feature switches.
 *
 * Every flag guards a whole pipeline: the section disappears from the tabbar
 * *and* its background work (sampler timers, the keyboard hook, the toast
 * bridge, the beat meter) never starts. That is what actually frees RAM and
 * CPU — hiding the UI alone would leave the work running.
 *
 * Media playback is deliberately not a flag: the island exists to show what is
 * playing, so it cannot be switched off.
 */
export interface FeatureFlags {
  /** CPU/RAM/GPU/disk/battery sampler and the System section. */
  system: boolean
  /** Global keyboard hook and the Keys section. */
  keyboard: boolean
  /** Windows toast mirroring, the local notification API and Alerts. */
  notifications: boolean
  /** Core Audio beat meter that makes the face nod. */
  beat: boolean
}

export const FEATURE_KEYS = ['system', 'keyboard', 'notifications', 'beat'] as const

export type FeatureKey = (typeof FEATURE_KEYS)[number]

/** Copy lives here so the Modules panel and the tray never drift apart. */
export const FEATURE_META: Record<FeatureKey, { label: string; hint: string }> = {
  system: { label: 'System monitor', hint: 'CPU, memory, GPU and battery' },
  keyboard: { label: 'Keyboard lights', hint: 'Caps, Num and Scroll indicators' },
  notifications: { label: 'Notifications', hint: 'Mirror Windows toasts into Alerts' },
  beat: { label: 'Beat visualiser', hint: 'Make the face nod to the music' }
}

export const DEFAULT_FEATURES: FeatureFlags = {
  system: true,
  keyboard: true,
  notifications: true,
  beat: true
}

/** Every module on, used by the "Everything on" preset. */
export const ALL_FEATURES: FeatureFlags = { ...DEFAULT_FEATURES }

/**
 * The lean profile: media, the transport controls and the face keep running.
 * Discord is a separate setting, so the preset turns it off too (see
 * `isAudioOnly` below).
 */
export const AUDIO_ONLY_FEATURES: FeatureFlags = {
  system: false,
  keyboard: false,
  notifications: false,
  beat: true
}

/** Drops unknown keys and fixes wrong types coming from a hand-edited file. */
export function sanitizeFeatures(input: unknown): FeatureFlags {
  const raw = (input ?? {}) as Record<string, unknown>
  const next: FeatureFlags = { ...DEFAULT_FEATURES }
  for (const key of FEATURE_KEYS) {
    if (typeof raw[key] === 'boolean') next[key] = raw[key] as boolean
  }
  return next
}

/** True when every module runs, Discord included. */
export function allFeaturesOn(features: FeatureFlags, discordPresence: boolean): boolean {
  return discordPresence && FEATURE_KEYS.every((key) => features[key])
}

/** True when only the audio path is left, Discord included. */
export function isAudioOnly(features: FeatureFlags, discordPresence: boolean): boolean {
  return !discordPresence && !features.system && !features.keyboard && !features.notifications
}
