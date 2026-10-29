import { IPC } from '../../shared/ipc'
import type { VolumeState } from '../../shared/volume'
import { getIslandWindow } from '../windows/island'

const POLL_INTERVAL_MS = 150
/** Re-resolve the default endpoint every ~2 s so switching output devices is
 * picked up without needing IMMNotificationClient callbacks. */
const REFRESH_EVERY_TICKS = 13
const LEVEL_EPSILON = 0.001

const CLSCTX_ALL = 23
const POINTER_SIZE = process.arch === 'x64' || process.arch === 'arm64' ? 8 : 4

interface KoffiFunction {
  (...args: unknown[]): number
}

interface KoffiLibrary {
  func(definition: string): KoffiFunction
}

interface KoffiModule {
  load(path: string): KoffiLibrary
  struct(name: string, members: Record<string, string>): unknown
  proto(definition: string): unknown
  decode(value: unknown, type: unknown): unknown
  decode(value: unknown, offset: number, type: unknown): unknown
}

interface AudioReader {
  read(): VolumeState | null
  /** 0..1 peak of whatever is playing on the default output, or null. */
  peak(): number | null
  close(): void
}

let timer: NodeJS.Timeout | null = null
let reader: AudioReader | null = null
let last: VolumeState | null = null
let ticks = 0

/** The beat watcher polls fast enough to feel like a 60 fps animation. */
const BEAT_POLL_MS = 16
/** Re-resolve the endpoint every ~2 s, same as the volume watcher. */
const BEAT_REFRESH_EVERY = 125

let beatTimer: NodeJS.Timeout | null = null
let beatReader: AudioReader | null = null
let beatTicks = 0

/** Koffi registers the GUID struct globally, so build the opener only once. */
let opener: (() => AudioReader | null) | null = null
let openerReady = false

