import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/api'
import type { Settings } from '@shared/settings'

interface IslandProps {
  settings: Settings | null
  info: AppInfo | null
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function formatHotkey(accelerator: string): string {
  return accelerator.replace(/Control/g, 'Ctrl').replace(/\+/g, ' + ')
}

export function Island({ settings, info }: IslandProps) {
  const [hovered, setHovered] = useState(false)
  const clock = useClock()

  const hotkey = formatHotkey(settings?.hotkey ?? 'Control+Alt+Space')
  const subtitle = hovered ? hotkey : info ? `v${info.version} · M1` : 'starting…'

  return (
    <motion.div
      className="island"
      role="status"
      aria-label="Dynamic Island"
      title={`Double-click to hide · ${hotkey}`}
      initial={{ opacity: 0, scale: 0.92, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 360, damping: 26, mass: 0.9 }}
      onDoubleClick={() => void window.island.hideIsland()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="island-mark" aria-hidden="true" />
      <span className="island-meta">
        <span className="island-title">Dynamic Island</span>
        <span className="island-sub">{subtitle}</span>
      </span>
      <span className="island-clock">{clock}</span>
    </motion.div>
  )
}