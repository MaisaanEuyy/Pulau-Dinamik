import { AnimatePresence, motion, useReducedMotion, type Transition } from 'framer-motion'
import { Pin, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { AppInfo } from '@shared/api'
import { ISLAND_LAYOUT } from '@shared/layout'
import type { Settings } from '@shared/settings'
import { TABS, TabPanel, type TabId } from './tabs'

interface IslandProps {
  settings: Settings | null
  info: AppInfo | null
}

const INSET = ISLAND_LAYOUT.inset
const COLLAPSED_SIZE = {
  width: ISLAND_LAYOUT.collapsed.width - INSET * 2,
  height: ISLAND_LAYOUT.collapsed.height - INSET * 2
}
const EXPANDED_SIZE = {
  width: ISLAND_LAYOUT.expanded.width - INSET * 2,
  height: ISLAND_LAYOUT.expanded.height - INSET * 2
}

/** Time the window waits before being shaped down to the pill, so the spring
 * has settled and nothing gets clipped. */
const SHRINK_DELAY_MS = 420

function useClock(): string {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function Island({ settings, info }: IslandProps) {
  const reducedMotion = useReducedMotion() ?? false
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [hoverIntent, setHoverIntent] = useState(false)
  const [tab, setTab] = useState<TabId>(TABS[0].id)
  const clock = useClock()

  const expanded = pinned || hoverIntent

  const collapse = useCallback(() => {
    setPinned(false)
    setHovered(false)
    setHoverIntent(false)
  }, [])

  // Hover intent: opening is instant-ish, closing has a grace period so the
  // island does not flicker when the pointer crosses its edge.
  useEffect(() => {
    if (hovered) {
      const timer = setTimeout(() => setHoverIntent(true), 70)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => setHoverIntent(false), 160)
    return () => clearTimeout(timer)
  }, [hovered])

  // The window keeps its expanded footprint for its whole lifetime and is only
  // *shaped* down to the pill while collapsed. Resizing a visible transparent
  // window makes Windows show one stale frame at the new origin, which reads as
  // a blink, so the geometry itself is never animated.
  useEffect(() => {
    if (expanded || hovered) {
      void window.island.setExpanded(true)
      return
    }
    const timer = setTimeout(
      () => void window.island.setExpanded(false),
      reducedMotion ? 0 : SHRINK_DELAY_MS
    )
    return () => clearTimeout(timer)
  }, [expanded, hovered, reducedMotion])

  useEffect(() => window.island.onHidden(collapse), [collapse])

  useEffect(() => {
    const onBlur = (): void => collapse()
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [collapse])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        collapse()
        return
      }
      if (!expanded) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

      event.preventDefault()
      setTab((current) => {
        const index = TABS.findIndex((entry) => entry.id === current)
        const step = event.key === 'ArrowRight' ? 1 : -1
        return TABS[(index + step + TABS.length) % TABS.length].id
      })
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expanded, collapse])

  const activeTab = TABS.find((entry) => entry.id === tab) ?? TABS[0]
  const subtitle = expanded
    ? activeTab.label.toLowerCase()
    : info
      ? `v${info.version} · M3`
      : 'starting…'

  const transition: Transition = reducedMotion
    ? { duration: 0 }
    : { type: 'spring', stiffness: 320, damping: 32, mass: 0.8 }

  return (
    <motion.div
      className="island"
      data-expanded={expanded}
      data-pinned={pinned}
      aria-keyshortcuts={settings?.hotkey}
      initial={false}
      animate={{
        width: expanded ? EXPANDED_SIZE.width : COLLAPSED_SIZE.width,
        height: expanded ? EXPANDED_SIZE.height : COLLAPSED_SIZE.height
      }}
      transition={transition}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDoubleClick={() => void window.island.hideIsland()}
    >
      <div
        className="island-header"
        aria-label={expanded ? 'Island controls' : 'Dynamic Island'}
        onClick={() => {
          if (expanded) setPinned((value) => !value)
        }}
      >
        <span className="island-mark" aria-hidden="true" />
        <span className="island-meta">
          <span className="island-title">Dynamic Island</span>
          <span className="island-sub">{subtitle}</span>
        </span>
        {expanded ? (
          <span className="island-controls">
            <button
              type="button"
              className="island-btn"
              data-active={pinned}
              aria-pressed={pinned}
              aria-label={pinned ? 'Unpin island' : 'Pin island open'}
              onClick={(event) => {
                event.stopPropagation()
                setPinned((value) => !value)
              }}
            >
              <Pin size={12} strokeWidth={1.9} />
            </button>
            <button
              type="button"
              className="island-btn"
              aria-label="Hide island"
              onClick={(event) => {
                event.stopPropagation()
                void window.island.hideIsland()
              }}
            >
              <X size={12} strokeWidth={1.9} />
            </button>
          </span>
        ) : (
          <span className="island-clock">{clock}</span>
        )}
      </div>

      <motion.div
        className="island-body"
        initial={false}
        animate={{ opacity: expanded ? 1 : 0, y: expanded ? 0 : -6 }}
        transition={{
          duration: reducedMotion ? 0 : 0.18,
          delay: expanded && !reducedMotion ? 0.06 : 0
        }}
        style={{ pointerEvents: expanded ? 'auto' : 'none' }}
        aria-hidden={!expanded}
      >
        <div className="island-content">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeTab.id}
              className="tab-panel-wrap"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: reducedMotion ? 0 : 0.15 }}
            >
              <TabPanel tab={activeTab} active={expanded} />
            </motion.div>
          </AnimatePresence>
        </div>

        <nav className="island-tabbar" aria-label="Island sections">
          {TABS.map((entry) => {
            const Icon = entry.icon
            const active = entry.id === activeTab.id

            return (
              <button
                key={entry.id}
                type="button"
                className="tab-button"
                data-active={active}
                aria-label={entry.label}
                aria-pressed={active}
                onClick={() => setTab(entry.id)}
              >
                {active && (
                  <motion.span
                    layoutId="island-tab-indicator"
                    className="tab-indicator"
                    transition={transition}
                  />
                )}
                <Icon size={14} strokeWidth={1.9} />
              </button>
            )
          })}
        </nav>
      </motion.div>
    </motion.div>
  )
}