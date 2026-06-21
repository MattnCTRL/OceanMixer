/**
 * Timeline — OceanMixer's core multi-track editing surface.
 *
 * Layout:
 *   ┌─────────────┬──────────────────────────────────────────┐
 *   │ (zoom bar)  │  Ruler  (scrolls horizontally with lanes) │
 *   ├─────────────┼──────────────────────────────────────────┤
 *   │ track hdr   │  lane (clips, drop target)                │  ← top track
 *   │ track hdr   │  lane                                     │
 *   │   …         │   …                                       │  ← bottom track
 *   └─────────────┴──────────────────────────────────────────┘
 *
 * Tracks are stored bottom→top (index 0 = bottom). We render them reversed so
 * the topmost compositing layer appears at the top of the panel, matching what
 * users see in the preview.
 *
 * All document mutations go through the project store's `apply` (history) and
 * `applyTransient` (live drag). Clip interaction lives in <TimelineClip>; this
 * component owns the ruler, playhead, zoom, keyboard shortcuts, the shared
 * horizontal scroll, and the library drag-and-drop drop targets.
 */

import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import clsx from 'clsx'
import {
  Film,
  Music,
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ZoomIn,
  ZoomOut,
  Scissors,
  Trash2
} from 'lucide-react'
import type { Track, MediaType } from '@shared/types'
import type { EditOp } from '@shared/ai-ops'
import { useProjectStore, useProjectDuration } from '@renderer/store/projectStore'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { clamp } from '@renderer/lib/time'
import { Ruler } from './Ruler'
import { TimelineClip } from './TimelineClip'

const ASSET_DND_KEY = 'application/x-oceanmixer-asset'
const HEADER_WIDTH = 140
const LANE_HEIGHT = 64
const MIN_TIMELINE_SECONDS = 10

/** Which timeline track kind can host a given imported media type. */
function trackKindForAssetType(t: MediaType): Track['kind'] {
  return t === 'audio' ? 'audio' : 'video'
}

