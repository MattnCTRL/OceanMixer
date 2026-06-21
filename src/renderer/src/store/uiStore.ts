/**
 * UI-only store for modals/overlays and first-run state, so any component can
 * open a helper (settings, audio setup, shortcuts, welcome, recorder) without
 * prop-drilling. App mounts the overlays and reads these flags.
 */

import { create } from 'zustand'

const WELCOME_SEEN_KEY = 'oceanmixer.welcomeSeen.v1'

export interface UIState {
  settingsOpen: boolean
  shortcutsOpen: boolean
  audioSetupOpen: boolean
  recorderOpen: boolean
  welcomeOpen: boolean

  openSettings: () => void
  closeSettings: () => void
  openShortcuts: () => void
  closeShortcuts: () => void
  openAudioSetup: () => void
  closeAudioSetup: () => void
  openRecorder: () => void
  closeRecorder: () => void
  openWelcome: () => void
  /** dismiss the welcome card and remember it for next launch */
  dismissWelcome: () => void
}

function welcomeSeen(): boolean {
  try {
    return localStorage.getItem(WELCOME_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export const useUIStore = create<UIState>((set) => ({
  settingsOpen: false,
  shortcutsOpen: false,
  audioSetupOpen: false,
  recorderOpen: false,
  // Show the welcome card on the very first launch.
  welcomeOpen: !welcomeSeen(),

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openShortcuts: () => set({ shortcutsOpen: true }),
  closeShortcuts: () => set({ shortcutsOpen: false }),
  openAudioSetup: () => set({ audioSetupOpen: true }),
  closeAudioSetup: () => set({ audioSetupOpen: false }),
  openRecorder: () => set({ recorderOpen: true }),
  closeRecorder: () => set({ recorderOpen: false }),
  openWelcome: () => set({ welcomeOpen: true }),
  dismissWelcome: () => {
    try {
      localStorage.setItem(WELCOME_SEEN_KEY, '1')
    } catch {
      /* ignore */
    }
    set({ welcomeOpen: false })
  }
}))
