import { useEffect } from 'react'
import { TopBar } from './components/topbar/TopBar'
import { MediaLibrary } from './components/library/MediaLibrary'
import { Preview } from './components/preview/Preview'
import { Timeline } from './components/timeline/Timeline'
import { Inspector } from './components/inspector/Inspector'
import { Director } from './components/director/Director'
import { SettingsModal } from './components/settings/SettingsModal'
import { AudioRecorder } from './components/library/AudioRecorder'
import { AudioSetupHelper } from './components/library/AudioSetupHelper'
import { ShortcutsOverlay } from './components/help/ShortcutsOverlay'
import { WelcomeCard } from './components/help/WelcomeCard'
import { useProjectStore } from './store/projectStore'
import { useUIStore } from './store/uiStore'

export default function App() {
  // Global keyboard shortcuts (undo/redo, transport, help). Timeline owns
  // clip-level shortcuts (delete/split) while it has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      const meta = e.metaKey || e.ctrlKey
      const project = useProjectStore.getState()

      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) project.redo()
        else project.undo()
        return
      }
      if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        project.redo()
        return
      }
      if (!typing && e.key === '?') {
        e.preventDefault()
        useUIStore.getState().openShortcuts()
        return
      }
      if (e.key === ' ' && !typing) {
        e.preventDefault()
        project.togglePlay()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full w-full flex-col bg-ocean-bg text-ocean-text">
      <header className="titlebar-drag flex h-11 shrink-0 items-center border-b border-ocean-border bg-ocean-panel pl-20">
        <TopBar />
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-ocean-border bg-ocean-panel">
          <MediaLibrary />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <section className="flex min-h-0 flex-1 items-center justify-center bg-black/40">
            <Preview />
          </section>
          <section className="h-80 shrink-0 border-t border-ocean-border bg-ocean-panel">
            <Timeline />
          </section>
        </main>

        <aside className="flex w-96 shrink-0 flex-col border-l border-ocean-border bg-ocean-panel">
          <div className="max-h-[45%] shrink-0 overflow-y-auto border-b border-ocean-border">
            <Inspector />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <Director />
          </div>
        </aside>
      </div>

      {/* Overlays — each reads its own open state from the UI store */}
      <SettingsModal />
      <AudioRecorder />
      <AudioSetupHelper />
      <ShortcutsOverlay />
      <WelcomeCard />
    </div>
  )
}
