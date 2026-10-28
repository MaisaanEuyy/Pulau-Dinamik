import { Bell, Music2, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import type { NotificationLevel } from '@shared/notifications'
import type { MediaState } from '@shared/media'
import type { TabData, TabDefinition } from './tabs'

function MiniAction({
  label,
  disabled,
  primary,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  primary?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={primary ? 'mini-btn mini-btn--primary' : 'mini-btn'}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        // Quick controls must never open or pin the island.
        event.stopPropagation()
        onClick()
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {children}
    </button>
  )
}

function MediaMini({
  state,
  send
}: {
  state: MediaState | null
  send: TabData['media']['send']
}) {
  if (!state || !state.active) {
    return (
      <div className="mini mini--media" data-empty="true">
        <span className="mini-art" data-empty="true">
          <Music2 size={13} strokeWidth={1.8} />
        </span>
        <span className="mini-text">
          <span className="mini-title">{state ? 'Nothing playing' : 'Looking for media…'}</span>
          <span className="mini-sub">start a song or video</span>
        </span>
      </div>
    )
  }

  const title = state.title?.trim() || 'Unknown track'
  const artist = state.artist?.trim() || state.album?.trim() || state.app || '—'

  return (
    <div className="mini mini--media">
      <span className="mini-art" data-artwork={Boolean(state.artwork)}>
        {state.artwork ? (
          <img src={state.artwork} alt="" draggable={false} />
        ) : (
          <Music2 size={13} strokeWidth={1.8} />
        )}
      </span>

      <span className="mini-text">
        <span className="mini-title">{title}</span>
        <span className="mini-sub">
          {state.playing ? '' : 'Paused · '}
          {artist}
        </span>
      </span>

      <span className="mini-controls">
        <MiniAction
          label="Previous track"
          disabled={!state.canPrevious}
          onClick={() => send('previous')}
        >
          <SkipBack size={11} strokeWidth={2.4} fill="currentColor" />
        </MiniAction>
        <MiniAction
          label={state.playing ? 'Pause' : 'Play'}
          disabled={!state.canPlayPause}
          primary
          onClick={() => send('toggle')}
        >
          {state.playing ? (
            <Pause size={11} strokeWidth={0} fill="currentColor" />
          ) : (
            <Play size={11} strokeWidth={0} fill="currentColor" />
          )}
        </MiniAction>
        <MiniAction
          label="Next track"
          disabled={!state.canNext}
          onClick={() => send('next')}
        >
          <SkipForward size={11} strokeWidth={2.4} fill="currentColor" />
        </MiniAction>
      </span>
    </div>
  )
}

function MiniStat({
  label,
  value,
  color
}: {
  label: string
  value: string
  color: string
}) {
  return (
    <span className="mini-stat">
      <span className="mini-dot" style={{ '--dot': color } as CSSProperties} />
      <span className="mini-stat-label">{label}</span>
      <span className="mini-stat-value">{value}</span>
    </span>
  )
}

function SystemMini({ data }: { data: TabData['system'] }) {
  const cpu = data?.cpu.load
  const memory =
    data && data.memory.totalBytes > 0
      ? (data.memory.usedBytes / data.memory.totalBytes) * 100
      : null
  const gpu = data?.gpu?.utilization ?? null
  const percent = (value: number | null | undefined): string =>
    value === null || value === undefined || Number.isNaN(value) ? '—' : `${Math.round(value)}%`

  return (
    <div className="mini mini--system">
      <MiniStat label="CPU" value={percent(cpu)} color="#7dd3fc" />
      <MiniStat label="RAM" value={percent(memory)} color="#6ee7b7" />
      <MiniStat label="GPU" value={percent(gpu)} color="#c4b5fd" />
    </div>
  )
}

function KeysMini({ data }: { data: TabData['keyboard'] }) {
  const locks = [
    { key: 'caps', label: 'Caps' },
    { key: 'num', label: 'Num' },
    { key: 'scroll', label: 'Scrl' }
  ] as const
  const bars = data.bars.slice(-8)

  return (
    <div className="mini mini--keys">
      {locks.map((entry) => (
        <span key={entry.key} className="mini-lock" data-on={data.state?.[entry.key] ?? false}>
          {entry.label}
        </span>
      ))}
      <span className="mini-meter" aria-hidden="true">
        {bars.map((value, index) => (
          <span
            // The strip is positional, not keyed by content.
            key={index}
            className="mini-bar"
            style={{ height: `${18 + value * 82}%`, opacity: 0.25 + value * 0.75 }}
          />
        ))}
      </span>
      <span className="mini-rate">{data.rate > 0 ? `${data.rate}/m` : 'idle'}</span>
    </div>
  )
}

const LEVEL_LABEL: Record<NotificationLevel, string> = {
  info: 'Info',
  success: 'Done',
  warning: 'Warning',
  error: 'Error'
}

function AlertsMini({ data, port }: { data: TabData['alerts']; port: number | null }) {
  const latest = data.items[0]

  if (!latest) {
    return (
      <div className="mini mini--alerts" data-empty="true">
        <span className="mini-art" data-empty="true">
          <Bell size={12} strokeWidth={1.9} />
        </span>
        <span className="mini-text">
          <span className="mini-title">No alerts yet</span>
          <span className="mini-sub">{port ? `api on :${port}` : 'local api offline'}</span>
        </span>
      </div>
    )
  }

  return (
    <div className="mini mini--alerts" data-level={latest.level}>
      <span className="mini-art" data-empty="true">
        <Bell size={12} strokeWidth={1.9} />
      </span>
      <span className="mini-text">
        <span className="mini-title">{latest.title}</span>
        <span className="mini-sub">
          {LEVEL_LABEL[latest.level]}
          {latest.app ? ` · ${latest.app}` : ''}
          {data.items.length > 1 ? ` · +${data.items.length - 1}` : ''}
        </span>
      </span>
    </div>
  )
}

/** Compact per-section view that fills the collapsed pill. */
export function MiniBar({
  tab,
  data,
  notifyPort
}: {
  tab: TabDefinition
  data: TabData
  notifyPort: number | null
}) {
  if (tab.id === 'media') return <MediaMini state={data.media.state} send={data.media.send} />
  if (tab.id === 'system') return <SystemMini data={data.system} />
  if (tab.id === 'keys') return <KeysMini data={data.keyboard} />
  return <AlertsMini data={data.alerts} port={notifyPort} />
}