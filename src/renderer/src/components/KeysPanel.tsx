import { useKeyboard } from '../hooks/useKeyboard'

const LOCKS = [
  { key: 'caps', label: 'Caps' },
  { key: 'num', label: 'Num' },
  { key: 'scroll', label: 'Scrl' }
] as const

const MODIFIERS = [
  { key: 'shift', label: 'Shift' },
  { key: 'ctrl', label: 'Ctrl' },
  { key: 'alt', label: 'Alt' },
  { key: 'win', label: 'Win' }
] as const

export function KeysPanel({ active }: { active: boolean }) {
  const { state, bars, rate } = useKeyboard(active)

  return (
    <div className="keys-panel">
      <div className="keys-row">
        <span className="keys-caption">Locks</span>
        <div className="keys-group" data-tone="lock">
          {LOCKS.map((entry) => (
            <span key={entry.key} className="key-chip" data-on={state?.[entry.key] ?? false}>
              {entry.label}
            </span>
          ))}
        </div>
      </div>

      <div className="keys-row">
        <span className="keys-caption">Held</span>
        <div className="keys-group" data-tone="held">
          {MODIFIERS.map((entry) => (
            <span key={entry.key} className="key-chip" data-on={state?.[entry.key] ?? false}>
              {entry.label}
            </span>
          ))}
        </div>
      </div>

      <div className="keys-row">
        <span className="keys-caption">Live</span>
        <div className="keys-activity">
          <div className="keys-meter" aria-hidden="true">
            {bars.map((value, index) => (
              <span
                // The strip is positional, not keyed by content.
                key={index}
                className="keys-bar"
                style={{ height: `${12 + value * 88}%`, opacity: 0.24 + value * 0.76 }}
              />
            ))}
          </div>
          <div className="keys-readout">
            <span className="keys-rate">{rate > 0 ? `${rate} / min` : 'idle'}</span>
            <span className="keys-note">never stored</span>
          </div>
        </div>
      </div>
    </div>
  )
}