/**
 * TimelineClip — a single draggable/trimmable block on a track lane.
 *
 * It owns all the pointer-driven interaction for one clip:
 *   - dragging the body to move it in time (and vertically across same-kind
 *     tracks),
 *   - dragging the left/right edges to trim it.
 *
 * During a drag it calls `onTransient` with the live EditOps so the store can
 * preview the change without polluting undo history; on pointer-up it calls
 * `onCommit` with the final EditOps which the parent applies through the
 * history-tracked `apply`. Selection is delegated to `onSelect`.
 */

import type * as React from 'react'
import { useCallback, useRef, useState } from 'react'
import clsx from 'clsx'
import { Film, Music, Image as ImageIcon, Type } from 'lucide-react'
import type { Clip } from '@shared/types'
import type { EditOp } from '@shared/ai-ops'
import { clamp, formatDuration } from '@renderer/lib/time'

/** Minimum on-timeline duration we allow a clip to be trimmed/sized to. */
export const MIN_CLIP_DURATION = 0.1

/** Width in px of each grab-able trim handle at the clip edges. */
const EDGE_PX = 8

type DragMode = 'move' | 'trim-left' | 'trim-right'

export interface TimelineClipProps {
  clip: Clip
  /** id of the track this clip currently lives on */
  trackId: string
  selected: boolean
  pixelsPerSecond: number
  /** lane height in px (used to size the block) */
  laneHeight: number
  /**
   * Resolve a vertical pointer movement into a destination track id of the
   * SAME kind, or null if the pointer isn't over a compatible lane. Returns
   * the current trackId when the move shouldn't change tracks.
   */
  resolveTrackAtClientY: (clientY: number, clipTrackId: string) => string | null
  onSelect: (clipId: string, additive: boolean) => void
  onTransient: (ops: EditOp[]) => void
  onCommit: (ops: EditOp[]) => void
}

interface DragState {
  mode: DragMode
  pointerId: number
  startClientX: number
  startClientY: number
  origStart: number
  origDuration: number
  origInPoint: number
  origOutPoint: number
  origTrackId: string
  /** seconds of source per second of timeline (speed) */
  speed: number
  /** whether the clip is trimmable in-source (video/audio) vs free (image/text) */
  trimmable: boolean
  moved: boolean
}

function clipIcon(type: Clip['type']): React.JSX.Element {
  switch (type) {
    case 'video':
      return <Film size={12} />
    case 'audio':
      return <Music size={12} />
    case 'image':
      return <ImageIcon size={12} />
    case 'text':
      return <Type size={12} />
    default:
      return <Film size={12} />
  }
}

function clipColorClass(type: Clip['type']): string {
  switch (type) {
    case 'audio':
      return 'bg-ocean-audio'
    case 'text':
      return 'bg-ocean-text-clip'
    case 'image':
    case 'video':
    default:
      return 'bg-ocean-video'
  }
}

