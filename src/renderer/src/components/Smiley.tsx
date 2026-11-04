import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform
} from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BeatStore } from '../hooks/useBeat'

interface SmileyProps {
  /** Pointer is somewhere over the island. */
  hovered: boolean
  /** Pointer is held down on the island. */
  pressed: boolean
  /** A song or video is playing right now. */
  playing: boolean
  /** Low-end energy of the track, used for the nod. */
  beat: BeatStore
  /** Increments every time a notification lands — the face reacts to it. */
  alertSignal: number
  /** The machine is on battery power and running low. */
  lowBattery: boolean
  /** The user may poke and drag the face. */
  interactive: boolean
}

type PokeKind = 'surprised' | 'wink' | 'shy'

type Mood = 'idle' | 'doze' | 'sleep' | 'hover' | 'pressed' | 'bliss' | 'alert' | 'sad' | 'poke'

/** Silence before the face starts to doze off. */
const DOZE_AFTER_MS = 22_000
/** How long the yawn lasts before the eyes close for good. */
const YAWN_MS = 1_800
/** Extra quiet after the yawn before it falls asleep. */
const SLEEP_AFTER_MS = 4_000
/** A poke reaction or an arrival blink. */
const POKE_MS = 1_300
const ALERT_MS = 1_600

/** The face inherits its ink from CSS, so the light theme can flip it dark. */
const INK = 'currentColor'

const POKES: PokeKind[] = ['surprised', 'wink', 'shy']

/**
 * Normalised pointer offset from the face centre. The travel is deliberately
 * small: the eyes sit close above the mouth, so a big shift reads as the face
 * coming apart rather than as a glance.
 */
function pupilOffset(rect: DOMRect, x: number, y: number): { x: number; y: number } {
  const dx = (x - (rect.left + rect.width / 2)) / 34
  const dy = (y - (rect.top + rect.height / 2)) / 46
  return {
    x: Math.min(1, Math.max(-1, dx)) * 0.95,
    y: Math.min(1, Math.max(-1, dy)) * 0.5
  }
}

/** The two happy, closed eyes — an "enjoying the song" face. */
function ClosedEyes() {
  return (
    <>
      <path
        d="M6.4 10.8Q8.4 8.1 10.6 10.8"
        fill="none"
        stroke={INK}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M13.4 10.8Q15.6 8.1 17.6 10.8"
        fill="none"
        stroke={INK}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </>
  )
}

/** Asleep: two small downward bows, flatter than the happy arcs. */
function SleepyEyes() {
  return (
    <>
      <path
        d="M6.4 10.4Q8.4 11.6 10.6 10.4"
        fill="none"
        stroke={INK}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M13.4 10.4Q15.6 11.6 17.6 10.4"
        fill="none"
        stroke={INK}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  )
}

/** Tiny solid eighth note, drawn in 16 units so it stays crisp at 9 px. */
function NoteSingle() {
  return (
    <svg viewBox="0 0 16 16" width="9" height="9" fill="currentColor" aria-hidden="true">
      <ellipse cx="4.4" cy="12.4" rx="2.6" ry="2" transform="rotate(-20 4.4 12.4)" />
      <rect x="6.2" y="3.2" width="1.3" height="9.2" rx="0.65" />
      <path d="M7.5 3.1c2 .6 3.6 1.9 4 4.2-1-1.5-2.3-2.4-4-2.8V3.1Z" />
    </svg>
  )
}

/** Two beamed notes (♫), same drawing rules. */
function NotePair() {
  return (
    <svg viewBox="0 0 16 16" width="9" height="9" fill="currentColor" aria-hidden="true">
      <ellipse cx="3.4" cy="12.3" rx="2.4" ry="1.9" transform="rotate(-20 3.4 12.3)" />
      <ellipse cx="11.2" cy="11.4" rx="2.4" ry="1.9" transform="rotate(-20 11.2 11.4)" />
      <rect x="5.1" y="3.6" width="1.2" height="8.1" rx="0.6" />
      <rect x="12.9" y="2.6" width="1.2" height="8.1" rx="0.6" />
      <path d="M5.1 3.6 14.1 2.2v1.6L5.1 5.2z" />
    </svg>
  )
}

