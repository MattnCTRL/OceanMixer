/**
 * Settings + app paths service (main process).
 *
 * Persists `AppSettings` (including the sensitive Anthropic API key) to a
 * typed electron-store on the local machine. Exposes IPC handlers for the
 * renderer settings UI plus helper accessors used by other main services.
 */

import { app, ipcMain, shell } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import Store from 'electron-store'
import { IPC, DEFAULT_SETTINGS } from '@shared/ipc'
import type { AppSettings, AppPaths } from '@shared/ipc'

/* --------------------------------------------------------------------- Store */

let _store: Store<AppSettings> | undefined

/**
 * Lazily construct the store. Constructing on first use (rather than at module
 * load) keeps things robust if `app` isn't ready yet, and isolates failures
 * (e.g. a corrupt/missing store file) so they don't crash the whole module.
 */
function store(): Store<AppSettings> {
  if (_store) return _store
  try {
    _store = new Store<AppSettings>({
      name: 'settings',
      defaults: DEFAULT_SETTINGS,
      // Don't let a single malformed key brick the app; clear on parse error.
      clearInvalidConfig: true
    })
  } catch {
    // If the on-disk file is unreadable/corrupt, fall back to a fresh store.
    _store = new Store<AppSettings>({
      name: 'settings',
      defaults: DEFAULT_SETTINGS,
      clearInvalidConfig: true
    })
  }
  return _store
}

/* ----------------------------------------------------------------- Accessors */

/** Full settings including the API key, for use by other main services. */
export function getSettings(): AppSettings {
  // Spread over defaults so callers always receive every required field even
  // if the persisted object is partial.
  return { ...DEFAULT_SETTINGS, ...store().store }
}

export function getAnthropicKey(): string | undefined {
  const key = store().get('anthropicApiKey')
  if (typeof key !== 'string') return undefined
  const trimmed = key.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Helper used by the ai service to persist a key after the user enters it. */
export function setAnthropicKey(key: string): void {
  const trimmed = key.trim()
  if (trimmed.length > 0) {
    store().set('anthropicApiKey', trimmed)
  } else {
    store().delete('anthropicApiKey')
  }
}

/**
 * Returns an absolute path to the cache directory, creating it (recursively)
 * if it does not yet exist. Honors a user-configured `cacheDir` when it is an
 * absolute path; otherwise defaults to `<userData>/cache`.
 */
export function getCacheDir(): string {
  const configured = store().get('cacheDir')
  const dir =
    typeof configured === 'string' && configured.trim().length > 0 && isAbsolute(configured)
      ? configured
      : join(app.getPath('userData'), 'cache')

  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  } catch {
    // If the configured dir can't be created, fall back to the default and try
    // once more so callers always get a usable directory.
    const fallback = join(app.getPath('userData'), 'cache')
    try {
      if (!existsSync(fallback)) mkdirSync(fallback, { recursive: true })
    } catch {
      /* best effort */
    }
    return fallback
  }

  return dir
}

/* ------------------------------------------------------------------ Handlers */

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.settingsGet, async (_e, key: keyof AppSettings) => {
    return store().get(key)
  })

  ipcMain.handle(
    IPC.settingsSet,
    async (_e, key: keyof AppSettings, value: AppSettings[keyof AppSettings]) => {
      if (value === undefined) {
        store().delete(key)
      } else {
        // Cast required: electron-store's typed setter wants the exact value
        // type for the given key, which the generic erases here.
        store().set(key, value as never)
      }
    }
  )

  ipcMain.handle(IPC.settingsAll, async (): Promise<AppSettings> => {
    // Return the full settings shape but never leak the secret key to the
    // renderer. The renderer learns key presence via api.ai.status().
    const all = getSettings()
    return { ...all, anthropicApiKey: undefined }
  })

  ipcMain.handle(IPC.appPaths, async (): Promise<AppPaths> => {
    return {
      home: app.getPath('home'),
      cache: getCacheDir(),
      userData: app.getPath('userData')
    }
  })

  ipcMain.handle(IPC.appOpenExternal, async (_e, url: string) => {
    await shell.openExternal(url)
  })
}
