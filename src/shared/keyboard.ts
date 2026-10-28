/**
 * Live keyboard indicators. Only lock and modifier state is read — key codes
 * are counted once and immediately discarded, never stored or forwarded.
 */
export interface KeyboardState {
  caps: boolean
  num: boolean
  scroll: boolean
  shift: boolean
  ctrl: boolean
  alt: boolean
  win: boolean
}

/** Anonymous key-down count for one polling frame. */
export interface KeyboardPulse {
  count: number
  at: number
}