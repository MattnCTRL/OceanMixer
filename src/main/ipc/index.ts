/**
 * Central IPC handler registry.
 *
 * Each service registers its `ipcMain.handle(...)` channels here. This file is
 * the single place `src/main/index.ts` calls to wire the main process to the
 * renderer. Service modules live under src/main/services/*.
 */

export function registerIpcHandlers(): void {
  // Handlers are registered by feature modules (media, exporter, project, ai,
  // settings, app). They are added here as each service is implemented.
}
