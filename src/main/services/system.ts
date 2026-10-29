import os from 'node:os'
import type systeminformation from 'systeminformation'
import { IPC } from '../../shared/ipc'
import type {
  BatteryStats,
  DiskStats,
  GpuStats,
  NetworkStats,
  SystemSnapshot
} from '../../shared/system'
import { getIslandWindow } from '../windows/island'

const FAST_INTERVAL_MS = 1000
const GPU_INTERVAL_MS = 5000
const SLOW_INTERVAL_MS = 15_000
const HISTORY_LENGTH = 60
/** Drop the history if the panel has been closed for a while. */
const STALE_AFTER_MS = 30_000

type GraphicsData = Awaited<ReturnType<typeof systeminformation.graphics>>
type FsList = Awaited<ReturnType<typeof systeminformation.fsSize>>
type BatteryInfo = Awaited<ReturnType<typeof systeminformation.battery>>
type TemperatureInfo = Awaited<ReturnType<typeof systeminformation.cpuTemperature>>

/**
 * `systeminformation` pulls in a large module graph (~5 MB in the main process)
 * and is only needed once the System panel is opened, so load it on demand.
 */
let siModule: typeof systeminformation | null = null
function si(): typeof systeminformation {
  if (!siModule) siModule = require('systeminformation') as typeof systeminformation
  return siModule
}

interface NetCounters {
  rx: number
  tx: number
}

const history = {
  cpu: [] as number[],
  memory: [] as number[],
  gpu: [] as number[]
}

let fastTimer: NodeJS.Timeout | null = null
let gpuTimer: NodeJS.Timeout | null = null
let slowTimer: NodeJS.Timeout | null = null
let fallbackNetTimer: NodeJS.Timeout | null = null

let running = false
let hasSnapshot = false
let fastBusy = false
let gpuBusy = false
let slowBusy = false
let lastTickAt = 0

let cpuBrand = ''
let cpuLoad = 0
let cpuTempC: number | null = null
let memoryUsedBytes = 0
let memoryTotalBytes = 0
let gpu: GpuStats | null = null
let disk: DiskStats | null = null
let network: NetworkStats | null = null
let battery: BatteryStats | null = null

let previousCpuTimes: Array<{ idle: number; total: number }> | null = null
let lastNetCounters: { rx: number; tx: number; at: number } | null = null

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

const warnOnce = (() => {
  const seen = new Set<string>()
  return (message: string, error: unknown): void => {
    if (seen.has(message)) return
    seen.add(message)
    console.warn(`[system] ${message}`, error)
  }
})()

async function safe<T>(task: () => Promise<T>): Promise<T | null> {
  try {
    return await task()
  } catch (error) {
    warnOnce('collector failed', error)
    return null
  }
}

/**
 * Windows exposes per-adapter byte counters through iphlpapi. We read them
 * with koffi instead of shelling out, which keeps the 1 s tick instant.
 * Returns `null` when the native module is unavailable (other platforms or a
 * failed load) so the caller can fall back to systeminformation.
 */
function createNativeNetworkReader(): (() => NetCounters | null) | null {
  if (process.platform !== 'win32') return null

  try {
    interface KoffiFunction {
      (...args: unknown[]): number
    }
    interface KoffiLibrary {
      func(name: string, result: string, args: string[]): KoffiFunction
    }
    interface KoffiModule {
      load(path: string): KoffiLibrary
    }

    // Required lazily so a broken native binary never takes the app down.
    const koffi = require('koffi') as KoffiModule
    const iphlpapi = koffi.load('iphlpapi.dll')
    const GetIfTable = iphlpapi.func('GetIfTable', 'uint32', ['void *', 'uint32 *', 'int'])
    const GetBestInterface = iphlpapi.func('GetBestInterface', 'uint32', ['uint32', 'uint32 *'])

    const MIB_IFROW_SIZE = 860
    const ERROR_INSUFFICIENT_BUFFER = 122
    const IF_TYPE_SOFTWARE_LOOPBACK = 24
    const IF_OPER_STATUS_OPERATIONAL = 5

    let buffer = Buffer.alloc(64 * 1024)
    const sizeRef = new Uint32Array(1)
    let bestIndex = 0

    const refreshDefaultIndex = (): void => {
      const indexRef = new Uint32Array(1)
      // 8.8.8.8 in network byte order; any public address works.
      const code = GetBestInterface(0x08080808, indexRef)
      if (code === 0) bestIndex = indexRef[0]
    }
    refreshDefaultIndex()

    return (): NetCounters | null => {
      sizeRef[0] = buffer.length
      let code = GetIfTable(buffer, sizeRef, 0)
      if (code === ERROR_INSUFFICIENT_BUFFER) {
        buffer = Buffer.alloc(sizeRef[0])
        sizeRef[0] = buffer.length
        code = GetIfTable(buffer, sizeRef, 0)
      }
      if (code !== 0) return null

      const count = buffer.readUInt32LE(0)
      let match: NetCounters | null = null
      let fallback: NetCounters | null = null

      for (let index = 0; index < count; index++) {
        const base = 4 + index * MIB_IFROW_SIZE
        const ifIndex = buffer.readUInt32LE(base + 512)
        const type = buffer.readUInt32LE(base + 516)
        const operStatus = buffer.readUInt32LE(base + 544)
        if (type === IF_TYPE_SOFTWARE_LOOPBACK || operStatus !== IF_OPER_STATUS_OPERATIONAL) continue

        const row: NetCounters = {
          rx: buffer.readUInt32LE(base + 552),
          tx: buffer.readUInt32LE(base + 556)
        }
        if (ifIndex === bestIndex) match = row
        if (!fallback && (row.rx > 0 || row.tx > 0)) fallback = row
      }

      if (!match) refreshDefaultIndex()
      return match ?? fallback
    }
  } catch (error) {
    warnOnce('native network counters unavailable', error)
    return null
  }
}

