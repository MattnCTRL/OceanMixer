/**
 * Pure project helpers + the EditOp reducer.
 *
 * This is shared by every layer:
 *   - the renderer store applies user actions and AI ops through `applyOps`,
 *   - the AI service summarizes a project for the model with `summarizeProject`,
 *   - the exporter walks the same model.
 *
 * Everything here is pure: functions return new values and never touch I/O.
 */

import { customAlphabet } from 'nanoid'
import {
  DEFAULT_IMAGE_DURATION_SEC,
  DEFAULT_PROJECT_SETTINGS,
  DEFAULT_TRANSFORM,
  PROJECT_SCHEMA_VERSION,
  type Clip,
  type ClipType,
  type MediaAsset,
  type Project,
  type Track,
  type TrackKind
} from './types'
import type { EditOp } from './ai-ops'

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10)

export function newId(prefix: string): string {
  return `${prefix}_${nano()}`
}

/* ----------------------------------------------------------- constructors */

export function createEmptyProject(name = 'Untitled project'): Project {
  const now = Date.now()
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: newId('proj'),
    name,
    settings: { ...DEFAULT_PROJECT_SETTINGS },
    tracks: [
      createTrack('video', 'Video 1'),
      createTrack('audio', 'Audio 1')
    ],
    media: [],
    createdAt: now,
    updatedAt: now
  }
}

export function createTrack(kind: TrackKind, name: string): Track {
  return {
    id: newId('trk'),
    name,
    kind,
    clips: [],
    muted: false,
    locked: false,
    hidden: false,
    volume: 1
  }
}

function clipTypeForAsset(asset: MediaAsset): ClipType {
  if (asset.type === 'video') return 'video'
  if (asset.type === 'audio') return 'audio'
  return 'image'
}

/** Build a default clip for an asset placed at `start` on the timeline. */
export function clipFromAsset(
  asset: MediaAsset,
  start: number,
  inPoint?: number,
  outPoint?: number
): Clip {
  const type = clipTypeForAsset(asset)
  const isStill = type === 'image'
  const ip = isStill ? 0 : Math.max(0, inPoint ?? 0)
  const srcDur = asset.durationSec > 0 ? asset.durationSec : DEFAULT_IMAGE_DURATION_SEC
  const op = isStill ? DEFAULT_IMAGE_DURATION_SEC : Math.min(srcDur, outPoint ?? srcDur)
  const duration = isStill ? DEFAULT_IMAGE_DURATION_SEC : Math.max(0.05, op - ip)
  return {
    id: newId('clip'),
    type,
    assetId: asset.id,
    start: Math.max(0, start),
    duration,
    inPoint: ip,
    outPoint: op,
    transform: { ...DEFAULT_TRANSFORM },
    volume: 1,
    muted: type === 'image',
    speed: 1,
    effects: [],
    label: asset.name
  }
}

/* --------------------------------------------------------------- queries */

export function assetById(project: Project, id: string): MediaAsset | undefined {
  return project.media.find((a) => a.id === id)
}

export function trackById(project: Project, id: string): Track | undefined {
  return project.tracks.find((t) => t.id === id)
}

export interface ClipLocation {
  track: Track
  clip: Clip
  index: number
}

export function findClip(project: Project, clipId: string): ClipLocation | undefined {
  for (const track of project.tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId)
    if (index >= 0) return { track, clip: track.clips[index], index }
  }
  return undefined
}

export function clipEnd(clip: Clip): number {
  return clip.start + clip.duration
}

export function trackDuration(track: Track): number {
  return track.clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0)
}

export function projectDuration(project: Project): number {
  return project.tracks.reduce((max, t) => Math.max(max, trackDuration(t)), 0)
}

/** Next free start time when appending to a track. */
export function appendStart(track: Track): number {
  return trackDuration(track)
}

function sortClips(track: Track): void {
  track.clips.sort((a, b) => a.start - b.start)
}

/* ----------------------------------------------------------- the reducer */

export interface ApplyResult {
  project: Project
  warnings: string[]
}

/**
 * Apply a batch of edit operations to a project, returning a new project.
 * Ops referencing entities created earlier in the same batch use "$ref" ids.
 */
