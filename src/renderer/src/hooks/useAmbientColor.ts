import { useEffect, useState } from 'react'

const SAMPLE_SIZE = 24
const CACHE_LIMIT = 4

/** Ambient colour plus how strongly it should tint the island glass. */
export interface AmbientMood {
  color: string
  strength: number
}

const cache = new Map<string, AmbientMood | null>()

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function rgbToHsl(red: number, green: number, blue: number): [number, number, number] {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  const delta = max - min

  if (delta === 0) return [0, 0, lightness]

  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  let hue: number
  if (max === r) hue = ((g - b) / delta) % 6
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4

  return [(hue * 60 + 360) % 360, saturation, lightness]
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('artwork could not be decoded'))
    image.src = source
  })
}

/**
 * Averages the artwork into a single accent colour, ignoring near-black and
 * near-white pixels so a dark sleeve does not turn into a grey glow. The
 * result is normalised for the dark glass: vivid enough to read, never neon.
 */
export async function ambientColorFor(source: string): Promise<AmbientMood | null> {
  const cached = cache.get(source)
  if (cached !== undefined) return cached

  let mood: AmbientMood | null = null
  try {
    const image = await loadImage(source)
    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE_SIZE
    canvas.height = SAMPLE_SIZE
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context) {
      context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)

      let red = 0
      let green = 0
      let blue = 0
      let weight = 0

      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] < 160) continue
        const [, saturation, lightness] = rgbToHsl(
          data[index],
          data[index + 1],
          data[index + 2]
        )
        if (lightness < 0.05 || lightness > 0.97) continue

        // Vivid, mid-tone pixels carry the mood; flat black or white does not.
        const hueWeight = (0.15 + saturation) * (1 - Math.abs(lightness - 0.5))
        red += data[index] * hueWeight
        green += data[index + 1] * hueWeight
        blue += data[index + 2] * hueWeight
        weight += hueWeight
      }

      if (weight > 0) {
        const [hue, saturation, lightness] = rgbToHsl(red / weight, green / weight, blue / weight)
        const finalSaturation = saturation < 0.12 ? 0.18 : clamp(saturation, 0.38, 0.82)
        mood = {
          color: `hsl(${Math.round(hue)}, ${Math.round(finalSaturation * 100)}%, ${Math.round(
            clamp(lightness, 0.46, 0.62) * 100
          )}%)`,
          // Grey sleeves glow gently, vivid ones a bit more.
          strength: 0.12 + clamp((saturation - 0.1) / 0.6, 0, 1) * 0.16
        }
      }
    }
  } catch {
    mood = null
  }

  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(source, mood)
  return mood
}

/**
 * Mirrors the album mood into the `--ambient` / `--ambient-opacity` CSS custom
 * properties. They are cleared as soon as the panel unmounts (tab switch), so
 * the island only glows while the Media section is on screen.
 */
export function useAmbientColor(artwork: string | null): void {
  const [mood, setMood] = useState<AmbientMood | null>(null)

  useEffect(() => {
    if (!artwork) {
      setMood(null)
      return
    }

    let cancelled = false
    void ambientColorFor(artwork).then((next) => {
      if (!cancelled) setMood(next)
    })

    return () => {
      cancelled = true
    }
  }, [artwork])

  useEffect(() => {
    const root = document.documentElement
    if (!mood) {
      root.style.setProperty('--ambient', 'transparent')
      root.style.setProperty('--ambient-opacity', '0')
      return
    }

    root.style.setProperty('--ambient', mood.color)
    root.style.setProperty('--ambient-opacity', mood.strength.toFixed(2))

    return () => {
      root.style.setProperty('--ambient', 'transparent')
      root.style.setProperty('--ambient-opacity', '0')
    }
  }, [mood])
}