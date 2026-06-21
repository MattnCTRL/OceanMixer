/**
 * Preview player: a real composited preview of the project at the playhead,
 * with play/pause + a scrubber. Uses a <canvas> at the project's pixel size
 * (CSS-scaled to fit) plus a hidden pool of media decoders managed by
 * PreviewCompositor.
 *
 * - Paused: renders a single frame whenever the project or playhead changes.
 * - Playing: runs a requestAnimationFrame loop that advances the playhead by
 *   real elapsed time, composites each frame, and drives audio. Stops at the
 *   project end.
 */

import { useEffect, useRef, useCallback } from 'react'
import clsx from 'clsx'
import { Play, Pause, SkipBack } from 'lucide-react'
import { useProjectStore, useProjectDuration } from '@renderer/store/projectStore'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { formatTimecode } from '@renderer/lib/time'
import { PreviewCompositor } from './compositor'

export function Preview(): JSX.Element {
  const project = useProjectStore((s) => s.project)
  const playheadSec = useProjectStore((s) => s.playheadSec)
  const isPlaying = useProjectStore((s) => s.isPlaying)
  const setPlayhead = useProjectStore((s) => s.setPlayhead)
  const play = useProjectStore((s) => s.play)
  const pause = useProjectStore((s) => s.pause)
  const duration = useProjectDuration()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const decoderHostRef = useRef<HTMLDivElement>(null)
  const compositorRef = useRef<PreviewCompositor | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastTickRef = useRef<number>(0)

  // Keep stable refs to the latest values for use inside the rAF loop.
  const playheadRef = useRef(playheadSec)
  const durationRef = useRef(duration)
  playheadRef.current = playheadSec
  durationRef.current = duration

  /* ----- create / destroy the compositor with the canvas lifetime ----- */
  useEffect(() => {
    const canvas = canvasRef.current
    const host = decoderHostRef.current
    if (!canvas || !host) return
    const comp = new PreviewCompositor()
    comp.attach(canvas, host)
    compositorRef.current = comp
    return () => {
      comp.dispose()
      compositorRef.current = null
    }
  }, [])

  /* ----- reconcile the decoder pool when the project changes ----- */
  useEffect(() => {
    const comp = compositorRef.current
    if (!comp) return
    comp.syncDecoders(project)
    // re-render the current frame so newly loaded media appears once decoded.
    if (!useProjectStore.getState().isPlaying) {
      // give the browser a tick for image/video metadata, then draw a couple frames
      comp.render(playheadRef.current)
      const id = window.setTimeout(() => comp.render(playheadRef.current), 120)
      return () => window.clearTimeout(id)
    }
    return undefined
  }, [project])

  /* ----- paused: render a single frame on playhead/project change ----- */
  useEffect(() => {
    const comp = compositorRef.current
    if (!comp) return
    if (isPlaying) return
    comp.setPlaying(false)
    comp.render(playheadSec)
  }, [playheadSec, project, isPlaying])

  /* ----- playing: rAF loop advancing the playhead + compositing ----- */
  useEffect(() => {
    const comp = compositorRef.current
    if (!comp) return

    if (!isPlaying) {
      comp.setPlaying(false)
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      return
    }

    comp.setPlaying(true)
    lastTickRef.current = performance.now()

    const loop = (now: number): void => {
      const dt = (now - lastTickRef.current) / 1000
      lastTickRef.current = now

      const total = durationRef.current
      let next = playheadRef.current + dt

      if (total > 0 && next >= total) {
        next = total
        setPlayhead(next)
        comp.render(next)
        pause()
        return
      }

      playheadRef.current = next
      setPlayhead(next)
      comp.render(next)
      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
    // We intentionally only react to isPlaying; the loop reads live values via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  const onTogglePlay = useCallback(() => {
    const total = durationRef.current
    if (!isPlaying && total > 0 && playheadRef.current >= total - 0.001) {
      setPlayhead(0)
    }
    if (isPlaying) pause()
    else play()
  }, [isPlaying, play, pause, setPlayhead])

  const onScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setPlayhead(parseFloat(e.target.value))
    },
    [setPlayhead]
  )

  const onRewind = useCallback(() => {
    setPlayhead(0)
  }, [setPlayhead])

  const aspect = project.settings.height
    ? project.settings.width / project.settings.height
    : 16 / 9
  const fps = project.settings.fps || 30
  const scrubMax = Math.max(duration, 0.001)

  return (
    <div className="flex h-full min-h-0 flex-col bg-ocean-bg">
      {/* hidden decoder host */}
      <div ref={decoderHostRef} className="pointer-events-none absolute h-0 w-0 overflow-hidden" />

      {/* stage */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <div
          className="relative max-h-full max-w-full"
          style={{ aspectRatio: String(aspect) }}
        >
          <canvas
            ref={canvasRef}
            className="block h-full w-full rounded border border-ocean-border bg-black object-contain shadow-lg"
            style={{ aspectRatio: String(aspect) }}
          />
        </div>
      </div>

      {/* transport */}
      <div className="flex items-center gap-3 border-t border-ocean-border bg-ocean-panel px-4 py-2">
        <Tooltip
          label="Back to start"
          keys="Home"
          description="Jump the playhead to the beginning."
          side="top"
        >
          <button
            type="button"
            onClick={onRewind}
            title="Back to start"
            className="rounded p-1.5 text-ocean-muted transition-colors hover:bg-ocean-panel-2 hover:text-ocean-text"
          >
            <SkipBack size={16} />
          </button>
        </Tooltip>

        <Tooltip
          label={isPlaying ? 'Pause' : 'Play'}
          keys="Space"
          description="Play or pause the preview."
          side="top"
        >
          <button
            type="button"
            onClick={onTogglePlay}
            title={isPlaying ? 'Pause' : 'Play'}
            className={clsx(
              'rounded p-1.5 transition-colors hover:bg-ocean-panel-2',
              isPlaying ? 'text-ocean-accent' : 'text-ocean-text'
            )}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
        </Tooltip>

        <span className="select-none font-mono text-xs tabular-nums text-ocean-text">
          {formatTimecode(playheadSec, false, fps)}
        </span>

        <Tooltip
          label="Scrub"
          description="Drag to move the playhead through the timeline."
          side="top"
          className="flex-1"
        >
          <input
            type="range"
            min={0}
            max={scrubMax}
            step={1 / fps}
            value={Math.min(playheadSec, scrubMax)}
            onChange={onScrub}
            className="h-1 w-full cursor-pointer appearance-none rounded bg-ocean-panel-2 accent-ocean-accent"
          />
        </Tooltip>

        <span className="select-none font-mono text-xs tabular-nums text-ocean-muted">
          {formatTimecode(duration, false, fps)}
        </span>
      </div>
    </div>
  )
}
