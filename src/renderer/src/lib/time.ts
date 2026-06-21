/** Time + formatting helpers shared across renderer panels. */

/** "1:23.4" style timecode for the transport/ruler. */
export function formatTimecode(sec: number, withFrames = false, fps = 30): string {
  const s = Math.max(0, sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const secs = Math.floor(s % 60)
  const frames = Math.floor((s - Math.floor(s)) * fps)
  const pad = (n: number, w = 2): string => n.toString().padStart(w, '0')
  const base = h > 0 ? `${h}:${pad(m)}:${pad(secs)}` : `${m}:${pad(secs)}`
  if (withFrames) return `${base};${pad(frames)}`
  const tenths = Math.floor((s - Math.floor(s)) * 10)
  return `${base}.${tenths}`
}

/** Compact "1.2 GB" style file size. */
export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

/** "1:05" mm:ss for clip/asset durations. */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function fileUrl(path: string): string {
  // Encode a local absolute path for use in <video>/<img> src.
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `file://${encoded}`
}