const readNativeNet = createNativeNetworkReader()

function readCpuTimes(): Array<{ idle: number; total: number }> {
  return os.cpus().map((cpu) => {
    const { user, nice, sys, irq, idle } = cpu.times
    return { idle, total: user + nice + sys + irq + idle }
  })
}

/** CPU load from os.cpus() deltas — instant, unlike si.currentLoad(). */
function computeCpuLoad(): number {
  const current = readCpuTimes()
  const previous = previousCpuTimes
  previousCpuTimes = current
  if (!previous || previous.length !== current.length) return cpuLoad

  let idleDelta = 0
  let totalDelta = 0
  for (let index = 0; index < current.length; index++) {
    idleDelta += current[index].idle - previous[index].idle
    totalDelta += current[index].total - previous[index].total
  }
  if (totalDelta <= 0) return cpuLoad
  return clamp(100 - (idleDelta / totalDelta) * 100, 0, 100)
}

/** 32-bit counters wrap at 4 GiB; a backwards jump means the adapter reset. */
function wrappedDelta(now: number, previous: number): number {
  const delta = (now - previous + 2 ** 32) % 2 ** 32
  return delta > 2 ** 31 ? 0 : delta
}

function readNetworkRate(): NetworkStats | null {
  if (!readNativeNet) return network

  const counters = readNativeNet()
  if (!counters) return network

  const now = Date.now()
  if (!lastNetCounters) {
    lastNetCounters = { rx: counters.rx, tx: counters.tx, at: now }
    return { rxPerSec: 0, txPerSec: 0 }
  }

  const elapsedMs = now - lastNetCounters.at
  const rx = wrappedDelta(counters.rx, lastNetCounters.rx)
  const tx = wrappedDelta(counters.tx, lastNetCounters.tx)
  lastNetCounters = { rx: counters.rx, tx: counters.tx, at: now }

  if (elapsedMs <= 0) return network
  // A long pause means the counters are not comparable anymore.
  if (elapsedMs > 10_000) return { rxPerSec: 0, txPerSec: 0 }
  return {
    rxPerSec: (rx * 1000) / elapsedMs,
    txPerSec: (tx * 1000) / elapsedMs
  }
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10
}

function pickGpu(data: GraphicsData | null): GpuStats | null {
  const controllers = (data?.controllers ?? []).filter((entry) => entry.model || entry.name)
  if (controllers.length === 0) return null

  // Prefer the controller with utilisation data (typically the dGPU), then VRAM.
  const ranked = controllers
    .map((controller) => ({
      controller,
      score: (num(controller.utilizationGpu) !== null ? 2 : 0) + (num(controller.vram) ?? 0) / 1_000_000
    }))
    .sort((a, b) => b.score - a.score)

  const { controller } = ranked[0]
  const totalMb = num(controller.vram) ?? num(controller.memoryTotal)
  const usedMb = num(controller.memoryUsed)

  return {
    name: (controller.name ?? controller.model ?? controller.vendor ?? 'GPU').trim(),
    utilization: round1(num(controller.utilizationGpu)),
    memoryUsedBytes: usedMb === null ? null : usedMb * 1024 * 1024,
    memoryTotalBytes: totalMb === null ? null : totalMb * 1024 * 1024,
    tempC: round1(num(controller.temperatureGpu)),
    powerW: round1(num(controller.powerDraw))
  }
}

function pickDisk(list: FsList | null): DiskStats | null {
  if (!Array.isArray(list) || list.length === 0) return null
  const systemDrive = (process.env['SystemDrive'] ?? 'C:').replace(/\\$/, '').toUpperCase()
  const entry =
    list.find((item) => item.mount?.toUpperCase().startsWith(systemDrive)) ?? list[0]
  if (!entry || !entry.size) return null
  return { mount: entry.mount, usedBytes: entry.used, totalBytes: entry.size }
}

function pickBattery(info: BatteryInfo | null): BatteryStats | null {
  if (!info || !info.hasBattery) return null
  const percent = num(info.percent)
  if (percent === null) return null
  const remaining = num(info.timeRemaining)
  return {
    percent: clamp(percent, 0, 100),
    charging: Boolean(info.isCharging) || Boolean(info.acConnected),
    timeRemainingMin: remaining !== null && remaining > 0 ? Math.round(remaining) : null
  }
}

