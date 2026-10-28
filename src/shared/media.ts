/** Now-playing state mirrored from the Windows SMTC session. */
export interface MediaState {
  /** A player is exposing a media session. */
  active: boolean
  playing: boolean
  title: string | null
  artist: string | null
  album: string | null
  /** Source app user model id without the `.exe` suffix, e.g. `Spotify`. */
  app: string | null
  canPlayPause: boolean
  canNext: boolean
  canPrevious: boolean
  /** Cover art as a data URL so the renderer needs no file access. */
  artwork: string | null
}

export type MediaCommand = 'toggle' | 'next' | 'previous'