export function applyOps(input: Project, ops: EditOp[]): ApplyResult {
  const project: Project = structuredClone(input)
  const warnings: string[] = []
  // maps a "$ref" used in the batch to the real generated id
  const refs = new Map<string, string>()

  const resolveTrackId = (id: string): string => refs.get(id) ?? id

  for (const op of ops) {
    try {
      switch (op.op) {
        case 'renameProject':
          project.name = op.name
          break

        case 'setProjectSettings':
          project.settings = { ...project.settings, ...op.settings }
          break

        case 'addTrack': {
          const track = createTrack(op.kind, op.name ?? defaultTrackName(project, op.kind))
          project.tracks.push(track)
          if (op.ref) refs.set(op.ref, track.id)
          break
        }

        case 'removeTrack': {
          const id = resolveTrackId(op.trackId)
          const before = project.tracks.length
          project.tracks = project.tracks.filter((t) => t.id !== id)
          if (project.tracks.length === before) warnings.push(`removeTrack: track ${id} not found`)
          break
        }

        case 'addClip': {
          const track = trackById(project, resolveTrackId(op.trackId))
          if (!track) {
            warnings.push(`addClip: track ${op.trackId} not found`)
            break
          }
          const asset = assetById(project, op.assetId)
          if (!asset) {
            warnings.push(`addClip: asset ${op.assetId} not found`)
            break
          }
          const start = op.start ?? appendStart(track)
          const clip = clipFromAsset(asset, start, op.inPoint, op.outPoint)
          track.clips.push(clip)
          sortClips(track)
          if (op.ref) refs.set(op.ref, clip.id)
          break
        }

        case 'addTextClip': {
          const track = trackById(project, resolveTrackId(op.trackId))
          if (!track) {
            warnings.push(`addTextClip: track ${op.trackId} not found`)
            break
          }
          const clip: Clip = {
            id: newId('clip'),
            type: 'text',
            start: Math.max(0, op.start),
            duration: Math.max(0.1, op.duration),
            inPoint: 0,
            outPoint: Math.max(0.1, op.duration),
            transform: { ...DEFAULT_TRANSFORM, ...op.transform },
            volume: 1,
            muted: true,
            speed: 1,
            effects: [],
            text: {
              text: op.text.text,
              fontFamily: op.text.fontFamily ?? 'Inter',
              fontSize: op.text.fontSize ?? 64,
              color: op.text.color ?? '#ffffff',
              backgroundColor: op.text.backgroundColor,
              align: op.text.align ?? 'center',
              bold: op.text.bold,
              italic: op.text.italic
            },
            label: op.text.text.slice(0, 24)
          }
          track.clips.push(clip)
          sortClips(track)
          if (op.ref) refs.set(op.ref, clip.id)
          break
        }

        case 'removeClip': {
          const loc = findClip(project, op.clipId)
          if (!loc) {
            warnings.push(`removeClip: clip ${op.clipId} not found`)
            break
          }
          loc.track.clips.splice(loc.index, 1)
          break
        }

        case 'moveClip': {
          const loc = findClip(project, op.clipId)
          if (!loc) {
            warnings.push(`moveClip: clip ${op.clipId} not found`)
            break
          }
          loc.clip.start = Math.max(0, op.start)
          if (op.trackId) {
            const dest = trackById(project, resolveTrackId(op.trackId))
            if (dest && dest.id !== loc.track.id) {
              loc.track.clips.splice(loc.index, 1)
              dest.clips.push(loc.clip)
              sortClips(dest)
            } else if (!dest) {
              warnings.push(`moveClip: dest track ${op.trackId} not found`)
            }
          }
          sortClips(loc.track)
          break
        }

        case 'trimClip': {
          const loc = findClip(project, op.clipId)
          if (!loc) {
            warnings.push(`trimClip: clip ${op.clipId} not found`)
            break
          }
          const c = loc.clip
          if (op.inPoint !== undefined) c.inPoint = Math.max(0, op.inPoint)
          if (op.outPoint !== undefined) c.outPoint = Math.max(c.inPoint + 0.05, op.outPoint)
          if (op.duration !== undefined) {
            c.duration = Math.max(0.05, op.duration)
          } else if (op.inPoint !== undefined || op.outPoint !== undefined) {
            if (c.type !== 'image' && c.type !== 'text') {
              c.duration = Math.max(0.05, (c.outPoint - c.inPoint) / (c.speed || 1))
            }
          }
          break
        }

        case 'splitClip': {
          const loc = findClip(project, op.clipId)
          if (!loc) {
            warnings.push(`splitClip: clip ${op.clipId} not found`)
            break
          }
          const c = loc.clip
          if (op.at <= c.start || op.at >= clipEnd(c)) {
            warnings.push(`splitClip: time ${op.at} outside clip bounds`)
            break
          }
          const offset = op.at - c.start // seconds into the clip on the timeline
          const srcOffset = offset * (c.speed || 1) // seconds into the source
          const second: Clip = {
            ...structuredClone(c),
            id: newId('clip'),
            start: op.at,
            duration: c.duration - offset,
            inPoint: c.type === 'image' || c.type === 'text' ? c.inPoint : c.inPoint + srcOffset,
            // a transition belongs to the first half only
            transitionIn: undefined
          }
          c.duration = offset
          if (c.type !== 'image' && c.type !== 'text') c.outPoint = c.inPoint + srcOffset
          loc.track.clips.splice(loc.index + 1, 0, second)
          break
        }

        case 'setClipProps': {
          const loc = findClip(project, op.clipId)
          if (!loc) {
            warnings.push(`setClipProps: clip ${op.clipId} not found`)
            break
          }
          const c = loc.clip
          const p = op.props
          if (p.volume !== undefined) c.volume = clamp(p.volume, 0, 2)
          if (p.muted !== undefined) c.muted = p.muted
          if (p.speed !== undefined) c.speed = clamp(p.speed, 0.1, 8)
          if (p.label !== undefined) c.label = p.label
          if (p.color !== undefined) c.color = p.color
          if (p.transform) c.transform = { ...c.transform, ...p.transform }
          if (p.text && c.text) c.text = { ...c.text, ...p.text }
          break
        }

        case 'addEffect': {
          const loc = findClip(project, op.clipId)
          if (!loc) {
            warnings.push(`addEffect: clip ${op.clipId} not found`)
            break
          }
          loc.clip.effects.push({ ...op.effect, id: newId('fx') })
          break
        }

        case 'removeEffect': {
          const loc = findClip(project, op.clipId)
          if (!loc) {
            warnings.push(`removeEffect: clip ${op.clipId} not found`)
            break
          }
          loc.clip.effects = loc.clip.effects.filter((e) => e.id !== op.effectId)
          break
        }

        case 'setTransition': {
          const loc = findClip(project, op.clipId)
          if (!loc) {
            warnings.push(`setTransition: clip ${op.clipId} not found`)
            break
          }
          loc.clip.transitionIn = op.transition ?? undefined
          break
        }

        case 'reorderClips': {
          const track = trackById(project, resolveTrackId(op.trackId))
          if (!track) {
            warnings.push(`reorderClips: track ${op.trackId} not found`)
            break
          }
          const byId = new Map(track.clips.map((c) => [c.id, c]))
          const ordered = op.clipIdsInOrder.map((id) => byId.get(id)).filter((c): c is Clip => !!c)
          // repack sequentially from 0, preserving each clip's duration
          let cursor = 0
          for (const c of ordered) {
            c.start = cursor
            cursor += c.duration
          }
          // keep any clips not mentioned, after the repacked ones
          const mentioned = new Set(op.clipIdsInOrder)
          const rest = track.clips.filter((c) => !mentioned.has(c.id))
          track.clips = [...ordered, ...rest]
          sortClips(track)
          break
        }

        default: {
          const _exhaustive: never = op
          warnings.push(`unknown op: ${JSON.stringify(_exhaustive)}`)
        }
      }
    } catch (err) {
      warnings.push(`op ${op.op} failed: ${(err as Error).message}`)
    }
  }

  project.updatedAt = Date.now()
  return { project, warnings }
}