export function Timeline(): React.JSX.Element {
  // Narrow store selections to avoid over-rendering.
  const tracks = useProjectStore((s) => s.project.tracks)
  const media = useProjectStore((s) => s.project.media)
  const fps = useProjectStore((s) => s.project.settings.fps)
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds)
  const playheadSec = useProjectStore((s) => s.playheadSec)
  const pixelsPerSecond = useProjectStore((s) => s.pixelsPerSecond)

  const apply = useProjectStore((s) => s.apply)
  const applyTransient = useProjectStore((s) => s.applyTransient)
  const select = useProjectStore((s) => s.select)
  const clearSelection = useProjectStore((s) => s.clearSelection)
  const setPlayhead = useProjectStore((s) => s.setPlayhead)
  const setPixelsPerSecond = useProjectStore((s) => s.setPixelsPerSecond)
  const zoomIn = useProjectStore((s) => s.zoomIn)
  const zoomOut = useProjectStore((s) => s.zoomOut)

  const duration = useProjectDuration()

  const scrollRef = useRef<HTMLDivElement>(null)
  const lanesRef = useRef<HTMLDivElement>(null)
  const headerScrollRef = useRef<HTMLDivElement>(null)

  const selectedSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds])

  // Content width: cover the project, the playhead, and a little headroom.
  const contentSeconds = Math.max(duration, playheadSec, MIN_TIMELINE_SECONDS) + 4
  const contentWidth = contentSeconds * pixelsPerSecond

  // Tracks rendered top→bottom visually = reverse of storage order.
  const visualTracks = useMemo(() => [...tracks].reverse(), [tracks])

  /* ----------------------------------------------------------- track lookup */

  /**
   * Map a vertical client-Y to a destination track id of the SAME kind as the
   * clip being dragged. Used for cross-track moves. Returns the original track
   * id if the pointer isn't over a compatible lane.
   */
  const resolveTrackAtClientY = useCallback(
    (clientY: number, clipTrackId: string): string | null => {
      const origin = tracks.find((t) => t.id === clipTrackId)
      if (!origin) return clipTrackId
      const lanesEl = lanesRef.current
      if (!lanesEl) return clipTrackId
      const laneNodes = lanesEl.querySelectorAll<HTMLElement>('[data-track-id]')
      for (const node of Array.from(laneNodes)) {
        const rect = node.getBoundingClientRect()
        if (clientY >= rect.top && clientY <= rect.bottom) {
          const id = node.dataset.trackId
          if (!id) continue
          const dest = tracks.find((t) => t.id === id)
          if (dest && dest.kind === origin.kind) return dest.id
          return clipTrackId // hovering an incompatible lane → stay put
        }
      }
      return clipTrackId
    },
    [tracks]
  )

  /* --------------------------------------------------------- clip callbacks */

  const handleSelect = useCallback(
    (clipId: string, additive: boolean) => select(clipId, additive),
    [select]
  )
  const handleTransient = useCallback((ops: EditOp[]) => applyTransient(ops), [applyTransient])
  const handleCommit = useCallback((ops: EditOp[]) => apply(ops), [apply])

  /* ----------------------------------------------------------------- scrub */

  const handleScrub = useCallback((sec: number) => setPlayhead(sec), [setPlayhead])

  // Keep the fixed left header column vertically aligned with the lanes when
  // the timeline body scrolls vertically (many tracks).
  const handleBodyScroll = useCallback(() => {
    if (headerScrollRef.current && scrollRef.current) {
      headerScrollRef.current.scrollTop = scrollRef.current.scrollTop
    }
  }, [])

  /* ----------------------------------------------------------- drop target */

  const handleLaneDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes(ASSET_DND_KEY)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleLaneDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, track: Track) => {
      if (!e.dataTransfer.types.includes(ASSET_DND_KEY)) return
      e.preventDefault()
      const assetId = e.dataTransfer.getData(ASSET_DND_KEY)
      if (!assetId) return
      const asset = media.find((a) => a.id === assetId)
      if (!asset) return
      // Only accept onto a kind-compatible track.
      if (trackKindForAssetType(asset.type) !== track.kind) return

      // The lane's live bounding rect already reflects horizontal scroll, so
      // clientX - rect.left is the in-content x position directly.
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const start = Math.max(0, x / pixelsPerSecond)
      const warnings = apply([{ op: 'addClip', trackId: track.id, assetId, start }])
      if (warnings.length === 0) {
        // best-effort: nothing else needed; store marks dirty
      }
    },
    [media, pixelsPerSecond, apply]
  )

  /* ----------------------------------------------------------- empty-space */

  const handleLanePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Click on empty lane area clears selection + moves playhead there.
      if (e.target !== e.currentTarget) return
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      setPlayhead(Math.max(0, x / pixelsPerSecond))
      clearSelection()
    },
    [pixelsPerSecond, setPlayhead, clearSelection]
  )

  /* -------------------------------------------------------- ctrl/cmd wheel */

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const pointerX = e.clientX - rect.left + el.scrollLeft
      const secAtPointer = pointerX / useProjectStore.getState().pixelsPerSecond
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const current = useProjectStore.getState().pixelsPerSecond
      const next = clamp(current * factor, 4, 400)
      setPixelsPerSecond(next)
      // keep the point under the cursor stable
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollLeft = secAtPointer * next - (e.clientX - rect.left)
        }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setPixelsPerSecond])

  /* ----------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Ignore when typing in inputs/textareas/contenteditable.
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }

      const state = useProjectStore.getState()
      const selected = state.selectedClipIds

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected.length === 0) return
        e.preventDefault()
        const ops: EditOp[] = selected.map((id) => ({ op: 'removeClip', clipId: id }))
        state.apply(ops)
        state.clearSelection()
        return
      }

      if (e.key === 's' || e.key === 'S') {
        if (e.metaKey || e.ctrlKey) return // leave save shortcut alone
        if (selected.length === 0) return
        const at = state.playheadSec
        const ops: EditOp[] = []
        for (const id of selected) {
          // Only split clips the playhead actually crosses.
          for (const track of state.project.tracks) {
            const clip = track.clips.find((c) => c.id === id)
            if (clip && at > clip.start && at < clip.start + clip.duration) {
              ops.push({ op: 'splitClip', clipId: id, at })
            }
          }
        }
        if (ops.length > 0) {
          e.preventDefault()
          state.apply(ops)
        }
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* ----------------------------------------------------------- selected ops */

  const deleteSelected = useCallback(() => {
    if (selectedClipIds.length === 0) return
    apply(selectedClipIds.map((id) => ({ op: 'removeClip', clipId: id }) as EditOp))
    clearSelection()
  }, [selectedClipIds, apply, clearSelection])

  const splitSelected = useCallback(() => {
    if (selectedClipIds.length === 0) return
    const at = playheadSec
    const ops: EditOp[] = []
    for (const track of tracks) {
      for (const clip of track.clips) {
        if (
          selectedSet.has(clip.id) &&
          at > clip.start &&
          at < clip.start + clip.duration
        ) {
          ops.push({ op: 'splitClip', clipId: clip.id, at })
        }
      }
    }
    if (ops.length > 0) apply(ops)
  }, [selectedClipIds, selectedSet, tracks, playheadSec, apply])

  /* ---------------------------------------------------------------- render */

  const playheadX = playheadSec * pixelsPerSecond
  const hasSelection = selectedClipIds.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col bg-ocean-bg text-ocean-text">
      {/* toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-ocean-border bg-ocean-panel px-2">
        <span className="mr-2 text-xs font-medium text-ocean-muted">Timeline</span>
        <Tooltip
          label="Zoom out"
          keys="-"
          description="Show more of the timeline. Ctrl/Cmd + scroll also zooms."
          side="bottom"
        >
          <button
            type="button"
            onClick={zoomOut}
            className="rounded p-1 text-ocean-muted hover:bg-ocean-panel-2 hover:text-ocean-text"
            title="Zoom out (Ctrl/Cmd + scroll)"
          >
            <ZoomOut size={16} />
          </button>
        </Tooltip>
        <Tooltip
          label="Zoom in"
          keys="+"
          description="See clips in finer detail. Ctrl/Cmd + scroll also zooms."
          side="bottom"
        >
          <button
            type="button"
            onClick={zoomIn}
            className="rounded p-1 text-ocean-muted hover:bg-ocean-panel-2 hover:text-ocean-text"
            title="Zoom in (Ctrl/Cmd + scroll)"
          >
            <ZoomIn size={16} />
          </button>
        </Tooltip>
        <span className="w-12 text-center text-[10px] tabular-nums text-ocean-muted">
          {Math.round(pixelsPerSecond)}px/s
        </span>

        <div className="mx-2 h-4 w-px bg-ocean-border" />

        <Tooltip
          label="Split clip"
          keys="S"
          description="Cut the selected clip at the playhead into two."
          side="bottom"
        >
          <button
            type="button"
            onClick={splitSelected}
            disabled={!hasSelection}
            className={clsx(
              'flex items-center gap-1 rounded px-2 py-1 text-xs',
              hasSelection
                ? 'text-ocean-text hover:bg-ocean-panel-2'
                : 'cursor-not-allowed text-ocean-muted/40'
            )}
            title="Split selected clip at playhead (S)"
          >
            <Scissors size={14} /> Split
          </button>
        </Tooltip>
        <Tooltip
          label="Delete clip"
          keys="Del"
          description="Remove the selected clip(s) from the timeline."
          side="bottom"
        >
          <button
            type="button"
            onClick={deleteSelected}
            disabled={!hasSelection}
            className={clsx(
              'flex items-center gap-1 rounded px-2 py-1 text-xs',
              hasSelection
                ? 'text-ocean-danger hover:bg-ocean-panel-2'
                : 'cursor-not-allowed text-ocean-muted/40'
            )}
            title="Delete selected clips (Delete)"
          >
            <Trash2 size={14} /> Delete
          </button>
        </Tooltip>
      </div>

      {/* main grid: fixed header column + scrollable lanes */}
      <div className="flex min-h-0 flex-1">
        {/* header column (ruler spacer + per-track headers); its vertical scroll
            is kept in sync with the lanes body below. */}
        <div
          className="flex shrink-0 flex-col overflow-hidden border-r border-ocean-border bg-ocean-panel"
          style={{ width: HEADER_WIDTH }}
        >
          {/* ruler spacer (matches RULER_HEIGHT) */}
          <div className="h-7 shrink-0 border-b border-ocean-border" />
          <div ref={headerScrollRef} className="min-h-0 flex-1 overflow-hidden">
            {visualTracks.map((track) => (
              <TrackHeader key={track.id} track={track} />
            ))}
          </div>
        </div>

        {/* scrollable timeline body */}
        <div
          ref={scrollRef}
          onScroll={handleBodyScroll}
          className="relative min-h-0 flex-1 overflow-auto"
        >
          <div style={{ width: contentWidth, minWidth: '100%' }}>
            <div className="sticky top-0 z-30">
              <Ruler
                contentWidth={contentWidth}
                pixelsPerSecond={pixelsPerSecond}
                playheadSec={playheadSec}
                fps={fps}
                onScrub={handleScrub}
              />
            </div>

            <div ref={lanesRef} className="relative">
              {visualTracks.map((track) => (
                <div
                  key={track.id}
                  data-track-id={track.id}
                  className={clsx(
                    'relative border-b border-ocean-border',
                    track.kind === 'audio' ? 'bg-ocean-panel/40' : 'bg-ocean-panel-2/40'
                  )}
                  style={{ height: LANE_HEIGHT }}
                  onPointerDown={handleLanePointerDown}
                  onDragOver={handleLaneDragOver}
                  onDrop={(e) => handleLaneDrop(e, track)}
                >
                  {track.clips.map((clip) => (
                    <TimelineClip
                      key={clip.id}
                      clip={clip}
                      trackId={track.id}
                      selected={selectedSet.has(clip.id)}
                      pixelsPerSecond={pixelsPerSecond}
                      laneHeight={LANE_HEIGHT}
                      resolveTrackAtClientY={resolveTrackAtClientY}
                      onSelect={handleSelect}
                      onTransient={handleTransient}
                      onCommit={handleCommit}
                    />
                  ))}
                </div>
              ))}

              {/* playhead spanning all lanes */}
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-ocean-accent"
                style={{ left: playheadX }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- subviews */

interface TrackHeaderProps {
  track: Track
}

/**
 * Track header with name, kind icon, and mute/hide/lock toggles. Toggles
 * dispatch `setTrackProps` so they participate in undo/redo like any edit.
 */
function TrackHeader({ track }: TrackHeaderProps): React.JSX.Element {
  const apply = useProjectStore((s) => s.apply)
  const KindIcon = track.kind === 'audio' ? Music : Film

  const toggle = (props: { muted?: boolean; hidden?: boolean; locked?: boolean }): void => {
    apply([{ op: 'setTrackProps', trackId: track.id, props }])
  }

  return (
    <div
      className="flex flex-col justify-between border-b border-ocean-border px-2 py-1.5"
      style={{ height: LANE_HEIGHT }}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-ocean-text">
        <KindIcon size={13} className="shrink-0 text-ocean-muted" />
        <span className="truncate">{track.name}</span>
      </div>
      <div className="flex items-center gap-1 text-ocean-muted">
        <Tooltip
          label={track.muted ? 'Unmute track' : 'Mute track'}
          description="Silence this track's audio in preview and export."
          side="top"
        >
          <button
            type="button"
            onClick={() => toggle({ muted: !track.muted })}
            className={clsx(
              'rounded p-0.5 hover:text-ocean-text',
              track.muted ? 'text-ocean-danger' : 'text-ocean-muted/60'
            )}
            title={track.muted ? 'Unmute track' : 'Mute track'}
          >
            {track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
        </Tooltip>
        {track.kind === 'video' && (
          <Tooltip
            label={track.hidden ? 'Show track' : 'Hide track'}
            description="Toggle this video layer's visibility in the composite."
            side="top"
          >
            <button
              type="button"
              onClick={() => toggle({ hidden: !track.hidden })}
              className={clsx(
                'rounded p-0.5 hover:text-ocean-text',
                track.hidden ? 'text-ocean-danger' : 'text-ocean-muted/60'
              )}
              title={track.hidden ? 'Show track' : 'Hide track'}
            >
              {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </Tooltip>
        )}
        <Tooltip
          label={track.locked ? 'Unlock track' : 'Lock track'}
          description="Prevent edits to clips on this track."
          side="top"
        >
          <button
            type="button"
            onClick={() => toggle({ locked: !track.locked })}
            className={clsx(
              'rounded p-0.5 hover:text-ocean-text',
              track.locked ? 'text-ocean-accent' : 'text-ocean-muted/60'
            )}
            title={track.locked ? 'Unlock track' : 'Lock track'}
          >
            {track.locked ? <Lock size={13} /> : <Unlock size={13} />}
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
