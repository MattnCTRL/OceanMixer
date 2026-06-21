/**
 * Media probing, thumbnails, and waveforms via the bundled FFmpeg/FFprobe.
 *
 * Importing media into OceanMixer runs ffprobe to learn each file's shape
 * (type, duration, dimensions, codecs, audio), then generates a small poster
 * thumbnail (data URL, embedded directly in the MediaAsset so the library grid
 * needs no extra I/O). Waveforms are rendered lazily to PNGs cached on disk and
 * referenced by absolute path.
 *
 * All heavy work tolerates per-file failure: a bad/unsupported file is skipped
 * with a warning rather than failing the whole import batch.
 */

import { ipcMain } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

import { ffmpegPath, ffprobePath } from './ffmpeg/binaries'
import { run, runChecked } from './ffmpeg/run'
import { getCacheDir } from './settings'
import type { MediaAsset, MediaType } from '@shared/types'
import { newId } from '@shared/project-utils'
import { IPC } from '@shared/ipc'

/* --------------------------------------------------------------- ffprobe types */

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  sample_rate?: string
  channels?: number
  duration?: string
  disposition?: Record<string, number>
}

interface FfprobeFormat {
  duration?: string
  size?: string
  format_name?: string
  nb_streams?: number
}

interface FfprobeResult {
  streams?: FfprobeStream[]
  format?: FfprobeFormat
}

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.heic',
  '.heif',
  '.tiff',
  '.tif'
])

/** ffprobe `format_name`s that denote a single still image rather than a video. */
const IMAGE_FORMAT_NAMES = new Set([
  'png_pipe',
  'image2',
  'jpeg_pipe',
  'mjpeg',
  'webp_pipe',
  'bmp_pipe',
  'gif',
  'tiff_pipe'
])

/* -------------------------------------------------------------------- helpers */

function isImagePath(p: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(p).toLowerCase())
}

/** Parse an ffprobe rational like "30000/1001" into a number, undefined if invalid. */
function parseRational(value: string | undefined): number | undefined {
  if (!value) return undefined
  const [numStr, denStr] = value.split('/')
  const num = Number(numStr)
  const den = denStr === undefined ? 1 : Number(denStr)
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return undefined
  const fps = num / den
  return Number.isFinite(fps) && fps > 0 ? fps : undefined
}

function safeParseFloat(value: string | undefined): number {
  if (value === undefined) return 0
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

function fileSize(p: string, fromFormat: string | undefined): number | undefined {
  if (fromFormat !== undefined) {
    const n = parseInt(fromFormat, 10)
    if (Number.isFinite(n) && n >= 0) return n
  }
  try {
    return fs.statSync(p).size
  } catch {
    return undefined
  }
}

/** Determine a media kind from probe data + the file extension. */
function classify(
  probe: FfprobeResult,
  filePath: string
): { type: MediaType; videoStream?: FfprobeStream; audioStream?: FfprobeStream } {
  const streams = probe.streams ?? []
  const videoStream = streams.find((s) => s.codec_type === 'video')
  const audioStream = streams.find((s) => s.codec_type === 'audio')

  const formatName = probe.format?.format_name ?? ''
  const formatIsImage = formatName
    .split(',')
    .some((name) => IMAGE_FORMAT_NAMES.has(name.trim()))

  // An image either matches by extension or ffprobe reports an image container.
  // A still has a video stream but zero/NaN duration and no audio.
  const durationSec = safeParseFloat(probe.format?.duration)
  const looksLikeStill =
    !!videoStream && !audioStream && (durationSec === 0 || formatIsImage)

  if (isImagePath(filePath) || (formatIsImage && !audioStream) || (looksLikeStill && isStillExt(filePath))) {
    return { type: 'image', videoStream, audioStream }
  }

  if (videoStream) {
    return { type: 'video', videoStream, audioStream }
  }

  return { type: 'audio', videoStream: undefined, audioStream }
}

function isStillExt(p: string): boolean {
  // GIFs and some webp can be animated; treat by extension as image only when
  // the extension is clearly a still format.
  const ext = path.extname(p).toLowerCase()
  return ext !== '.gif' && IMAGE_EXTENSIONS.has(ext)
}

/* ----------------------------------------------------------------- cache dir */

function cacheDirEnsured(): string {
  const dir = getCacheDir()
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    // best-effort; downstream writes will surface real errors
  }
  return dir
}

function hashPath(p: string): string {
  return crypto.createHash('sha1').update(p).digest('hex').slice(0, 16)
}

/* --------------------------------------------------------------------- probe */

/**
 * Probe a list of absolute media paths into MediaAssets.
 * Per-file failures are logged and skipped; the batch never throws.
 */
export async function probePaths(paths: string[]): Promise<MediaAsset[]> {
  const assets: MediaAsset[] = []

  for (const filePath of paths) {
    try {
      const asset = await probeOne(filePath)
      if (asset) assets.push(asset)
    } catch (err) {
      console.warn(`[media] failed to probe "${filePath}":`, (err as Error).message)
    }
  }

  return assets
}

