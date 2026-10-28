/**
 * Generates the tray + app icons without any image dependency.
 * Run with `npm run icons` (writes into ./resources).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'resources')

/** Supersampling factor used for anti-aliased edges. */
const SS = 4

/* --------------------------------------------------------------- png encoder */

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function encodePng(size, rgba) {
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  header[10] = 0 // deflate
  header[11] = 0 // adaptive filtering
  header[12] = 0 // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ------------------------------------------------------------- tiny renderer */

function makeCanvas(size) {
  return { size, data: new Float64Array(size * size * 4) }
}

function insideRoundedRect(px, py, x, y, w, h, radius) {
  if (px < x || py < y || px > x + w || py > y + h) return false
  const r = Math.min(radius, w / 2, h / 2)
  if (r <= 0) return true
  const cx = px < x + r ? x + r : px > x + w - r ? x + w - r : px
  const cy = py < y + r ? y + r : py > y + h - r ? y + h - r : py
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= r * r
}

function paint(canvas, rect, colorAt) {
  const { size, data } = canvas
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(size, Math.ceil(rect.x + rect.w))
  const y1 = Math.min(size, Math.ceil(rect.y + rect.h))
  const step = 1 / SS
  const perSample = 1 / (SS * SS)

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      let hits = 0
      for (let sy = 0; sy < SS; sy++) {
        const fy = py + (sy + 0.5) * step
        for (let sx = 0; sx < SS; sx++) {
          if (insideRoundedRect(px + (sx + 0.5) * step, fy, rect.x, rect.y, rect.w, rect.h, rect.radius)) hits++
        }
      }
      if (hits === 0) continue

      const [r, g, b, a = 1] = colorAt(px + 0.5, py + 0.5)
      const srcA = hits * perSample * a
      const i = (py * size + px) * 4
      const dstA = data[i + 3]
      const outA = srcA + dstA * (1 - srcA)
      if (outA <= 0) continue

      data[i] = (r * srcA + data[i] * dstA * (1 - srcA)) / outA
      data[i + 1] = (g * srcA + data[i + 1] * dstA * (1 - srcA)) / outA
      data[i + 2] = (b * srcA + data[i + 2] * dstA * (1 - srcA)) / outA
      data[i + 3] = outA
    }
  }
}

function toRgba(canvas) {
  const out = Buffer.alloc(canvas.size * canvas.size * 4)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = Math.round(Math.min(255, Math.max(0, canvas.data[i])))
    out[i + 1] = Math.round(Math.min(255, Math.max(0, canvas.data[i + 1])))
    out[i + 2] = Math.round(Math.min(255, Math.max(0, canvas.data[i + 2])))
    out[i + 3] = Math.round(Math.min(1, Math.max(0, canvas.data[i + 3])) * 255)
  }
  return out
}

const solid = (color) => () => color

function verticalGradient(top, bottom, y0, y1) {
  const span = Math.max(1, y1 - y0)
  return (_px, py) => {
    const t = Math.min(1, Math.max(0, (py - y0) / span))
    return [
      top[0] + (bottom[0] - top[0]) * t,
      top[1] + (bottom[1] - top[1]) * t,
      top[2] + (bottom[2] - top[2]) * t
    ]
  }
}

/* --------------------------------------------------------------------- icons */

function appIcon(size) {
  const canvas = makeCanvas(size)
  const pad = size * 0.045
  const inner = size - pad * 2

  paint(
    canvas,
    { x: pad, y: pad, w: inner, h: inner, radius: size * 0.23 },
    verticalGradient([30, 30, 36], [7, 7, 9], pad, size - pad)
  )

  const pillW = size * 0.56
  const pillH = size * 0.19
  const pillX = (size - pillW) / 2
  const pillY = (size - pillH) / 2

  paint(
    canvas,
    { x: pillX, y: pillY, w: pillW, h: pillH, radius: pillH / 2 },
    solid([244, 246, 251])
  )

  const dot = pillH * 0.42
  paint(
    canvas,
    {
      x: pillX + pillW - dot * 1.95,
      y: pillY + (pillH - dot) / 2,
      w: dot,
      h: dot,
      radius: dot / 2
    },
    solid([56, 189, 248])
  )

  return canvas
}

function trayIcon(size, color) {
  const canvas = makeCanvas(size)
  const w = size * 0.84
  const h = size * 0.34
  paint(canvas, { x: (size - w) / 2, y: (size - h) / 2, w, h, radius: h / 2 }, solid(color))
  return canvas
}

function save(name, canvas) {
  const buffer = encodePng(canvas.size, toRgba(canvas))
  writeFileSync(join(OUT_DIR, name), buffer)
  console.log(`  ${name.padEnd(18)} ${canvas.size}×${canvas.size}  ${buffer.length} B`)
}

mkdirSync(OUT_DIR, { recursive: true })
console.log('Generating icons:')
save('icon.png', appIcon(512))
// `tray-dark` uses a light glyph (for the dark Windows taskbar) and vice versa.
save('tray-dark.png', trayIcon(16, [255, 255, 255]))
save('tray-dark@2x.png', trayIcon(32, [255, 255, 255]))
save('tray-light.png', trayIcon(16, [18, 18, 21]))
save('tray-light@2x.png', trayIcon(32, [18, 18, 21]))
console.log('Done.')