function pushHistory(): void {
  const memoryPercent =
    memoryTotalBytes > 0 ? clamp((memoryUsedBytes / memoryTotalBytes) * 100, 0, 100) : 0
  history.cpu.push(Math.round(cpuLoad * 10) / 10)
  history.memory.push(Math.round(memoryPercent * 10) / 10)
  history.gpu.push(gpu?.utilization ?? 0)

  for (const key of ['cpu', 'memory', 'gpu'] as const) {
    if (history[key].length > HISTORY_LENGTH) history[key].splice(0, history[key].length - HISTORY_LENGTH)
  }
}

function buildSnapshot(): SystemSnapshot {
  return {
    timestamp: Date.now(),
    uptimeSec: Math.round(os.uptime()),
    cpu: {
      load: Math.round(cpuLoad * 10) / 10,
      brand: cpuBrand,
      threads: os.cpus().length,
      tempC: cpuTempC
    },
    memory: { usedBytes: memoryUsedBytes, totalBytes: memoryTotalBytes },
    gpu,
    disk,
    network,
    battery,
    history: {
      cpu: [...history.cpu],
      memory: [...history.memory],
      gpu: [...history.gpu]
    }
  }
}

function emit(): void {
  const win = getIslandWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC.systemUpdate, buildSnapshot())
}

async function sampleFast(): Promise<void> {
  if (fastBusy) return
  fastBusy = true
  try {
    cpuLoad = computeCpuLoad()
    memoryTotalBytes = os.totalmem()
    memoryUsedBytes = Math.max(0, memoryTotalBytes - os.freemem())
    const rate = readNetworkRate()
    if (rate) network = rate

    lastTickAt = Date.now()
    pushHistory()
    hasSnapshot = true
    emit()
  } finally {
    fastBusy = false
  }
}

async function sampleGpu(): Promise<void> {
  if (gpuBusy) return
  gpuBusy = true
  try {
    const data = await safe(() => si().graphics())
    if (data) gpu = pickGpu(data)
  } finally {
    gpuBusy = false
  }
}

/** Used only when the native counters are unavailable (slow: ~1.3 s). */
async function sampleNetworkFallback(): Promise<void> {
  const stats = await safe(() => si().networkStats())
  const entry = stats?.[0]
  if (!entry) return
  network = {
    rxPerSec: Math.max(0, num(entry.rx_sec) ?? 0),
    txPerSec: Math.max(0, num(entry.tx_sec) ?? 0)
  }
}

async function sampleSlow(): Promise<void> {
  if (slowBusy) return
  slowBusy = true
  try {
    const [fsList, batteryInfo, temperatures] = await Promise.all([
      safe(() => si().fsSize()),
      safe(() => si().battery()),
      safe(() => si().cpuTemperature())
    ])

    if (fsList) disk = pickDisk(fsList)
    if (batteryInfo) battery = pickBattery(batteryInfo)

    const main = num((temperatures as TemperatureInfo | null)?.main)
    cpuTempC = main !== null && main > 0 ? Math.round(main * 10) / 10 : null
  } finally {
    slowBusy = false
  }
}

function cleanBrand(model: string): string {
  return model
    .replace(/\((R|TM)\)/gi, '')
    .replace(/\bCPU\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function resetHistory(): void {
  history.cpu.length = 0
  history.memory.length = 0
  history.gpu.length = 0
  lastNetCounters = null
}

export function startSystemSampler(): Promise<SystemSnapshot | null> {
  if (!running) {
    running = true
    if (Date.now() - lastTickAt > STALE_AFTER_MS) resetHistory()

    cpuBrand = cleanBrand(os.cpus()[0]?.model ?? '')
    previousCpuTimes = readCpuTimes()
    memoryTotalBytes = os.totalmem()

    void sampleGpu()
    void sampleSlow()

    fastTimer = setInterval(() => void sampleFast(), FAST_INTERVAL_MS)
    gpuTimer = setInterval(() => void sampleGpu(), GPU_INTERVAL_MS)
    slowTimer = setInterval(() => void sampleSlow(), SLOW_INTERVAL_MS)
    if (!readNativeNet) {
      fallbackNetTimer = setInterval(() => void sampleNetworkFallback(), GPU_INTERVAL_MS)
    }
  }

  // Make sure the caller gets data immediately instead of waiting a tick.
  const ready = hasSnapshot ? Promise.resolve() : sampleFast()
  return ready.then(() => (hasSnapshot ? buildSnapshot() : null))
}

export function stopSystemSampler(): void {
  if (!running) return
  running = false
  for (const timer of [fastTimer, gpuTimer, slowTimer, fallbackNetTimer]) {
    if (timer) clearInterval(timer)
  }
  fastTimer = null
  gpuTimer = null
  slowTimer = null
  fallbackNetTimer = null
}

export function getSystemSnapshot(): SystemSnapshot | null {
  return hasSnapshot ? buildSnapshot() : null
}