import { useEffect, useRef, useState } from 'react'

/**
 * Tracks whether the island window is on screen. Panels pause their sampling
 * while it is hidden, and re-subscribe as soon as it is shown again.
 */
export function useIslandVisibility(): boolean {
  const [visible, setVisible] = useState(false)
  const gotEvent = useRef(false)

  useEffect(() => {
    let alive = true

    const off = window.island.onVisibilityChanged((next) => {
      gotEvent.current = true
      setVisible(next)
    })

    void window.island
      .getVisibility()
      .then((next) => {
        // A newer show/hide event always wins over the initial snapshot.
        if (alive && !gotEvent.current) setVisible(next)
      })
      .catch(() => undefined)

    return () => {
      alive = false
      off()
    }
  }, [])

  return visible
}