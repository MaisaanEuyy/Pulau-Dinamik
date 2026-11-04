import { useEffect, useState } from 'react'

/** `low` is reported below this level while the machine is on battery. */
const LOW_LEVEL = 0.2

interface BatteryLike extends EventTarget {
  charging: boolean
  level: number
}

type BatteryNavigator = Navigator & { getBattery?: () => Promise<BatteryLike> }

/**
 * Reports whether the machine is running low on battery, without waking the
 * system sampler: Chromium exposes the Battery Status API to the renderer, so
 * this costs one listener and no polling. Returns `false` when the API is
 * unavailable (desktop, VM) or the machine is plugged in.
 */
export function useBatteryLow(): boolean {
  const [low, setLow] = useState(false)

  useEffect(() => {
    const nav = navigator as BatteryNavigator
    if (typeof nav.getBattery !== 'function') return

    let disposed = false
    let manager: BatteryLike | null = null

    const update = (): void => {
      if (!manager || disposed) return
      setLow(!manager.charging && manager.level <= LOW_LEVEL)
    }

    void nav
      .getBattery()
      .then((battery) => {
        if (disposed) return
        manager = battery
        update()
        battery.addEventListener('levelchange', update)
        battery.addEventListener('chargingchange', update)
      })
      .catch(() => undefined)

    return () => {
      disposed = true
      if (!manager) return
      manager.removeEventListener('levelchange', update)
      manager.removeEventListener('chargingchange', update)
    }
  }, [])

  return low
}