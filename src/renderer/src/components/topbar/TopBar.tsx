import { useState, useCallback } from 'react'
import clsx from 'clsx'
import {
  FilePlus,
  FolderOpen,
  Save,
  Undo2,
  Redo2,
  Clapperboard,
  Settings as SettingsIcon
} from 'lucide-react'
import { useProjectStore } from '@renderer/store/projectStore'
import { ExportDialog } from './ExportDialog'

interface TopBarProps {
  onOpenSettings: () => void
}

interface ToolButtonProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  accent?: boolean
}

function ToolButton({ icon, label, onClick, disabled, accent }: ToolButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'no-drag flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-ocean-accent',
        disabled
          ? 'cursor-not-allowed text-ocean-muted/40'
          : accent
            ? 'bg-ocean-accent/15 text-ocean-accent hover:bg-ocean-accent/25'
            : 'text-ocean-muted hover:bg-ocean-panel-2 hover:text-ocean-text'
      )}
    >
      {icon}
    </button>
  )
}

export function TopBar({ onOpenSettings }: TopBarProps): React.JSX.Element {
  const [exportOpen, setExportOpen] = useState(false)

  const projectName = useProjectStore((s) => s.project.name)
  const dirty = useProjectStore((s) => s.dirty)
  // Subscribe to history length so undo/redo enabled state re-renders.
  const canUndo = useProjectStore((s) => s.past.length > 0)
  const canRedo = useProjectStore((s) => s.future.length > 0)

  const handleNew = useCallback(() => {
    useProjectStore.getState().newProject()
  }, [])

  const handleOpen = useCallback(async () => {
    try {
      const r = await window.api.dialog.openProject()
      if (r) useProjectStore.getState().setProject(r.project, r.path)
    } catch (err) {
      console.error('Failed to open project', err)
    }
  }, [])

  const handleSave = useCallback(async () => {
    try {
      const s = useProjectStore.getState()
      let path = s.project.filePath
      if (!path) {
        const chosen = await window.api.dialog.saveProject(s.project.name)
        if (!chosen) return
        path = chosen
      }
      const res = await window.api.project.save(s.project, path)
      s.markSaved(res.path ?? path)
    } catch (err) {
      console.error('Failed to save project', err)
    }
  }, [])

  const handleUndo = useCallback(() => {
    useProjectStore.getState().undo()
  }, [])

  const handleRedo = useCallback(() => {
    useProjectStore.getState().redo()
  }, [])

  return (
    <div className="flex h-11 w-full items-center gap-2 border-b border-ocean-border bg-ocean-panel px-3 select-none">
      {/* Left: app + project name. Empty space here is draggable (titlebar). */}
      <div className="flex min-w-0 items-center gap-2 pl-16">
        <span className="text-sm font-semibold tracking-tight text-ocean-text">OceanMixer</span>
        <span className="text-ocean-border">/</span>
        <span className="truncate text-sm text-ocean-muted" title={projectName}>
          {projectName || 'Untitled'}
        </span>
        {dirty && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-ocean-accent-2"
            title="Unsaved changes"
            aria-label="Unsaved changes"
          />
        )}
      </div>

      {/* Flexible draggable spacer */}
      <div className="h-full flex-1" />

      {/* Right: controls */}
      <div className="no-drag flex items-center gap-1">
        <ToolButton icon={<FilePlus size={16} />} label="New project" onClick={handleNew} />
        <ToolButton icon={<FolderOpen size={16} />} label="Open project…" onClick={handleOpen} />
        <ToolButton icon={<Save size={16} />} label="Save project" onClick={handleSave} />

        <div className="mx-1 h-5 w-px bg-ocean-border" />

        <ToolButton
          icon={<Undo2 size={16} />}
          label="Undo"
          onClick={handleUndo}
          disabled={!canUndo}
        />
        <ToolButton
          icon={<Redo2 size={16} />}
          label="Redo"
          onClick={handleRedo}
          disabled={!canRedo}
        />

        <div className="mx-1 h-5 w-px bg-ocean-border" />

        <button
          type="button"
          title="Export video"
          aria-label="Export video"
          onClick={() => setExportOpen(true)}
          className="no-drag flex h-8 items-center gap-1.5 rounded-md bg-ocean-accent px-3 text-sm font-medium text-ocean-bg transition-colors hover:bg-ocean-accent-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-ocean-accent"
        >
          <Clapperboard size={16} />
          <span>Export</span>
        </button>

        <ToolButton
          icon={<SettingsIcon size={16} />}
          label="Settings"
          onClick={onOpenSettings}
        />
      </div>

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  )
}
