/**
 * Canvas compositor for the OceanMixer preview player.
 *
 * It owns a pool of hidden media decoders (HTMLVideoElement / HTMLImageElement /
 * HTMLAudioElement) — one per clip that needs a decoder — and composites the
 * project frame at an arbitrary timeline time onto a 2D canvas, honoring each
 * clip's Transform (position, scale, opacity). It also drives audio playback for
 * the active clips when the transport is playing.
 *
 * It deliberately uses Chromium's media stack (media elements + canvas
 * drawImage) rather than WebCodecs: simple, robust, and good enough for v1
 * preview. Rotation is approximated (applied as a canvas rotate) but exotic
 * blend/transition effects are not rendered here — only opacity is honored.
 */

import type { Clip, Project, Track } from '@shared/types'
import { assetById } from '@shared/project-utils'
import { fileUrl } from '@renderer/lib/time'

/** How close (sec) a media element's currentTime must be before we re-seek. */
const SEEK_EPSILON_PAUSED = 0.04
const SEEK_EPSILON_PLAYING = 0.25

type DecoderKind = 'video' | 'audio' | 'image'

interface Decoder {
  kind: DecoderKind
  assetId: string
  /** the underlying media element */
  el: HTMLVideoElement | HTMLImageElement | HTMLAudioElement
  /** true once the element has enough data / has loaded */
  ready: boolean
  /** natural pixel size, filled on load (images/videos) */
  naturalWidth: number
  naturalHeight: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function clipEnd(c: Clip): number {
  return c.start + c.duration
}

function isActiveAt(c: Clip, t: number): boolean {
  return t >= c.start && t < clipEnd(c)
}

/**
 * Source time (sec into the asset) for a video/audio clip at timeline time t.
 * Honors trim (inPoint) and playback speed.
 */
function sourceTimeFor(c: Clip, t: number): number {
  const speed = c.speed > 0 ? c.speed : 1
  const into = (t - c.start) * speed
  return c.inPoint + Math.max(0, into)
}

export class PreviewCompositor {
  private canvas: HTMLCanvasElement | null = null
  private container: HTMLElement | null = null
  private decoders = new Map<string, Decoder>()
  private project: Project | null = null
  private playing = false

  attach(canvas: HTMLCanvasElement, container: HTMLElement): void {
    this.canvas = canvas
    this.container = container
  }

  /**
   * Rebuild / reconcile the decoder pool against the current project.
   * Keeps existing elements where the clip + asset still match (so we don't
   * re-download or reset playback), creates new ones, disposes orphans.
   */
  syncDecoders(project: Project): void {
    this.project = project
    if (!this.container) return

    const wanted = new Set<string>()

    for (const track of project.tracks) {
      for (const clip of track.clips) {
        if (clip.type === 'text') continue
        if (!clip.assetId) continue
        const asset = assetById(project, clip.assetId)
        if (!asset) continue
        wanted.add(clip.id)
        const existing = this.decoders.get(clip.id)
        if (existing && existing.assetId === clip.assetId) continue
        if (existing) this.disposeDecoder(clip.id)
        this.createDecoder(clip, asset.path)
      }
    }

    // dispose decoders for clips that no longer exist
    for (const id of [...this.decoders.keys()]) {
      if (!wanted.has(id)) this.disposeDecoder(id)
    }
  }

  private createDecoder(clip: Clip, path: string): void {
    if (!this.container) return
    const src = fileUrl(path)

    if (clip.type === 'image') {
      const img = new Image()
      img.decoding = 'async'
      const dec: Decoder = {
        kind: 'image',
        assetId: clip.assetId as string,
        el: img,
        ready: false,
        naturalWidth: 0,
        naturalHeight: 0
      }
      img.onload = () => {
        dec.ready = true
        dec.naturalWidth = img.naturalWidth
        dec.naturalHeight = img.naturalHeight
      }
      img.onerror = () => {
        dec.ready = false
      }
      img.src = src
      this.decoders.set(clip.id, dec)
      return
    }

    if (clip.type === 'audio') {
      const audio = document.createElement('audio')
      audio.preload = 'auto'
      audio.crossOrigin = 'anonymous'
      audio.src = src
      audio.style.display = 'none'
      const dec: Decoder = {
        kind: 'audio',
        assetId: clip.assetId as string,
        el: audio,
        ready: false,
        naturalWidth: 0,
        naturalHeight: 0
      }
      audio.addEventListener('loadeddata', () => {
        dec.ready = true
      })
      audio.addEventListener('canplay', () => {
        dec.ready = true
      })
      this.container.appendChild(audio)
      this.decoders.set(clip.id, dec)
      return
    }

    // video
    const video = document.createElement('video')
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    video.muted = false
    video.playsInline = true
    video.src = src
    video.style.display = 'none'
    const dec: Decoder = {
      kind: 'video',
      assetId: clip.assetId as string,
      el: video,
      ready: false,
      naturalWidth: 0,
      naturalHeight: 0
    }
    video.addEventListener('loadeddata', () => {
      dec.ready = true
      dec.naturalWidth = video.videoWidth
      dec.naturalHeight = video.videoHeight
    })
    this.container.appendChild(video)
    this.decoders.set(clip.id, dec)
  }

