import type { OceanMixerApi } from '../shared/ipc'

declare global {
  interface Window {
    api: OceanMixerApi
  }
}

export {}
