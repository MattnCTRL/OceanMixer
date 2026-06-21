/**
 * Native OS dialogs for importing media and opening/saving projects.
 *
 * Registers IPC handlers that the renderer invokes through `window.api.dialog`.
 * Each handler resolves the dialog against the focused window (falling back to
 * the first available window) so the dialog is sheet-attached on macOS.
 */

import { dialog, BrowserWindow, ipcMain } from 'electron'
import { IPC, type ExportFormat } from '../../shared/ipc'
import { probePaths } from './media'
import { loadProjectFromDisk } from './project'

/** Resolve the window the dialog should be parented to, if any. */
function targetWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined
}

/**
 * Wire up all dialog-related IPC handlers. Called once during app startup by
 * the central IPC registrar. Safe to assume it runs after `app.whenReady()`.
 */
export function registerDialogHandlers(): void {
  ipcMain.handle(IPC.dialogOpenMedia, async () => {
    const win = targetWindow()
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Media',
          extensions: [
            'mp4',
            'mov',
            'm4v',
            'webm',
            'mkv',
            'avi',
            'mp3',
            'wav',
            'aac',
            'm4a',
            'flac',
            'ogg',
            'png',
            'jpg',
            'jpeg',
            'gif',
            'webp',
            'bmp',
            'heic',
            'tiff'
          ]
        }
      ]
    })
    if (res.canceled) return []
    return probePaths(res.filePaths)
  })

  ipcMain.handle(
    IPC.dialogExportPath,
    async (_e, defaultName: string, format: ExportFormat) => {
      const win = targetWindow()
      const res = await dialog.showSaveDialog(win!, {
        defaultPath: defaultName + '.' + format,
        filters: [{ name: format.toUpperCase(), extensions: [format] }]
      })
      return res.canceled ? null : res.filePath ?? null
    }
  )

  ipcMain.handle(IPC.dialogOpenProject, async () => {
    const win = targetWindow()
    const res = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'OceanMixer Project', extensions: ['ocmix', 'json'] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    const path = res.filePaths[0]
    const project = await loadProjectFromDisk(path)
    return { project, path }
  })

  ipcMain.handle(IPC.dialogSaveProject, async (_e, defaultName: string) => {
    const win = targetWindow()
    const res = await dialog.showSaveDialog(win!, {
      defaultPath: defaultName + '.ocmix',
      filters: [{ name: 'OceanMixer Project', extensions: ['ocmix'] }]
    })
    return res.canceled ? null : res.filePath ?? null
  })
}
