import { motion, useMotionValue, useReducedMotion } from 'framer-motion'
import { useEffect, useRef } from 'react'

interface SmileyProps {
  /** Pointer is somewhere over the island. */
  hovered: boolean
  /** Pointer is held down on the island. */
  pressed: boolean
  /** A song or video is playing right now. */
  playing: boolean
}

type Mood = 'idle' | 'hover' | 'pressed' | 'bliss'

const WHITE = '#f8fbff'

/** Normalised pointer offset from the face centre, clamped to the eye travel. */
function pupilOffset(rect: DOMRect, x: number, y: number): { x: number; y: number } {
  const dx = (x - (rect.left + rect.width / 2)) / 16
  const dy = (y - (rect.top + rect.height / 2)) / 16
  return {
    x: Math.min(1, Math.max(-1, dx)) * 1.9,
    y: Math.min(1, Math.max(-1, dy)) * 1.5
  }
}

/** The two happy, closed eyes — an "enjoying the song" face. */
function ClosedEyes({ opacity }: { opacity: number }) {
  return (
    <g opacity={opacity}>
      <path
        d="M6.1 10.5Q8.3 7.5 10.5 10.5"
        fill="none"
        stroke={WHITE}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M13.5 10.5Q15.7 7.5 17.9 10.5"
        fill="none"
        stroke={WHITE}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </g>
  )
}

/**
 * The face: no head, just white eyes and a mouth. It floats and blinks while
 * idle, tracks the pointer when hovered, folds into closed "blissful" eyes when
 * music is playing and squishes into a small "o" while pressed. Purely
 * decorative, so it stays hidden from screen readers.
 */
export function Smiley({ hovered, pressed, playing }: SmileyProps) {
  const reduced = useReducedMotion() ?? false
  const ref = useRef<HTMLSpanElement>(null)
  const lookX = useMotionValue(0)
  const lookY = useMotionValue(0)

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

  const pose = reduced
    ? { scaleX: 1, scaleY: 1, rotate: 0 }
    : mood === 'pressed'
      ? { scaleX: 1.14, scaleY: 0.86, rotate: 2 }
      : mood === 'hover'
        ? { scaleX: 1.09, scaleY: 1.09, rotate: -3 }
        : mood === 'bliss'
          ? { scaleX: 1.04, scaleY: 1.04, rotate: 0 }
          : { scaleX: 1, scaleY: 1, rotate: 0 }

  // A slow bob while idle; when the music is on the whole face sways with it.
  const sway = reduced
    ? { y: 0, rotate: 0 }
    : mood === 'bliss'
      ? { y: [0, -0.6, 0], rotate: [-2.4, 2.4, -2.4] }
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
      <motion.svg
        className="smiley-face"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        initial={false}
        animate={sway}
        transition={swayTransition}
      >
        {/* Open eyes, following the pointer. */}
        <motion.g
          style={{ x: lookX, y: lookY }}
          animate={{ opacity: eyesShut ? 0 : 1 }}
          transition={{ duration: reduced ? 0 : 0.13 }}
        >
          <ellipse className="smiley-eye" cx="8.2" cy="9.7" rx="1.5" ry="2.05" fill={WHITE} />
          <ellipse className="smiley-eye" cx="15.8" cy="9.7" rx="1.5" ry="2.05" fill={WHITE} />
        </motion.g>

        {/* Closed eyes: happy arcs while the song plays, a flatter squint when pressed. */}
        <motion.g
          animate={{ opacity: eyesShut ? 1 : 0, scaleY: mood === 'pressed' ? 0.9 : 1 }}
          transition={{ duration: reduced ? 0 : 0.16 }}
          style={{ transformOrigin: '12px 10px' }}
        >
          <ClosedEyes opacity={1} />
        </motion.g>

        {/* Small, easy smile. */}
        <motion.path
          d="M9.5 15.1Q12 16.9 14.5 15.1"
          fill="none"
          stroke={WHITE}
          strokeWidth="1.5"
          strokeLinecap="round"
          animate={{ opacity: mood === 'idle' ? 1 : 0 }}
          transition={{ duration: reduced ? 0 : 0.16 }}
        />

        {/* Grin: wider and rounder, gently humming along with the track. */}
        <motion.path
          d="M8.5 14.4Q12 18.2 15.5 14.4"
          fill="none"
          stroke={WHITE}
          strokeWidth="1.7"
          strokeLinecap="round"
          animate={
            grinning
              ? {
                  opacity: 1,
                  scaleY: mood === 'bliss' && !reduced ? [1, 1.16, 1] : 1
                }
              : { opacity: 0, scaleY: 1 }
          }
          transition={
            grinning && mood === 'bliss' && !reduced
              ? { opacity: { duration: 0.16 }, scaleY: { duration: 3.6, repeat: Infinity, ease: 'easeInOut' } }
              : { duration: reduced ? 0 : 0.16 }
          }
          style={{ transformOrigin: '12px 15px' }}
        />

        {/* Pressed: a small "o". */}
        <motion.ellipse
          cx="12"
          cy="15.6"
          rx="1.25"
          ry="1.5"
          fill={WHITE}
          animate={{ opacity: mood === 'pressed' ? 1 : 0 }}
          transition={{ duration: reduced ? 0 : 0.13 }}
        />
      </motion.svg>
    </motion.span>
  )
}