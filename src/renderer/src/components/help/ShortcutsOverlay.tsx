/**
 * Keyboard shortcuts cheat sheet.
 *
 * A clean two-column overlay grouped by section, using <kbd> chips for keys.
 * Takes no props: reads `shortcutsOpen` / `closeShortcuts` from the UI store and
 * renders nothing while closed. The integrator mounts it unconditionally.
 */

import { useEffect } from 'react'
import { Keyboard, X } from 'lucide-react'

import { useUIStore } from '@renderer/store/uiStore'

interface Shortcut {
  keys: string[]
  /** join chips with "/" to indicate alternatives, otherwise treat as a combo */
  alt?: boolean
  desc: string
}

interface Section {
  title: string
  items: Shortcut[]
}

const SECTIONS: Section[] = [
  {
    title: 'Transport',
    items: [{ keys: ['Space'], desc: 'Play / Pause' }]
  },
  {
    title: 'Edit',
    items: [
      { keys: ['⌘', 'Z'], desc: 'Undo' },
      { keys: ['⌘⇧Z', '⌘Y'], alt: true, desc: 'Redo' },
      { keys: ['S'], desc: 'Split clip at playhead' },
      { keys: ['Delete', 'Backspace'], alt: true, desc: 'Remove selected clip' }
    ]
  },
  {
    title: 'Timeline',
    items: [
      { keys: ['⌘', 'Wheel'], desc: 'Zoom' },
      { keys: ['+', '-'], alt: true, desc: 'Zoom in / out' },
      { keys: ['Click ruler'], desc: 'Move playhead' }
    ]
  },
  {
    title: 'Help',
    items: [{ keys: ['?'], desc: 'This shortcuts panel' }]
  }
]

function Keys({ keys, alt }: { keys: string[]; alt?: boolean }): JSX.Element {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((k, i) => (
        <span key={k} className="flex items-center gap-1">
          {i > 0 && (
            <span className="text-[10px] text-ocean-muted">{alt ? 'or' : ''}</span>
          )}
          <kbd className="rounded border border-ocean-line bg-ocean-bg px-1 text-ocean-muted">
            {k}
          </kbd>
        </span>
      ))}
    </span>
  )
}

function SectionBlock({ section }: { section: Section }): JSX.Element {
  return (
    <div className="rounded-lg border border-ocean-border bg-ocean-panel-2 p-3.5">
      <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ocean-accent">
        {section.title}
      </h3>
      <ul className="space-y-2">
        {section.items.map((s) => (
          <li key={s.desc} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-ocean-text">{s.desc}</span>
            <Keys keys={s.keys} alt={s.alt} />
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ShortcutsOverlay(): JSX.Element | null {
  const shortcutsOpen = useUIStore((s) => s.shortcutsOpen)
  const closeShortcuts = useUIStore((s) => s.closeShortcuts)

  useEffect(() => {
    if (!shortcutsOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeShortcuts()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shortcutsOpen, closeShortcuts])

  if (!shortcutsOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeShortcuts()
      }}
    >
      <div className="w-full max-w-2xl rounded-xl border border-ocean-border bg-ocean-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-ocean-line px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Keyboard size={18} className="text-ocean-accent" />
            <h2 className="text-sm font-semibold text-ocean-text">Keyboard shortcuts</h2>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={closeShortcuts}
            className="rounded-md p-1.5 text-ocean-muted transition-colors hover:bg-ocean-panel-2 hover:text-ocean-text"
          >
            <X size={18} />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
          {SECTIONS.map((section) => (
            <SectionBlock key={section.title} section={section} />
          ))}
        </div>
      </div>
    </div>
  )
}
