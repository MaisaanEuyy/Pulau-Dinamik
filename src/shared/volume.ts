/** Master volume of the default render device, mirrored from Core Audio. */
export interface VolumeState {
  /** Scalar volume between 0 and 1. */
  level: number
  muted: boolean
}