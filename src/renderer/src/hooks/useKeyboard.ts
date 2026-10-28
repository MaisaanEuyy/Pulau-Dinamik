import { useEffect, useRef, useState } from 'react'
import type { KeyboardState } from '@shared/keyboard'

/** Meter resolution: one bar per 100 ms, so the strip holds ~2.8 s of typing. */
const BUCKET_MS = 100
const BAR_COUNT = 28
const RATE_WINDOW_MS = 4000

export interface KeyboardActivity {
  state: KeyboardState | null
  bars: number[]
  /** Key presses per minute over the last few seconds. */
  rate: number
}

/**
 * Subscribes to the keyboard watcher while the Keys section is open. The main
 * process only sends anonymous key-down counts, so nothing typed is ever
 * available to the renderer.
 */
export function useKeyboard(active: boolean): KeyboardActivity {
  const [state, setState] = useState<KeyboardState | null>(null)
  const [bars, setBars] = useState<number[]>(() => new Array(BAR_COUNT).fill(0))
  const [rate, setRate] = useState(0)

  const pending = useRef(0)
  const stamps = useRef<number[]>([])

  useEffect(() => {
    if (!active) return

    let disposed = false
    pending.current = 0
    stamps.current = []
    setBars(new Array(BAR_COUNT).fill(0))
    setRate(0)

    const offState = window.island.onKeyboardUpdate((next) => {
      if (!disposed) setState(next)
    })

    const offPulse = window.island.onKeyboardPulse((pulse) => {
      if (disposed) return
      pending.current += pulse.count
      const now = Date.now()
      for (let index = 0; index < pulse.count; index++) stamps.current.push(now)
    })

    void window.island
      .subscribeKeyboard()
      .then((next) => {
        if (!disposed && next) setState(next)
      })
      .catch(() => undefined)

    const timer = setInterval(() => {
      const now = Date.now()
      stamps.current = stamps.current.filter((at) => now - at <= RATE_WINDOW_MS)
      setRate(Math.round((stamps.current.length * 60_000) / RATE_WINDOW_MS))

      const level = Math.min(1, pending.current / 3)
      pending.current = 0
      setBars((current) => {
        if (level === 0 && current.every((value) => value === 0)) return current
        const next = current.slice(1)
        next.push(level)
        return next
      })
    }, BUCKET_MS)

    return () => {
      disposed = true
      clearInterval(timer)
      offState()
      offPulse()
      void window.island.unsubscribeKeyboard()
    }
  }, [active])

  return { state, bars, rate }
}