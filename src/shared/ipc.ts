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
  dialogOpenFolder: 'dialog:openFolder',

  mediaProbe: 'media:probe',
  mediaThumbnail: 'media:thumbnail',
  mediaWaveform: 'media:waveform',
  mediaSaveRecording: 'media:saveRecording',

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
  aiLogin: 'ai:login',
  aiLogout: 'ai:logout',
  aiInstallCli: 'ai:installCli',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsAll: 'settings:all',

  appPaths: 'app:paths',
  appOpenExternal: 'app:openExternal',
  appOpenAudioMidi: 'app:openAudioMidi'
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

/** How the Director authenticates: a pasted API key, or an Anthropic account login. */
export type AIAuthMode = 'apiKey' | 'oauth'

export interface AIStatus {
  provider: AIProvider
  model: string
  /** which credential the Director will use */
  authMode: AIAuthMode
  /** an API key is stored locally */
  hasKey: boolean
  /** an Anthropic account (OAuth) session is active and usable */
  loggedIn: boolean
  /** the `ant` CLI (used for account login) is installed and resolvable */
  cliAvailable: boolean
  /** Homebrew is available so the CLI can be installed with one click */
  canInstallCli: boolean
  /** account/workspace label when logged in (best effort) */
  account?: string
  /** whether the Director can make calls right now under the active authMode */
  ready: boolean
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
  /** preferred Director auth: pasted API key, or Anthropic account login */
  authMode?: AIAuthMode
  aiModel: string
  defaultExportDir?: string
  theme: 'dark' | 'light'
  /** absolute path to a cache dir for thumbnails/waveforms/proxies */
  cacheDir?: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  aiModel: 'claude-opus-4-8',
  authMode: 'apiKey',
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
    /** pick a folder; recursively imports all media files inside it */
    openMediaFolder(): Promise<MediaAsset[]>
    exportPath(defaultName: string, format: ExportFormat): Promise<string | null>
    openProject(): Promise<{ project: Project; path: string } | null>
    saveProject(defaultName: string): Promise<string | null>
  }
  media: {
    probe(paths: string[]): Promise<MediaAsset[]>
    thumbnail(assetPath: string, atSec: number): Promise<string> // data URL
    waveform(assetPath: string): Promise<string> // file path to PNG
    /** persist a recorded audio blob to disk, probe it, return the asset */
    saveRecording(bytes: Uint8Array, ext: string, name?: string): Promise<MediaAsset>
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
    /** start an Anthropic account login (opens a browser via the `ant` CLI) */
    login(): Promise<AIStatus>
    /** sign out of the Anthropic account session */
    logout(): Promise<AIStatus>
    /** install the `ant` CLI via Homebrew (one-click sign-in helper setup) */
    installCli(): Promise<AIStatus>
  }
  settings: {
    get<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]>
    set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void>
    all(): Promise<AppSettings>
  }
  app: {
    paths(): Promise<AppPaths>
    openExternal(url: string): Promise<void>
    /** resolve the absolute path of a File dropped from the OS (Finder/Photos) */
    pathForFile(file: File): string
    /** open macOS Audio MIDI Setup (for configuring loopback / multi-output) */
    openAudioMidiSetup(): Promise<void>
  }
}
