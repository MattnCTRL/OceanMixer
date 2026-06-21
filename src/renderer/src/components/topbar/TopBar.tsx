import { useState, useCallback } from 'react'
import clsx from 'clsx'
import {
  FilePlus,
  FolderOpen,
  Save,
  Undo2,
  Redo2,
  Clapperboard,
  HelpCircle,
  Settings as SettingsIcon
} from 'lucide-react'
import { useProjectStore } from '@renderer/store/projectStore'
import { useUIStore } from '@renderer/store/uiStore'
import { Logo } from '@renderer/components/brand/Logo'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { ExportDialog } from './ExportDialog'

interface ToolButtonProps {
  icon: React.ReactNode
  label: string
  description?: string
  keys?: string
  onClick: () => void
  disabled?: boolean
}

function ToolButton({
  icon,
  label,
  description,
  keys,
  onClick,
  disabled
}: ToolButtonProps): React.JSX.Element {
  return (
    <Tooltip label={label} description={description} keys={keys} side="bottom">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className={clsx(
          'no-drag flex h-8 w-8 items-center justify-center rounded-md transition-colors',
          'focus:outline-none focus-visible:ring-1 focus-visible:ring-ocean-accent',
          disabled
            ? 'cursor-not-allowed text-ocean-muted/40'
            : 'text-ocean-muted hover:bg-ocean-panel-2 hover:text-ocean-text'
        )}
      >
        {icon}
      </button>
    </Tooltip>
  )
}

export function TopBar(): React.JSX.Element {
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

  const handleHelp = useCallback(() => {
    useUIStore.getState().openShortcuts()
  }, [])

  const handleSettings = useCallback(() => {
    useUIStore.getState().openSettings()
  }, [])

  return (
    <div className="relative flex h-11 w-full items-center gap-2 border-b border-ocean-border bg-gradient-to-b from-ocean-panel to-ocean-bg px-3 select-none">
      {/* Left: brand + project name. Empty space here is draggable (titlebar). */}
      <div className="flex min-w-0 items-center gap-2 pl-16">
        <Logo size={20} className="no-drag" />
        <span className="mx-0.5 h-4 w-px bg-ocean-border" />
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
        <ToolButton
          icon={<FilePlus size={16} />}
          label="New project"
          description="Start a fresh, empty project"
          onClick={handleNew}
        />
        <ToolButton
          icon={<FolderOpen size={16} />}
          label="Open project"
          description="Open a saved .ocean project file"
          keys="⌘O"
          onClick={handleOpen}
        />
        <ToolButton
          icon={<Save size={16} />}
          label="Save project"
          description="Save changes to disk"
          keys="⌘S"
          onClick={handleSave}
        />

        <div className="mx-1 h-5 w-px bg-ocean-border" />

        <ToolButton
          icon={<Undo2 size={16} />}
          label="Undo"
          description="Revert the last edit"
          keys="⌘Z"
          onClick={handleUndo}
          disabled={!canUndo}
        />
        <ToolButton
          icon={<Redo2 size={16} />}
          label="Redo"
          description="Reapply the last undone edit"
          keys="⌘⇧Z"
          onClick={handleRedo}
          disabled={!canRedo}
        />

        <div className="mx-1 h-5 w-px bg-ocean-border" />

        <Tooltip
          label="Export video"
          description="Render the timeline to a video or GIF file"
          side="bottom"
        >
          <button
            type="button"
            aria-label="Export video"
            onClick={() => setExportOpen(true)}
            className="no-drag flex h-8 items-center gap-1.5 rounded-md bg-gradient-to-r from-ocean-accent to-ocean-accent-2 px-3 text-sm font-semibold text-ocean-bg transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-1 focus-visible:ring-ocean-accent"
          >
            <Clapperboard size={16} />
            <span>Export</span>
          </button>
        </Tooltip>

        <div className="mx-1 h-5 w-px bg-ocean-border" />

        <ToolButton
          icon={<HelpCircle size={16} />}
          label="Keyboard shortcuts"
          description="View all keyboard shortcuts"
          keys="?"
          onClick={handleHelp}
        />
        <ToolButton
          icon={<SettingsIcon size={16} />}
          label="Settings"
          description="Open project and app settings"
          onClick={handleSettings}
        />
      </div>

      {/* Subtle gradient hairline under the bar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-ocean-accent/30 to-transparent" />

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  )
}
