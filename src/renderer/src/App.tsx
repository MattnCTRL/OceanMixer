import type { ReactNode } from 'react'

/**
 * Editor shell layout. This boots immediately and is progressively replaced by
 * real feature panels (MediaLibrary, Preview, Timeline, Inspector, Director).
 */
export default function App() {
  return (
    <div className="flex h-full w-full flex-col bg-ocean-bg text-ocean-text">
      <header className="titlebar-drag flex h-11 shrink-0 items-center gap-3 border-b border-ocean-border bg-ocean-panel px-4 pl-20">
        <span className="text-sm font-semibold tracking-wide">OceanMixer</span>
        <span className="rounded bg-ocean-panel-2 px-2 py-0.5 text-[11px] text-ocean-muted">
          Untitled project
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-ocean-border bg-ocean-panel">
          <PanelTitle>Library</PanelTitle>
          <div className="flex-1 p-4 text-sm text-ocean-muted">Import media to begin.</div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <section className="flex min-h-0 flex-1 items-center justify-center bg-black/40 p-6">
            <div className="aspect-video w-full max-w-3xl rounded-lg border border-ocean-border bg-black shadow-2xl" />
          </section>
          <section className="h-72 shrink-0 border-t border-ocean-border bg-ocean-panel">
            <PanelTitle>Timeline</PanelTitle>
            <div className="p-4 text-sm text-ocean-muted">Your tracks will appear here.</div>
          </section>
        </main>

        <aside className="flex w-80 shrink-0 flex-col border-l border-ocean-border bg-ocean-panel">
          <PanelTitle>Creative Director</PanelTitle>
          <div className="flex-1 p-4 text-sm text-ocean-muted">
            Ask the AI to build or refine your edit.
          </div>
        </aside>
      </div>
    </div>
  )
}

function PanelTitle({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-9 items-center border-b border-ocean-border px-4 text-[11px] font-semibold uppercase tracking-widest text-ocean-muted">
      {children}
    </div>
  )
}
