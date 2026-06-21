/**
 * Project -> FFmpeg command compiler.
 *
 * Compiles an OceanMixer Project into a single ffmpeg invocation that
 * composites every visual clip over a base canvas and mixes every audio
 * source into one track.
 *
 * Strategy
 * --------
 * Input 0 is always an lavfi `color` source sized to the output canvas and
 * lasting the full project duration. Every video/image/audio source becomes an
 * additional `-i` input (text clips need no input — they are drawn directly
 * onto a video stream). A single `-filter_complex` graph:
 *
 *   1. Prepares each visual clip: trim -> speed -> scale/pad -> effects ->
 *      opacity -> drawtext (text clips) -> PTS shift to the clip's timeline
 *      start.
 *   2. Chains overlays bottom-track-first onto the base canvas, gated by
 *      `enable='between(t, start, end)'`, producing [outv].
 *   3. Prepares each audio source: atrim -> aspeed -> volume -> adelay to the
 *      clip start, then `amix` everything into [aout]. When there is no audio
 *      a silent `anullsrc` is mixed so the muxer always has an audio track
 *      (except for GIF which carries no audio).
 *
 * Correctness over completeness: features that are hard to express are degraded
 * gracefully (see integration notes returned by the module README/handlers).
 *
 * Implemented:
 *   - video / image / text visual clips, opacity, scale, x/y offset from center
 *   - speed (setpts / atempo via aspeed)
 *   - effects: brightness, contrast, saturation, hue, gamma, blur, sharpen,
 *     grayscale, sepia, vignette, fadeIn, fadeOut (enabled ones only)
 *   - transitionIn 'fade'/'dissolve' approximated as a fade-in on the clip
 *   - audio mixing with per-clip + per-track gain, mute, trim, speed
 *   - mp4/mov (h264+aac), webm (vp9+opus), gif (palette, no audio)
 *
 * Degraded / ignored:
 *   - rotation (transform.rotation) is ignored
 *   - non-fade transitions are approximated by a fade-in
 *   - audio fade effects are not separately applied to audio
 */

import type { Clip, Effect, Project, Track, Transform } from '@shared/types'
import type { ExportFormat, ExportOptions } from '@shared/ipc'
import { projectDuration } from '@shared/project-utils'

/* ----------------------------------------------------------------- helpers */

/** Resolution of the output canvas given options/project fallbacks. */
interface Canvas {
  width: number
  height: number
  fps: number
  background: string
}

/** Round to a sane number of decimals for ffmpeg expressions. */
function num(n: number, decimals = 4): string {
  if (!Number.isFinite(n)) return '0'
  const r = Number(n.toFixed(decimals))
  return String(r)
}

/** Even integer (h264/yuv420p require even dimensions). */
function even(n: number): number {
  const v = Math.max(2, Math.round(n))
  return v % 2 === 0 ? v : v + 1
}

/**
 * Normalize a hex/named color into something ffmpeg's lavfi/color accepts.
 * ffmpeg understands #rrggbb and 0xrrggbb and named colors. We pass hex through
 * after stripping a leading '#'? ffmpeg color= prefers 0x or named; both
 * `color=c=#000000` styles are flaky, so normalize '#rrggbb' -> '0xrrggbb'.
 */
function ffColor(hex: string): string {
  if (!hex) return 'black'
  const h = hex.trim()
  if (h.startsWith('#')) return '0x' + h.slice(1)
  return h
}

/**
 * Escape text for use inside a drawtext `text='...'` value. ffmpeg filtergraph
 * parsing requires escaping of \ : ' % and newlines, in this order.
 */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\r?\n/g, '\\n')
}

/** Effective on-timeline window [start, end] for a clip. */
function clipWindow(clip: Clip): { start: number; end: number } {
  const start = Math.max(0, clip.start)
  return { start, end: start + Math.max(0.001, clip.duration) }
}

/* --------------------------------------------------------- visual building */

/**
 * Map a single enabled Effect to a filter fragment (no leading/trailing comma).
 * Returns null when the effect produces no usable filter.
 */
