import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Square, Loader2, X, CircleDot, Info, Settings2 } from 'lucide-react'
import clsx from 'clsx'
import { useProjectStore } from '@renderer/store/projectStore'
import { useUIStore } from '@renderer/store/uiStore'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import type { EditOp } from '@shared/ai-ops'

const BLACKHOLE_URL = 'https://existential.audio/blackhole/'

/** Names that indicate a loopback/aggregate device suitable for system audio. */
function isLoopback(label: string): boolean {
  return /blackhole|loopback|aggregate|soundflower|virtual/i.test(label)
}

function pickMimeType(): { mimeType: string; ext: string } {
  const candidates = [
    { mimeType: 'audio/webm;codecs=opus', ext: 'webm' },
    { mimeType: 'audio/webm', ext: 'webm' },
    { mimeType: 'audio/ogg;codecs=opus', ext: 'ogg' },
    { mimeType: 'audio/mp4', ext: 'm4a' }
  ]
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mimeType)) {
      return c
    }
  }
  return { mimeType: '', ext: 'webm' }
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

type Phase = 'init' | 'ready' | 'denied' | 'recording' | 'saving'

export function AudioRecorder(): JSX.Element | null {
  const open = useUIStore((s) => s.recorderOpen)
  const close = useUIStore((s) => s.closeRecorder)
  const openAudioSetup = useUIStore((s) => s.openAudioSetup)
  const [phase, setPhase] = useState<Phase>('init')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>('')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [placeOnTimeline, setPlaceOnTimeline] = useState(true)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef(0)
  const mimeRef = useRef(pickMimeType())

  const stopMeters = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  const teardown = useCallback(() => {
    stopMeters()
    recorderRef.current = null
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined)
      audioCtxRef.current = null
    }
  }, [stopMeters])

  /* Request permission + enumerate input devices on open. */
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPhase('init')
    setError(null)
    setElapsed(0)
    setLevel(0)
    ;(async () => {
      try {
        // Unlocks device labels and triggers the OS mic prompt.
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
        probe.getTracks().forEach((t) => t.stop())
        const all = await navigator.mediaDevices.enumerateDevices()
        if (cancelled) return
        const inputs = all.filter((d) => d.kind === 'audioinput')
        setDevices(inputs)
        // Prefer a loopback device if present (best for recording music).
        const preferred = inputs.find((d) => isLoopback(d.label)) ?? inputs[0]
        setDeviceId(preferred?.deviceId ?? '')
        setPhase('ready')
      } catch (err) {
        if (cancelled) return
        setPhase('denied')
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      teardown()
    }
  }, [open, teardown])

  /* Close on Escape (but never mid-recording/save). */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        const p = useUIStore.getState().recorderOpen
        if (p && phase !== 'recording' && phase !== 'saving') close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, phase, close])

  const startRecording = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          // Disable processing so music is captured faithfully.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })
      streamRef.current = stream

      // Level meter.
      const Ctx: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      const tick = (): void => {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 2.2))
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)

      // Recorder.
      const { mimeType } = mimeRef.current
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => void finalize()
      recorder.start()
      recorderRef.current = recorder

      startedAtRef.current = performance.now()
      setElapsed(0)
      timerRef.current = setInterval(() => {
        setElapsed((performance.now() - startedAtRef.current) / 1000)
      }, 200)
      setPhase('recording')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      teardown()
      setPhase('ready')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, teardown])

  const finalize = useCallback(async () => {
    setPhase('saving')
    stopMeters()
    try {
      const { ext } = mimeRef.current
      const blob = new Blob(chunksRef.current, {
        type: mimeRef.current.mimeType || 'audio/webm'
      })
      const buf = new Uint8Array(await blob.arrayBuffer())
      if (buf.length === 0) throw new Error('Empty recording')

      const stamp = fmt(elapsed)
      const asset = await window.api.media.saveRecording(buf, ext, `Recording ${stamp}`)

      const store = useProjectStore.getState()
      store.importAssets([asset])

      if (placeOnTimeline) {
        const audioTrack = store.project.tracks.find((t) => t.kind === 'audio')
        const start = store.playheadSec
        const ops: EditOp[] = audioTrack
          ? [{ op: 'addClip', trackId: audioTrack.id, assetId: asset.id, start }]
          : [
              { op: 'addTrack', kind: 'audio', name: 'Audio', ref: '$rec' },
              { op: 'addClip', trackId: '$rec', assetId: asset.id, start }
            ]
        store.apply(ops)
      }
      teardown()
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      teardown()
      setPhase('ready')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, placeOnTimeline, close, teardown, stopMeters])

  const stopRecording = useCallback(() => {
    const r = recorderRef.current
    if (r && r.state !== 'inactive') {
      r.stop() // triggers onstop -> finalize()
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
    }
  }, [])

  if (!open) return null

  const recording = phase === 'recording'
  const saving = phase === 'saving'
  const selectedLabel = devices.find((d) => d.deviceId === deviceId)?.label ?? ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !recording && !saving) close()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Record audio"
    >
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-ocean-border bg-ocean-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-ocean-border px-5 py-4">
          <h2 className="inline-flex items-center gap-2 text-base font-semibold text-ocean-text">
            <Mic className="h-4 w-4 text-ocean-accent" />
            Record audio
          </h2>
          <Tooltip label="Close" keys="Esc" side="bottom">
            <button
              type="button"
              onClick={close}
              disabled={recording || saving}
              className="rounded-md p-1 text-ocean-muted transition-colors hover:bg-ocean-panel-2 hover:text-ocean-text disabled:opacity-40"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>

        <div className="space-y-4 px-5 py-5">
          {phase === 'init' && (
            <div className="flex items-center gap-2 text-sm text-ocean-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Requesting microphone access…
            </div>
          )}

          {phase === 'denied' && (
            <p className="text-sm text-ocean-danger">
              Microphone access was denied. Enable it for OceanMixer in System
              Settings → Privacy &amp; Security → Microphone, then reopen this dialog.
            </p>
          )}

          {phase !== 'init' && phase !== 'denied' && (
            <>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-ocean-muted">Input device</label>
                <Tooltip
                  label="Input device"
                  description="Pick a loopback device (e.g. BlackHole) to record music playing on your Mac, or a mic for live audio."
                  className="w-full"
                  side="top"
                >
                  <select
                    value={deviceId}
                    onChange={(e) => setDeviceId(e.target.value)}
                    disabled={recording || saving}
                    className="w-full rounded-md border border-ocean-border bg-ocean-bg px-3 py-2 text-sm text-ocean-text outline-none focus:border-ocean-accent disabled:opacity-60"
                  >
                    {devices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || 'Microphone'}
                        {isLoopback(d.label) ? '  · good for music' : ''}
                      </option>
                    ))}
                  </select>
                </Tooltip>
              </div>

              {/* Level meter */}
              <div className="space-y-1">
                <div className="h-2 w-full overflow-hidden rounded-full bg-ocean-bg">
                  <div
                    className={clsx(
                      'h-full rounded-full transition-[width] duration-75',
                      level > 0.85 ? 'bg-ocean-danger' : 'bg-ocean-ok'
                    )}
                    style={{ width: `${Math.round(level * 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs tabular-nums text-ocean-muted">
                  <span>{recording ? 'Recording…' : 'Input level'}</span>
                  <span className="inline-flex items-center gap-1">
                    {recording && <CircleDot className="h-3 w-3 animate-pulse text-ocean-danger" />}
                    {fmt(elapsed)}
                  </span>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-ocean-text">
                <input
                  type="checkbox"
                  checked={placeOnTimeline}
                  onChange={(e) => setPlaceOnTimeline(e.target.checked)}
                  disabled={recording || saving}
                  className="accent-ocean-accent"
                />
                Add to the timeline at the playhead
              </label>

              <div className="flex justify-center pt-1">
                {recording ? (
                  <Tooltip label="Stop & save" description="End the recording and save it to your library.">
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="inline-flex items-center gap-2 rounded-full bg-ocean-danger px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                    >
                      <Square className="h-4 w-4" />
                      Stop &amp; save
                    </button>
                  </Tooltip>
                ) : (
                  <Tooltip
                    label="Start recording"
                    description="Capture audio from the selected input device."
                  >
                    <button
                      type="button"
                      onClick={() => void startRecording()}
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-full bg-ocean-accent px-5 py-2.5 text-sm font-semibold text-ocean-bg transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Saving…
                        </>
                      ) : (
                        <>
                          <Mic className="h-4 w-4" />
                          Start recording
                        </>
                      )}
                    </button>
                  </Tooltip>
                )}
              </div>

              {!isLoopback(selectedLabel) && (
                <div className="flex items-start gap-2 rounded-md border border-ocean-border bg-ocean-bg px-3 py-2.5 text-xs leading-relaxed text-ocean-muted">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ocean-accent-2" />
                  <span>
                    To record music playing on your Mac (e.g. Apple Music, which
                    can&apos;t be exported as a file), install a free loopback device,
                    route your system audio to it, and select it above. Otherwise this
                    records the chosen microphone.{' '}
                    <button
                      type="button"
                      onClick={() => void window.api.app.openExternal(BLACKHOLE_URL)}
                      className="font-medium text-ocean-accent-2 underline-offset-2 hover:underline"
                    >
                      Get BlackHole
                    </button>
                  </span>
                </div>
              )}
            </>
          )}

          {error && phase !== 'denied' && (
            <p className="text-xs font-medium text-ocean-danger">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-ocean-border px-5 py-3">
          <Tooltip
            label="Audio setup guide"
            description="Step-by-step help to capture system audio (Apple Music, etc.) via a loopback device."
            side="top"
          >
            <button
              type="button"
              onClick={() => {
                if (!recording && !saving) openAudioSetup()
              }}
              disabled={recording || saving}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-ocean-accent-2 underline-offset-2 transition-opacity hover:underline disabled:opacity-40"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Recording music? Set up audio →
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
