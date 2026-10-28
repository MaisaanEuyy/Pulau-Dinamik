/// <reference types="vite/client" />

import type { IslandApi } from '@shared/api'

declare global {
  interface Window {
    island: IslandApi
  }
}

export {}