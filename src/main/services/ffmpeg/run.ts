/**
 * Thin promise wrapper around spawning ffmpeg/ffprobe processes, with a
 * streaming stderr callback (ffmpeg reports progress on stderr) and abort
 * support for cancellable exports.
 */

import { spawn } from 'node:child_process'

export interface RunOptions {
  /** called with each chunk of stderr (ffmpeg progress lives here) */
  onStderr?: (chunk: string) => void
  onStdout?: (chunk: string) => void
  signal?: AbortSignal
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

export function run(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''

    const onAbort = (): void => {
      child.kill('SIGKILL')
    }
    if (opts.signal) {
      if (opts.signal.aborted) {
        child.kill('SIGKILL')
        reject(new Error('aborted'))
        return
      }
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString()
      stdout += s
      opts.onStdout?.(s)
    })
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      stderr += s
      opts.onStderr?.(s)
    })
    child.on('error', (err) => {
      opts.signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ code, stdout, stderr })
    })
  })
}

/** Run and reject on non-zero exit, returning combined output. */
export async function runChecked(
  bin: string,
  args: string[],
  opts: RunOptions = {}
): Promise<RunResult> {
  const res = await run(bin, args, opts)
  if (res.code !== 0) {
    throw new Error(`${bin} exited ${res.code}\n${res.stderr.slice(-2000)}`)
  }
  return res
}
