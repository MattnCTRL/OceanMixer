/**
 * Central IPC handler registry.
 *
 * Each feature service exposes a register function; this file is the single
 * place src/main/index.ts calls to wire the main process to the renderer.
 * Settings is registered first because other services read settings at runtime.
 */

import { registerSettingsHandlers } from '../services/settings'
import { registerMediaHandlers } from '../services/media'
import { registerProjectHandlers } from '../services/project'
import { registerDialogHandlers } from '../services/dialog'
import { registerExportHandlers } from '../services/exporter'
import { registerAIHandlers } from '../services/ai'

export function registerIpcHandlers(): void {
  registerSettingsHandlers()
  registerMediaHandlers()
  registerProjectHandlers()
  registerDialogHandlers()
  registerExportHandlers()
  registerAIHandlers()
}
