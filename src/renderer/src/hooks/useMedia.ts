import { useCallback, useEffect, useState } from 'react'
import type { MediaCommand, MediaState } from '@shared/media'

/**
 * Subscribes to the SMTC helper only while `active` is true (the Media tab is
 * open inside the expanded island). The last state is kept while inactive so
 * reopening the tab paints instantly instead of flashing a placeholder.
 */
export function useMedia(active: boolean): {
  state: MediaState | null
  send: (command: MediaCommand) => void
} {
  const [state, setState] = useState<MediaState | null>(null)

  useEffect(() => {
    if (!active) return

    let disposed = false
    const apply = (next: MediaState | null): void => {
      if (next && !disposed) setState(next)
    }

    const off = window.island.onMediaUpdate(apply)
    void window.island
      .subscribeMedia()
      .then(apply)
      .catch(() => undefined)

    return () => {
      disposed = true
      off()
      void window.island.unsubscribeMedia()
    }
  }, [active])

  const send = useCallback((command: MediaCommand): void => {
    void window.island.sendMediaCommand(command).catch(() => undefined)
  }, [])

  return { state, send }
}