  private disposeDecoder(clipId: string): void {
    const dec = this.decoders.get(clipId)
    if (!dec) return
    if (dec.kind === 'video' || dec.kind === 'audio') {
      const media = dec.el as HTMLMediaElement
      try {
        media.pause()
        media.removeAttribute('src')
        media.load()
      } catch {
        /* ignore */
      }
      if (media.parentNode) media.parentNode.removeChild(media)
    } else {
      const img = dec.el as HTMLImageElement
      img.onload = null
      img.onerror = null
      img.src = ''
    }
    this.decoders.delete(clipId)
  }

  /** Set transport state so audio elements start/stop as appropriate. */
  setPlaying(playing: boolean): void {
    this.playing = playing
    if (!playing) this.pauseAllMedia()
  }

  private pauseAllMedia(): void {
    for (const dec of this.decoders.values()) {
      if (dec.kind === 'image') continue
      const media = dec.el as HTMLMediaElement
      if (!media.paused) {
        try {
          media.pause()
        } catch {
          /* ignore */
        }
      }
    }
  }

  /**
   * Composite + drive audio for timeline time `t`.
   * Should be called every frame while playing, and once per change while paused.
   */
  render(t: number): void {
    const canvas = this.canvas
    const project = this.project
    if (!canvas || !project) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width, height } = project.settings
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height

    ctx.save()
    ctx.fillStyle = project.settings.backgroundColor || '#000000'
    ctx.fillRect(0, 0, width, height)
    ctx.restore()

    // Visual tracks composite bottom (index 0) -> top.
    for (const track of project.tracks) {
      if (track.kind !== 'video') continue
      if (track.hidden) continue
      const clip = this.activeVisualClip(track, t)
      if (!clip) continue
      this.drawVisualClip(ctx, project, clip, t, width, height)
    }

    // Audio: drive every audio-capable clip on every track.
    this.driveAudio(project, t)
  }

  private activeVisualClip(track: Track, t: number): Clip | undefined {
    // Topmost (last in clip order is irrelevant; clips don't overlap on a track,
    // but if they do, prefer the later-starting one).
    let chosen: Clip | undefined
    for (const c of track.clips) {
      if (c.type === 'audio') continue
      if (isActiveAt(c, t)) {
        if (!chosen || c.start > chosen.start) chosen = c
      }
    }
    return chosen
  }

  private drawVisualClip(
    ctx: CanvasRenderingContext2D,
    project: Project,
    clip: Clip,
    t: number,
    fw: number,
    fh: number
  ): void {
    const tf = clip.transform
    const opacity = clamp(tf.opacity ?? 1, 0, 1)
    if (opacity <= 0) return

    if (clip.type === 'text') {
      this.drawTextClip(ctx, clip, fw, fh, opacity)
      return
    }

    const dec = this.decoders.get(clip.id)
    if (!dec || !dec.ready) return

    if (dec.kind === 'video') {
      const video = dec.el as HTMLVideoElement
      const srcT = sourceTimeFor(clip, t)
      const target = clamp(srcT, 0, Number.isFinite(video.duration) ? video.duration : srcT)
      const eps = this.playing ? SEEK_EPSILON_PLAYING : SEEK_EPSILON_PAUSED
      if (Math.abs(video.currentTime - target) > eps && video.seekable.length >= 0) {
        try {
          video.currentTime = target
        } catch {
          /* ignore */
        }
      }
      if (video.readyState >= 2) {
        this.drawMediaWithTransform(
          ctx,
          video,
          dec.naturalWidth || video.videoWidth,
          dec.naturalHeight || video.videoHeight,
          clip,
          fw,
          fh,
          opacity
        )
      }
    } else if (dec.kind === 'image') {
      const img = dec.el as HTMLImageElement
      this.drawMediaWithTransform(
        ctx,
        img,
        dec.naturalWidth || img.naturalWidth,
        dec.naturalHeight || img.naturalHeight,
        clip,
        fw,
        fh,
        opacity
      )
    }
  }

