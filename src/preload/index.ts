import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  OceanMixerApi,
  ExportProgress,
  AIStreamEvent
} from '../shared/ipc'

const api: OceanMixerApi = {
  dialog: {
    openMedia: () => ipcRenderer.invoke(IPC.dialogOpenMedia),
    openMediaFolder: () => ipcRenderer.invoke(IPC.dialogOpenFolder),
    exportPath: (defaultName, format) =>
      ipcRenderer.invoke(IPC.dialogExportPath, defaultName, format),
    openProject: () => ipcRenderer.invoke(IPC.dialogOpenProject),
    saveProject: (defaultName) => ipcRenderer.invoke(IPC.dialogSaveProject, defaultName)
  },
  media: {
    probe: (paths) => ipcRenderer.invoke(IPC.mediaProbe, paths),
    thumbnail: (assetPath, atSec) => ipcRenderer.invoke(IPC.mediaThumbnail, assetPath, atSec),
    waveform: (assetPath) => ipcRenderer.invoke(IPC.mediaWaveform, assetPath),
    saveRecording: (bytes, ext, name) =>
      ipcRenderer.invoke(IPC.mediaSaveRecording, bytes, ext, name)
  },
  exporter: {
    start: (project, options) => ipcRenderer.invoke(IPC.exportStart, project, options),
    cancel: (jobId) => ipcRenderer.invoke(IPC.exportCancel, jobId),
    onProgress: (cb) => {
      const listener = (_e: unknown, p: ExportProgress): void => cb(p)
      ipcRenderer.on(IPC.exportProgress, listener)
      return () => ipcRenderer.removeListener(IPC.exportProgress, listener)
    }
  },
  project: {
    save: (project, path) => ipcRenderer.invoke(IPC.projectSave, project, path),
    load: (path) => ipcRenderer.invoke(IPC.projectLoad, path),
    recent: () => ipcRenderer.invoke(IPC.projectRecent)
  },
  ai: {
    chat: (req) => ipcRenderer.invoke(IPC.aiChat, req),
    onStream: (cb) => {
      const listener = (_e: unknown, ev: AIStreamEvent): void => cb(ev)
      ipcRenderer.on(IPC.aiStream, listener)
      return () => ipcRenderer.removeListener(IPC.aiStream, listener)
    },
    status: () => ipcRenderer.invoke(IPC.aiStatus),
    setKey: (provider, key) => ipcRenderer.invoke(IPC.aiSetKey, provider, key),
    login: () => ipcRenderer.invoke(IPC.aiLogin),
    logout: () => ipcRenderer.invoke(IPC.aiLogout),
    installCli: () => ipcRenderer.invoke(IPC.aiInstallCli)
  },
  settings: {
    get: (key) => ipcRenderer.invoke(IPC.settingsGet, key),
    set: (key, value) => ipcRenderer.invoke(IPC.settingsSet, key, value),
    all: () => ipcRenderer.invoke(IPC.settingsAll)
  },
  app: {
    paths: () => ipcRenderer.invoke(IPC.appPaths),
    openExternal: (url) => ipcRenderer.invoke(IPC.appOpenExternal, url),
    pathForFile: (file) => webUtils.getPathForFile(file),
    openAudioMidiSetup: () => ipcRenderer.invoke(IPC.appOpenAudioMidi)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-expect-error fallback when context isolation is disabled
  window.api = api
}