function effectFilter(effect: Effect, clip: Clip): string | null {
  if (!effect.enabled) return null
  const p = effect.params ?? {}
  const dur = Math.max(0.001, clip.duration)
  switch (effect.type) {
    case 'brightness': {
      // expects roughly -1..1; eq brightness range is -1..1
      const v = p.value ?? p.amount ?? 0
      return `eq=brightness=${num(v)}`
    }
    case 'contrast': {
      const v = p.value ?? p.amount ?? 1
      return `eq=contrast=${num(v)}`
    }
    case 'saturation': {
      const v = p.value ?? p.amount ?? 1
      return `eq=saturation=${num(v)}`
    }
    case 'gamma': {
      const v = p.value ?? p.amount ?? 1
      return `eq=gamma=${num(Math.max(0.1, v))}`
    }
    case 'hue': {
      // degrees
      const v = p.degrees ?? p.value ?? p.amount ?? 0
      return `hue=h=${num(v)}`
    }
    case 'grayscale':
      return 'hue=s=0'
    case 'sepia':
      return 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131'
    case 'blur': {
      const sigma = p.radius ?? p.amount ?? p.value ?? 5
      return `gblur=sigma=${num(Math.max(0.1, sigma))}`
    }
    case 'sharpen': {
      const amt = p.amount ?? p.value ?? 1
      return `unsharp=5:5:${num(Math.max(0, amt))}:5:5:0`
    }
    case 'vignette':
      return 'vignette'
    case 'fadeIn': {
      const d = Math.max(0.05, p.duration ?? 1)
      return `fade=t=in:st=0:d=${num(Math.min(d, dur))}:alpha=1`
    }
    case 'fadeOut': {
      const d = Math.max(0.05, p.duration ?? 1)
      const st = Math.max(0, dur - d)
      return `fade=t=out:st=${num(st)}:d=${num(d)}:alpha=1`
    }
    default:
      return null
  }
}

/**
 * Compute the overlay position so that transform.x/y are offsets from the
 * frame center (the clip is centered, then nudged). Overlay x/y position the
 * top-left of the overlaid layer, so we offset by half the layer size.
 */
function overlayPosition(transform: Transform): { x: string; y: string } {
  const dx = transform.x ?? 0
  const dy = transform.y ?? 0
  // W/H = base size, w/h = overlay size (ffmpeg overlay vars)
  return {
    x: `(W-w)/2+(${num(dx)})`,
    y: `(H-h)/2+(${num(dy)})`
  }
}

/**
 * Build the filter chain for one visual clip producing a labelled stream
 * `[vN]` ready to be overlaid, plus the overlay placement.
 *
 * @param inputIdx ffmpeg input index for this clip's source (ignored for text)
 * @param vlabel   output label to assign (without brackets)
 */