  /**
   * Draw a source image/video frame fit into the frame (contain), then scaled +
   * offset by the clip transform. Rotation is applied around the frame center.
   */
  private drawMediaWithTransform(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    naturalW: number,
    naturalH: number,
    clip: Clip,
    fw: number,
    fh: number,
    opacity: number
  ): void {
    if (!naturalW || !naturalH) return
    const tf = clip.transform

    // Base "fit by contain" size within the frame.
    const fitScale = Math.min(fw / naturalW, fh / naturalH)
    const scale = fitScale * (tf.scale > 0 ? tf.scale : 1)
    const drawW = naturalW * scale
    const drawH = naturalH * scale

    ctx.save()
    ctx.globalAlpha = opacity
    // Move to frame center, apply transform offset + rotation, draw centered.
    ctx.translate(fw / 2 + (tf.x || 0), fh / 2 + (tf.y || 0))
    if (tf.rotation) ctx.rotate((tf.rotation * Math.PI) / 180)
    try {
      ctx.drawImage(source, -drawW / 2, -drawH / 2, drawW, drawH)
    } catch {
      /* drawing a not-yet-decoded frame can throw; ignore this frame */
    }
    ctx.restore()
  }

  private drawTextClip(
    ctx: CanvasRenderingContext2D,
    clip: Clip,
    fw: number,
    fh: number,
    opacity: number
  ): void {
    const style = clip.text
    if (!style) return
    const tf = clip.transform

    const weight = style.bold ? '700' : '400'
    const italic = style.italic ? 'italic ' : ''
    const fontSize = style.fontSize > 0 ? style.fontSize : 64
    const family = style.fontFamily || 'Inter, sans-serif'

    ctx.save()
    ctx.globalAlpha = opacity
    ctx.translate(fw / 2 + (tf.x || 0), fh / 2 + (tf.y || 0))
    if (tf.rotation) ctx.rotate((tf.rotation * Math.PI) / 180)
    if (tf.scale && tf.scale !== 1) ctx.scale(tf.scale, tf.scale)

    ctx.font = `${italic}${weight} ${fontSize}px ${family}`
    ctx.textBaseline = 'middle'
    ctx.textAlign = style.align

    const lines = style.text.split('\n')
    const lineHeight = fontSize * 1.2
    const totalH = lineHeight * lines.length
    const startY = -totalH / 2 + lineHeight / 2

    // optional background box behind the text
    if (style.backgroundColor) {
      let maxW = 0
      for (const line of lines) {
        const m = ctx.measureText(line)
        if (m.width > maxW) maxW = m.width
      }
      const padX = fontSize * 0.3
      const padY = fontSize * 0.2
      let boxX = -maxW / 2
      if (style.align === 'left') boxX = 0
      else if (style.align === 'right') boxX = -maxW
      ctx.save()
      ctx.fillStyle = style.backgroundColor
      ctx.fillRect(boxX - padX, -totalH / 2 - padY, maxW + padX * 2, totalH + padY * 2)
      ctx.restore()
    }

    ctx.fillStyle = style.color || '#ffffff'
    let y = startY
    const x = 0
    for (const line of lines) {
      ctx.fillText(line, x, y)
      y += lineHeight
    }
    ctx.restore()
  }

  /**
   * Start/stop + sync the audio of every audio-capable clip for time t.
   * Video clips that aren't muted also emit their audio through their element.
   */
  private driveAudio(project: Project, t: number): void {
    for (const track of project.tracks) {
      const trackMuted = track.muted
      const trackVol = clamp(track.volume ?? 1, 0, 2)
      for (const clip of track.clips) {
        if (clip.type === 'text' || clip.type === 'image') continue
        const dec = this.decoders.get(clip.id)
        if (!dec || dec.kind === 'image') continue
        const media = dec.el as HTMLMediaElement

        const active = isActiveAt(clip, t)
        const audible = active && this.playing && !clip.muted && !trackMuted

        if (!audible) {
          if (!media.paused) {
            try {
              media.pause()
            } catch {
              /* ignore */
            }
          }
          // For active-but-paused video we still want the right frame; the
          // visual path handles seeking. For inactive media we leave it.
          continue
        }

        // audible: sync playback rate, time, volume, and play.
        const speed = clip.speed > 0 ? clip.speed : 1
        if (media.playbackRate !== speed) {
          try {
            media.playbackRate = speed
          } catch {
            /* some rates unsupported */
          }
        }
        media.volume = clamp((clip.volume ?? 1) * trackVol, 0, 1)
        media.muted = false

        const target = clamp(
          sourceTimeFor(clip, t),
          0,
          Number.isFinite(media.duration) ? media.duration : sourceTimeFor(clip, t)
        )
        if (Math.abs(media.currentTime - target) > SEEK_EPSILON_PLAYING) {
          try {
            media.currentTime = target
          } catch {
            /* ignore */
          }
        }
        if (media.paused) {
          const p = media.play()
          if (p && typeof p.catch === 'function') p.catch(() => undefined)
        }
      }
    }
  }

  /** Tear everything down (call on unmount). */
  dispose(): void {
    for (const id of [...this.decoders.keys()]) this.disposeDecoder(id)
    this.decoders.clear()
    this.canvas = null
    this.container = null
    this.project = null
  }
}