export function TimelineClip({
  clip,
  trackId,
  selected,
  pixelsPerSecond,
  laneHeight,
  resolveTrackAtClientY,
  onSelect,
  onTransient,
  onCommit
}: TimelineClipProps): React.JSX.Element {
  const dragRef = useRef<DragState | null>(null)
  const [activeMode, setActiveMode] = useState<DragMode | null>(null)

  const left = clip.start * pixelsPerSecond
  const width = Math.max(2, clip.duration * pixelsPerSecond)
  const label =
    clip.type === 'text' ? clip.text?.text ?? 'Text' : clip.label ?? clip.type

  const beginDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, mode: DragMode) => {
      e.preventDefault()
      e.stopPropagation()
      // selection happens immediately on press for snappy feel
      onSelect(clip.id, e.shiftKey)
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      dragRef.current = {
        mode,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origStart: clip.start,
        origDuration: clip.duration,
        origInPoint: clip.inPoint,
        origOutPoint: clip.outPoint,
        origTrackId: trackId,
        speed: clip.speed || 1,
        trimmable: clip.type === 'video' || clip.type === 'audio',
        moved: false
      }
      setActiveMode(mode)
    },
    [clip, trackId, onSelect]
  )

  const computeOps = useCallback(
    (d: DragState, clientX: number, clientY: number): EditOp[] => {
      const dxSec = (clientX - d.startClientX) / pixelsPerSecond

      if (d.mode === 'move') {
        const newStart = Math.max(0, d.origStart + dxSec)
        const destTrack = resolveTrackAtClientY(clientY, d.origTrackId)
        const ops: EditOp[] = []
        if (destTrack && destTrack !== d.origTrackId) {
          ops.push({ op: 'moveClip', clipId: clip.id, start: newStart, trackId: destTrack })
        } else {
          ops.push({ op: 'moveClip', clipId: clip.id, start: newStart })
        }
        return ops
      }

      if (d.mode === 'trim-right') {
        // dragging the right edge changes duration (and source out-point for media)
        const newDuration = Math.max(MIN_CLIP_DURATION, d.origDuration + dxSec)
        if (d.trimmable) {
          const newOut = d.origInPoint + newDuration * d.speed
          return [{ op: 'trimClip', clipId: clip.id, outPoint: newOut, duration: newDuration }]
        }
        return [{ op: 'trimClip', clipId: clip.id, duration: newDuration }]
      }

      // trim-left: the left edge moves; start + duration change, in-point too.
      // Clamp so we never collapse below the minimum duration and never push
      // the source in-point negative.
      let deltaSec = dxSec
      // limit so duration stays >= MIN
      const maxDelta = d.origDuration - MIN_CLIP_DURATION
      deltaSec = Math.min(deltaSec, maxDelta)
      // limit so start stays >= 0
      deltaSec = Math.max(deltaSec, -d.origStart)
      if (d.trimmable) {
        // limit so in-point stays >= 0
        const minDeltaForSource = -d.origInPoint / d.speed
        deltaSec = Math.max(deltaSec, minDeltaForSource)
      }
      const newStart = d.origStart + deltaSec
      const newDuration = d.origDuration - deltaSec
      const ops: EditOp[] = []
      if (d.trimmable) {
        const newIn = Math.max(0, d.origInPoint + deltaSec * d.speed)
        ops.push({ op: 'trimClip', clipId: clip.id, inPoint: newIn, duration: newDuration })
      } else {
        ops.push({ op: 'trimClip', clipId: clip.id, duration: newDuration })
      }
      ops.push({ op: 'moveClip', clipId: clip.id, start: newStart })
      return ops
    },
    [pixelsPerSecond, clip.id, resolveTrackAtClientY]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current
      if (!d || e.pointerId !== d.pointerId) return
      const dist = Math.abs(e.clientX - d.startClientX) + Math.abs(e.clientY - d.startClientY)
      if (!d.moved && dist < 3) return
      d.moved = true
      onTransient(computeOps(d, e.clientX, e.clientY))
    },
    [computeOps, onTransient]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current
      if (!d || e.pointerId !== d.pointerId) return
      const el = e.currentTarget as HTMLElement
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      dragRef.current = null
      setActiveMode(null)
      if (d.moved) {
        onCommit(computeOps(d, e.clientX, e.clientY))
      }
      // pure click (no move) already selected on pointerdown; nothing else to do
    },
    [computeOps, onCommit]
  )

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    const el = e.currentTarget as HTMLElement
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    dragRef.current = null
    setActiveMode(null)
  }, [])

  return (
    <div
      className={clsx(
        'group absolute top-1 bottom-1 overflow-hidden rounded-md border text-ocean-text shadow-sm',
        clipColorClass(clip.type),
        selected ? 'border-ocean-accent ring-2 ring-ocean-accent' : 'border-black/30',
        activeMode === 'move' ? 'cursor-grabbing' : 'cursor-grab',
        (clip.type === 'video' || clip.type === 'audio') && clip.muted && 'opacity-60'
      )}
      style={{ left, width, height: laneHeight - 8 }}
      onPointerDown={(e) => beginDrag(e, 'move')}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      title={`${label} — ${formatDuration(clip.duration)}`}
    >
      {/* clip body */}
      <div className="pointer-events-none flex h-full flex-col px-1.5 py-1">
        <div className="flex items-center gap-1 text-[11px] font-medium leading-none">
          <span className="shrink-0 opacity-90">{clipIcon(clip.type)}</span>
          <span className="truncate">{label}</span>
        </div>
        {width > 60 && (
          <div className="mt-auto truncate text-[9px] leading-none text-white/60">
            {formatDuration(clip.duration)}
          </div>
        )}
      </div>

      {/* trim handles */}
      <div
        className={clsx(
          'absolute inset-y-0 left-0 cursor-ew-resize bg-black/0 hover:bg-white/20',
          activeMode === 'trim-left' && 'bg-white/30'
        )}
        style={{ width: EDGE_PX }}
        onPointerDown={(e) => beginDrag(e, 'trim-left')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      />
      <div
        className={clsx(
          'absolute inset-y-0 right-0 cursor-ew-resize bg-black/0 hover:bg-white/20',
          activeMode === 'trim-right' && 'bg-white/30'
        )}
        style={{ width: EDGE_PX }}
        onPointerDown={(e) => beginDrag(e, 'trim-right')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      />
    </div>
  )
}
