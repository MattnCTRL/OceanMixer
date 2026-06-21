/**
 * Ruler — the time scale displayed above the timeline tracks.
 *
 * Renders tick marks + labels spaced according to the current zoom
 * (pixelsPerSecond), and lets the user scrub the playhead by clicking or
 * dragging anywhere on the ruler surface. It shares the same horizontal
 * scroll as the track lanes, so the caller positions it inside the scroll
 * content and passes the same `contentWidth` and `pixelsPerSecond`.
 */

import type * as React from 'react'
import { useCallback, useRef } from 'react'
import clsx from 'clsx'
import { formatTimecode } from '@renderer/lib/time'

export interface RulerProps {
  /** total scrollable content width in px (project length * pps, with headroom) */
  contentWidth: number
  /** zoom: px per second */
  pixelsPerSecond: number
  /** current playhead position in seconds */
  playheadSec: number
  /** project frame rate, used for nicer timecode labels at high zoom */
  fps: number
  /** commit a new playhead time (seconds) */
  onScrub: (sec: number) => void
}

/**
 * Pick a "nice" major tick interval (in seconds) so labels are readable at
 * any zoom. We aim for roughly one label every ~90px.
 */
function chooseInterval(pixelsPerSecond: number): { major: number; minorDivs: number } {
  const targetPx = 90
  const rawSec = targetPx / pixelsPerSecond
  // candidate intervals in seconds, from sub-frame to minutes
  const candidates = [
    0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600
  ]
  let major = candidates[candidates.length - 1]
  for (const c of candidates) {
    if (c >= rawSec) {
      major = c
      break
    }
  }
  // minor subdivisions per major tick (visual density only)
  const minorDivs = major >= 60 ? 6 : major >= 10 ? 5 : major >= 1 ? 4 : 5
  return { major, minorDivs }
}

const RULER_HEIGHT = 28

export function Ruler({
  contentWidth,
  pixelsPerSecond,
  playheadSec,
  fps,
  onScrub
}: RulerProps): React.JSX.Element {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const secFromClientX = useCallback(
    (clientX: number): number => {
      const el = surfaceRef.current
      if (!el) return 0
      const rect = el.getBoundingClientRect()
      const x = clientX - rect.left
      return Math.max(0, x / pixelsPerSecond)
    },
    [pixelsPerSecond]
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      draggingRef.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
      onScrub(secFromClientX(e.clientX))
    },
    [onScrub, secFromClientX]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      onScrub(secFromClientX(e.clientX))
    },
    [onScrub, secFromClientX]
  )

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  const { major, minorDivs } = chooseInterval(pixelsPerSecond)
  const minorStep = major / minorDivs

  // Build tick marks. Cap the count defensively to avoid runaway DOM.
  const totalSeconds = contentWidth / pixelsPerSecond
  const ticks: React.JSX.Element[] = []
  const maxTicks = 2000
  let count = 0
  for (let t = 0; t <= totalSeconds + minorStep && count < maxTicks; t += minorStep, count++) {
    const x = t * pixelsPerSecond
    // floating point: snap to detect majors
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6
    ticks.push(
      <div
        key={`t${count}`}
        className={clsx(
          'absolute bottom-0 w-px',
          isMajor ? 'bg-ocean-line' : 'bg-ocean-border'
        )}
        style={{ left: x, height: isMajor ? 12 : 6 }}
      />
    )
    if (isMajor) {
      ticks.push(
        <div
          key={`l${count}`}
          className="absolute top-1 select-none text-[10px] leading-none text-ocean-muted"
          style={{ left: x + 3 }}
        >
          {formatTimecode(t, major < 1, fps)}
        </div>
      )
    }
  }

  const playheadX = playheadSec * pixelsPerSecond

  return (
    <div
      ref={surfaceRef}
      role="slider"
      aria-label="Timeline ruler"
      aria-valuenow={Math.round(playheadSec * 100) / 100}
      tabIndex={-1}
      title="Click or drag to move the playhead"
      className="relative cursor-text border-b border-ocean-border bg-ocean-panel"
      style={{ width: contentWidth, height: RULER_HEIGHT, minWidth: '100%' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {ticks}
      {/* playhead handle (triangle) */}
      <div
        className="pointer-events-none absolute top-0 z-10"
        style={{ left: playheadX, transform: 'translateX(-50%)' }}
      >
        <div
          className="h-0 w-0 border-l-[6px] border-r-[6px] border-t-[7px] border-l-transparent border-r-transparent"
          style={{ borderTopColor: 'var(--color-ocean-accent)' }}
        />
      </div>
    </div>
  )
}

export const RULER_HEIGHT_PX = RULER_HEIGHT
