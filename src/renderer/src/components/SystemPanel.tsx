import { ArrowDown, ArrowUp, Zap } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { SystemSnapshot } from '@shared/system'
import { useSystemStats } from '../hooks/useSystemStats'

const clampPercent = (value: number): number => Math.min(Math.max(value, 0), 100)

function formatRate(bytesPerSec: number | null | undefined): string {
  if (!bytesPerSec || bytesPerSec < 1) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let value = bytesPerSec
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

function formatGb(bytes: number | null | undefined, digits = 1): string {
  if (bytes === null || bytes === undefined) return '—'
  return `${(bytes / 1024 ** 3).toFixed(digits)} GB`
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return String(Math.round(clampPercent(value)))
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <span className="stat-spark stat-spark--empty" />

  // Stretch the available history across the card until the ring buffer is
  // full; afterwards the usual right-aligned scroll takes over.
  const span = Math.max(values.length - 1, 1)
  const points = values.map((value, index) => {
    const x = (index / span) * 100
    const y = 27 - (clampPercent(value) / 100) * 25
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })

  return (
    <svg
      className="stat-spark"
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

interface StatCardProps {
  label: string
  value: string
  unit?: string
  note?: string
  color: string
  history?: number[]
}

function StatCard({ label, value, unit, note, color, history }: StatCardProps) {
  return (
    <div className="stat-card" style={{ '--accent': color } as CSSProperties}>
      <div className="stat-head">
        <span className="stat-label">{label}</span>
        {note ? <span className="stat-note">{note}</span> : null}
      </div>
      <div className="stat-value">
        {value}
        {unit ? <span className="stat-unit">{unit}</span> : null}
      </div>
      {history ? (
        <Sparkline values={history} color={color} />
      ) : (
        <span className="stat-spark" />
      )}
    </div>
  )
}

function batteryNote(snapshot: SystemSnapshot | null): string {
  const battery = snapshot?.battery
  if (!battery) return ''
  if (battery.charging) return 'charging'
  if (battery.timeRemainingMin !== null) return `${battery.timeRemainingMin} min left`
  return ''
}

export function SystemPanel({ active }: { active: boolean }) {
  const snapshot = useSystemStats(active)

  const cpu = snapshot?.cpu
  const memory = snapshot?.memory
  const gpu = snapshot?.gpu
  const disk = snapshot?.disk
  const network = snapshot?.network
  const battery = snapshot?.battery

  const memoryPercent =
    memory && memory.totalBytes > 0 ? (memory.usedBytes / memory.totalBytes) * 100 : null
  const diskPercent = disk && disk.totalBytes > 0 ? (disk.usedBytes / disk.totalBytes) * 100 : null

  const gpuHasUtilisation = gpu?.utilization !== null && gpu?.utilization !== undefined
  const gpuNote = gpu
    ? gpu.tempC !== null
      ? `${Math.round(gpu.tempC)}°C`
      : gpuHasUtilisation
        ? undefined
        : 'no sensor'
    : undefined

  return (
    <div className="system-panel" data-loading={!snapshot}>
      <div className="system-cards">
        <StatCard
          label="CPU"
          value={formatPercent(cpu?.load)}
          unit={cpu ? '%' : undefined}
          note={cpu ? (cpu.tempC !== null ? `${Math.round(cpu.tempC)}°C` : `${cpu.threads} threads`) : undefined}
          color="#7dd3fc"
          history={snapshot?.history.cpu}
        />
        <StatCard
          label="GPU"
          value={gpuHasUtilisation ? formatPercent(gpu?.utilization) : '—'}
          unit={gpuHasUtilisation ? '%' : undefined}
          note={gpuNote}
          color="#c4b5fd"
          history={gpuHasUtilisation ? snapshot?.history.gpu : undefined}
        />
        <StatCard
          label="RAM"
          value={formatPercent(memoryPercent)}
          unit={memory ? '%' : undefined}
          note={memory ? formatGb(memory.usedBytes, 1) : undefined}
          color="#6ee7b7"
          history={snapshot?.history.memory}
        />
      </div>

      <div className="system-footer" data-count={battery ? 3 : 2}>
        <div className="footer-chip">
          <span className="chip-label">NETWORK</span>
          <span className="chip-value">
            <span className="net-item">
              <ArrowDown size={9} strokeWidth={2.6} />
              {formatRate(network?.rxPerSec)}
            </span>
            <span className="net-item">
              <ArrowUp size={9} strokeWidth={2.6} />
              {formatRate(network?.txPerSec)}
            </span>
          </span>
        </div>

        <div className="footer-chip">
          <span className="chip-label">DISK {disk?.mount ?? ''}</span>
          <span className="chip-value">
            {formatPercent(diskPercent)}
            {disk ? '%' : ''}
            {disk ? <span className="chip-sub">{formatGb(disk.usedBytes, 0)}</span> : null}
          </span>
          <span className="chip-bar" style={{ width: `${diskPercent ?? 0}%` }} />
        </div>

        {battery ? (
          <div className="footer-chip" data-charging={battery.charging}>
            <span className="chip-label">BATTERY</span>
            <span className="chip-value">
              {battery.charging ? <Zap size={9} strokeWidth={2.6} className="chip-icon" /> : null}
              {Math.round(battery.percent)}%
              <span className="chip-sub">{batteryNote(snapshot)}</span>
            </span>
            <span className="chip-bar" style={{ width: `${battery.percent}%` }} />
          </div>
        ) : null}
      </div>
    </div>
  )
}