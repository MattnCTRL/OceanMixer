import { useCallback, useRef, useState } from 'react'
import { FilePlus, FolderPlus, Loader2, Mic, Upload } from 'lucide-react'
import clsx from 'clsx'
import { useProjectStore } from '@renderer/store/projectStore'
import type { MediaAsset } from '@shared/types'
import { AssetCard } from './AssetCard'
import { AudioRecorder } from './AudioRecorder'

/**
 * The media pool panel. Imports source files via the native dialog, a whole
 * folder, drag-and-drop from Finder/Photos, or the audio recorder — then shows
 * them as a draggable grid of AssetCards that feed the timeline.
 */
export function MediaLibrary(): JSX.Element {
  const media = useProjectStore((s) => s.project.media)
  const [importing, setImporting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [recorderOpen, setRecorderOpen] = useState(false)
  const dragDepth = useRef(0)

  const addAssets = useCallback((assets: MediaAsset[]) => {
    if (assets && assets.length > 0) useProjectStore.getState().importAssets(assets)
  }, [])

  const handleImportFiles = useCallback(async (): Promise<void> => {
    if (importing) return
    setImporting(true)
    try {
      addAssets(await window.api.dialog.openMedia())
    } catch (err) {
      console.error('Failed to import media', err)
    } finally {
      setImporting(false)
    }
  }, [importing, addAssets])

  const handleImportFolder = useCallback(async (): Promise<void> => {
    if (importing) return
    setImporting(true)
    try {
      addAssets(await window.api.dialog.openMediaFolder())
    } catch (err) {
      console.error('Failed to import folder', err)
    } finally {
      setImporting(false)
    }
  }, [importing, addAssets])

  /* --- Finder / Photos drag-and-drop --- */

  const hasFiles = (e: React.DragEvent): boolean =>
    Array.from(e.dataTransfer.types).includes('Files')

  const onDragEnter = useCallback((e: React.DragEvent): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }, [])

  const onDragOver = useCallback((e: React.DragEvent): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent): void => {
    if (!hasFiles(e)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }, [])

  const onDrop = useCallback(
    async (e: React.DragEvent): Promise<void> => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const paths = Array.from(e.dataTransfer.files)
        .map((f) => {
          try {
            return window.api.app.pathForFile(f)
          } catch {
            return ''
          }
        })
        .filter((p) => p.length > 0)
      if (paths.length === 0) return
      setImporting(true)
      try {
        addAssets(await window.api.media.probe(paths))
      } catch (err) {
        console.error('Failed to import dropped files', err)
      } finally {
        setImporting(false)
      }
    },
    [addAssets]
  )

  return (
    <div
      className="relative flex h-full min-h-0 flex-col bg-ocean-panel text-ocean-text"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-ocean-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ocean-muted">Media</h2>
        <div className="flex items-center gap-1">
          <IconBtn title="Import files" onClick={handleImportFiles} busy={importing}>
            <FilePlus size={14} />
          </IconBtn>
          <IconBtn title="Import a folder" onClick={handleImportFolder} busy={importing}>
            <FolderPlus size={14} />
          </IconBtn>
          <IconBtn title="Record audio" onClick={() => setRecorderOpen(true)}>
            <Mic size={14} />
          </IconBtn>
        </div>
      </header>

      {media.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <Upload size={32} strokeWidth={1.5} className="text-ocean-muted" />
          <p className="text-sm text-ocean-muted">
            Drag in photos, videos &amp; music — or
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleImportFiles}
              disabled={importing}
              className="inline-flex items-center gap-1.5 rounded-md bg-ocean-accent px-3 py-1.5 text-xs font-semibold text-ocean-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {importing ? <Loader2 size={14} className="animate-spin" /> : <FilePlus size={14} />}
              Import files
            </button>
            <button
              type="button"
              onClick={handleImportFolder}
              disabled={importing}
              className="inline-flex items-center gap-1.5 rounded-md border border-ocean-border bg-ocean-panel-2 px-3 py-1.5 text-xs font-semibold text-ocean-text transition-colors hover:border-ocean-accent hover:text-ocean-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FolderPlus size={14} />
              Import folder
            </button>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="grid grid-cols-2 gap-2">
            {media.map((asset) => (
              <AssetCard key={asset.id} asset={asset} />
            ))}
          </div>
        </div>
      )}

      {/* Drop overlay */}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-ocean-accent bg-ocean-bg/80">
          <div className="flex flex-col items-center gap-2 text-ocean-accent">
            <Upload size={28} />
            <span className="text-sm font-medium">Drop to import</span>
          </div>
        </div>
      )}

      {recorderOpen && <AudioRecorder open onClose={() => setRecorderOpen(false)} />}
    </div>
  )
}

function IconBtn({
  title,
  onClick,
  busy,
  children
}: {
  title: string
  onClick: () => void
  busy?: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={busy}
      className={clsx(
        'inline-flex items-center justify-center rounded-md border border-ocean-border bg-ocean-panel-2 p-1.5 text-ocean-text transition-colors hover:border-ocean-accent hover:text-ocean-accent',
        busy && 'cursor-not-allowed opacity-60'
      )}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : children}
    </button>
  )
}