/**
 * The face: no head, just white eyes and a mouth. It floats and blinks while
 * idle, tracks the pointer when hovered, folds into closed "blissful" eyes while
 * music is playing — and nods along with it. On top of that it is a small toy:
 * it can be poked (surprise, wink, bashful), dragged a few pixels before it
 * springs back, reacts to incoming notifications, yawns and falls asleep when
 * nothing happens, and looks glum when the battery is about to die.
 *
 * Purely decorative, so it stays hidden from screen readers.
 */
export function Smiley({
  hovered,
  pressed,
  playing,
  beat,
  alertSignal,
  lowBattery,
  interactive
}: SmileyProps) {
  const reduced = useReducedMotion() ?? false
  const ref = useRef<HTMLSpanElement>(null)
  const lookX = useMotionValue(0)
  const lookY = useMotionValue(0)
  const dragX = useMotionValue(0)
  const dragY = useMotionValue(0)
  const dragRotate = useTransform(dragX, (value) => value * 2.4)

  const [poke, setPoke] = useState<{ kind: PokeKind; seq: number } | null>(null)
  const [alerting, setAlerting] = useState(false)
  const [resting, setResting] = useState<'awake' | 'yawn' | 'sleep'>('awake')

  const level = beat.level
  const nodY = useTransform(level, (value) => -value * 2)
  const nodScaleY = useTransform(level, (value) => 1 + value * 0.12)
  const nodScaleX = useTransform(level, (value) => 1 - value * 0.05)
  const beatRotate = useTransform(beat.lean, (value) => value * 3)
  const grinOpen = useTransform(level, (value) => 1 + value * 0.4)
  const noteScale = useTransform(level, (value) => 1 + value * 0.3)

  // The listener stays mounted so the eyes react to the very first move that
  // brings the pointer over the island (that move happens before `hovered`).
  const hovering = useRef(hovered)
  hovering.current = hovered
  const last = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const apply = (x: number, y: number): void => {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return
      const offset = pupilOffset(rect, x, y)
      lookX.set(offset.x)
      lookY.set(offset.y)
    }

    const onMove = (event: PointerEvent): void => {
      last.current = { x: event.clientX, y: event.clientY }
      if (hovering.current) apply(event.clientX, event.clientY)
    }

    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [lookX, lookY])

  useEffect(() => {
    if (!hovered) {
      lookX.set(0)
      lookY.set(0)
      return
    }
    // Catch the position of the move that entered the island.
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const offset = pupilOffset(rect, last.current.x, last.current.y)
    lookX.set(offset.x)
    lookY.set(offset.y)
  }, [hovered, lookX, lookY])

  // --- reactions -----------------------------------------------------------

  // Counts the pokes, so every tap is the next joke in the rotation instead of
  // repeating the one still on screen. Monotonic: a tap that lands while the
  // previous reaction is still showing simply advances again.
  const pokeCount = useRef(0)

  useEffect(() => {
    if (!poke) return
    const timer = setTimeout(() => setPoke(null), POKE_MS)
    return () => clearTimeout(timer)
  }, [poke])

  const pokeNow = useCallback(() => {
    const kind = POKES[pokeCount.current % POKES.length]
    pokeCount.current += 1
    setPoke({ kind, seq: Date.now() })
  }, [])

  // Skip the mount value: only a notification that actually arrives is news.
  const lastAlert = useRef(alertSignal)
  useEffect(() => {
    if (alertSignal === lastAlert.current) return
    lastAlert.current = alertSignal
    setAlerting(true)
    const timer = setTimeout(() => setAlerting(false), ALERT_MS)
    return () => clearTimeout(timer)
  }, [alertSignal])

  // Doze off after a while without pointer, music, poke or notification — and
  // wake up the moment any of them happens again.
  const awake = hovered || playing || pressed || poke !== null || alerting
  useEffect(() => {
    if (reduced) {
      setResting('awake')
      return
    }
    if (awake) {
      setResting('awake')
      return
    }
    let sleepTimer: ReturnType<typeof setTimeout> | null = null
    const yawnTimer = setTimeout(() => {
      setResting('yawn')
      sleepTimer = setTimeout(() => setResting('sleep'), YAWN_MS + SLEEP_AFTER_MS)
    }, DOZE_AFTER_MS)
    return () => {
      clearTimeout(yawnTimer)
      if (sleepTimer) clearTimeout(sleepTimer)
    }
  }, [awake, reduced])

  // --- poke + drag ---------------------------------------------------------

  const dragStart = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  // Swallowing the poke's own pointer gesture must not get stuck: a single
  // press that ends off the face (capture lost, blur, another button down)
  // clears the flag, so the next real click on the header still works.
  const swallowClick = useRef(false)
  // The drag also ends in a synthetic click even after a real tug (CDP shows
  // header:click following moved pointer-ups), so remember the swallow in
  // state as well: the capture-phase click handler runs on a fresh render.
  const [pendingSwallow, setPendingSwallow] = useState(false)

  const endSwallow = useCallback((): void => {
    swallowClick.current = false
    setPendingSwallow(false)
  }, [])

  const onPointerDown = (event: React.PointerEvent<HTMLSpanElement>): void => {
    endSwallow()
    if (!interactive || event.button !== 0) return
    dragStart.current = { x: event.clientX, y: event.clientY, moved: false }
    // A poke starts on the face itself, so it must never also reach the
    // header's click handler (which would open or pin the card).
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLSpanElement>): void => {
    const start = dragStart.current
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!start.moved && Math.hypot(dx, dy) > 4) start.moved = true
    if (!start.moved) return
    // Only a few pixels of give: the face is tethered to the header.
    dragX.set(Math.max(-7, Math.min(7, dx * 0.55)))
    dragY.set(Math.max(-5, Math.min(5, dy * 0.55)))
  }

  const endDrag = (): void => {
    dragStart.current = null
    dragX.set(0)
    dragY.set(0)
  }

  const onPointerUp = (event: React.PointerEvent<HTMLSpanElement>): void => {
    const start = dragStart.current
    if (!start) {
      endSwallow()
      return
    }
    const dragged = start.moved
    endDrag()
    if (!interactive) {
      endSwallow()
      return
    }
    // A poke and a tug both already had their say above: swallow the click
    // that follows so the island never opens or toggles its pin because of
    // the toy. A real click next to the face still reaches the header.
    event.stopPropagation()
    swallowClick.current = true
    if (dragged) {
      // A tug is not a poke: it just springs back.
      setPendingSwallow(true)
      return
    }
    setPendingSwallow(true)
    pokeNow()
  }

  // --- mood ----------------------------------------------------------------

  const mood: Mood = pressed
    ? 'pressed'
    : poke
      ? 'poke'
      : alerting
        ? 'alert'
        : hovered
          ? 'hover'
          : lowBattery && !playing
            ? 'sad'
            : playing
              ? 'bliss'
              : resting === 'sleep'
                ? 'sleep'
                : resting === 'yawn'
                  ? 'doze'
                  : 'idle'

  const winking = mood === 'poke' && poke?.kind === 'wink'
  const surprised = mood === 'alert' || (mood === 'poke' && poke?.kind === 'surprised')
  const bashful = mood === 'poke' && poke?.kind === 'shy'
  const happyEyes = mood === 'bliss' || mood === 'pressed' || bashful || winking
  const sleepy = mood === 'sleep' || mood === 'doze'
  const openEyes = !happyEyes && !sleepy
  /** Notes only while there is a song (or video) actually playing. */
  const humming = playing && !reduced
  const sleeping = mood === 'sleep'

  const pose = reduced
    ? { scaleX: 1, scaleY: 1, rotate: 0 }
    : mood === 'pressed'
      ? { scaleX: 1.14, scaleY: 0.86, rotate: 2 }
      : surprised
        ? { scaleX: 1.16, scaleY: 1.1, rotate: 0 }
        : bashful
          ? { scaleX: 1.02, scaleY: 0.98, rotate: -4 }
          : winking
            ? { scaleX: 1.1, scaleY: 1.02, rotate: 3 }
            : mood === 'hover'
              ? { scaleX: 1.09, scaleY: 1.09, rotate: -3 }
              : mood === 'sad'
                ? { scaleX: 0.96, scaleY: 0.94, rotate: 0 }
                : mood === 'sleep' || mood === 'doze'
                  ? { scaleX: 1, scaleY: 0.97, rotate: 0 }
                  : mood === 'bliss'
                    ? { scaleX: 1.04, scaleY: 1.04, rotate: 0 }
                    : { scaleX: 1, scaleY: 1, rotate: 0 }

  // A slow bob while idle; the music nod on top of it does the rest.
  const sway = reduced
    ? { y: 0, rotate: 0 }
    : mood === 'bliss'
      ? { y: [0, -0.5, 0], rotate: [-1.4, 1.4, -1.4] }
      : mood === 'sleep'
        ? { y: [0, -0.7, 0], rotate: [-0.8, 0.8, -0.8] }
        : mood === 'idle' || mood === 'doze'
          ? { y: [0, -1.2, 0], rotate: 0 }
          : surprised
            ? { y: [-1.4, 0], rotate: 0 }
            : { y: 0, rotate: 0 }

  const swayTransition = reduced
    ? { duration: 0 }
    : surprised
      ? { duration: 0.42, ease: 'easeOut' as const }
      : mood === 'bliss'
        ? { duration: 3.6, repeat: Infinity, ease: 'easeInOut' as const }
        : mood === 'sleep'
          ? { duration: 5.2, repeat: Infinity, ease: 'easeInOut' as const }
          : mood === 'idle' || mood === 'doze'
            ? { duration: 4.6, repeat: Infinity, ease: 'easeInOut' as const }
            : { type: 'spring' as const, stiffness: 300, damping: 22 }

  return (
    <motion.span
      ref={ref}
      className="smiley"
      data-mood={mood}
      data-poke={poke?.kind ?? 'none'}
      data-interactive={interactive}
      initial={false}
      animate={pose}
      transition={{ type: 'spring', stiffness: 430, damping: 20, mass: 0.5 }}
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onClickCapture={(event) => {
        // A poke already did its joke in onPointerUp: swallow the click that
        // follows it so the island does not also open or toggle its pin.
        if (!pendingSwallow) return
        setPendingSwallow(false)
        event.stopPropagation()
        event.preventDefault()
      }}
    >
      {/* Tethered drag: a few pixels of give, then spring back. */}
      <motion.span className="smiley-drag" style={{ x: dragX, y: dragY, rotate: dragRotate }}>
        {/* Bass nod: squash + lift on every kick, leaning left/right in turn. */}
        <motion.span
          className="smiley-beat"
          style={
            reduced
              ? undefined
              : { y: nodY, scaleX: nodScaleX, scaleY: nodScaleY, rotate: beatRotate }
          }
        >
          <motion.svg
            className="smiley-face"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            initial={false}
            animate={sway}
            transition={swayTransition}
          >
            {/* Open eyes, glancing at the pointer — wide when startled. */}
            <motion.g
              style={{ x: lookX, y: lookY }}
              animate={{ opacity: openEyes ? 1 : 0 }}
              transition={{ duration: reduced ? 0 : 0.13 }}
            >
              <motion.ellipse
                className="smiley-eye smiley-eye--left"
                cx="8.4"
                cy="10.2"
                rx="1.45"
                ry="1.9"
                fill={INK}
                animate={{ rx: surprised ? 1.62 : 1.45, ry: surprised ? 2.16 : 1.9 }}
                transition={{ duration: reduced ? 0 : 0.16 }}
              />
              <motion.ellipse
                className="smiley-eye smiley-eye--right"
                cx="15.6"
                cy="10.2"
                rx="1.45"
                ry="1.9"
                fill={INK}
                animate={{
                  rx: surprised ? 1.62 : 1.45,
                  ry: surprised ? 2.16 : 1.9,
                  opacity: winking ? 0 : 1
                }}
                transition={{ duration: reduced ? 0 : 0.16 }}
              />
            </motion.g>

            {/* Happy arcs: songs, presses, a wink or a bashful poke. */}
            <motion.g
              animate={{ opacity: happyEyes ? 1 : 0, scaleY: mood === 'pressed' ? 0.9 : 1 }}
              transition={{ duration: reduced ? 0 : 0.16 }}
              style={{ transformOrigin: '12px 10.4px' }}
            >
              <ClosedEyes />
            </motion.g>

            {/* One eye shut: the wink lands on the right eye only. */}
            <motion.path
              d="M13.4 10.8Q15.6 8.6 17.6 10.8"
              fill="none"
              stroke={INK}
              strokeWidth="1.7"
              strokeLinecap="round"
              animate={{ opacity: winking ? 1 : 0 }}
              transition={{ duration: reduced ? 0 : 0.13 }}
            />

            {/* Asleep: flat, downward bows. */}
            <motion.g
              animate={{ opacity: sleepy ? 1 : 0 }}
              transition={{ duration: reduced ? 0 : 0.2 }}
            >
              <SleepyEyes />
            </motion.g>

            {/* Bashful: two tiny blush dots under the eyes. */}
            <motion.g
              animate={{ opacity: bashful ? 0.75 : 0 }}
              transition={{ duration: reduced ? 0 : 0.16 }}
            >
              <circle cx="7.2" cy="13.1" r="0.7" fill={INK} />
              <circle cx="16.8" cy="13.1" r="0.7" fill={INK} />
            </motion.g>

            {/* Small, easy smile — also the "sleeping" mouth. */}
            <motion.path
              d="M9.7 14.6Q12 16.3 14.3 14.6"
              fill="none"
              stroke={INK}
              strokeWidth="1.5"
              strokeLinecap="round"
              animate={{ opacity: mood === 'idle' || sleepy || bashful ? 1 : 0 }}
              transition={{ duration: reduced ? 0 : 0.16 }}
            />

            {/* Grin: wider and rounder, opening up with the music. */}
            <motion.g style={{ scaleY: reduced ? 1 : grinOpen, transformOrigin: '12px 14.4px' }}>
              <motion.path
                d="M8.8 13.9Q12 17.4 15.2 13.9"
                fill="none"
                stroke={INK}
                strokeWidth="1.7"
                strokeLinecap="round"
                animate={{ opacity: mood === 'bliss' || mood === 'hover' ? 1 : 0 }}
                transition={{ duration: reduced ? 0 : 0.16 }}
              />
            </motion.g>

            {/* Wink: a lopsided smirk. */}
            <motion.path
              d="M9.9 15.1Q12.6 16.4 14.6 14.4"
              fill="none"
              stroke={INK}
              strokeWidth="1.6"
              strokeLinecap="round"
              animate={{ opacity: winking ? 1 : 0 }}
              transition={{ duration: reduced ? 0 : 0.13 }}
            />

            {/* Pressed: a small "o". */}
            <motion.ellipse
              cx="12"
              cy="15.4"
              rx="1.25"
              ry="1.5"
              fill={INK}
              animate={{ opacity: mood === 'pressed' ? 1 : 0 }}
              transition={{ duration: reduced ? 0 : 0.13 }}
            />

            {/* Startled: mouth drops open. */}
            <motion.ellipse
              cx="12"
              cy="15.5"
              fill={INK}
              initial={false}
              animate={{
                opacity: surprised ? 1 : 0,
                rx: surprised ? 1.55 : 1.25,
                ry: surprised ? 2.1 : 1.5
              }}
              transition={{ duration: reduced ? 0 : 0.16 }}
            />

            {/* Glum: a small frown while the battery is low. */}
            <motion.path
              d="M9.9 16Q12 14.4 14.1 16"
              fill="none"
              stroke={INK}
              strokeWidth="1.5"
              strokeLinecap="round"
              animate={{ opacity: mood === 'sad' ? 1 : 0 }}
              transition={{ duration: reduced ? 0 : 0.16 }}
            />

            {/* A single tear, only on the low-battery face. */}
            <motion.ellipse
              cx="7.6"
              cy="12.4"
              rx="0.62"
              ry="0.85"
              fill={INK}
              animate={{ opacity: mood === 'sad' ? 0.85 : 0, cy: mood === 'sad' ? 13.6 : 12.4 }}
              transition={{ duration: reduced ? 0.01 : 1.4, repeat: mood === 'sad' ? Infinity : 0 }}
            />
          </motion.svg>
        </motion.span>
      </motion.span>

      {/* A song is on: the face hums little notes up into the header. */}
      <AnimatePresence>
        {humming && (
          <motion.span
            className="smiley-notes"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.22 }}
            style={{ scale: noteScale }}
          >
            <span className="smiley-note smiley-note--1">
              <NoteSingle />
            </span>
            <span className="smiley-note smiley-note--2">
              <NotePair />
            </span>
            <span className="smiley-note smiley-note--3">
              <NoteSingle />
            </span>
          </motion.span>
        )}
      </AnimatePresence>

      {/* Asleep: three little z's drift up from the face. */}
      <AnimatePresence>
        {sleeping && !reduced && (
          <motion.span
            className="smiley-zzz"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <span className="smiley-z smiley-z--1">z</span>
            <span className="smiley-z smiley-z--2">z</span>
            <span className="smiley-z smiley-z--3">z</span>
          </motion.span>
        )}
      </AnimatePresence>
    </motion.span>
  )
}