async function probeOne(filePath: string): Promise<MediaAsset | undefined> {
  const res = await runChecked(ffprobePath, [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath
  ])

  let probe: FfprobeResult
  try {
    probe = JSON.parse(res.stdout) as FfprobeResult
  } catch (err) {
    throw new Error(`unparseable ffprobe output: ${(err as Error).message}`)
  }

  const { type, videoStream, audioStream } = classify(probe, filePath)

  const durationSec = type === 'image' ? 0 : safeParseFloat(probe.format?.duration)
  const fps =
    type === 'image'
      ? undefined
      : parseRational(videoStream?.avg_frame_rate) ?? parseRational(videoStream?.r_frame_rate)

  const sampleRate = audioStream?.sample_rate ? Number(audioStream.sample_rate) : undefined

  const asset: MediaAsset = {
    id: newId('asset'),
    path: filePath,
    name: path.basename(filePath),
    type,
    durationSec,
    width: videoStream?.width,
    height: videoStream?.height,
    fps,
    hasAudio: !!audioStream,
    sampleRate: Number.isFinite(sampleRate) ? sampleRate : undefined,
    channels: audioStream?.channels,
    videoCodec: videoStream?.codec_name,
    audioCodec: audioStream?.codec_name,
    sizeBytes: fileSize(filePath, probe.format?.size),
    importedAt: Date.now()
  }

  // Poster thumbnail (best-effort: a probe success shouldn't be lost over a
  // failed thumbnail).
  try {
    const thumb = await generateThumbnailDataUrl(filePath, pickThumbTime(asset), type)
    if (thumb) asset.thumbnailDataUrl = thumb
  } catch (err) {
    console.warn(`[media] thumbnail failed for "${filePath}":`, (err as Error).message)
  }

  return asset
}

/** Choose a sensible frame time for the poster thumbnail. */
function pickThumbTime(asset: MediaAsset): number {
  if (asset.type !== 'video' || asset.durationSec <= 0) return 0
  // a little in from the start, but never past the end
  return Math.min(1, asset.durationSec / 2)
}

/* ----------------------------------------------------------------- thumbnail */

/**
 * Extract a single frame at `atSec` and return it as a base64 JPEG data URL.
 * Returns '' for audio-only media (no visual frame to show).
 */
export async function generateThumbnailDataUrl(
  assetPath: string,
  atSec: number,
  knownType?: MediaType
): Promise<string> {
  const type = knownType ?? (isImagePath(assetPath) ? 'image' : undefined)
  if (type === 'audio') return ''

  const dir = cacheDirEnsured()
  const seek = Number.isFinite(atSec) && atSec > 0 ? atSec : 0
  const outJpg = path.join(dir, `thumb_${hashPath(assetPath)}_${Math.round(seek * 1000)}.jpg`)

  // -ss before -i for fast seek; for images seek is ignored harmlessly.
  const args = [
    '-y',
    '-ss',
    String(seek),
    '-i',
    assetPath,
    '-frames:v',
    '1',
    '-vf',
    'scale=320:-1:flags=bilinear',
    '-q:v',
    '4',
    outJpg
  ]

  try {
    const result = await run(ffmpegPath, args)
    if (result.code !== 0 || !fs.existsSync(outJpg)) {
      // audio-only files reach here (no video stream to grab) -> no thumbnail
      return ''
    }
    const buf = fs.readFileSync(outJpg)
    if (buf.length === 0) return ''
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  } finally {
    safeUnlink(outJpg)
  }
}

/* ------------------------------------------------------------------ waveform */

/**
 * Render a waveform PNG for an audio/video file and return its absolute path.
 * Cached by a hash of the source path so repeated calls reuse the PNG.
 * Returns '' if the file has no audio stream or rendering fails.
 */
export async function generateWaveformPng(assetPath: string): Promise<string> {
  const dir = cacheDirEnsured()
  const outPng = path.join(dir, `wave_${hashPath(assetPath)}.png`)

  // Reuse a previously rendered, non-empty waveform.
  try {
    const stat = fs.statSync(outPng)
    if (stat.size > 0) return outPng
  } catch {
    // not cached yet
  }

  const args = [
    '-y',
    '-i',
    assetPath,
    '-filter_complex',
    'showwavespic=s=600x80:colors=#5a4a8a',
    '-frames:v',
    '1',
    outPng
  ]

  try {
    const result = await run(ffmpegPath, args)
    if (result.code !== 0 || !fs.existsSync(outPng) || fs.statSync(outPng).size === 0) {
      // No audio stream (or filter failed): nothing to show.
      safeUnlink(outPng)
      return ''
    }
    return outPng
  } catch (err) {
    console.warn(`[media] waveform failed for "${assetPath}":`, (err as Error).message)
    safeUnlink(outPng)
    return ''
  }
}

function safeUnlink(p: string): void {
  try {
    fs.unlinkSync(p)
  } catch {
    // file may not exist; ignore
  }
}

/* ----------------------------------------------------------------- handlers */

export function registerMediaHandlers(): void {
  ipcMain.handle(IPC.mediaProbe, async (_e, paths: string[]): Promise<MediaAsset[]> => {
    if (!Array.isArray(paths)) return []
    return probePaths(paths)
  })

  ipcMain.handle(
    IPC.mediaThumbnail,
    async (_e, assetPath: string, atSec: number): Promise<string> => {
      return generateThumbnailDataUrl(assetPath, atSec)
    }
  )

  ipcMain.handle(IPC.mediaWaveform, async (_e, assetPath: string): Promise<string> => {
    return generateWaveformPng(assetPath)
  })
}
