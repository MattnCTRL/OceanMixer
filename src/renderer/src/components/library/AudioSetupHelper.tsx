/**
 * AudioSetupHelper — a guided modal for recording system audio on macOS.
 *
 * Many sources (e.g. Apple Music) are DRM-protected and can't be exported as a
 * file, so the only way to capture them is to route system audio through a
 * virtual "loopback" device (BlackHole) and record that. This walks the user
 * through installing the loopback device, creating a Multi-Output Device so they
 * still hear the music, routing system output, and verifying a live signal.
 *
 * Reads its open flag + actions from useUIStore; takes no props. The integrator
 * mounts it unconditionally in App.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Circle, Mic, ExternalLink, Loader2, X, Activity } from 'lucide-react'
import clsx from 'clsx'
import { useUIStore } from '@renderer/store/uiStore'
import { LogoMark } from '@renderer/components/brand/Logo'
import { Tooltip } from '@renderer/components/ui/Tooltip'

const BLACKHOLE_URL = 'https://existential.audio/blackhole/'

const LOOPBACK_RE = /blackhole|loopback|aggregate|soundflower|virtual/i
const MULTI_OUT_RE = /multi-output|aggregate/i

type Probe = 'idle' | 'checking' | 'ready' | 'denied'
type TestState = 'idle' | 'testing' | 'signal' | 'nosignal' | 'error'

export function AudioSetupHelper(): JSX.Element | null {
  const open = useUIStore((s) => s.audioSetupOpen)
  const close = useUIStore((s) => s.closeAudioSetup)
  const openRecorder = useUIStore((s) => s.openRecorder)

  const [probe, setProbe] = useState<Probe>('idle')
  const [error, setError] = useState<string | null>(null)
  const [blackholeInput, setBlackholeInput] = useState<MediaDeviceInfo | null>(null)
  const [multiOutput, setMultiOutput] = useState<MediaDeviceInfo | null>(null)

  const [testState, setTestState] = useState<TestState>('idle')
  const [level, setLevel] = useState(0)
  const [peak, setPeak] = useState(0)

  // Live-test resources.
  const testStreamRef = useRef<MediaStream | null>(null)
  const testCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const testTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopTest = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (testTimerRef.current) clearTimeout(testTimerRef.current)
    testTimerRef.current = null
    if (testStreamRef.current) {
      testStreamRef.current.getTracks().forEach((t) => t.stop())
      testStreamRef.current = null
    }
    if (testCtxRef.current) {
      void testCtxRef.current.close().catch(() => undefined)
      testCtxRef.current = null
    }
  }, [])

  const recheck = useCallback(async () => {
    setProbe('checking')
    setError(null)
    try {
      // Unlock device labels (and trigger the OS prompt once).
      const probeStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      probeStream.getTracks().forEach((t) => t.stop())
      const all = await navigator.mediaDevices.enumerateDevices()
      const inputs = all.filter((d) => d.kind === 'audioinput')
      const outputs = all.filter((d) => d.kind === 'audiooutput')
      setBlackholeInput(inputs.find((d) => LOOPBACK_RE.test(d.label)) ?? null)
      setMultiOutput(outputs.find((d) => MULTI_OUT_RE.test(d.label)) ?? null)
      setProbe('ready')
    } catch (err) {
      setProbe('denied')
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  /* Probe on open; clean up on close/unmount. */
  useEffect(() => {
    if (!open) return
    setTestState('idle')
    setLevel(0)
    setPeak(0)
    void recheck()
    return () => {
      stopTest()
    }
  }, [open, recheck, stopTest])

  /* Close on Escape. */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  const runTest = useCallback(async () => {
    stopTest()
    setError(null)
    setLevel(0)
    setPeak(0)
    setTestState('testing')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: blackholeInput ? { exact: blackholeInput.deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })
      testStreamRef.current = stream

      const Ctx: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      testCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      const data = new Uint8Array(analyser.fftSize)

      let localPeak = 0
      const tick = (): void => {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.min(1, Math.sqrt(sum / data.length) * 2.2)
        setLevel(rms)
        if (rms > localPeak) {
          localPeak = rms
          setPeak(rms)
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)

      testTimerRef.current = setTimeout(() => {
        const THRESHOLD = 0.04
        setTestState(localPeak > THRESHOLD ? 'signal' : 'nosignal')
        stopTest()
        setLevel(0)
      }, 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setTestState('error')
      stopTest()
    }
  }, [blackholeInput, stopTest])

  if (!open) return null

  const testing = testState === 'testing'

  const StatusIcon = ({ done }: { done: boolean }): JSX.Element =>
    done ? (
      <Check className="h-4 w-4 shrink-0 text-ocean-ok" />
    ) : (
      <Circle className="h-4 w-4 shrink-0 text-ocean-muted" />
    )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Audio setup"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-ocean-border bg-ocean-panel shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ocean-border px-5 py-4">
          <h2 className="inline-flex items-center gap-2 text-base font-semibold text-ocean-text">
            <LogoMark size={18} />
            Set up system-audio recording
          </h2>
          <Tooltip label="Close" keys="Esc" side="bottom">
            <button
              type="button"
              onClick={close}
              className="rounded-md p-1 text-ocean-muted transition-colors hover:bg-ocean-panel-2 hover:text-ocean-text"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <p className="text-sm leading-relaxed text-ocean-muted">
            To record audio playing on your Mac — like Apple Music, which is DRM-protected
            and can&apos;t be exported as a file — route your system audio through a virtual
            loopback device and record that. Follow these steps once.
          </p>

          {probe === 'denied' && (
            <p className="rounded-md border border-ocean-danger/40 bg-ocean-danger/10 px-3 py-2 text-sm text-ocean-danger">
              Microphone access was denied. Enable it for OceanMixer in System Settings →
              Privacy &amp; Security → Microphone, then click Re-check.
            </p>
          )}

          {/* Step 1 — loopback device */}
          <div className="rounded-lg border border-ocean-border bg-ocean-bg p-3.5">
            <div className="flex items-start gap-2.5">
              <StatusIcon done={!!blackholeInput} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ocean-text">
                  1. Loopback device installed
                </p>
                {blackholeInput ? (
                  <p className="mt-0.5 text-xs text-ocean-ok">
                    Found “{blackholeInput.label}”.
                  </p>
                ) : (
                  <>
                    <p className="mt-0.5 text-xs leading-relaxed text-ocean-muted">
                      Install BlackHole (free, open-source). After installing you may need
                      to log out and back in, then click Re-check below.
                    </p>
                    <Tooltip
                      label="Open existential.audio/blackhole"
                      description="Free loopback audio driver download."
                      side="bottom"
                    >
                      <button
                        type="button"
                        onClick={() => void window.api.app.openExternal(BLACKHOLE_URL)}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-ocean-border bg-ocean-panel-2 px-2.5 py-1.5 text-xs font-medium text-ocean-text transition-colors hover:border-ocean-accent"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Get BlackHole
                      </button>
                    </Tooltip>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Step 2 — Multi-Output Device */}
          <div className="rounded-lg border border-ocean-border bg-ocean-bg p-3.5">
            <div className="flex items-start gap-2.5">
              <StatusIcon done={!!multiOutput} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ocean-text">
                  2. Multi-Output Device created
                </p>
                <p className="mt-0.5 text-xs text-ocean-muted">
                  So you still hear the music while it&apos;s being recorded.
                </p>
                {multiOutput ? (
                  <p className="mt-0.5 text-xs text-ocean-ok">
                    Found “{multiOutput.label}”.
                  </p>
                ) : (
                  <>
                    <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-ocean-muted">
                      <li>Open Audio MIDI Setup.</li>
                      <li>
                        Click the <span className="text-ocean-text">+</span> (bottom-left) →{' '}
                        <span className="text-ocean-text">Create Multi-Output Device</span>.
                      </li>
                      <li>
                        Check both your speakers/headphones <em>and</em> BlackHole.
                      </li>
                      <li>
                        Enable <span className="text-ocean-text">Drift Correction</span> on the
                        BlackHole row.
                      </li>
                    </ol>
                    <Tooltip
                      label="Open Audio MIDI Setup"
                      description="macOS utility for creating the Multi-Output Device."
                      side="bottom"
                    >
                      <button
                        type="button"
                        onClick={() => void window.api.app.openAudioMidiSetup()}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-ocean-border bg-ocean-panel-2 px-2.5 py-1.5 text-xs font-medium text-ocean-text transition-colors hover:border-ocean-accent"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open Audio MIDI Setup
                      </button>
                    </Tooltip>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Step 3 — set system output */}
          <div className="rounded-lg border border-ocean-border bg-ocean-bg p-3.5">
            <div className="flex items-start gap-2.5">
              <Circle className="h-4 w-4 shrink-0 text-ocean-muted" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ocean-text">
                  3. Set the Multi-Output Device as system output
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-ocean-muted">
                  System Settings → Sound → Output → select your Multi-Output Device, then
                  start playing your music.
                </p>
              </div>
            </div>
          </div>

          {/* Step 4 — test input */}
          <div className="rounded-lg border border-ocean-border bg-ocean-bg p-3.5">
            <div className="flex items-start gap-2.5">
              {testState === 'signal' ? (
                <Check className="h-4 w-4 shrink-0 text-ocean-ok" />
              ) : (
                <Activity className="h-4 w-4 shrink-0 text-ocean-accent" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ocean-text">4. Test the input level</p>
                <p className="mt-0.5 text-xs leading-relaxed text-ocean-muted">
                  With music playing and routed to the loopback device, run a 5-second meter
                  on{' '}
                  <span className="text-ocean-text">
                    {blackholeInput ? blackholeInput.label : 'the default input'}
                  </span>
                  .
                </p>

                {/* Live meter */}
                <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-ocean-panel">
                  <div
                    className={clsx(
                      'h-full rounded-full transition-[width] duration-75',
                      level > 0.85 ? 'bg-ocean-danger' : 'bg-ocean-ok'
                    )}
                    style={{ width: `${Math.round(level * 100)}%` }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-ocean-muted">
                  <span>{testing ? 'Listening…' : 'Input level'}</span>
                  <span>peak {Math.round(peak * 100)}%</span>
                </div>

                <Tooltip
                  label="Test input level"
                  description="Records ~5s from the loopback device and checks for a signal."
                  side="bottom"
                >
                  <button
                    type="button"
                    onClick={() => void runTest()}
                    disabled={testing || probe !== 'ready'}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-ocean-border bg-ocean-panel-2 px-2.5 py-1.5 text-xs font-medium text-ocean-text transition-colors hover:border-ocean-accent disabled:opacity-50"
                  >
                    {testing ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Testing…
                      </>
                    ) : (
                      <>
                        <Activity className="h-3.5 w-3.5" />
                        Test input level (5s)
                      </>
                    )}
                  </button>
                </Tooltip>

                {testState === 'signal' && (
                  <p className="mt-2 text-xs font-medium text-ocean-ok">
                    Signal detected — you&apos;re ready to record.
                  </p>
                )}
                {testState === 'nosignal' && (
                  <p className="mt-2 text-xs font-medium text-ocean-danger">
                    No signal — is music playing and routed to the loopback device?
                  </p>
                )}
                {testState === 'error' && error && (
                  <p className="mt-2 text-xs font-medium text-ocean-danger">{error}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-ocean-border px-5 py-3">
          <Tooltip
            label="Re-check devices"
            description="Re-scan for the loopback and Multi-Output devices."
            side="top"
          >
            <button
              type="button"
              onClick={() => void recheck()}
              disabled={probe === 'checking'}
              className="inline-flex items-center gap-1.5 rounded-md border border-ocean-border bg-ocean-panel-2 px-3 py-2 text-sm font-medium text-ocean-text transition-colors hover:border-ocean-accent disabled:opacity-50"
            >
              {probe === 'checking' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Circle className="h-4 w-4" />
              )}
              Re-check
            </button>
          </Tooltip>

          <button
            type="button"
            onClick={() => {
              openRecorder()
              close()
            }}
            className="inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-ocean-accent to-ocean-accent-2 px-4 py-2 text-sm font-semibold text-ocean-bg transition-opacity hover:opacity-90"
          >
            <Mic className="h-4 w-4" />
            Open recorder
          </button>
        </div>
      </div>
    </div>
  )
}
