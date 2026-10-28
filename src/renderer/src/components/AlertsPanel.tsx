import { Bell, Trash2 } from 'lucide-react'
import type { IslandNotification } from '@shared/notifications'
import type { NotificationsStore } from '../hooks/useNotifications'

const LEVEL_LABEL = {
  info: 'Info',
  success: 'Done',
  warning: 'Warning',
  error: 'Error'
} as const

function relativeTime(at: number): string {
  const diff = Math.max(0, Date.now() - at)
  if (diff < 45_000) return 'now'
  const minutes = Math.round(diff / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return new Date(at).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}

function AlertRow({ item }: { item: IslandNotification }) {
  return (
    <div className="alert-row" data-level={item.level}>
      <span className="alert-dot" aria-hidden="true" />
      <span className="alert-body">
        <span className="alert-title">{item.title}</span>
        {item.message ? <span className="alert-message">{item.message}</span> : null}
      </span>
      <span className="alert-meta">
        <span className="alert-time">{relativeTime(item.createdAt)}</span>
        <span className="alert-app">{item.app ?? LEVEL_LABEL[item.level]}</span>
      </span>
    </div>
  )
}

export function AlertsPanel({
  alerts,
  port
}: {
  alerts: NotificationsStore
  port: number | null
}) {
  if (alerts.items.length === 0) {
    return (
      <div className="alerts-empty">
        <span className="alerts-empty-icon">
          <Bell size={17} strokeWidth={1.7} />
        </span>
        <span className="alerts-empty-title">No notifications yet</span>
        <span className="alerts-empty-hint">
          POST JSON to <code>http://127.0.0.1:{port ?? 43110}/notify</code> or run
          <code> npm run notify -- -t "Build done"</code>.
        </span>
      </div>
    )
  }

  return (
    <div className="alerts-panel">
      <div className="alerts-head">
        <span className="alerts-count">
          {alerts.items.length} recent
          {alerts.unseen > 0 ? <span className="alerts-new"> · {alerts.unseen} new</span> : null}
        </span>
        <button
          type="button"
          className="alerts-clear"
          onClick={(event) => {
            event.stopPropagation()
            void alerts.clear()
          }}
        >
          <Trash2 size={10} strokeWidth={2.2} />
          Clear
        </button>
      </div>
      <div className="alerts-list">
        {alerts.items.map((item) => (
          <AlertRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}