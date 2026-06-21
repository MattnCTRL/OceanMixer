import { useState } from 'react'
import clsx from 'clsx'
import { Film, Image as ImageIcon, Music } from 'lucide-react'
import type { MediaAsset, TrackKind } from '@shared/types'
import type { EditOp } from '@shared/ai-ops'
import { useProjectStore } from '@renderer/store/projectStore'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { fileUrl, formatDuration } from '@renderer/lib/time'

const TYPE_ICON = {
  video: Film,
  image: ImageIcon,
  audio: Music
} as const

const TYPE_BADGE = {
  video: 'bg-ocean-video/20 text-ocean-video',
  image: 'bg-ocean-text-clip/20 text-ocean-text-clip',
  audio: 'bg-ocean-audio/20 text-ocean-audio'
} as const

/**
 * A single draggable media asset tile in the library grid.
 * Drag to the timeline (sets the x-oceanmixer-asset payload) or double-click
 * to append it to the first matching track.
 */
export function AssetCard({ asset }: { asset: MediaAsset }): JSX.Element {
  const apply = useProjectStore((s) => s.apply)
  const [imgFailed, setImgFailed] = useState(false)

  const Icon = TYPE_ICON[asset.type]
  const hasThumb = !!asset.thumbnailDataUrl && !imgFailed

  function handleDragStart(e: React.DragEvent<HTMLDivElement>): void {
    e.dataTransfer.setData('application/x-oceanmixer-asset', asset.id)
    e.dataTransfer.effectAllowed = 'copy'
  }

  function handleDoubleClick(): void {
    const { project } = useProjectStore.getState()
    const wantedKind: TrackKind = asset.type === 'audio' ? 'audio' : 'video'
    const track = project.tracks.find((t) => t.kind === wantedKind)
    if (!track) return
    const op: EditOp = { op: 'addClip', trackId: track.id, assetId: asset.id }
    apply([op])
  }

  const tooltipDescription =
    asset.durationSec > 0
      ? `${asset.type} · ${formatDuration(asset.durationSec)} — drag to the timeline or double-click to add`
      : `${asset.type} — drag to the timeline or double-click to add`

  return (
    <Tooltip label={asset.name} description={tooltipDescription} side="top" className="w-full">
      <div
        draggable
        onDragStart={handleDragStart}
        onDoubleClick={handleDoubleClick}
        title={asset.name}
        className={clsx(
          'group flex w-full flex-col overflow-hidden rounded-md border border-ocean-border',
          'bg-ocean-panel-2 transition-colors hover:border-ocean-accent',
          'cursor-grab select-none active:cursor-grabbing'
        )}
      >
      <div className="relative aspect-video w-full overflow-hidden bg-ocean-bg">
        {hasThumb ? (
          <img
            src={asset.thumbnailDataUrl}
            alt={asset.name}
            draggable={false}
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : asset.type === 'image' && !imgFailed ? (
          <img
            src={fileUrl(asset.path)}
            alt={asset.name}
            draggable={false}
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ocean-muted">
            <Icon size={28} strokeWidth={1.5} />
          </div>
        )}

        {asset.durationSec > 0 && (
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[10px] font-medium tabular-nums text-ocean-text">
            {formatDuration(asset.durationSec)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 px-1.5 py-1">
        <span
          className={clsx(
            'shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
            TYPE_BADGE[asset.type]
          )}
        >
          {asset.type}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-ocean-text">{asset.name}</span>
      </div>
      </div>
    </Tooltip>
  )
}
