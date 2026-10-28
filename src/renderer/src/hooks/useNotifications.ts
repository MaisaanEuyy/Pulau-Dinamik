import { useCallback, useEffect, useState } from 'react'
import type { IslandNotification } from '@shared/notifications'
import type { ToastAccess } from '@shared/toast'

export interface NotificationsStore {
  /** Newest first. */
  items: IslandNotification[]
  /** Arrived while the Alerts section was closed. */
  unseen: number
  /** Whether Windows lets us mirror its own notifications. */
  windowsAccess: ToastAccess
  markSeen: () => void
  clear: () => Promise<void>
}

/**
 * Mirrors the in-memory notification list kept by the main process. Two sources
 * feed it: the local HTTP API and the WinRT toast bridge. The bridge only runs
 * while the island is visible, so it is tied to `visible` here.
 */
export function useNotifications(visible: boolean): NotificationsStore {
  const [items, setItems] = useState<IslandNotification[]>([])
  const [unseen, setUnseen] = useState(0)
  const [windowsAccess, setWindowsAccess] = useState<ToastAccess>('unknown')

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

    const offAccess = window.island.onToastAccess(setWindowsAccess)

    return () => {
      alive = false
      off()
      offAccess()
    }
  }, [])

  useEffect(() => {
    if (!visible) return

    let alive = true
    void window.island
      .subscribeToasts()
      .then((access) => {
        if (alive) setWindowsAccess(access)
      })
      .catch(() => undefined)

    return () => {
      alive = false
      void window.island.unsubscribeToasts().catch(() => undefined)
    }
  }, [visible])

  const markSeen = useCallback(() => setUnseen(0), [])

  const clear = useCallback(async () => {
    await window.island.clearNotifications().catch(() => undefined)
    setItems([])
    setUnseen(0)
  }, [])

  return { items, unseen, windowsAccess, markSeen, clear }
}