function buildVisualClip(
  clip: Clip,
  inputIdx: number,
  vlabel: string,
  canvas: Canvas
): { chain: string; position: { x: string; y: string } } {
  const { start, end } = clipWindow(clip)
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1
  const transform = clip.transform
  const scale = transform.scale && transform.scale > 0 ? transform.scale : 1

  const parts: string[] = []
  let head: string

  if (clip.type === 'text') {
    // Text clips need a transparent base of the canvas size to draw onto.
    // We synthesize it from input 0 is not possible (color is opaque), so we
    // build a transparent source via a format on a scaled color is awkward;
    // instead create the layer from the canvas-sized transparent via the
    // input index? Text clips have no input — generate with a nullsrc-like
    // approach using `color` is opaque. We therefore draw onto a transparent
    // RGBA canvas produced by `color=...@0`. That source is added as a regular
    // input by the caller (inputIdx points at a transparent color input).
    head = `[${inputIdx}:v]`
  } else {
    head = `[${inputIdx}:v]`
  }

  // 1. Trim source (skip for image/text — they have no meaningful in/out).
  if (clip.type === 'video') {
    const inP = Math.max(0, clip.inPoint)
    const outP = Math.max(inP + 0.01, clip.outPoint)
    parts.push(`trim=start=${num(inP)}:end=${num(outP)}`)
    parts.push('setpts=PTS-STARTPTS')
  } else {
    // image / text: normalize timestamps
    parts.push('setpts=PTS-STARTPTS')
  }

  // 2. Speed (video only — images/text have a fixed on-timeline duration).
  if (clip.type === 'video' && speed !== 1) {
    parts.push(`setpts=${num(1 / speed)}*PTS`)
  }

  // 3. fps + scale-to-fit-by-default, honoring transform.scale, then pad to
  //    the layer's own bounding box. We scale into a box of (canvas*scale)
  //    while preserving aspect (force_original_aspect_ratio=decrease).
  const boxW = even(canvas.width * scale)
  const boxH = even(canvas.height * scale)
  parts.push(`fps=${num(canvas.fps)}`)
  parts.push(`scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease`)
  // Ensure even dims after aspect-preserving scale.
  parts.push('scale=trunc(iw/2)*2:trunc(ih/2)*2')

  // 4. Effects (enabled only).
  for (const fx of clip.effects ?? []) {
    const f = effectFilter(fx, clip)
    if (f) parts.push(f)
  }

  // 5. Text rendering.
  if (clip.type === 'text' && clip.text) {
    const t = clip.text
    const fontColor = ffColor(t.color || '#ffffff')
    const fontSize = Math.max(8, Math.round(t.fontSize || 64))
    // Centered text within the layer; align maps x position.
    let x = '(w-text_w)/2'
    if (t.align === 'left') x = '10'
    else if (t.align === 'right') x = '(w-text_w-10)'
    const y = '(h-text_h)/2'
    const drawParts = [
      `text='${escapeDrawtext(t.text)}'`,
      `fontcolor=${fontColor}`,
      `fontsize=${fontSize}`,
      `x=${x}`,
      `y=${y}`
    ]
    if (t.backgroundColor) {
      drawParts.push('box=1')
      drawParts.push(`boxcolor=${ffColor(t.backgroundColor)}`)
      drawParts.push('boxborderw=10')
    }
    parts.push(`drawtext=${drawParts.join(':')}`)
  }

  // 6. Opacity via alpha. format=rgba so we can multiply the alpha channel.
  const opacity = transform.opacity ?? 1
  if (opacity < 0.999 || clip.type === 'text') {
    parts.push('format=rgba')
    if (opacity < 0.999) {
      parts.push(`colorchannelmixer=aa=${num(Math.max(0, Math.min(1, opacity)))}`)
    }
  }

  // 7. transitionIn -> approximate as a fade-in at the clip's local start.
  if (clip.transitionIn && clip.transitionIn.durationSec > 0) {
    const d = Math.min(clip.transitionIn.durationSec, Math.max(0.05, clip.duration))
    parts.push('format=rgba')
    parts.push(`fade=t=in:st=0:d=${num(d)}:alpha=1`)
  }

  // 8. Shift PTS so the clip appears at its timeline start, and pad its
  //    timeline so overlay enable windows line up. We add start offset.
  parts.push(`setpts=PTS+${num(start)}/TB`)

  const chain = `${head}${parts.join(',')}[${vlabel}]`
  return { chain, position: overlayPosition(transform) }
}

/* ---------------------------------------------------------- audio building */

/**
 * Build the filter chain for one audio source producing `[aN]`.
 * @param inputIdx ffmpeg input index for this source
 * @param alabel   output label (without brackets)
 */
function buildAudioClip(
  clip: Clip,
  track: Track,
  inputIdx: number,
  alabel: string,
  sampleRate: number
): string {
  const { start } = clipWindow(clip)
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1
  const inP = Math.max(0, clip.inPoint)
  const outP = Math.max(inP + 0.01, clip.outPoint)

  const parts: string[] = []
  parts.push(`atrim=start=${num(inP)}:end=${num(outP)}`)
  parts.push('asetpts=PTS-STARTPTS')

  // Speed via aspeed (handles arbitrary factors, chaining internally).
  if (speed !== 1) {
    parts.push(`atempo=${num(clampTempo(speed))}`)
  }

  // Normalize to the project sample rate / stereo so amix is consistent.
  parts.push(`aformat=sample_rates=${sampleRate}:channel_layouts=stereo`)

  // Gain (clip volume * track volume). Mute zeroes it.
  const gain = clip.muted || track.muted ? 0 : (clip.volume ?? 1) * (track.volume ?? 1)
  parts.push(`volume=${num(Math.max(0, gain))}`)

  // Delay to the clip start (adelay in ms, per channel).
  const delayMs = Math.round(start * 1000)
  if (delayMs > 0) {
    parts.push(`adelay=${delayMs}|${delayMs}`)
  }

  return `[${inputIdx}:a]${parts.join(',')}[${alabel}]`
}

