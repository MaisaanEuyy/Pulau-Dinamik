import { useCallback, useEffect, useState } from 'react'
import type { IslandNotification } from '@shared/notifications'

export interface NotificationsStore {
  /** Newest first. */
  items: IslandNotification[]
  /** Arrived while the Alerts section was closed. */
  unseen: number
  markSeen: () => void
  clear: () => Promise<void>
}

/**
 * Mirrors the in-memory notification list kept by the main process. The local
 * HTTP API posts into that list; this hook only listens for the forwarded
 * entries, so a hidden island still collects them.
 */
export function useNotifications(): NotificationsStore {
  const [items, setItems] = useState<IslandNotification[]>([])
  const [unseen, setUnseen] = useState(0)

  useEffect(() => {
    let alive = true

    void window.island
      .getNotifications()
      .then((list) => {
        if (alive) setItems(list)
      })
      .catch(() => undefined)

    const off = window.island.onNotification((item) => {
      setItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, 24))
      setUnseen((count) => count + 1)
    })

    return () => {
      alive = false
      off()
    }
  }, [])

  const markSeen = useCallback(() => setUnseen(0), [])

  const clear = useCallback(async () => {
    await window.island.clearNotifications().catch(() => undefined)
    setItems([])
    setUnseen(0)
  }, [])

  return { items, unseen, markSeen, clear }
}