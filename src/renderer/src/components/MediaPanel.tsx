import { Music2, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMedia } from '../hooks/useMedia'

function ControlButton({
  label,
  disabled,
  primary,
  onClick,
  children
}: {
  label: string
  disabled: boolean
  primary?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={primary ? 'media-btn media-btn--primary' : 'media-btn'}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function MediaPanel({ active }: { active: boolean }) {
  const { state, send } = useMedia(active)

  if (!state || !state.active) {
    return (
      <div className="media-panel" data-empty="true">
        <span className="media-empty-icon">
          <Music2 size={18} strokeWidth={1.6} />
        </span>
        <div className="media-empty-text">
          <span className="media-empty-title">
            {state ? 'Nothing playing' : 'Looking for media…'}
          </span>
          <span className="media-empty-hint">
            Start a song or video in Spotify, YouTube or any player that supports SMTC.
          </span>
        </div>
      </div>
    )
  }

  const title = state.title?.trim() || 'Unknown track'
  const artist = state.artist?.trim() || state.album?.trim() || '—'

  return (
    <div className="media-panel">
      <div className="media-art" data-artwork={Boolean(state.artwork)}>
        {state.artwork ? (
          <img src={state.artwork} alt="" draggable={false} />
        ) : (
          <Music2 size={20} strokeWidth={1.5} />
        )}
      </div>

      <div className="media-meta">
        <span className="media-app">{state.app ?? 'media'}</span>
        <span className="media-title">{title}</span>
        <span className="media-artist">{artist}</span>
      </div>

      <div className="media-controls">
        <ControlButton
          label="Previous track"
          disabled={!state.canPrevious}
          onClick={() => send('previous')}
        >
          <SkipBack size={14} strokeWidth={2.2} fill="currentColor" />
        </ControlButton>
        <ControlButton
          label={state.playing ? 'Pause' : 'Play'}
          disabled={!state.canPlayPause}
          primary
          onClick={() => send('toggle')}
        >
          {state.playing ? (
            <Pause size={15} strokeWidth={0} fill="currentColor" />
          ) : (
            <Play size={15} strokeWidth={0} fill="currentColor" />
          )}
        </ControlButton>
        <ControlButton
          label="Next track"
          disabled={!state.canNext}
          onClick={() => send('next')}
        >
          <SkipForward size={14} strokeWidth={2.2} fill="currentColor" />
        </ControlButton>
      </div>
    </div>
  )
}