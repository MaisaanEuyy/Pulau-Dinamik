import { AnimatePresence, motion, useReducedMotion, type Transition } from 'framer-motion'
import { Bell, Pin, Volume, Volume1, Volume2, VolumeX, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppInfo } from '@shared/api'
import { ISLAND_LAYOUT } from '@shared/layout'
import type { IslandNotification } from '@shared/notifications'
import type { Settings } from '@shared/settings'
import { useAmbientColor } from '../hooks/useAmbientColor'
import { useBeat } from '../hooks/useBeat'
import { useIslandVisibility } from '../hooks/useIslandVisibility'
import { useKeyboard } from '../hooks/useKeyboard'
import { useMedia } from '../hooks/useMedia'
import { useNotifications } from '../hooks/useNotifications'
import { useSystemStats } from '../hooks/useSystemStats'
import { useVolumeHud } from '../hooks/useVolumeHud'
import { MiniBar } from './MiniBar'
import { Smiley } from './Smiley'
import { TABS, TabPanel, type TabData, type TabId } from './tabs'

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
/** Grace period before an unpinned card closes after the pointer leaves. */
const LEAVE_DELAY_MS = 280
/** How long a fresh notification stays on the header. */
const ALERT_HUD_MS = 4200

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
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [tab, setTab] = useState<TabId>(TABS[0].id)
  const [hud, setHud] = useState<IslandNotification | null>(null)
  /** The notification that opened the card: while it is set the Alerts panel
   * shows only that one instead of the whole history. */
  const [alertFocus, setAlertFocus] = useState<IslandNotification | null>(null)
  /** The window slides out of the top edge on hide; the island folds with it. */
  const [presence, setPresence] = useState<'visible' | 'leaving'>('visible')
  const clock = useClock()
  const volume = useVolumeHud()

  const visible = useIslandVisibility()
  const notifications = useNotifications()

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    // The main process persists the patch and broadcasts the merged settings
    // back, which is what `App` feeds into the island.
    void window.island.patchSettings(patch)
  }, [])

  // One subscription per section, shared by the header mini view and the panel.
  // Media stays subscribed the whole time the island is on screen: the face
  // reacts to the song from any section, not just Media.
  const media = useMedia(visible)
  const system = useSystemStats(visible && tab === 'system')
  const keyboard = useKeyboard(visible && tab === 'keys')
  useAmbientColor(tab === 'media' && media.state?.active ? media.state.artwork : null)

  const expanded = open || pinned
  const playing = media.state?.active === true && media.state.playing
  // The face nods to whatever Windows is playing; the meter only runs while
  // there is something to dance to.
  const beat = useBeat(visible && playing && !reducedMotion)

  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The pointer (or Escape) took the card over during a notification HUD, so
   * nothing about the session gets put back. */
  const tookOver = useRef(false)

  const cancelLeave = useCallback(() => {
    if (!leaveTimer.current) return
    clearTimeout(leaveTimer.current)
    leaveTimer.current = null
  }, [])

  const collapse = useCallback(() => {
    // Closing by hand (Escape, a click on close, the main process) also ends the
    // notification session, so its HUD must not restore anything afterwards.
    tookOver.current = true
    setAlertFocus(null)
    cancelLeave()
    setPinned(false)
    setOpen(false)
    setHovered(false)
    setPressed(false)
  }, [cancelLeave])

  // The pill only opens on a click (it hosts quick controls now), so an
  // unpinned card closes once the pointer has left it for a moment.
  const handleLeave = useCallback(() => {
    setHovered(false)
    setPressed(false)
    cancelLeave()
    if (pinned) return
    leaveTimer.current = setTimeout(() => {
      leaveTimer.current = null
      setOpen(false)
    }, LEAVE_DELAY_MS)
  }, [pinned, cancelLeave])

  useEffect(() => () => cancelLeave(), [cancelLeave])

  useEffect(() => window.island.onHidden(collapse), [collapse])

  // The tray's "Settings…" entry asks the island to open on the Settings
  // section. Pinning it keeps the card up while the user changes something.
  useEffect(
    () =>
      window.island.onOpenSection((section) => {
        if (!TABS.some((entry) => entry.id === section)) return
        cancelLeave()
        setTab(section)
        setPinned(true)
        setOpen(true)
      }),
    [cancelLeave]
  )

  // Hiding is a two-step dance with the main process: the island folds toward
  // its top edge first (`island:hiding`), then the window slides up out of the
  // work area. Showing runs the same path backwards.
  useEffect(() => window.island.onHiding(() => setPresence('leaving')), [])
  useEffect(() => window.island.onShowing(() => setPresence('visible')), [])

  useEffect(() => {
    // Losing focus closes the transient card, but a pinned island stays put.
    const onBlur = (): void => setOpen(false)
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])

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

  // Keep the Alerts badge honest while the section is on screen.
  const markSeen = notifications.markSeen
  const alertCount = notifications.items.length
  useEffect(() => {
    if (expanded && tab === 'alerts') markSeen()
  }, [expanded, tab, markSeen, alertCount])

  // Transient header card for notifications posted through the local API.
  const openRef = useRef(open)
  openRef.current = open
  const pinnedRef = useRef(pinned)
  pinnedRef.current = pinned
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const tabRef = useRef<TabId>(tab)
  tabRef.current = tab
  /** A HUD session is running (several notifications can pile into one). */
  const hudActive = useRef(false)
  /** This notification opened the card, so it may close it again. */
  const autoOpened = useRef(false)
  /** The island was tucked away when the notification came in. */
  const hiddenBefore = useRef(false)
  /** The section the notification borrowed the card from. */
  const previousTab = useRef<TabId>(tab)

  useEffect(
    () =>
      window.island.onNotification((notification) => {
        // The first notification of a burst decides what has to be restored
        // afterwards; a second one must not forget that the island was hidden.
        if (!hudActive.current) {
          hudActive.current = true
          tookOver.current = false
          hiddenBefore.current = !visibleRef.current
          autoOpened.current = !openRef.current && !pinnedRef.current
          previousTab.current = tabRef.current
        }
        // A notification is pointless if the island is asleep: bring it back
        // down and open the card, so the HUD has room to be read.
        if (!visibleRef.current) void window.island.showIsland()
        setHud(notification)
        setAlertFocus(notification)
        if (!pinnedRef.current) setOpen(true)
        // Show the thing that just happened: the Alerts section, not whatever
        // tab was up (a song, the stats…) — the notification is the news here.
        setTab('alerts')
      }),
    []
  )

  useEffect(() => {
    if (!hud) return
    const timer = setTimeout(() => {
      setHud(null)
      hudActive.current = false
      // The peek is over: the Alerts section (if still open) shows the history.
      setAlertFocus(null)
      // A click, a key or Escape means the user is driving now: leave the card
      // on the section they are actually looking at.
      if (tookOver.current) return
      // Hand the section back the way it was found.
      if (previousTab.current !== tabRef.current) setTab(previousTab.current)
      if (!autoOpened.current) return
      autoOpened.current = false
      if (!pinnedRef.current) setOpen(false)
      if (hiddenBefore.current) {
        hiddenBefore.current = false
        void window.island.hideIsland()
      }
    }, ALERT_HUD_MS)
    return () => clearTimeout(timer)
  }, [hud])

  // The window keeps its expanded footprint for its whole lifetime and is only
  // *shaped* down to the pill while collapsed. Resizing a visible transparent
  // window makes Windows show one stale frame at the new origin, which reads as
  // a blink, so the geometry itself is never animated.
  useEffect(() => {
    if (expanded) {
      void window.island.setExpanded(true)
      return
    }
    const timer = setTimeout(
      () => void window.island.setExpanded(false),
      reducedMotion ? 0 : SHRINK_DELAY_MS
    )
    return () => clearTimeout(timer)
  }, [expanded, reducedMotion])

  const activeTab = TABS.find((entry) => entry.id === tab) ?? TABS[0]
  const notifyPort = info?.notifyPort ?? null

  const data: TabData = {
    media,
    system,
    keyboard,
    alerts: notifications,
    settings: { value: settings, patch: patchSettings }
  }

  const transition: Transition = reducedMotion
    ? { duration: 0 }
    : { type: 'spring', stiffness: 320, damping: 32, mass: 0.8 }

  const foldTransition: Transition = reducedMotion
    ? { duration: 0 }
    : {
        ...transition,
        // The island folds toward its top edge while the window slides up
        // behind it, so the content is still on screen during the first half of
        // the motion.
        opacity: { duration: 0.26, ease: 'easeIn' },
        scale: { type: 'spring', stiffness: 260, damping: 26, mass: 0.7 }
      }

  const volumePercent = volume ? Math.round(volume.level * 100) : 0
  const VolumeIcon = volume?.muted
    ? VolumeX
    : volume && volume.level > 0
      ? volume.level < 0.34
        ? Volume1
        : Volume2
      : Volume

  return (
    <motion.div
      className="island"
      data-expanded={expanded}
      data-pinned={pinned}
      data-hovered={hovered}
      data-hud={Boolean(hud)}
      aria-keyshortcuts={settings?.hotkey}
      initial={false}
      animate={{
        width: expanded ? EXPANDED_SIZE.width : COLLAPSED_SIZE.width,
        height: expanded ? EXPANDED_SIZE.height : COLLAPSED_SIZE.height,
        opacity: presence === 'leaving' ? 0 : 1,
        scale: presence === 'leaving' ? 0.58 : 1
      }}
      transition={foldTransition}
      style={{
        transformOrigin: 'center top',
        pointerEvents: presence === 'leaving' ? 'none' : undefined
      }}
      onMouseEnter={() => {
        cancelLeave()
        setHovered(true)
      }}
      onMouseLeave={handleLeave}
      onPointerDown={() => {
        // Touching the card means the user took over: keep it open.
        hudActive.current = false
        autoOpened.current = false
        hiddenBefore.current = false
        tookOver.current = true
        // Touching the card also unfolds the alert history under it.
        setAlertFocus(null)
        setPressed(true)
      }}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
    >
      <div className="island-aura" aria-hidden="true" />
      <div
        className="island-header"
        aria-label={expanded ? 'Island controls' : 'Dynamic Island'}
        onClick={() => {
          // Click opens the card; a second click pins it (so it survives focus
          // changes) instead of toggling it shut.
          if (!expanded) {
            setOpen(true)
            return
          }
          setPinned((value) => !value)
        }}
      >
        <Smiley hovered={hovered} pressed={pressed} playing={playing} beat={beat} />
        {/* The mini view is the pill, not a strip on top of the open card: the
            card already shows the same track/statistics in full. */}
        {!expanded && (
          <motion.div
            className="island-mini"
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.16 }}
          >
            <MiniBar tab={activeTab} data={data} notifyPort={notifyPort} />
          </motion.div>
        )}
        {expanded && <span className="island-header-spacer" aria-hidden="true" />}
        <span className="island-clock">{clock}</span>
        {expanded && (
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
        )}

        <AnimatePresence initial={false}>
          {volume && (
            <motion.div
              className="volume-hud"
              data-expanded={expanded}
              data-muted={volume.muted}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.16 }}
              aria-hidden="true"
            >
              <span className="volume-icon">
                <VolumeIcon size={15} strokeWidth={2} />
              </span>
              <span className="volume-track">
                <motion.span
                  className="volume-fill"
                  initial={false}
                  animate={{ width: `${volume.muted ? 0 : volumePercent}%` }}
                  transition={
                    reducedMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 420, damping: 34, mass: 0.6 }
                  }
                />
              </span>
              <span className="volume-value">
                {volume.muted ? 'Muted' : `${volumePercent}%`}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {hud && (
            <motion.div
              className="alert-hud"
              data-level={hud.level}
              data-expanded={expanded}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.18 }}
              aria-hidden="true"
            >
              <span className="alert-hud-icon">
                <Bell size={14} strokeWidth={2} />
              </span>
              <span className="alert-hud-text">
                <span className="alert-hud-title">{hud.title}</span>
                {hud.message ? <span className="alert-hud-message">{hud.message}</span> : null}
              </span>
              {hud.app ? <span className="alert-hud-app">{hud.app}</span> : null}
            </motion.div>
          )}
        </AnimatePresence>
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
              <TabPanel tab={activeTab} data={data} notifyPort={notifyPort} focusAlert={alertFocus} />
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
                {entry.id === 'alerts' && notifications.unseen > 0 && !active && (
                  <span className="tab-badge" aria-hidden="true" />
                )}
              </button>
            )
          })}
        </nav>
      </motion.div>
    </motion.div>
  )
}