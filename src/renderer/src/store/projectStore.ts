/**
 * The renderer's single editor store.
 *
 * Holds the live Project plus UI state (selection, playhead, zoom, transport).
 * ALL document mutations flow through `apply(ops)` (history-tracked) or
 * `applyTransient(ops)` (live drag, no history), which run the shared reducer in
 * src/shared/project-utils.ts. This is the same EditOp pipeline the AI Director
 * uses, so manual edits, AI edits, and undo/redo share one code path.
 */

import { create } from 'zustand'
import type { MediaAsset, Project, Clip, Track } from '@shared/types'
import type { EditOp } from '@shared/ai-ops'
import {
  applyOps,
  createEmptyProject,
  findClip,
  projectDuration
} from '@shared/project-utils'

const HISTORY_LIMIT = 100

export interface ProjectState {
  project: Project
  selectedClipIds: string[]
  playheadSec: number
  isPlaying: boolean
  /** timeline zoom */
  pixelsPerSecond: number
  /** unsaved changes since last save */
  dirty: boolean
  lastWarnings: string[]

  past: Project[]
  future: Project[]

  /* document mutations */
  apply: (ops: EditOp[]) => string[]
  applyTransient: (ops: EditOp[]) => void
  importAssets: (assets: MediaAsset[]) => void
  setProject: (project: Project, filePath?: string) => void
  newProject: () => void
  markSaved: (filePath: string) => void

  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  /* selection */
  select: (clipId: string | null, additive?: boolean) => void
  selectMany: (ids: string[]) => void
  clearSelection: () => void

  /* transport / playhead */
  setPlayhead: (sec: number) => void
  play: () => void
  pause: () => void
  togglePlay: () => void

  /* zoom */
  setPixelsPerSecond: (pps: number) => void
  zoomIn: () => void
  zoomOut: () => void
}

function pushHistory(past: Project[], current: Project): Project[] {
  const next = [...past, current]
  if (next.length > HISTORY_LIMIT) next.shift()
  return next
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: createEmptyProject(),
  selectedClipIds: [],
  playheadSec: 0,
  isPlaying: false,
  pixelsPerSecond: 80,
  dirty: false,
  lastWarnings: [],
  past: [],
  future: [],

  apply: (ops) => {
    const { project, past } = get()
    const { project: next, warnings } = applyOps(project, ops)
    set({
      project: next,
      past: pushHistory(past, project),
      future: [],
      dirty: true,
      lastWarnings: warnings
    })
    return warnings
  },

  applyTransient: (ops) => {
    const { project } = get()
    const { project: next } = applyOps(project, ops)
    set({ project: next, dirty: true })
  },

  importAssets: (assets) => {
    if (assets.length === 0) return
    const { project, past } = get()
    const existing = new Set(project.media.map((m) => m.path))
    const fresh = assets.filter((a) => !existing.has(a.path))
    if (fresh.length === 0) return
    const next: Project = {
      ...project,
      media: [...project.media, ...fresh],
      updatedAt: Date.now()
    }
    set({ project: next, past: pushHistory(past, project), future: [], dirty: true })
  },

  setProject: (project, filePath) => {
    set({
      project: filePath ? { ...project, filePath } : project,
      past: [],
      future: [],
      selectedClipIds: [],
      playheadSec: 0,
      isPlaying: false,
      dirty: false,
      lastWarnings: []
    })
  },

  newProject: () => {
    get().setProject(createEmptyProject())
  },

  markSaved: (filePath) => {
    set((s) => ({ project: { ...s.project, filePath }, dirty: false }))
  },

  undo: () => {
    const { past, project, future } = get()
    if (past.length === 0) return
    const previous = past[past.length - 1]
    set({
      project: previous,
      past: past.slice(0, -1),
      future: [project, ...future],
      dirty: true
    })
  },

  redo: () => {
    const { future, project, past } = get()
    if (future.length === 0) return
    const next = future[0]
    set({
      project: next,
      future: future.slice(1),
      past: pushHistory(past, project),
      dirty: true
    })
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  select: (clipId, additive = false) => {
    if (clipId === null) {
      set({ selectedClipIds: [] })
      return
    }
    set((s) => {
      if (!additive) return { selectedClipIds: [clipId] }
      const has = s.selectedClipIds.includes(clipId)
      return {
        selectedClipIds: has
          ? s.selectedClipIds.filter((id) => id !== clipId)
          : [...s.selectedClipIds, clipId]
      }
    })
  },

  selectMany: (ids) => set({ selectedClipIds: ids }),
  clearSelection: () => set({ selectedClipIds: [] }),

  setPlayhead: (sec) => set({ playheadSec: Math.max(0, sec) }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),

  setPixelsPerSecond: (pps) => set({ pixelsPerSecond: clampZoom(pps) }),
  zoomIn: () => set((s) => ({ pixelsPerSecond: clampZoom(s.pixelsPerSecond * 1.25) })),
  zoomOut: () => set((s) => ({ pixelsPerSecond: clampZoom(s.pixelsPerSecond / 1.25) }))
}))

function clampZoom(pps: number): number {
  return Math.min(400, Math.max(4, pps))
}

/* ----------------------------------------------------------- selectors */

/** The currently selected clips (resolved against the live project). */
export function useSelectedClips(): Clip[] {
  return useProjectStore((s) => {
    const out: Clip[] = []
    for (const id of s.selectedClipIds) {
      const loc = findClip(s.project, id)
      if (loc) out.push(loc.clip)
    }
    return out
  })
}

/** First selected clip + its track, or null. */
export function useActiveClip(): { clip: Clip; track: Track } | null {
  return useProjectStore((s) => {
    const id = s.selectedClipIds[0]
    if (!id) return null
    const loc = findClip(s.project, id)
    return loc ? { clip: loc.clip, track: loc.track } : null
  })
}

export function useProjectDuration(): number {
  return useProjectStore((s) => projectDuration(s.project))
}
