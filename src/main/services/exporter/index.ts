/**
 * Export IPC handlers.
 *
 * `IPC.exportStart` compiles a Project into an ffmpeg command (see
 * compiler.ts), spawns ffmpeg in the background, and streams
 * `ExportProgress` events to the renderer via `IPC.exportProgress`. The call
 * returns an `{ jobId }` immediately — it does NOT await the render.
 *
 * `IPC.exportCancel` aborts the running job by signalling its AbortController,
 * which kills the ffmpeg process (see services/ffmpeg/run.ts).
 */

import { BrowserWindow, ipcMain } from 'electron'
import type { Project } from '@shared/types'
import type { ExportOptions, ExportProgress } from '@shared/ipc'
import { IPC } from '@shared/ipc'
import { newId } from '@shared/project-utils'
import { ffmpegPath } from '../ffmpeg/binaries'
import { run } from '../ffmpeg/run'
import { buildExportCommand } from './compiler'

/** Active jobs keyed by jobId, holding the controller used to cancel them. */
const jobs = new Map<string, AbortController>()

/** Broadcast an export progress event to the renderer. */
function emit(progress: ExportProgress): void {
  const win = BrowserWindow.getAllWindows()[0]
  win?.webContents.send(IPC.exportProgress, progress)
}

/**
 * Parse the most recent processed time (seconds) out of an ffmpeg stderr chunk.
 * Supports both the `-progress pipe:2` key/value format (`out_time_ms=` in
 * microseconds, `out_time_us=`, or `out_time=HH:MM:SS.ms`) and the classic
 * stats line (`time=HH:MM:SS.ms`). Returns null when nothing parseable.
 */
function parseProgressSeconds(chunk: string): number | null {
  let seconds: number | null = null

  // out_time_us / out_time_ms are microseconds in -progress output (the key is
  // historically misnamed "ms" but carries microseconds).
  const usMatches = [...chunk.matchAll(/out_time_(?:ms|us)=(\d+)/g)]
  if (usMatches.length) {
    const last = usMatches[usMatches.length - 1]
    const us = Number(last[1])
    if (Number.isFinite(us)) seconds = us / 1_000_000
  }

  // out_time=HH:MM:SS.micros  or  time=HH:MM:SS.ms (fallback / overrides).
  const timeMatches = [
    ...chunk.matchAll(/(?:out_time|time)=(\d+):(\d+):(\d+(?:\.\d+)?)/g)
  ]
  if (timeMatches.length) {
    const m = timeMatches[timeMatches.length - 1]
    const h = Number(m[1])
    const min = Number(m[2])
    const s = Number(m[3])
    if (Number.isFinite(h) && Number.isFinite(min) && Number.isFinite(s)) {
      seconds = h * 3600 + min * 60 + s
    }
  }

  return seconds
}

/** Parse the current encoding fps from a stats line, if present. */
function parseFps(chunk: string): number | undefined {
  const m = [...chunk.matchAll(/(?:^|\s)fps=\s*(\d+(?:\.\d+)?)/g)]
  if (!m.length) return undefined
  const v = Number(m[m.length - 1][1])
  return Number.isFinite(v) && v > 0 ? v : undefined
}

/** Kick off an export. Returns the jobId immediately and renders in background. */
function startExport(project: Project, options: ExportOptions): { jobId: string } {
  const jobId = newId('job')
  const controller = new AbortController()
  jobs.set(jobId, controller)

  let args: string[]
  let totalDurationSec: number
  try {
    const built = buildExportCommand(project, options)
    args = built.args
    totalDurationSec = built.totalDurationSec
  } catch (err) {
    jobs.delete(jobId)
    // Defer so the caller receives { jobId } before the error event.
    setImmediate(() => {
      emit({
        jobId,
        percent: 0,
        stage: 'error',
        done: true,
        error: `Failed to build export command: ${(err as Error).message}`
      })
    })
    return { jobId }
  }

  emit({ jobId, percent: 0, stage: 'analyzing', done: false })

  // Run ffmpeg in the background; do not await.
  void run(ffmpegPath, args, {
    signal: controller.signal,
    onStderr: (chunk) => {
      const seconds = parseProgressSeconds(chunk)
      if (seconds === null) return
      const percent = Math.max(
        0,
        Math.min(99.5, (seconds / totalDurationSec) * 100)
      )
      const fps = parseFps(chunk)
      let etaSec: number | undefined
      if (fps && totalDurationSec > 0) {
        const remainingSec = Math.max(0, totalDurationSec - seconds)
        // crude ETA: remaining output time scaled by realtime factor unknown,
        // so just report remaining media seconds as a lower bound proxy.
        etaSec = remainingSec
      }
      emit({
        jobId,
        percent,
        stage: 'rendering',
        fps,
        etaSec,
        done: false
      })
    }
  })
    .then((res) => {
      jobs.delete(jobId)
      if (controller.signal.aborted) {
        emit({
          jobId,
          percent: 0,
          stage: 'error',
          done: true,
          error: 'Export cancelled'
        })
        return
      }
      if (res.code === 0) {
        emit({
          jobId,
          percent: 100,
          stage: 'done',
          done: true,
          outputPath: options.outputPath
        })
      } else {
        emit({
          jobId,
          percent: 0,
          stage: 'error',
          done: true,
          error: `ffmpeg exited ${res.code}\n${res.stderr.slice(-1500)}`
        })
      }
    })
    .catch((err) => {
      jobs.delete(jobId)
      const message = (err as Error).message ?? String(err)
      const cancelled = controller.signal.aborted || /aborted/i.test(message)
      emit({
        jobId,
        percent: 0,
        stage: 'error',
        done: true,
        error: cancelled ? 'Export cancelled' : message
      })
    })

  return { jobId }
}

/** Cancel a running export by jobId (no-op if it already finished). */
function cancelExport(jobId: string): void {
  const controller = jobs.get(jobId)
  if (!controller) return
  controller.abort()
  jobs.delete(jobId)
}

/** Register the export IPC handlers. Called once by the integrator. */
export function registerExportHandlers(): void {
  ipcMain.handle(
    IPC.exportStart,
    async (_e, project: Project, options: ExportOptions) => {
      return startExport(project, options)
    }
  )

  ipcMain.handle(IPC.exportCancel, async (_e, jobId: string) => {
    cancelExport(jobId)
  })
}