function defaultTrackName(project: Project, kind: TrackKind): string {
  const n = project.tracks.filter((t) => t.kind === kind).length + 1
  return `${kind === 'video' ? 'Video' : 'Audio'} ${n}`
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/* ------------------------------------------------- AI-facing serialization */

/**
 * Compact, model-friendly description of a project, used in the AI Director's
 * context so Claude can reason about what to edit without huge token cost.
 */
export function summarizeProject(project: Project): string {
  const lines: string[] = []
  lines.push(`Project "${project.name}" — ${project.settings.width}x${project.settings.height} @ ${project.settings.fps}fps`)
  lines.push(`Duration: ${projectDuration(project).toFixed(2)}s`)
  lines.push('')
  lines.push('MEDIA POOL:')
  if (project.media.length === 0) lines.push('  (empty)')
  for (const a of project.media) {
    const dims = a.width ? `${a.width}x${a.height}` : '—'
    lines.push(
      `  ${a.id}  [${a.type}] "${a.name}"  ${a.durationSec.toFixed(2)}s  ${dims}  audio:${a.hasAudio}`
    )
  }
  lines.push('')
  lines.push('TIMELINE (tracks bottom→top):')
  for (const t of project.tracks) {
    lines.push(`  ${t.id}  [${t.kind}] "${t.name}"${t.muted ? ' (muted)' : ''}`)
    if (t.clips.length === 0) lines.push('    (no clips)')
    for (const c of t.clips) {
      const label = c.type === 'text' ? `"${c.text?.text ?? ''}"` : c.label ?? c.assetId ?? ''
      lines.push(
        `    ${c.id} [${c.type}] ${label} @ ${c.start.toFixed(2)}s len ${c.duration.toFixed(
          2
        )}s src[${c.inPoint.toFixed(2)}-${c.outPoint.toFixed(2)}]${c.muted ? ' muted' : ''}`
      )
    }
  }
  return lines.join('\n')
}
