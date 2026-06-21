/**
 * Anthropic account login via the official `ant` CLI.
 *
 * Rather than reverse-engineering Anthropic's OAuth flow (and impersonating
 * another app's OAuth client), we delegate "Sign in with your Anthropic
 * account" to the first-party `ant` CLI, which implements the browser login,
 * secure token storage, and automatic refresh. We then hand the resulting
 * short-lived OAuth access token to the SDK as a Bearer token
 * (`Authorization: Bearer` + the `anthropic-beta: oauth-2025-04-20` header).
 *
 * `ant auth print-credentials --access-token` refreshes the token if needed and
 * prints just the bearer token, so we call it per request to stay valid.
 *
 * GUI apps launched from Finder inherit a minimal PATH, so `ant` (typically in
 * Homebrew's bin) won't be on PATH — resolveAnt() probes common locations and,
 * as a last resort, asks a login shell.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { join } from 'node:path'

const exec = promisify(execFile)

/** The beta header required when authenticating with an OAuth bearer token. */
export const OAUTH_BETA_HEADER = 'oauth-2025-04-20'

let cachedAntPath: string | null | undefined

/** Augmented environment so spawned `ant` (and the `open`/browser it calls) resolve. */
function augmentedEnv(): NodeJS.ProcessEnv {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
  const current = process.env.PATH ?? ''
  const merged = [current, ...extra].filter(Boolean).join(':')
  return { ...process.env, PATH: merged }
}

async function respondsToVersion(bin: string): Promise<boolean> {
  try {
    await exec(bin, ['--version'], { timeout: 5000, env: augmentedEnv() })
    return true
  } catch {
    return false
  }
}

/** Locate the `ant` binary, or null if it can't be found. Result is cached. */
export async function resolveAnt(): Promise<string | null> {
  if (cachedAntPath !== undefined) return cachedAntPath

  const candidates = [
    'ant',
    '/opt/homebrew/bin/ant',
    '/usr/local/bin/ant',
    join(homedir(), '.local', 'bin', 'ant'),
    join(homedir(), 'go', 'bin', 'ant'),
    '/usr/bin/ant'
  ]
  for (const c of candidates) {
    if (await respondsToVersion(c)) {
      cachedAntPath = c
      return c
    }
  }

  // Last resort: ask a login shell where `ant` is (picks up user PATH config).
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const { stdout } = await exec(shell, ['-lic', 'command -v ant'], {
      timeout: 8000,
      env: augmentedEnv()
    })
    const found = stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean).pop()
    if (found && (await respondsToVersion(found))) {
      cachedAntPath = found
      return found
    }
  } catch {
    /* ignore */
  }

  cachedAntPath = null
  return null
}

export async function isAntAvailable(): Promise<boolean> {
  return (await resolveAnt()) !== null
}

/** Locate the Homebrew binary, or null. */
async function resolveBrew(): Promise<string | null> {
  for (const c of ['/opt/homebrew/bin/brew', '/usr/local/bin/brew', 'brew']) {
    if (await respondsToVersion(c)) return c
  }
  return null
}

export async function isBrewAvailable(): Promise<boolean> {
  return (await resolveBrew()) !== null
}

export interface InstallResult {
  ok: boolean
  error?: string
}

/**
 * Install the `ant` CLI via Homebrew so account login works without the user
 * touching a terminal. Returns ok:false with a message if brew is missing or
 * the install fails. Re-probes the ant cache on success.
 */
export async function installAnt(): Promise<InstallResult> {
  const brew = await resolveBrew()
  if (!brew) return { ok: false, error: 'brew-missing' }
  try {
    await exec(brew, ['install', 'anthropics/tap/ant'], {
      timeout: 1000 * 60 * 6,
      env: { ...augmentedEnv(), HOMEBREW_NO_AUTO_UPDATE: '1', NONINTERACTIVE: '1' }
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  invalidateAntCache()
  const ant = await resolveAnt()
  if (!ant) return { ok: false, error: 'Installed, but the CLI could not be located.' }
  // Best-effort: clear quarantine so the binary runs without a Gatekeeper prompt.
  try {
    await exec('/usr/bin/xattr', ['-d', 'com.apple.quarantine', ant], { timeout: 5000 })
  } catch {
    /* usually nothing to clear */
  }
  return { ok: true }
}

/** Re-probe the CLI on next call (e.g. after the user installs it). */
export function invalidateAntCache(): void {
  cachedAntPath = undefined
}

export interface LoginResult {
  ok: boolean
  /** 'cli-missing' when `ant` isn't installed; otherwise an error message */
  error?: string
}

/**
 * Run `ant auth login`, which opens the system browser and completes via a
 * local callback. Resolves when the CLI process exits (success or failure).
 */
export async function antLogin(): Promise<LoginResult> {
  const ant = await resolveAnt()
  if (!ant) return { ok: false, error: 'cli-missing' }
  try {
    await exec(ant, ['auth', 'login'], { timeout: 1000 * 60 * 3, env: augmentedEnv() })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function antLogout(): Promise<void> {
  const ant = await resolveAnt()
  if (!ant) return
  try {
    await exec(ant, ['auth', 'logout'], { timeout: 20000, env: augmentedEnv() })
  } catch {
    /* best effort */
  }
}

/**
 * Fetch a fresh OAuth access token (the CLI refreshes it if expired). Returns
 * null if `ant` is missing or there is no active session.
 */
export async function antAccessToken(): Promise<string | null> {
  const ant = await resolveAnt()
  if (!ant) return null
  try {
    const { stdout } = await exec(ant, ['auth', 'print-credentials', '--access-token'], {
      timeout: 20000,
      env: augmentedEnv()
    })
    const token = stdout.trim()
    return token.length > 0 ? token : null
  } catch {
    return null
  }
}

export async function antLoggedIn(): Promise<boolean> {
  return (await antAccessToken()) !== null
}

/** Best-effort human label for the active account/workspace from `ant auth status`. */
export async function antAccountLabel(): Promise<string | undefined> {
  const ant = await resolveAnt()
  if (!ant) return undefined
  try {
    const { stdout } = await exec(ant, ['auth', 'status'], { timeout: 15000, env: augmentedEnv() })
    const text = stdout.replace(/\[[0-9;]*m/g, '') // strip ANSI colors
    const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0]
    if (email) return email
    const acct = text.match(/account[^:]*:\s*(.+)/i)?.[1]?.trim()
    if (acct) return acct
    const ws = text.match(/workspace[^:]*:\s*(.+)/i)?.[1]?.trim()
    return ws || undefined
  } catch {
    return undefined
  }
}
