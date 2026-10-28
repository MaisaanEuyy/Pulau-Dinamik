import { useEffect, useState } from 'react'
import type { VolumeState } from '@shared/volume'

/** How long the HUD stays on screen after the last change. */
const HUD_TIMEOUT_MS = 1500

/**
 * Returns the current volume while the HUD should be visible, or `null` when
 * it has faded out. The main process only emits on real changes, so every
 * event restarts the timer.
 */
export function useVolumeHud(): VolumeState | null {
  const [state, setState] = useState<VolumeState | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const off = window.island.onVolumeUpdate((next) => {
      setState(next)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setState(null), HUD_TIMEOUT_MS)
    })

    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [])

  return state
}