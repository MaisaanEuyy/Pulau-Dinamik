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
  port,
  focus = null
}: {
  alerts: NotificationsStore
  port: number | null
  /** When a fresh notification just opened the card, only that one is shown —
   * the rest of the history stays folded away instead of flooding the peek. */
  focus?: IslandNotification | null
}) {
  // Windows shows its consent prompt the first time; until it is accepted the
  // bridge stays silent, which is worth explaining instead of an empty list.
  const blocked = alerts.windowsAccess === 'denied'
  const items = focus ? [focus] : alerts.items

  if (items.length === 0) {
    return (
      <div className="alerts-empty">
        <span className="alerts-empty-icon">
          <Bell size={17} strokeWidth={1.7} />
        </span>
        <span className="alerts-empty-title">
          {blocked ? 'Windows notifications blocked' : 'No notifications yet'}
        </span>
        {blocked ? (
          <span className="alerts-empty-hint alerts-empty-warn">
            Turn the island back on in Settings → Privacy &amp; security → Notifications, then
            reopen it. Toasts from Windows apps show up here once access is allowed.
          </span>
        ) : (
          <span className="alerts-empty-hint">
            Toasts from Windows apps show up here on their own. You can also POST JSON to
            <code>http://127.0.0.1:{port ?? 43110}/notify</code> or run
            <code> npm run notify -- -t "Build done"</code>.
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="alerts-panel" data-focus={focus ? 'true' : 'false'}>
      <div className="alerts-head">
        <span className="alerts-count">
          {focus ? (
            'Just arrived'
          ) : (
            <>
              {alerts.items.length} recent
              {alerts.unseen > 0 ? <span className="alerts-new"> · {alerts.unseen} new</span> : null}
            </>
          )}
        </span>
        {focus ? null : (
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
        )}
      </div>
      {blocked ? (
        <span className="alerts-warn">Windows notifications blocked in Settings</span>
      ) : null}
      <div className="alerts-list">
        {items.map((item) => (
          <AlertRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}