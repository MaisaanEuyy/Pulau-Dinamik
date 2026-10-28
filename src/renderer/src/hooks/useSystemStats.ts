import { useEffect, useState } from 'react'
import type { SystemSnapshot } from '@shared/system'

/**
 * Subscribes to the sampler only while `active` is true (i.e. the System tab is
 * open inside the expanded island). The last snapshot is kept while inactive so
 * reopening the tab paints instantly instead of flashing empty cards.
 */
export function useSystemStats(active: boolean): SystemSnapshot | null {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null)

  useEffect(() => {
    if (!active) return

    let disposed = false
    const apply = (next: SystemSnapshot | null): void => {
      if (!next || disposed) return
      setSnapshot((previous) =>
        previous && previous.timestamp > next.timestamp ? previous : next
      )
    }

    const off = window.island.onSystemUpdate(apply)
    void window.island
      .subscribeSystem()
      .then(apply)
      .catch(() => undefined)

    return () => {
      disposed = true
      off()
      void window.island.unsubscribeSystem()
    }
  }, [active])

  return snapshot
}