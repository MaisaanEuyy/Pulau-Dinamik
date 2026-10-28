/** Geometry of the island window, in device independent pixels. */
export const ISLAND_LAYOUT = {
  // Wide enough for the avatar, the per-section mini view and the clock.
  collapsed: { width: 300, height: 46 },
  expanded: { width: 420, height: 260 },
  /** Padding between the window edge and the visible pill. */
  inset: 1,
  cornerRadius: 22
} as const