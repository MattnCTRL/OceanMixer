import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Square, Loader2, X, CircleDot, Info, Settings2, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import { useProjectStore } from '@renderer/store/projectStore'
import { useUIStore } from '@renderer/store/uiStore'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import type { EditOp } from '@shared/ai-ops'

const BLACKHOLE_URL = 'https://existential.audio/blackhole/'

/** Number of bars in the EQ meter. */
const BAR_COUNT = 28
/** Instantaneous RMS above which we consider the input to be carrying audio. */
const SIGNAL_LEVEL = 0.012
/** Session peak below which a finished recording is treated as silent. */
const SILENCE_PEAK = 0.012
/** How long (ms) to keep showing "receiving audio" after the last signal. */
const SIGNAL_HOLD_MS = 700

/** Names that indicate a loopback/aggregate device suitable for system audio. */
function isLoopback(label: string): boolean {
  return /blackhole|loopback|aggregate|soundflower|virtual/i.test(label)
}

/**
 * Choose a sensible default input. We deliberately DON'T auto-pick a loopback
 * device: an unrouted loopback (e.g. BlackHole with nothing sent to it) records
 * pure silence. Prefer the OS default input, then any real (non-loopback) mic,
 * and only fall back to whatever is first.
 */
function pickDefaultDevice(inputs: MediaDeviceInfo[]): MediaDeviceInfo | undefined {
  const osDefault = inputs.find((d) => d.deviceId === 'default')
  if (osDefault) return osDefault
  const real = inputs.find((d) => !isLoopback(d.label))
  return real ?? inputs[0]
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

type Phase = 'init' | 'ready' | 'denied' | 'recording' | 'saving' | 'silent'

export function AudioRecorder(): JSX.Element | null {
  const open = useUIStore((s) => s.recorderOpen)
  const close = useUIStore((s) => s.closeRecorder)
  const openAudioSetup = useUIStore((s) => s.openAudioSetup)
  const [phase, setPhase] = useState<Phase>('init')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>('')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [hasSignal, setHasSignal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [placeOnTimeline, setPlaceOnTimeline] = useState(true)

  const streamRef = useRef<MediaStream | null>(null)
  const monitorDeviceRef = useRef<string>('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const timeRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const rafRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef(0)
  const recordedDurationRef = useRef(0)
  const sessionPeakRef = useRef(0)
  const lastSignalAtRef = useRef(0)
  const lastUiPushRef = useRef(0)
  const recordingRef = useRef(false)
  const eqCanvasRef = useRef<HTMLCanvasElement>(null)
  const mimeRef = useRef(pickMimeType())
  const pendingSaveRef = useRef<{ buf: Uint8Array; ext: string; durationSec: number } | null>(null)

  /* ------------------------------------------------------------ EQ rendering */
  const drawEq = useCallback((freq: Uint8Array): void => {
    const canvas = eqCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)

    const n = BAR_COUNT
    const gap = 3
    const bw = (W - gap * (n - 1)) / n
    const nbins = freq.length
    const minBin = 1
    const maxBin = Math.max(minBin + n, Math.floor(nbins * 0.7))

    for (let i = 0; i < n; i++) {
      const b0 = Math.floor(minBin * Math.pow(maxBin / minBin, i / n))
      const b1 = Math.max(b0 + 1, Math.floor(minBin * Math.pow(maxBin / minBin, (i + 1) / n)))
      let m = 0
      for (let b = b0; b < b1 && b < nbins; b++) if (freq[b] > m) m = freq[b]
      const v = m / 255
      const barH = Math.max(2, v * H)
      const x = i * (bw + gap)
      const y = H - barH
      const col = v > 0.85 ? '#e5484d' : v > 0.5 ? '#3fa7ff' : '#6c5cff'
      ctx.fillStyle = col
      const r = Math.min(bw / 2, 2)
      ctx.beginPath()
      ctx.roundRect(x, y, bw, barH, r)
      ctx.fill()
    }
  }, [])

  const cancelMeter = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  const meterTick = useCallback((): void => {
    const analyser = analyserRef.current
    const freq = freqRef.current
    const time = timeRef.current
    if (!analyser || !freq || !time) return

    analyser.getByteFrequencyData(freq)
    analyser.getByteTimeDomainData(time)

    let sum = 0
    for (let i = 0; i < time.length; i++) {
      const d = (time[i] - 128) / 128
      sum += d * d
    }
    const rms = Math.sqrt(sum / time.length)

    drawEq(freq)

    const now = performance.now()
    if (rms > SIGNAL_LEVEL) lastSignalAtRef.current = now
    if (recordingRef.current && rms > sessionPeakRef.current) sessionPeakRef.current = rms

    // Throttle React state updates so we don't re-render 60×/s.
    if (now - lastUiPushRef.current > 110) {
      lastUiPushRef.current = now
      setLevel(Math.min(1, rms * 3))
      setHasSignal(now - lastSignalAtRef.current < SIGNAL_HOLD_MS)
    }

    rafRef.current = requestAnimationFrame(meterTick)
  }, [drawEq])

  /* ------------------------------------------------- monitor stream lifecycle */
  const stopStream = useCallback(() => {
    cancelMeter()
    analyserRef.current = null
    freqRef.current = null
    timeRef.current = null
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined)
      audioCtxRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    monitorDeviceRef.current = ''
  }, [cancelMeter])

  /** Open (or switch to) a live monitoring stream for `id` and start the meter. */
  const ensureMonitor = useCallback(
    async (id: string): Promise<MediaStream> => {
      if (streamRef.current && monitorDeviceRef.current === id) return streamRef.current
      stopStream()

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: id ? { exact: id } : undefined,
          // Disable processing so music is captured faithfully.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })
      streamRef.current = stream
      monitorDeviceRef.current = id

      const Ctx: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      audioCtxRef.current = ctx
      void ctx.resume().catch(() => undefined)
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.75
      source.connect(analyser) // NB: not connected to destination — no feedback.
      analyserRef.current = analyser
      freqRef.current = new Uint8Array(analyser.frequencyBinCount)
      timeRef.current = new Uint8Array(analyser.fftSize)

      lastSignalAtRef.current = 0
      cancelMeter()
      rafRef.current = requestAnimationFrame(meterTick)
      return stream
    },
    [stopStream, cancelMeter, meterTick]
  )

  const teardown = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    recordingRef.current = false
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop()
      } catch {
        /* ignore */
      }
    }
    recorderRef.current = null
    stopStream()
  }, [stopStream])

  /* Request permission + enumerate input devices on open. */
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPhase('init')
    setError(null)
    setElapsed(0)
    setLevel(0)
    setHasSignal(false)
    pendingSaveRef.current = null
    ;(async () => {
      try {
        // Unlocks device labels and triggers the OS mic prompt.
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
        probe.getTracks().forEach((t) => t.stop())
        const all = await navigator.mediaDevices.enumerateDevices()
        if (cancelled) return
        const inputs = all.filter((d) => d.kind === 'audioinput')
        setDevices(inputs)
        setDeviceId(pickDefaultDevice(inputs)?.deviceId ?? '')
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

  /* Start / switch live monitoring whenever the selected device changes while
     the dialog is idle. Recording reuses the already-open monitor stream. */
  useEffect(() => {
    if (!open) return
    if (phase !== 'ready') return
    if (!deviceId) return
    ensureMonitor(deviceId).catch((err) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }, [open, phase, deviceId, ensureMonitor])

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

  /* -------------------------------------------------------------- persistence */
  const persist = useCallback(
    async (buf: Uint8Array, ext: string, durationSec: number): Promise<void> => {
      setPhase('saving')
      try {
        const stamp = fmt(durationSec)
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
        setPhase('ready')
      }
    },
    [placeOnTimeline, close, teardown]
  )

  /* Build the blob from captured chunks and either save it or, if it looks
     silent, route to a confirmation step. Held in a ref so the recorder's
     onstop handler always calls the latest closure. */
  const decideRef = useRef<() => Promise<void>>()
  decideRef.current = async (): Promise<void> => {
    try {
      const { ext, mimeType } = mimeRef.current
      const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
      const buf = new Uint8Array(await blob.arrayBuffer())
      if (buf.length === 0) throw new Error('Empty recording')
      const durationSec = recordedDurationRef.current

      if (sessionPeakRef.current < SILENCE_PEAK) {
        pendingSaveRef.current = { buf, ext, durationSec }
        setPhase('silent')
        return
      }
      await persist(buf, ext, durationSec)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('ready')
    }
  }

  const startRecording = useCallback(async () => {
    setError(null)
    try {
      const stream = await ensureMonitor(deviceId)

      const { mimeType } = mimeRef.current
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      chunksRef.current = []
      sessionPeakRef.current = 0
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => void decideRef.current?.()
      recorder.start()
      recorderRef.current = recorder
      recordingRef.current = true

      startedAtRef.current = performance.now()
      setElapsed(0)
      timerRef.current = setInterval(() => {
        setElapsed((performance.now() - startedAtRef.current) / 1000)
      }, 200)
      setPhase('recording')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase('ready')
    }
  }, [deviceId, ensureMonitor])

  const stopRecording = useCallback(() => {
    recordedDurationRef.current = (performance.now() - startedAtRef.current) / 1000
    recordingRef.current = false
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    const r = recorderRef.current
    if (r && r.state !== 'inactive') {
      r.stop() // triggers onstop -> decideRef.current()
    }
  }, [])

  const discardSilent = useCallback(() => {
    pendingSaveRef.current = null
    sessionPeakRef.current = 0
    setPhase('ready')
  }, [])

  const saveSilentAnyway = useCallback(() => {
    const p = pendingSaveRef.current
    if (!p) {
      setPhase('ready')
      return
    }
    pendingSaveRef.current = null
    void persist(p.buf, p.ext, p.durationSec)
  }, [persist])

  if (!open) return null

  const recording = phase === 'recording'
  const saving = phase === 'saving'
  const silent = phase === 'silent'
  const selectedLabel = devices.find((d) => d.deviceId === deviceId)?.label ?? ''
  const selectedIsLoopback = isLoopback(selectedLabel)
  const monitoring = phase === 'ready' || phase === 'recording'

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

          {silent && (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 rounded-md border border-ocean-danger/40 bg-ocean-danger/10 px-3 py-3 text-sm leading-relaxed text-ocean-text">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ocean-danger" />
                <span>
                  We didn&apos;t detect any sound in that recording — it looks
                  silent. This usually means the wrong input was selected (for
                  example a loopback device like BlackHole with nothing routed to
                  it). Check the input meter reacts before recording again.
                </span>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={saveSilentAnyway}
                  className="rounded-md border border-ocean-border px-3 py-2 text-sm font-medium text-ocean-muted transition-colors hover:bg-ocean-panel-2 hover:text-ocean-text"
                >
                  Save anyway
                </button>
                <button
                  type="button"
                  onClick={discardSilent}
                  className="rounded-md bg-ocean-accent px-3 py-2 text-sm font-semibold text-ocean-bg transition-opacity hover:opacity-90"
                >
                  Discard &amp; try again
                </button>
              </div>
            </div>
          )}

          {phase !== 'init' && phase !== 'denied' && !silent && (
            <>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-ocean-muted">Input device</label>
                <Tooltip
                  label="Input device"
                  description="Pick your microphone for live audio, or a loopback device (e.g. BlackHole) to record music playing on your Mac. Watch the meter below to confirm it's picking up sound."
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
                        {isLoopback(d.label) ? '  · loopback (system audio)' : ''}
                      </option>
                    ))}
                  </select>
                </Tooltip>
              </div>

              {/* Live EQ / input meter — runs before and during recording so you
                  can confirm audio is being picked up. */}
              <div className="space-y-1.5">
                <div className="rounded-md border border-ocean-border bg-ocean-bg p-2">
                  <canvas
                    ref={eqCanvasRef}
                    width={600}
                    height={72}
                    className="block h-16 w-full"
                    aria-hidden="true"
                  />
                  {/* Peak level */}
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-ocean-panel-2">
                    <div
                      className={clsx(
                        'h-full rounded-full transition-[width] duration-75',
                        level > 0.85 ? 'bg-ocean-danger' : 'bg-ocean-ok'
                      )}
                      style={{ width: `${Math.round(level * 100)}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs tabular-nums">
                  <span
                    className={clsx(
                      'inline-flex items-center gap-1.5 font-medium',
                      monitoring && hasSignal
                        ? 'text-ocean-ok'
                        : monitoring
                          ? 'text-ocean-danger'
                          : 'text-ocean-muted'
                    )}
                  >
                    <span
                      className={clsx(
                        'h-2 w-2 rounded-full',
                        monitoring && hasSignal
                          ? 'bg-ocean-ok'
                          : monitoring
                            ? 'bg-ocean-danger'
                            : 'bg-ocean-muted'
                      )}
                    />
                    {!monitoring
                      ? 'Input level'
                      : hasSignal
                        ? recording
                          ? 'Recording · receiving audio'
                          : 'Receiving audio'
                        : recording
                          ? 'Recording · no signal'
                          : 'No signal detected'}
                  </span>
                  <span className="inline-flex items-center gap-1 text-ocean-muted">
                    {recording && <CircleDot className="h-3 w-3 animate-pulse text-ocean-danger" />}
                    {fmt(elapsed)}
                  </span>
                </div>

                {monitoring && !hasSignal && selectedIsLoopback && (
                  <p className="text-xs leading-relaxed text-ocean-muted">
                    This is a loopback device. Route your Mac&apos;s output to it
                    (see “Set up audio” below), or pick your microphone above.
                  </p>
                )}
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

              {!selectedIsLoopback && (
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
