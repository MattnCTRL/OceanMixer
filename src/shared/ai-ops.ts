/**
 * EditOps — the programmatic editing API of OceanMixer.
 *
 * This is the contract that ties the AI Creative Director to the editor.
 * The AI service (main process) exposes each op as a Claude tool; when Claude
 * decides to edit, it emits a list of EditOps. The renderer's project store
 * knows how to apply each one. The SAME ops back undo/redo and (eventually)
 * a macro/automation system.
 *
 * Rule: every op must be expressible as a pure transformation of a Project.
 * IDs that don't exist yet (e.g. a track the AI just asked to create) are
 * referenced by a temporary ref string prefixed with "$" and resolved during
 * application (see resolveRefs in the store).
 */

import type { ClipType, ProjectSettings, TextStyle, Transition, Transform, Effect, TrackKind } from './types'

export interface AddTrackOp {
  op: 'addTrack'
  kind: TrackKind
  name?: string
  /** optional ref so later ops in the same batch can target this new track */
  ref?: string
}

export interface RemoveTrackOp {
  op: 'removeTrack'
  trackId: string
}

export interface AddClipOp {
  op: 'addClip'
  /** track id, or a "$ref" to a track created earlier in the same batch */
  trackId: string
  assetId: string
  /** timeline position (sec). If omitted, append after the last clip. */
  start?: number
  /** source trim (sec). Defaults: full asset. */
  inPoint?: number
  outPoint?: number
  ref?: string
}

export interface AddTextClipOp {
  op: 'addTextClip'
  trackId: string
  start: number
  duration: number
  text: Partial<TextStyle> & { text: string }
  transform?: Partial<Transform>
  ref?: string
}

export interface RemoveClipOp {
  op: 'removeClip'
  clipId: string
}

export interface MoveClipOp {
  op: 'moveClip'
  clipId: string
  /** new timeline start (sec) */
  start: number
  /** optionally move to another track */
  trackId?: string
}

export interface TrimClipOp {
  op: 'trimClip'
  clipId: string
  inPoint?: number
  outPoint?: number
  /** set the on-timeline duration directly (sec) */
  duration?: number
}

export interface SplitClipOp {
  op: 'splitClip'
  clipId: string
  /** absolute timeline time (sec) at which to split */
  at: number
}

export interface SetClipPropsOp {
  op: 'setClipProps'
  clipId: string
  props: Partial<{
    volume: number
    muted: boolean
    speed: number
    transform: Partial<Transform>
    label: string
    color: string
    text: Partial<TextStyle>
  }>
}

export interface AddEffectOp {
  op: 'addEffect'
  clipId: string
  effect: Omit<Effect, 'id'>
}

export interface RemoveEffectOp {
  op: 'removeEffect'
  clipId: string
  effectId: string
}

export interface SetTransitionOp {
  op: 'setTransition'
  clipId: string
  transition: Transition | null
}

export interface ReorderClipsOp {
  op: 'reorderClips'
  trackId: string
  clipIdsInOrder: string[]
}

export interface SetProjectSettingsOp {
  op: 'setProjectSettings'
  settings: Partial<ProjectSettings>
}

export interface RenameProjectOp {
  op: 'renameProject'
  name: string
}

export type EditOp =
  | AddTrackOp
  | RemoveTrackOp
  | AddClipOp
  | AddTextClipOp
  | RemoveClipOp
  | MoveClipOp
  | TrimClipOp
  | SplitClipOp
  | SetClipPropsOp
  | AddEffectOp
  | RemoveEffectOp
  | SetTransitionOp
  | ReorderClipsOp
  | SetProjectSettingsOp
  | RenameProjectOp

export type EditOpName = EditOp['op']

export const EDIT_OP_NAMES: EditOpName[] = [
  'addTrack',
  'removeTrack',
  'addClip',
  'addTextClip',
  'removeClip',
  'moveClip',
  'trimClip',
  'splitClip',
  'setClipProps',
  'addEffect',
  'removeEffect',
  'setTransition',
  'reorderClips',
  'setProjectSettings',
  'renameProject'
]

/** Helper type for a clip type that the AI may create. */
export type CreatableClipType = Extract<ClipType, 'video' | 'audio' | 'image' | 'text'>