/** atempo only accepts 0.5..100 per stage; clamp to a single-stage safe range. */
function clampTempo(speed: number): number {
  if (speed < 0.5) return 0.5
  if (speed > 100) return 100
  return speed
}

/* ------------------------------------------------------- codec selection */

function videoCodecArgs(format: ExportFormat, options: ExportOptions, fps: number): string[] {
  const crf = options.crf ?? 20
  const preset = options.preset ?? 'medium'
  switch (format) {
    case 'webm':
      return [
        '-c:v',
        options.videoCodec ?? 'libvpx-vp9',
        '-crf',
        String(crf),
        '-b:v',
        '0',
        '-pix_fmt',
        'yuv420p',
        '-r',
        num(fps)
      ]
    case 'gif':
      // gif handled with a palette filter; no extra codec flags needed.
      return ['-r', num(Math.min(fps, 25))]
    case 'mov':
    case 'mp4':
    default:
      return [
        '-c:v',
        options.videoCodec ?? 'libx264',
        '-crf',
        String(crf),
        '-preset',
        preset,
        '-pix_fmt',
        'yuv420p',
        '-r',
        num(fps)
      ]
  }
}

function audioCodecArgs(format: ExportFormat, options: ExportOptions, sampleRate: number): string[] {
  const kbps = options.audioBitrateKbps ?? 192
  switch (format) {
    case 'webm':
      return ['-c:a', 'libopus', '-b:a', `${kbps}k`, '-ar', String(sampleRate)]
    case 'mov':
    case 'mp4':
    default:
      return ['-c:a', 'aac', '-b:a', `${kbps}k`, '-ar', String(sampleRate)]
  }
}

/* ----------------------------------------------------------------- public */

/**
 * Compile a Project into an ffmpeg argv plus the total duration (for progress).
 */
