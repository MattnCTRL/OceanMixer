import { useState, useEffect, useCallback, useRef } from 'react'
import clsx from 'clsx'
import {
  X,
  Clapperboard,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  FolderOpen
} from 'lucide-react'
import type { ExportFormat, ExportOptions, ExportProgress } from '@shared/ipc'
import { useProjectStore } from '@renderer/store/projectStore'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
}

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'mp4', label: 'MP4 (H.264)' },
  { value: 'mov', label: 'MOV (H.264)' },
  { value: 'webm', label: 'WebM (VP9)' },
  { value: 'gif', label: 'GIF (animated)' }
]

const PRESETS = [
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow'
] as const

function dirnameOf(p: string): string {
  const norm = p.replace(/\\/g, '/')
  const idx = norm.lastIndexOf('/')
  return idx > 0 ? norm.slice(0, idx) : norm
}

export function ExportDialog({ open, onClose }: ExportDialogProps): React.JSX.Element | null {
  const [format, setFormat] = useState<ExportFormat>('mp4')
  const [crf, setCrf] = useState(20)
  const [preset, setPreset] = useState<string>('medium')

  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  // Keep the unsubscribe handle so we can clean up on unmount / close.
  const offRef = useRef<(() => void) | null>(null)

  const settings = useProjectStore((s) => s.project.settings)

  const isRendering = jobId !== null && !progress?.done
  const isDone = progress?.done === true && !progress.error
  const showCrf = format !== 'gif'

  const cleanupSub = useCallback(() => {
    if (offRef.current) {
      offRef.current()
      offRef.current = null
    }
  }, [])

  // Reset transient state whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) {
      setJobId(null)
      setProgress(null)
      setError(null)
      setStarting(false)
    }
  }, [open])

  // Tear down any active progress subscription on unmount.
  useEffect(() => cleanupSub, [cleanupSub])

  const handleClose = useCallback(() => {
    // Don't allow dismissing mid-render; user must cancel first.
    if (isRendering) return
    cleanupSub()
    onClose()
  }, [isRendering, cleanupSub, onClose])

  const handleExport = useCallback(async () => {
    setError(null)
    setProgress(null)
    setStarting(true)
    try {
      const project = useProjectStore.getState().project
      const outputPath = await window.api.dialog.exportPath(project.name, format)
      if (!outputPath) {
        setStarting(false)
        return
      }

      const opts: ExportOptions = {
        outputPath,
        format,
        preset,
        ...(showCrf ? { crf } : {})
      }

      const handle = await window.api.exporter.start(project, opts)
      const id = handle.jobId
      setJobId(id)

      cleanupSub()
      offRef.current = window.api.exporter.onProgress((p) => {
        if (p.jobId !== id) return
        setProgress(p)
        if (p.done) {
          cleanupSub()
          if (p.error) setError(p.error)
        }
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStarting(false)
    }
  }, [format, preset, crf, showCrf, cleanupSub])

  const handleCancel = useCallback(async () => {
    if (!jobId) return
    try {
      await window.api.exporter.cancel(jobId)
    } catch (err) {
      console.error('Failed to cancel export', err)
    }
    cleanupSub()
    setJobId(null)
    setProgress(null)
  }, [jobId, cleanupSub])

  const handleReveal = useCallback(async () => {
    const out = progress?.outputPath
    if (!out) return
    try {
      await window.api.app.openExternal('file://' + dirnameOf(out))
    } catch (err) {
      console.error('Failed to reveal output', err)
    }
  }, [progress])

  if (!open) return null

  const percent = Math.max(0, Math.min(100, progress?.percent ?? 0))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Export video"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-ocean-border bg-ocean-panel shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ocean-border px-4 py-3">
          <div className="flex items-center gap-2 text-ocean-text">
            <Clapperboard size={18} className="text-ocean-accent" />
            <h2 className="text-sm font-semibold">Export Video</h2>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={handleClose}
            disabled={isRendering}
            className={clsx(
              'rounded-md p-1 text-ocean-muted transition-colors hover:bg-ocean-panel-2 hover:text-ocean-text',
              isRendering && 'cursor-not-allowed opacity-40 hover:bg-transparent'
            )}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-4 py-4">
          {/* Settings (disabled while rendering / done) */}
          {!isDone && (
            <>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-ocean-muted">Format</label>
                <select
                  value={format}
                  disabled={isRendering}
                  onChange={(e) => setFormat(e.target.value as ExportFormat)}
                  className="w-full rounded-md border border-ocean-border bg-ocean-panel-2 px-2.5 py-1.5 text-sm text-ocean-text focus:border-ocean-accent focus:outline-none disabled:opacity-50"
                >
                  {FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>

              {showCrf && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-medium text-ocean-muted">
                      Quality (CRF)
                    </label>
                    <span className="text-xs tabular-nums text-ocean-text">
                      {crf}
                      <span className="ml-1 text-ocean-muted">
                        {crf <= 18 ? 'high' : crf >= 26 ? 'low' : 'balanced'}
                      </span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={14}
                    max={30}
                    step={1}
                    value={crf}
                    disabled={isRendering}
                    onChange={(e) => setCrf(Number(e.target.value))}
                    className="w-full accent-ocean-accent disabled:opacity-50"
                  />
                  <div className="flex justify-between text-[10px] text-ocean-muted">
                    <span>Higher quality</span>
                    <span>Smaller file</span>
                  </div>
                </div>
              )}

              {showCrf && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-ocean-muted">
                    Encoding preset
                  </label>
                  <select
                    value={preset}
                    disabled={isRendering}
                    onChange={(e) => setPreset(e.target.value)}
                    className="w-full rounded-md border border-ocean-border bg-ocean-panel-2 px-2.5 py-1.5 text-sm text-ocean-text focus:border-ocean-accent focus:outline-none disabled:opacity-50"
                  >
                    {PRESETS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="rounded-md bg-ocean-panel-2 px-3 py-2 text-xs text-ocean-muted">
                Resolution{' '}
                <span className="text-ocean-text">
                  {settings.width}×{settings.height}
                </span>{' '}
                @ <span className="text-ocean-text">{settings.fps} fps</span>
              </div>
            </>
          )}

          {/* Progress */}
          {isRendering && progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-ocean-text">
                  <Loader2 size={13} className="animate-spin text-ocean-accent" />
                  <span className="capitalize">{progress.stage || 'rendering'}…</span>
                </span>
                <span className="tabular-nums text-ocean-muted">
                  {Math.round(percent)}%
                  {progress.etaSec != null && progress.etaSec > 0
                    ? ` · ~${Math.ceil(progress.etaSec)}s left`
                    : ''}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-ocean-panel-2">
                <div
                  className="h-full rounded-full bg-ocean-accent transition-[width] duration-200"
                  style={{ width: `${percent}%` }}
                />
              </div>
              {progress.fps != null && progress.fps > 0 && (
                <div className="text-[10px] text-ocean-muted">{Math.round(progress.fps)} fps</div>
              )}
            </div>
          )}

          {/* Starting (handed off, no first progress yet) */}
          {starting && !isRendering && (
            <div className="flex items-center gap-2 text-xs text-ocean-muted">
              <Loader2 size={13} className="animate-spin" /> Starting export…
            </div>
          )}

          {/* Success */}
          {isDone && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-md bg-ocean-ok/10 px-3 py-2.5">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-ocean-ok" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ocean-text">Export complete</div>
                  {progress?.outputPath && (
                    <div
                      className="truncate text-xs text-ocean-muted"
                      title={progress.outputPath}
                    >
                      {progress.outputPath}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-md bg-ocean-danger/10 px-3 py-2.5">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-ocean-danger" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-ocean-text">Export failed</div>
                <div className="text-xs break-words text-ocean-muted">{error}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-ocean-border px-4 py-3">
          {isRendering ? (
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-md border border-ocean-border px-3 py-1.5 text-sm text-ocean-text transition-colors hover:bg-ocean-panel-2"
            >
              Cancel render
            </button>
          ) : isDone ? (
            <>
              {progress?.outputPath && (
                <button
                  type="button"
                  onClick={handleReveal}
                  className="flex items-center gap-1.5 rounded-md border border-ocean-border px-3 py-1.5 text-sm text-ocean-text transition-colors hover:bg-ocean-panel-2"
                >
                  <FolderOpen size={14} /> Reveal
                </button>
              )}
              <button
                type="button"
                onClick={handleClose}
                className="rounded-md bg-ocean-accent px-4 py-1.5 text-sm font-medium text-ocean-bg transition-colors hover:bg-ocean-accent-2"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-md border border-ocean-border px-3 py-1.5 text-sm text-ocean-text transition-colors hover:bg-ocean-panel-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExport}
                disabled={starting}
                className="flex items-center gap-1.5 rounded-md bg-ocean-accent px-4 py-1.5 text-sm font-medium text-ocean-bg transition-colors hover:bg-ocean-accent-2 disabled:opacity-50"
              >
                <Clapperboard size={14} /> Export
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
