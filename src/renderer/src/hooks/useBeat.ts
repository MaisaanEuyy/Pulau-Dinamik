import { useEffect } from 'react'
import { useMotionValue, type MotionValue } from 'framer-motion'

export interface BeatStore {
  /** 0..1 energy of whatever Windows is playing right now. */
  level: MotionValue<number>
  /** -1..1 lean that flips on every detected beat, so the face dances. */
  lean: MotionValue<number>
}

/**
 * Turns the default output's peak level — read once per frame from Core Audio
 * in the main process — into a smoothed 0..1 level plus a lean that flips on
 * each kick.
 *
 * Nothing is recorded and no capture stream is opened: the meter lives inside
 * Windows' audio engine, so the visualiser costs no extra renderer memory while
 * music plays.
 */
export function useBeat(active: boolean): BeatStore {
  const level = useMotionValue(0)
  const lean = useMotionValue(0)

  useEffect(() => {
    if (!active) {
      level.set(0)
      lean.set(0)
      return
    }

    let cancelled = false
    /** Auto-gain follows the local floor/ceiling of the signal so quiet and
     * loud tracks both move the face. */
    let floor = 1
    let ceil = 0
    let level_ = 0
    let onBeat = false
    let direction = 1

    const apply = (peak: number): void => {
      if (cancelled) return
      const raw = Math.max(0, Math.min(1, peak))

      floor = raw < floor ? raw : floor + (raw - floor) * 0.02
      ceil = raw > ceil ? raw : ceil - (ceil - raw) * 0.02
      const span = Math.max(0.12, ceil - floor)
      const target = Math.max(0, Math.min(1, (raw - floor) / span))

      // A little smoothing keeps the nod musical instead of twitchy.
      level_ += (target - level_) * 0.25
      level.set(level_)

      // Hysteresis, so one swell flips the lean exactly once.
      if (level_ > 0.72 && !onBeat) {
        onBeat = true
        direction = -direction
      } else if (level_ < 0.32 && onBeat) {
        onBeat = false
      }
      lean.set(direction * level_)
    }

    const off = window.island.onBeatUpdate(apply)
    void window.island.subscribeBeat().catch(() => undefined)

    return () => {
      cancelled = true
      off()
      void window.island.unsubscribeBeat().catch(() => undefined)
      level.set(0)
      lean.set(0)
    }
  }, [active, level, lean])

  return { level, lean }
}