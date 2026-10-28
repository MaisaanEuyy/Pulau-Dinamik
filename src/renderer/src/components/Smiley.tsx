import { motion, useMotionValue, useReducedMotion } from 'framer-motion'
import { useEffect, useId, useRef } from 'react'

interface SmileyProps {
  /** Pointer is somewhere over the island. */
  hovered: boolean
  /** Pointer is held down on the island. */
  pressed: boolean
  expanded: boolean
}

type Mood = 'idle' | 'open' | 'hover' | 'pressed'

/** Normalised pointer offset from the face centre, clamped to the eye travel. */
function pupilOffset(rect: DOMRect, x: number, y: number): { x: number; y: number } {
  const dx = (x - (rect.left + rect.width / 2)) / 16
  const dy = (y - (rect.top + rect.height / 2)) / 16
  return {
    x: Math.min(1, Math.max(-1, dx)) * 1.9,
    y: Math.min(1, Math.max(-1, dy)) * 1.5
  }
}

/**
 * The little face that replaced the white dot. It bobs and blinks while idle,
 * follows the pointer with its eyes when the island is hovered and squishes
 * when it is pressed. Purely decorative, so it is hidden from screen readers.
 */
export function Smiley({ hovered, pressed, expanded }: SmileyProps) {
  const reduced = useReducedMotion() ?? false
  const ref = useRef<HTMLSpanElement>(null)
  const lookX = useMotionValue(0)
  const lookY = useMotionValue(0)
  // useId() contains colons, which are awkward inside url(#…).
  const gradientId = `smiley-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

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

  const mood: Mood = pressed ? 'pressed' : hovered ? 'hover' : expanded ? 'open' : 'idle'
  const smile = mood === 'hover' || mood === 'open'

  const pose = reduced
    ? { scaleX: 1, scaleY: 1, rotate: 0, y: 0 }
    : mood === 'pressed'
      ? { scaleX: 1.1, scaleY: 0.9, rotate: 2, y: 0.8 }
      : mood === 'hover'
        ? { scaleX: 1.08, scaleY: 1.08, rotate: -4, y: -0.6 }
        : mood === 'open'
          ? { scaleX: 1.04, scaleY: 1.04, rotate: 0, y: -0.4 }
          : { scaleX: 1, scaleY: 1, rotate: 0, y: 0 }

  return (
    <motion.span
      ref={ref}
      className="smiley"
      data-mood={mood}
      initial={false}
      animate={pose}
      transition={{ type: 'spring', stiffness: 420, damping: 18, mass: 0.5 }}
      aria-hidden="true"
    >
      <svg
        className={reduced || mood !== 'idle' ? 'smiley-face' : 'smiley-face smiley-face--bob'}
        viewBox="0 0 24 24"
        width="19"
        height="19"
      >
        <defs>
          <radialGradient id={gradientId} cx="34%" cy="26%" r="86%">
            <stop offset="0%" stopColor="#ffeeb8" />
            <stop offset="52%" stopColor="#ffd166" />
            <stop offset="100%" stopColor="#f0a029" />
          </radialGradient>
        </defs>

        <circle cx="12" cy="12" r="10.1" fill={`url(#${gradientId})`} />
        <circle
          cx="12"
          cy="12"
          r="10.1"
          fill="none"
          stroke="rgba(122, 72, 6, 0.22)"
          strokeWidth="0.8"
        />
        {/* glossy highlight */}
        <ellipse cx="8.2" cy="6.8" rx="3.5" ry="2.1" fill="#fffdf4" opacity="0.32" transform="rotate(-28 8.2 6.8)" />

        <motion.g style={{ x: lookX, y: lookY }}>
          <ellipse className="smiley-eye" cx="8.6" cy="10.1" rx="1.42" ry="1.85" fill="#3a2506" />
          <ellipse className="smiley-eye" cx="15.4" cy="10.1" rx="1.42" ry="1.85" fill="#3a2506" />
        </motion.g>

        {/* mouth: neutral smile, wide open smile and a small "oh" when pressed */}
        <path
          d="M8.6 14.3c.95 1.15 2.05 1.72 3.4 1.72s2.45-.57 3.4-1.72"
          fill="none"
          stroke="#3a2506"
          strokeWidth="1.35"
          strokeLinecap="round"
          className="smiley-mouth"
          opacity={mood === 'pressed' ? 0 : smile ? 0 : 1}
        />
        <path
          d="M8.2 13.6c1 2.15 2.35 3.1 3.8 3.1s2.8-.95 3.8-3.1"
          fill="none"
          stroke="#3a2506"
          strokeWidth="1.55"
          strokeLinecap="round"
          className="smiley-mouth"
          opacity={smile ? 1 : 0}
        />
        <ellipse
          cx="12"
          cy="15.1"
          rx="1.55"
          ry="1.15"
          fill="#3a2506"
          className="smiley-mouth"
          opacity={mood === 'pressed' ? 1 : 0}
        />

        <ellipse
          cx="5.9"
          cy="13.9"
          rx="1.5"
          ry="0.85"
          fill="#ff9a63"
          className="smiley-mouth"
          opacity={smile || mood === 'pressed' ? 0.42 : 0.18}
        />
        <ellipse
          cx="18.1"
          cy="13.9"
          rx="1.5"
          ry="0.85"
          fill="#ff9a63"
          className="smiley-mouth"
          opacity={smile || mood === 'pressed' ? 0.42 : 0.18}
        />
      </svg>
    </motion.span>
  )
}