import { IPC } from '../../shared/ipc'
import type { KeyboardState } from '../../shared/keyboard'
import { getIslandWindow } from '../windows/island'

const POLL_INTERVAL_MS = 120

const WH_KEYBOARD_LL = 13
const WM_KEYDOWN = 0x0100
const WM_SYSKEYDOWN = 0x0104

const VK = {
  lshift: 0xa0,
  rshift: 0xa1,
  lcontrol: 0xa2,
  rcontrol: 0xa3,
  lmenu: 0xa4,
  rmenu: 0xa5,
  lwin: 0x5b,
  rwin: 0x5c,
  capital: 0x14,
  numlock: 0x90,
  scroll: 0x91
} as const

interface KoffiFunction {
  (...args: unknown[]): number
}

interface KoffiLibrary {
  func(definition: string): KoffiFunction
}

interface KoffiModule {
  load(path: string): KoffiLibrary
  proto(definition: string): unknown
  pointer(type: unknown): unknown
  register(callback: (...args: never[]) => unknown, type: unknown): unknown
  unregister(handle: unknown): void
  decode(value: unknown, type: unknown): unknown
}

interface NativeKeyboard {
  koffi: KoffiModule
  user32: KoffiLibrary
  GetKeyState: KoffiFunction
  GetAsyncKeyState: KoffiFunction
}

interface PulseCounter {
  take(): number
  dispose(): void
}

const emptyState = (): KeyboardState => ({
  caps: false,
  num: false,
  scroll: false,
  shift: false,
  ctrl: false,
  alt: false,
  win: false
})

let native: NativeKeyboard | null | undefined
let state: KeyboardState | null = null
let timer: NodeJS.Timeout | null = null
let pulses: PulseCounter | null = null
let warnOnce = false
let protoDefined = false
/** The hook flips a lock between ticks; make sure the next tick publishes it. */
let dirty = false

function loadNative(): NativeKeyboard | null {
  if (native !== undefined) return native
  native = null
  if (process.platform !== 'win32') return native

  try {
    // Required lazily so a broken native binary never takes the app down.
    const koffi = require('koffi') as KoffiModule
    const user32 = koffi.load('user32.dll')
    native = {
      koffi,
      user32,
      GetKeyState: user32.func('short GetKeyState(int nVirtKey)'),
      GetAsyncKeyState: user32.func('short GetAsyncKeyState(int vKey)')
    }
  } catch (error) {
    console.warn('[keyboard] user32 binding unavailable', error)
  }

  return native
}

function isDown(api: NativeKeyboard, vk: number): boolean {
  return (api.GetAsyncKeyState(vk) & 0x8000) !== 0
}

/** Low bit of GetKeyState is the lock toggle, not the physical key. */
function isLocked(api: NativeKeyboard, vk: number): boolean {
  return (api.GetKeyState(vk) & 1) !== 0
}

/**
 * Counts key-down events with a WH_KEYBOARD_LL hook. The virtual key code is
 * only used to keep the lock state in sync; nothing else is read, kept or sent.
 * Returns `null` when the hook cannot be installed (the panel then falls back to
 * polling `GetKeyState` for the locks).
 */
function createPulseCounter(api: NativeKeyboard, onKeyDown: (vk: number) => void): PulseCounter | null {
  const { koffi, user32 } = api
  let pending = 0

  try {
    if (!protoDefined) {
      koffi.proto('intptr_t KeyboardProc(int nCode, uintptr_t wParam, intptr_t lParam)')
      protoDefined = true
    }

    const SetWindowsHookExW = user32.func(
      'void *SetWindowsHookExW(int idHook, KeyboardProc *lpfn, void *hmod, uint32_t tid)'
    )
    const CallNextHookEx = user32.func(
      'intptr_t CallNextHookEx(void *hook, int nCode, uintptr_t wParam, intptr_t lParam)'
    )
    const UnhookWindowsHookEx = user32.func('bool UnhookWindowsHookEx(void *hook)')

    const callback = koffi.register((code: number, wParam: bigint, lParam: bigint) => {
      try {
        if (code >= 0) {
          const message = Number(wParam)
          if (message === WM_KEYDOWN || message === WM_SYSKEYDOWN) {
            pending += 1
            onKeyDown(Number(koffi.decode(lParam, 'uint32_t')))
          }
        }
        return CallNextHookEx(null, code, wParam, lParam)
      } catch {
        // Never let a hook exception swallow the keystroke.
        return 0
      }
    }, 'KeyboardProc *')

    const hook = SetWindowsHookExW(WH_KEYBOARD_LL, callback, null, 0)
    if (!hook) {
      koffi.unregister(callback)
      return null
    }

    return {
      take(): number {
        const value = pending
        pending = 0
        return value
      },
      dispose(): void {
        UnhookWindowsHookEx(hook)
        koffi.unregister(callback)
      }
    }
  } catch (error) {
    if (!warnOnce) {
      warnOnce = true
      console.warn('[keyboard] low-level hook unavailable', error)
    }
    return null
  }
}

function send(channel: string, payload: unknown): void {
  const win = getIslandWindow()
  if (!win || win.isDestroyed() || !win.isVisible()) return
  win.webContents.send(channel, payload)
}

function publish(): void {
  if (state) send(IPC.keyboardUpdate, state)
}

function tick(): void {
  if (!state) return

  const api = native
  if (!api) return

  const next: KeyboardState = {
    ...state,
    shift: isDown(api, VK.lshift) || isDown(api, VK.rshift),
    ctrl: isDown(api, VK.lcontrol) || isDown(api, VK.rcontrol),
    alt: isDown(api, VK.lmenu) || isDown(api, VK.rmenu),
    win: isDown(api, VK.lwin) || isDown(api, VK.rwin)
  }

  // Without the hook the locks have to be read from the (thread-local) state.
  if (!pulses) {
    next.caps = isLocked(api, VK.capital)
    next.num = isLocked(api, VK.numlock)
    next.scroll = isLocked(api, VK.scroll)
  }

  const changed =
    next.caps !== state.caps ||
    next.num !== state.num ||
    next.scroll !== state.scroll ||
    next.shift !== state.shift ||
    next.ctrl !== state.ctrl ||
    next.alt !== state.alt ||
    next.win !== state.win

  state = next
  if (changed || dirty) {
    dirty = false
    publish()
  }

  const count = pulses?.take() ?? 0
  if (count > 0) send(IPC.keyboardPulse, { count, at: Date.now() })
}

export function subscribeKeyboard(): KeyboardState | null {
  const api = loadNative()
  if (!api) return null

  const current = state ?? emptyState()
  const next: KeyboardState = {
    ...current,
    caps: isLocked(api, VK.capital),
    num: isLocked(api, VK.numlock),
    scroll: isLocked(api, VK.scroll)
  }
  state = next

  if (!pulses) {
    pulses = createPulseCounter(api, (vk) => {
      if (!state) return
      if (vk === VK.capital) state = { ...state, caps: !state.caps }
      else if (vk === VK.numlock) state = { ...state, num: !state.num }
      else if (vk === VK.scroll) state = { ...state, scroll: !state.scroll }
      else return
      dirty = true
    })
  }

  if (!timer) timer = setInterval(tick, POLL_INTERVAL_MS)
  return { ...next }
}

export function unsubscribeKeyboard(): void {
  if (timer) clearInterval(timer)
  timer = null
  pulses?.dispose()
  pulses = null
  state = null
  dirty = false
}

/** True when the low-level keyboard hook is installed (used by the smoke test). */
export function isKeyboardHookActive(): boolean {
  return pulses !== null
}