/**
 * OceanMixer core data model.
 *
 * This is the single source of truth for the project document. Every layer
 * depends on it:
 *   - the renderer timeline/preview renders it,
 *   - the zustand store mutates it,
 *   - the FFmpeg exporter compiles it into a filtergraph,
 *   - the AI Creative Director reads it and proposes EditOps (see ai-ops.ts).
 *
 * Keep it serializable (plain JSON, no class instances) so projects can be
 * saved to disk (.ocmix) and sent across the Electron IPC boundary.
 */

export type MediaType = 'video' | 'audio' | 'image'

/** A source file the user imported into the project's media pool. */
export interface MediaAsset {
  id: string
  path: string // absolute path on disk
  name: string
  type: MediaType
  durationSec: number // 0 for images (use a default still duration when placed)
  width?: number
  height?: number
  fps?: number
  hasAudio: boolean
  sampleRate?: number
  channels?: number
  videoCodec?: string
  audioCodec?: string
  /** small base64 data URL poster frame for the library grid */
  thumbnailDataUrl?: string
  /** path to a generated waveform PNG (audio/video), cached on disk */
  waveformPath?: string
  sizeBytes?: number
  importedAt: number
}

/** A track holds clips of a single media kind. Video tracks composite top-down. */
export type TrackKind = 'video' | 'audio'

export type ClipType = 'video' | 'audio' | 'image' | 'text'

/** Spatial placement of a visual clip within the project frame. */
export interface Transform {
  x: number // px offset from frame center (+right)
  y: number // px offset from frame center (+down)
  scale: number // 1 = fit-by-default sizing
  rotation: number // degrees, clockwise
  opacity: number // 0..1
}

export interface TextStyle {
  text: string
  fontFamily: string
  fontSize: number
  color: string // hex
  backgroundColor?: string // hex or undefined for transparent
  align: 'left' | 'center' | 'right'
  bold?: boolean
  italic?: boolean
}

export type TransitionType =
  | 'fade'
  | 'dissolve'
  | 'wipeleft'
  | 'wiperight'
  | 'slideup'
  | 'slidedown'
  | 'circleopen'

/** A transition applied at the *start* of a clip (crossing with the clip before it). */
export interface Transition {
  type: TransitionType
  durationSec: number
}

/** A parametric effect/filter applied to a clip. type maps to an FFmpeg filter. */
export interface Effect {
  id: string
  type:
    | 'brightness'
    | 'contrast'
    | 'saturation'
    | 'hue'
    | 'gamma'
    | 'blur'
    | 'sharpen'
    | 'grayscale'
    | 'sepia'
    | 'vignette'
    | 'fadeIn'
    | 'fadeOut'
  params: Record<string, number>
  enabled: boolean
}

export interface Clip {
  id: string
  type: ClipType
  /** undefined for text clips; otherwise references a MediaAsset.id */
  assetId?: string

  // Timeline placement (seconds, on the track).
  start: number
  duration: number

  // Source trim into the asset (seconds). Ignored for text/image clips.
  inPoint: number
  outPoint: number

  // Visual properties (video/image/text).
  transform: Transform

  // Audio properties (video/audio).
  volume: number // 0..2, 1 = unchanged
  muted: boolean

  /** Playback speed multiplier. 1 = normal. Affects effective duration. */
  speed: number

  effects: Effect[]
  /** transition crossing into this clip from the previous clip on the track */
  transitionIn?: Transition

  /** populated only for text clips */
  text?: TextStyle

  label?: string
  color?: string // UI accent for the clip block
}

export interface Track {
  id: string
  name: string
  kind: TrackKind
  clips: Clip[]
  muted: boolean
  locked: boolean
  hidden: boolean
  volume: number // track-level gain, 0..2
}

export interface ProjectSettings {
  width: number
  height: number
  fps: number
  sampleRate: number
  backgroundColor: string // hex
}

export interface Project {
  /** schema version of the document format, for migrations */
  schemaVersion: number
  id: string
  name: string
  settings: ProjectSettings
  /** Track order is render order: index 0 is the BOTTOM video layer. */
  tracks: Track[]
  media: MediaAsset[]
  createdAt: number
  updatedAt: number
  filePath?: string // where it's saved on disk (.ocmix)
}

export const PROJECT_SCHEMA_VERSION = 1

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  sampleRate: 48000,
  backgroundColor: '#000000'
}

/** Seconds an image clip lasts by default when first placed on the timeline. */
export const DEFAULT_IMAGE_DURATION_SEC = 5

export const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1
}
