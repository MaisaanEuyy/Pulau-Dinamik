import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
import { useEffect, useRef } from 'react'
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
}

type Mood = 'idle' | 'hover' | 'pressed' | 'bliss'

const WHITE = '#f8fbff'

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
        stroke={WHITE}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M13.4 10.8Q15.6 8.1 17.6 10.8"
        fill="none"
        stroke={WHITE}
        strokeWidth="1.7"
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
 * music is playing — and nods along with the bass. Purely decorative, so it
 * stays hidden from screen readers.
 */
export function Smiley({ hovered, pressed, playing, beat }: SmileyProps) {
  const reduced = useReducedMotion() ?? false
  const ref = useRef<HTMLSpanElement>(null)
  const lookX = useMotionValue(0)
  const lookY = useMotionValue(0)

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

  const mood: Mood = pressed ? 'pressed' : hovered ? 'hover' : playing ? 'bliss' : 'idle'
  const eyesShut = mood === 'bliss' || mood === 'pressed'
  const grinning = mood === 'bliss' || mood === 'hover'
  /** Notes only while there is a song (or video) actually playing. */
  const humming = playing && !reduced

  const pose = reduced
    ? { scaleX: 1, scaleY: 1, rotate: 0 }
    : mood === 'pressed'
      ? { scaleX: 1.14, scaleY: 0.86, rotate: 2 }
      : mood === 'hover'
        ? { scaleX: 1.09, scaleY: 1.09, rotate: -3 }
        : mood === 'bliss'
          ? { scaleX: 1.04, scaleY: 1.04, rotate: 0 }
          : { scaleX: 1, scaleY: 1, rotate: 0 }

  // A slow bob while idle; the bass nod on top of it does the rest.
  const sway = reduced
    ? { y: 0, rotate: 0 }
    : mood === 'bliss'
      ? { y: [0, -0.5, 0], rotate: [-1.4, 1.4, -1.4] }
      : mood === 'idle'
        ? { y: [0, -1.2, 0], rotate: 0 }
        : { y: 0, rotate: 0 }

  const swayTransition = reduced
    ? { duration: 0 }
    : mood === 'bliss'
      ? { duration: 3.6, repeat: Infinity, ease: 'easeInOut' as const }
      : mood === 'idle'
        ? { duration: 4.6, repeat: Infinity, ease: 'easeInOut' as const }
        : { type: 'spring' as const, stiffness: 300, damping: 22 }

  return (
    <motion.span
      ref={ref}
      className="smiley"
      data-mood={mood}
      initial={false}
      animate={pose}
      transition={{ type: 'spring', stiffness: 430, damping: 20, mass: 0.5 }}
      aria-hidden="true"
    >
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
          {/* Open eyes, glancing at the pointer. */}
          <motion.g
            style={{ x: lookX, y: lookY }}
            animate={{ opacity: eyesShut ? 0 : 1 }}
            transition={{ duration: reduced ? 0 : 0.13 }}
          >
            <ellipse className="smiley-eye" cx="8.4" cy="10.2" rx="1.45" ry="1.9" fill={WHITE} />
            <ellipse className="smiley-eye" cx="15.6" cy="10.2" rx="1.45" ry="1.9" fill={WHITE} />
          </motion.g>

          {/* Closed eyes: happy arcs while the song plays, a flatter squint when pressed. */}
          <motion.g
            animate={{ opacity: eyesShut ? 1 : 0, scaleY: mood === 'pressed' ? 0.9 : 1 }}
            transition={{ duration: reduced ? 0 : 0.16 }}
            style={{ transformOrigin: '12px 10.4px' }}
          >
            <ClosedEyes />
          </motion.g>

          {/* Small, easy smile. */}
          <motion.path
            d="M9.7 14.6Q12 16.3 14.3 14.6"
            fill="none"
            stroke={WHITE}
            strokeWidth="1.5"
            strokeLinecap="round"
            animate={{ opacity: mood === 'idle' ? 1 : 0 }}
            transition={{ duration: reduced ? 0 : 0.16 }}
          />

          {/* Grin: wider and rounder, opening up on the bass. */}
          <motion.g style={{ scaleY: reduced ? 1 : grinOpen, transformOrigin: '12px 14.4px' }}>
            <motion.path
              d="M8.8 13.9Q12 17.4 15.2 13.9"
              fill="none"
              stroke={WHITE}
              strokeWidth="1.7"
              strokeLinecap="round"
              animate={{ opacity: grinning ? 1 : 0 }}
              transition={{ duration: reduced ? 0 : 0.16 }}
            />
          </motion.g>

          {/* Pressed: a small "o". */}
          <motion.ellipse
            cx="12"
            cy="15.4"
            rx="1.25"
            ry="1.5"
            fill={WHITE}
            animate={{ opacity: mood === 'pressed' ? 1 : 0 }}
            transition={{ duration: reduced ? 0 : 0.13 }}
          />
        </motion.svg>
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
    </motion.span>
  )
}