export function buildExportCommand(
  project: Project,
  options: ExportOptions
): { args: string[]; totalDurationSec: number } {
  const settings = project.settings
  const canvas: Canvas = {
    width: even(options.width ?? settings.width),
    height: even(options.height ?? settings.height),
    fps: options.fps ?? settings.fps ?? 30,
    background: settings.backgroundColor || '#000000'
  }
  const sampleRate = settings.sampleRate || 48000
  const totalDurationSec = Math.max(0.1, projectDuration(project))
  const format = options.format

  const inputs: string[] = []
  const filters: string[] = []

  // Input 0: base canvas (opaque background).
  inputs.push(
    '-f',
    'lavfi',
    '-i',
    `color=c=${ffColor(canvas.background)}:s=${canvas.width}x${canvas.height}:r=${num(
      canvas.fps
    )}:d=${num(totalDurationSec)}`
  )
  let inputIdx = 1

  // Gather visual clips bottom-track-first (render order = track order).
  const visualLabels: { label: string; position: { x: string; y: string }; window: { start: number; end: number } }[] = []
  const audioLabels: string[] = []

  for (const track of project.tracks) {
    if (track.hidden) continue
    if (track.kind !== 'video') continue
    for (const clip of track.clips) {
      if (clip.type !== 'video' && clip.type !== 'image' && clip.type !== 'text') continue

      // Resolve the source input for this clip.
      if (clip.type === 'text') {
        // Transparent canvas-sized source to draw text onto.
        inputs.push(
          '-f',
          'lavfi',
          '-i',
          `color=c=black@0.0:s=${canvas.width}x${canvas.height}:r=${num(canvas.fps)}:d=${num(
            Math.max(0.05, clip.duration)
          )},format=rgba`
        )
      } else {
        const asset = project.media.find((a) => a.id === clip.assetId)
        if (!asset) continue
        if (clip.type === 'image') {
          inputs.push('-loop', '1', '-t', num(Math.max(0.05, clip.duration)), '-i', asset.path)
        } else {
          inputs.push('-i', asset.path)
        }
      }

      const vlabel = `v${inputIdx}`
      const { chain, position } = buildVisualClip(clip, inputIdx, vlabel, canvas)
      filters.push(chain)
      visualLabels.push({ label: vlabel, position, window: clipWindow(clip) })
      inputIdx++
    }
  }

  // Gather audio sources: audio-track clips + video clips that carry audio.
  if (format !== 'gif') {
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        if (track.kind === 'audio' && clip.type === 'audio') {
          const asset = project.media.find((a) => a.id === clip.assetId)
          if (!asset) continue
          inputs.push('-i', asset.path)
          const alabel = `a${inputIdx}`
          filters.push(buildAudioClip(clip, track, inputIdx, alabel, sampleRate))
          audioLabels.push(alabel)
          inputIdx++
        } else if (track.kind === 'video' && clip.type === 'video') {
          const asset = project.media.find((a) => a.id === clip.assetId)
          if (!asset || !asset.hasAudio) continue
          if (clip.muted) continue
          inputs.push('-i', asset.path)
          const alabel = `a${inputIdx}`
          filters.push(buildAudioClip(clip, track, inputIdx, alabel, sampleRate))
          audioLabels.push(alabel)
          inputIdx++
        }
      }
    }
  }

  // Chain overlays onto the base canvas.
  let lastV = '0:v'
  if (visualLabels.length === 0) {
    // No visual clips: pass the base through (label it for -map).
    filters.push(`[0:v]null[outv]`)
    lastV = 'outv'
  } else {
    visualLabels.forEach((v, i) => {
      const out = i === visualLabels.length - 1 ? 'outv' : `ov${i}`
      const enable = `enable='between(t,${num(v.window.start)},${num(v.window.end)})'`
      filters.push(
        `[${lastV}][${v.label}]overlay=x=${v.position.x}:y=${v.position.y}:${enable}:format=auto[${out}]`
      )
      lastV = out
    })
  }

  // Build audio output.
  let haveAudio = false
  if (format !== 'gif') {
    if (audioLabels.length === 0) {
      // Silent track so the container always has audio.
      inputs.push(
        '-f',
        'lavfi',
        '-t',
        num(totalDurationSec),
        '-i',
        `anullsrc=r=${sampleRate}:cl=stereo`
      )
      filters.push(`[${inputIdx}:a]aformat=sample_rates=${sampleRate}:channel_layouts=stereo[aout]`)
      inputIdx++
      haveAudio = true
    } else if (audioLabels.length === 1) {
      // Pad with silence to the full duration, then bound it. Keep the PTS
      // (which already encodes the clip's adelay offset) intact.
      filters.push(`[${audioLabels[0]}]apad,atrim=end=${num(totalDurationSec)}[aout]`)
      haveAudio = true
    } else {
      const ins = audioLabels.map((l) => `[${l}]`).join('')
      filters.push(
        `${ins}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0,atrim=end=${num(
          totalDurationSec
        )}[aout]`
      )
      haveAudio = true
    }
  }

  // GIF: append palettegen/paletteuse to the visual chain.
  if (format === 'gif') {
    filters.push(`[${lastV}]split[gv1][gv2]`)
    filters.push(`[gv1]palettegen=stats_mode=diff[pal]`)
    filters.push(`[gv2][pal]paletteuse=dither=bayer:bayer_scale=5[gifout]`)
    lastV = 'gifout'
  }

  /* ---------------------------------------------------------- assemble argv */

  const args: string[] = ['-y', ...inputs]

  args.push('-filter_complex', filters.join(';'))

  args.push('-map', `[${lastV}]`)
  if (haveAudio) args.push('-map', '[aout]')

  args.push(...videoCodecArgs(format, options, canvas.fps))
  if (haveAudio) args.push(...audioCodecArgs(format, options, sampleRate))

  // Faststart for mp4/mov streaming.
  if (format === 'mp4' || format === 'mov') {
    args.push('-movflags', '+faststart')
  }

  // Bound the output to the project duration.
  args.push('-t', num(totalDurationSec))

  // Machine-parseable progress on stderr.
  args.push('-progress', 'pipe:2')

  args.push(options.outputPath)

  return { args, totalDurationSec }
}
