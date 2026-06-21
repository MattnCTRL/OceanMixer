/**
 * Resolves the bundled FFmpeg/FFprobe binary paths.
 *
 * ffmpeg-static / ffprobe-static ship platform binaries inside node_modules.
 * When the app is packaged into app.asar these must be unpacked, so we rewrite
 * the path to app.asar.unpacked (electron-builder is configured to unpack them).
 */

import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

function unpacked(p: string): string {
  return p.includes('app.asar') ? p.replace('app.asar', 'app.asar.unpacked') : p
}

const rawFfmpeg = (ffmpegStatic as unknown as string | null) ?? 'ffmpeg'
const rawFfprobe =
  (ffprobeStatic as unknown as { path?: string } | null)?.path ?? 'ffprobe'

export const ffmpegPath = unpacked(rawFfmpeg)
export const ffprobePath = unpacked(rawFfprobe)
