/**
 * IPC contract between the Electron main process and the renderer.
 *
 * `OceanMixerApi` is the exact shape exposed on `window.api` by the preload
 * script (see src/preload/index.ts). Main-process handlers implement each
 * channel; renderer code calls them through this typed surface. Keep this in
 * lockstep with the preload bridge and the main handlers.
 */

import type { MediaAsset, Project } from './types'
import type { EditOp } from './ai-ops'

/* ------------------------------------------------------------------ Channels */

export const IPC = {
  dialogOpenMedia: 'dialog:openMedia',
  dialogExportPath: 'dialog:exportPath',
  dialogOpenProject: 'dialog:openProject',
  dialogSaveProject: 'dialog:saveProject',

  mediaProbe: 'media:probe',
  mediaThumbnail: 'media:thumbnail',
  mediaWaveform: 'media:waveform',

  exportStart: 'export:start',
  exportCancel: 'export:cancel',
  exportProgress: 'export:progress', // main -> renderer (push)

  projectSave: 'project:save',
  projectLoad: 'project:load',
  projectRecent: 'project:recent',

  aiChat: 'ai:chat',
  aiStream: 'ai:stream', // main -> renderer (push)
  aiStatus: 'ai:status',
  aiSetKey: 'ai:setKey',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsAll: 'settings:all',

  appPaths: 'app:paths',
  appOpenExternal: 'app:openExternal'
} as const

/* ------------------------------------------------------------------- Export */

export type ExportFormat = 'mp4' | 'mov' | 'webm' | 'gif'

export interface ExportOptions {
  outputPath: string
  format: ExportFormat
  /** H.264 by default for mp4/mov; vp9 for webm. */
  videoCodec?: string
  /** constant rate factor; lower = higher quality (~18 visually lossless). */
  crf?: number
  preset?: string // ffmpeg x264 preset
  audioBitrateKbps?: number
  /** optional resolution override; defaults to project settings */
  width?: number
  height?: number
  fps?: number
}

export interface ExportProgress {
  jobId: string
  percent: number // 0..100
  stage: string // 'analyzing' | 'rendering' | 'muxing' | 'done' | 'error'
  fps?: number
  etaSec?: number
  done: boolean
  error?: string
  outputPath?: string
}

export interface ExportHandle {
  jobId: string
}

/* ----------------------------------------------------------------------- AI */

export type AIProvider = 'anthropic'

export interface AIMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AIChatRequest {
  /** the full current project so the Director can reason over it */
  project: Project
  /** conversation so far (excluding the new prompt, which is the last user msg) */
  messages: AIMessage[]
  /** optional id of the currently selected clip, for context */
  selectedClipId?: string
  /** the playhead position (sec), for "add it here" style requests */
  playheadSec?: number
}

export interface AIChatResponse {
  /** assistant's natural-language reply to show in the chat */
  reply: string
  /** edits the Director wants to apply to the project (may be empty) */
  ops: EditOp[]
  /** model id actually used */
  model?: string
  usage?: { inputTokens: number; outputTokens: number }
  error?: string
}

export interface AIStreamEvent {
  requestId: string
  type: 'text' | 'tool' | 'done' | 'error'
  textDelta?: string
  toolName?: string
  error?: string
}

export interface AIStatus {
  provider: AIProvider
  hasKey: boolean
  model: string
}

/* ----------------------------------------------------------------- Projects */

export interface RecentProject {
  path: string
  name: string
  updatedAt: number
}

/* ----------------------------------------------------------------- Settings */

export interface AppSettings {
  anthropicApiKey?: string
  aiModel: string
  defaultExportDir?: string
  theme: 'dark' | 'light'
  /** absolute path to a cache dir for thumbnails/waveforms/proxies */
  cacheDir?: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  aiModel: 'claude-opus-4-8',
  theme: 'dark'
}

/* --------------------------------------------------------------- App paths */

export interface AppPaths {
  home: string
  cache: string
  userData: string
}

/* ------------------------------------------------------- window.api surface */

export interface OceanMixerApi {
  dialog: {
    openMedia(): Promise<MediaAsset[]>
    exportPath(defaultName: string, format: ExportFormat): Promise<string | null>
    openProject(): Promise<{ project: Project; path: string } | null>
    saveProject(defaultName: string): Promise<string | null>
  }
  media: {
    probe(paths: string[]): Promise<MediaAsset[]>
    thumbnail(assetPath: string, atSec: number): Promise<string> // data URL
    waveform(assetPath: string): Promise<string> // file path to PNG
  }
  exporter: {
    start(project: Project, options: ExportOptions): Promise<ExportHandle>
    cancel(jobId: string): Promise<void>
    onProgress(cb: (p: ExportProgress) => void): () => void
  }
  project: {
    save(project: Project, path?: string): Promise<{ path: string }>
    load(path: string): Promise<Project>
    recent(): Promise<RecentProject[]>
  }
  ai: {
    chat(req: AIChatRequest): Promise<AIChatResponse>
    onStream(cb: (e: AIStreamEvent) => void): () => void
    status(): Promise<AIStatus>
    setKey(provider: AIProvider, key: string): Promise<AIStatus>
  }
  settings: {
    get<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]>
    set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void>
    all(): Promise<AppSettings>
  }
  app: {
    paths(): Promise<AppPaths>
    openExternal(url: string): Promise<void>
  }
}
