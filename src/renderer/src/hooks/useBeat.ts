import { useEffect } from 'react'
import { useMotionValue, type MotionValue } from 'framer-motion'

export interface BeatStore {
  /** 0..1 low-end energy of whatever Windows is playing right now. */
  level: MotionValue<number>
  /** -1..1 lean that flips on every detected kick, so the face dances. */
  lean: MotionValue<number>
}

/**
 * Taps the Windows system audio (loopback, Electron-only) and turns the low
 * bands — kick and bass — into a 0..1 level. Used to make the face nod along
 * with the song instead of just swaying to a fixed timer.
 *
 * Nothing is recorded: samples are averaged per frame and thrown away, and the
 * graph is wired to a muted gain so the audio is not played twice.
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
    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    let frame = 0

    // Tuned for 48 kHz / fftSize 1024: bins 1..5 are roughly 47–280 Hz.
    const BINS = 5
    /** Auto-gain follows the local floor/ceiling of the bass so quiet and loud
     * tracks both move the face. */
    let floor = 1
    let ceil = 0
    let level_ = 0
    let onBeat = false
    let direction = 1

    const tick = (analyser: AnalyserNode, bins: Uint8Array<ArrayBuffer>): void => {
      if (cancelled) return
      analyser.getByteFrequencyData(bins)

      let sum = 0
      for (let index = 1; index <= BINS; index += 1) sum += bins[index]
      const raw = sum / (BINS * 255)

      floor = raw < floor ? raw : floor + (raw - floor) * 0.02
      ceil = raw > ceil ? raw : ceil - (ceil - raw) * 0.02
      const span = Math.max(0.12, ceil - floor)
      const target = Math.max(0, Math.min(1, (raw - floor) / span))

      // A little smoothing keeps the nod musical instead of twitchy.
      level_ += (target - level_) * 0.25
      level.set(level_)

      // Hysteresis, so one bass swell flips the lean exactly once.
      if (level_ > 0.72 && !onBeat) {
        onBeat = true
        direction = -direction
      } else if (level_ < 0.32 && onBeat) {
        onBeat = false
      }
      lean.set(direction * level_)

      frame = requestAnimationFrame(() => tick(analyser, bins))
    }

    const start = async (): Promise<void> => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { mandatory: { chromeMediaSource: 'desktop' } },
          video: { mandatory: { chromeMediaSource: 'desktop' } }
        } as unknown as MediaStreamConstraints)
      } catch {
        return
      }

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop())
        stream = null
        return
      }

      // The video track is only there because Windows refuses audio-only
      // loopback through `chromeMediaSource: desktop`.
      stream.getVideoTracks().forEach((track) => track.stop())

      context = new AudioContext()
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.62

      // Keep the graph running without echoing the desktop back into it.
      const sink = context.createGain()
      sink.gain.value = 0
      source.connect(analyser)
      analyser.connect(sink)
      sink.connect(context.destination)

      const bins = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
      frame = requestAnimationFrame(() => tick(analyser, bins))
    }

    void start()

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((track) => track.stop())
      void context?.close().catch(() => undefined)
      level.set(0)
      lean.set(0)
    }
  }, [active, level, lean])

  return { level, lean }
}