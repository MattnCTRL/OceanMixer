import { useCallback, useState } from 'react'
import { FolderPlus, Loader2 } from 'lucide-react'
import { useProjectStore } from '@renderer/store/projectStore'
import { AssetCard } from './AssetCard'

/**
 * The media pool panel. Imports source files via the native dialog and shows
 * them as a draggable grid of AssetCards that feed the timeline.
 */
export function MediaLibrary(): JSX.Element {
  const media = useProjectStore((s) => s.project.media)
  const [importing, setImporting] = useState(false)

  const handleImport = useCallback(async (): Promise<void> => {
    if (importing) return
    setImporting(true)
    try {
      const assets = await window.api.dialog.openMedia()
      if (assets && assets.length > 0) {
        useProjectStore.getState().importAssets(assets)
      }
    } catch (err) {
      // Surface to console; the dialog failing should not crash the panel.
      console.error('Failed to import media', err)
    } finally {
      setImporting(false)
    }
  }, [importing])

  return (
    <div className="flex h-full min-h-0 flex-col bg-ocean-panel text-ocean-text">
      <header className="flex shrink-0 items-center justify-between border-b border-ocean-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ocean-muted">Media</h2>
        <button
          type="button"
          onClick={handleImport}
          disabled={importing}
          className="inline-flex items-center gap-1.5 rounded-md border border-ocean-border bg-ocean-panel-2 px-2 py-1 text-xs font-medium text-ocean-text transition-colors hover:border-ocean-accent hover:text-ocean-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {importing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <FolderPlus size={14} />
          )}
          Import
        </button>
      </header>

      {media.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <FolderPlus size={32} strokeWidth={1.5} className="text-ocean-muted" />
          <p className="text-sm text-ocean-muted">Import media to begin</p>
          <button
            type="button"
            onClick={handleImport}
            disabled={importing}
            className="inline-flex items-center gap-1.5 rounded-md bg-ocean-accent px-3 py-1.5 text-xs font-semibold text-ocean-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {importing ? <Loader2 size={14} className="animate-spin" /> : <FolderPlus size={14} />}
            Import media
          </button>
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
    </div>
  )
}
