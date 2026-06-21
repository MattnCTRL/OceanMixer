/**
 * Project file persistence for OceanMixer.
 *
 * Projects are stored as pretty-printed JSON in `.ocmix` files. This module
 * handles saving/loading those files, maintaining a backup (`.bak`) of the
 * previous version on save, and keeping a small recent-projects list persisted
 * via electron-store. IPC handlers wire these into the renderer's
 * `window.api.project` surface.
 */

import { ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import Store from 'electron-store'

import type { Project } from '@shared/types'
import { PROJECT_SCHEMA_VERSION } from '@shared/types'
import type { RecentProject } from '@shared/ipc'
import { IPC } from '@shared/ipc'

/* ------------------------------------------------------------- recent store */

interface RecentsSchema {
  recents: RecentProject[]
}

const MAX_RECENTS = 12

const recentsStore = new Store<RecentsSchema>({
  name: 'recents',
  defaults: { recents: [] }
})

/**
 * Add (or move-to-front) a project in the recent list. Deduplicates by path,
 * keeps the list capped at MAX_RECENTS, most-recent-first.
 */
export function addRecentProject(path: string, name: string): void {
  const existing = recentsStore.get('recents', [])
  const entry: RecentProject = {
    path,
    name: name || basename(path),
    updatedAt: Date.now()
  }
  const deduped = existing.filter((r) => r.path !== path)
  const next = [entry, ...deduped].slice(0, MAX_RECENTS)
  recentsStore.set('recents', next)
}

/** Return the recent-projects list, most-recent-first. */
export function getRecentProjects(): RecentProject[] {
  return recentsStore.get('recents', [])
}

/* ------------------------------------------------------------- save / load */

/**
 * Write `project` to `filePath` as pretty JSON. Bumps `updatedAt`, backs up any
 * existing file to `<filePath>.bak`, stamps `filePath` onto the document, and
 * records it in the recent list.
 */
export async function saveProjectToDisk(
  project: Project,
  filePath: string
): Promise<{ path: string }> {
  if (!filePath) {
    throw new Error('saveProjectToDisk: filePath is required')
  }

  // Back up the previous version if one exists. Failure to back up should not
  // block the save (e.g. permission quirks), but real I/O errors on the write
  // below will still surface.
  try {
    await fs.access(filePath)
    await fs.copyFile(filePath, `${filePath}.bak`)
  } catch {
    /* no previous file (or unreadable) — nothing to back up */
  }

  const toWrite: Project = {
    ...project,
    schemaVersion: project.schemaVersion ?? PROJECT_SCHEMA_VERSION,
    filePath,
    updatedAt: Date.now()
  }

  const json = JSON.stringify(toWrite, null, 2)
  await fs.writeFile(filePath, json, 'utf8')

  addRecentProject(filePath, toWrite.name)

  return { path: filePath }
}

/**
 * Read and parse a `.ocmix` file. Validates the basic document shape, fills in a
 * missing `schemaVersion`, stamps the on-disk `filePath`, and records it in the
 * recent list.
 */
export async function loadProjectFromDisk(filePath: string): Promise<Project> {
  if (!filePath) {
    throw new Error('loadProjectFromDisk: filePath is required')
  }

  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (err) {
    throw new Error(
      `Failed to read project file: ${filePath} (${(err as Error).message})`
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `Project file is not valid JSON: ${filePath} (${(err as Error).message})`
    )
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Project file is malformed: ${filePath}`)
  }

  const candidate = parsed as Partial<Project>

  if (!Array.isArray(candidate.tracks)) {
    throw new Error(`Project file is missing a "tracks" array: ${filePath}`)
  }
  if (!Array.isArray(candidate.media)) {
    throw new Error(`Project file is missing a "media" array: ${filePath}`)
  }

  const project: Project = {
    ...(candidate as Project),
    schemaVersion:
      typeof candidate.schemaVersion === 'number'
        ? candidate.schemaVersion
        : PROJECT_SCHEMA_VERSION,
    filePath
  }

  addRecentProject(filePath, project.name)

  return project
}

/* ------------------------------------------------------------- IPC wiring */

/** Register the project-persistence IPC handlers. Call once from ipc/index.ts. */
export function registerProjectHandlers(): void {
  ipcMain.handle(
    IPC.projectSave,
    async (_e, project: Project, path?: string): Promise<{ path: string }> => {
      const target = path ?? project.filePath
      if (!target) {
        throw new Error('No path provided to save the project to')
      }
      return saveProjectToDisk(project, target)
    }
  )

  ipcMain.handle(
    IPC.projectLoad,
    async (_e, path: string): Promise<Project> => {
      return loadProjectFromDisk(path)
    }
  )

  ipcMain.handle(IPC.projectRecent, async (): Promise<RecentProject[]> => {
    return getRecentProjects()
  })
}
