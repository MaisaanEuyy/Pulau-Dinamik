/** Shape of the system monitoring payload shared with the renderer. */
export interface CpuStats {
  /** Total load across all cores, 0–100. */
  load: number
  brand: string
  threads: number
  /** Package temperature, or `null` when the sensor is unavailable. */
  tempC: number | null
}

export interface MemoryStats {
  usedBytes: number
  totalBytes: number
}

export interface GpuStats {
  name: string
  /** GPU utilisation, 0–100. `null` for integrated GPUs without sensors. */
  utilization: number | null
  memoryUsedBytes: number | null
  memoryTotalBytes: number | null
  tempC: number | null
  powerW: number | null
}

export interface DiskStats {
  mount: string
  usedBytes: number
  totalBytes: number
}

export interface NetworkStats {
  rxPerSec: number
  txPerSec: number
}

export interface BatteryStats {
  percent: number
  charging: boolean
  timeRemainingMin: number | null
}

export interface SystemHistory {
  cpu: number[]
  memory: number[]
  gpu: number[]
}

export interface SystemSnapshot {
  timestamp: number
  uptimeSec: number
  cpu: CpuStats
  memory: MemoryStats
  gpu: GpuStats | null
  disk: DiskStats | null
  network: NetworkStats | null
  battery: BatteryStats | null
  history: SystemHistory
}