function getEndpointOpener(): (() => AudioReader | null) | null {
  if (!openerReady) {
    openerReady = true
    opener = createEndpointOpener()
  }
  return opener
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

function parseGuid(value: string): Record<string, unknown> {
  const match =
    /^\{?([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\}?$/i.exec(value)
  if (!match) throw new Error(`invalid GUID ${value}`)

  const tail = match[4] + match[5]
  const bytes: number[] = []
  for (let index = 0; index < 16; index += 2) {
    bytes.push(Number.parseInt(tail.slice(index, index + 2), 16))
  }

  return {
    Data1: Number.parseInt(match[1], 16),
    Data2: Number.parseInt(match[2], 16),
    Data3: Number.parseInt(match[3], 16),
    Data4: bytes
  }
}

/**
 * Reads the master volume of the default render device straight from Core
 * Audio. koffi can call COM vtable slots, so no extra process is needed: the
 * two getters are a couple of microseconds each.
 */
function createEndpointOpener(): (() => AudioReader | null) | null {
  if (process.platform !== 'win32') return null

  let koffi: KoffiModule
  try {
    // Required lazily so a broken native binary never takes the app down.
    koffi = require('koffi') as KoffiModule
  } catch (error) {
    console.warn('[audio] koffi unavailable', error)
    return null
  }

  try {
    koffi.struct('GUID', {
      Data1: 'uint32_t',
      Data2: 'uint16_t',
      Data3: 'uint16_t',
      Data4: 'uint8_t[8]'
    })

    const CLSID_MM_DEVICE_ENUMERATOR = parseGuid('BCDE0395-E52F-467C-8E3D-C4579291692E')
    const IID_MM_DEVICE_ENUMERATOR = parseGuid('A95664D2-9614-4F35-A746-DE8DB63617E6')
    const IID_AUDIO_ENDPOINT_VOLUME = parseGuid('5CDF2C82-841E-4546-9722-0CF74078229A')
    const IID_AUDIO_METER_INFORMATION = parseGuid('C02216F6-8C67-4B5B-9D00-D008E73E0064')

    const ole32 = koffi.load('ole32.dll')
    const CoInitializeEx = ole32.func('long CoInitializeEx(void *pvReserved, uint32_t dwCoInit)')
    const CoCreateInstance = ole32.func(
      'long CoCreateInstance(const GUID *rclsid, void *pUnkOuter, uint32_t dwClsContext, const GUID *riid, void **ppv)'
    )

    const GetDefaultAudioEndpoint = koffi.proto(
      'long GetDefaultAudioEndpoint(void *self, int dataFlow, int role, void **ppDevice)'
    )
    const Activate = koffi.proto(
      'long Activate(void *self, const GUID *iid, uint32_t clsctx, void *params, void **ppInterface)'
    )
    const GetMasterVolumeLevelScalar = koffi.proto(
      'long GetMasterVolumeLevelScalar(void *self, _Out_ float *level)'
    )
    const GetMute = koffi.proto('long GetMute(void *self, _Out_ int32_t *muted)')
    const GetPeakValue = koffi.proto('long GetPeakValue(void *self, _Out_ float *peak)')
    const Release = koffi.proto('uint32_t Release(void *self)')

    // Chromium already owns the COM apartment on the UI thread; a changed-mode
    // HRESULT is expected and harmless.
    try {
      CoInitializeEx(null, 0)
    } catch {
      // No apartment means COM calls will fail below, which is handled.
    }

    const methodSlot = (object: unknown, index: number): unknown =>
      koffi.decode(koffi.decode(object, 'void *'), index * POINTER_SIZE, 'void *')

    const method = <T>(object: unknown, index: number, proto: unknown): T =>
      koffi.decode(methodSlot(object, index), proto) as T

    const release = (object: unknown): void => {
      try {
        const releaseFn = method<(self: unknown) => number>(object, 2, Release)
        releaseFn(object)
      } catch {
        // The endpoint is already gone; nothing to clean up.
      }
    }

    return (): AudioReader | null => {
      const enumeratorRef = Buffer.alloc(POINTER_SIZE)
      if (
        CoCreateInstance(
          CLSID_MM_DEVICE_ENUMERATOR,
          null,
          CLSCTX_ALL,
          IID_MM_DEVICE_ENUMERATOR,
          enumeratorRef
        ) !== 0
      ) {
        return null
      }
      const enumerator = koffi.decode(enumeratorRef, 'void *')

      let device: unknown = null
      let volume: unknown = null
      let meter: unknown = null

      const fail = (): null => {
        if (meter) release(meter)
        if (volume) release(volume)
        if (device) release(device)
        release(enumerator)
        return null
      }

      try {
        // eRender = 0, eConsole = 0
        const deviceRef = Buffer.alloc(POINTER_SIZE)
        const getDefault = method<(self: unknown, flow: number, role: number, out: Buffer) => number>(
          enumerator,
          4,
          GetDefaultAudioEndpoint
        )
        if (getDefault(enumerator, 0, 0, deviceRef) !== 0) return fail()
        device = koffi.decode(deviceRef, 'void *')

        const volumeRef = Buffer.alloc(POINTER_SIZE)
        const activate = method<
          (self: unknown, iid: unknown, ctx: number, params: unknown, out: Buffer) => number
        >(device, 3, Activate)
        if (activate(device, IID_AUDIO_ENDPOINT_VOLUME, CLSCTX_ALL, null, volumeRef) !== 0) {
          return fail()
        }
        volume = koffi.decode(volumeRef, 'void *')

        // Optional: the master peak meter. The beat visualiser uses it so the
        // renderer never has to open a desktop-capture stream.
        const meterRef = Buffer.alloc(POINTER_SIZE)
        try {
          if (activate(device, IID_AUDIO_METER_INFORMATION, CLSCTX_ALL, null, meterRef) === 0) {
            meter = koffi.decode(meterRef, 'void *')
          }
        } catch {
          meter = null
        }

        const getLevel = method<(self: unknown, out: Float32Array) => number>(
          volume,
          9,
          GetMasterVolumeLevelScalar
        )
        const getMute = method<(self: unknown, out: Int32Array) => number>(volume, 15, GetMute)
        const getPeak = meter
          ? method<(self: unknown, out: Float32Array) => number>(meter, 3, GetPeakValue)
          : null

        const levelRef = new Float32Array(1)
        const muteRef = new Int32Array(1)
        const peakRef = new Float32Array(1)

        return {
          read(): VolumeState | null {
            try {
              if (getLevel(volume, levelRef) !== 0) return null
              if (getMute(volume, muteRef) !== 0) return null
              return { level: clamp(levelRef[0], 0, 1), muted: muteRef[0] !== 0 }
            } catch {
              return null
            }
          },
          peak(): number | null {
            if (!getPeak) return null
            try {
              if (getPeak(meter, peakRef) !== 0) return null
              return clamp(peakRef[0], 0, 1)
            } catch {
              return null
            }
          },
          close(): void {
            if (meter) release(meter)
            release(volume)
            release(device)
            release(enumerator)
          }
        }
      } catch (error) {
        console.warn('[audio] failed to open the default endpoint', error)
        return fail()
      }
    }
  } catch (error) {
    console.warn('[audio] Core Audio binding unavailable', error)
    return null
  }
}

function emit(state: VolumeState): void {
  const win = getIslandWindow()
  if (!win || win.isDestroyed() || !win.isVisible()) return
  win.webContents.send(IPC.volumeUpdate, state)
}

/** Watches the default output volume for the whole app lifetime. */
export function startVolumeWatcher(): void {
  if (timer) return

  const openEndpoint = getEndpointOpener()
  if (!openEndpoint) return

  const tick = (): void => {
    ticks += 1

    // Volume changes that happen while the island is hidden are not worth an
    // animation, so `last` keeps tracking them without sending anything.
    if (reader && ticks % REFRESH_EVERY_TICKS === 0) {
      reader.close()
      reader = null
    }
    if (!reader) {
      reader = openEndpoint()
      if (!reader) return
    }

    const next = reader.read()
    if (!next) {
      reader.close()
      reader = null
      return
    }

    const changed =
      !last ||
      Math.abs(next.level - last.level) > LEVEL_EPSILON ||
      next.muted !== last.muted
    last = next
    if (changed) emit(next)
  }

  tick()
  timer = setInterval(tick, POLL_INTERVAL_MS)
}

export function stopVolumeWatcher(): void {
  if (timer) clearInterval(timer)
  timer = null
  if (reader) reader.close()
  reader = null
  last = null
  ticks = 0
}

export function getVolumeState(): VolumeState | null {
  return last
}

/**
 * Streams the default output's peak level to the island while the face is on
 * screen. This is Core Audio's own meter, so the beat visualiser costs one COM
 * call per frame instead of a desktop-capture audio graph in the renderer.
 */
export function startBeatWatcher(): void {
  if (beatTimer) return

  const openEndpoint = getEndpointOpener()
  if (!openEndpoint) return

  const tick = (): void => {
    beatTicks += 1

    if (beatReader && beatTicks % BEAT_REFRESH_EVERY === 0) {
      beatReader.close()
      beatReader = null
    }
    if (!beatReader) {
      beatReader = openEndpoint()
      if (!beatReader) return
    }

    const peak = beatReader.peak()
    // A null peak means the meter is unavailable on this endpoint; the
    // periodic reopen above retries, and the face simply keeps its idle sway.
    if (peak === null) return

    const win = getIslandWindow()
    if (!win || win.isDestroyed() || !win.isVisible()) return
    win.webContents.send(IPC.beatUpdate, peak)
  }

  tick()
  beatTimer = setInterval(tick, BEAT_POLL_MS)
}

export function stopBeatWatcher(): void {
  if (beatTimer) clearInterval(beatTimer)
  beatTimer = null
  if (beatReader) beatReader.close()
  beatReader = null
  beatTicks = 0
}