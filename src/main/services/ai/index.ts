/**
 * AI IPC surface — registers the Creative Director handlers.
 *
 * Channels (see src/shared/ipc.ts):
 *   IPC.aiChat   — run the Director over a project + conversation, return ops.
 *   IPC.aiStatus — report provider/model + auth state (key, account login, CLI).
 *   IPC.aiSetKey — store the Anthropic key (switches authMode to apiKey).
 *   IPC.aiLogin  — sign in with an Anthropic account via the `ant` CLI (OAuth).
 *   IPC.aiLogout — sign out of the account session.
 *
 * The integrator calls registerAIHandlers() once from src/main/ipc/index.ts.
 */

import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { AIChatRequest, AIProvider, AIStatus } from '@shared/ipc'
import {
  getAnthropicKey,
  getAuthMode,
  getSettings,
  setAnthropicKey,
  setAuthMode
} from '../settings'
import { runDirector } from './director'
import {
  antAccountLabel,
  antLogin,
  antLoggedIn,
  antLogout,
  installAnt,
  invalidateAntCache,
  isAntAvailable,
  isBrewAvailable
} from './anthropicAuth'

/** Assemble the full Director status (auth state + CLI availability). */
async function buildStatus(): Promise<AIStatus> {
  const settings = getSettings()
  const hasKey = !!getAnthropicKey()
  const cliAvailable = await isAntAvailable()
  const loggedIn = cliAvailable ? await antLoggedIn() : false
  const account = loggedIn ? await antAccountLabel() : undefined
  const canInstallCli = !cliAvailable && (await isBrewAvailable())
  const authMode = getAuthMode()
  const ready = authMode === 'oauth' ? loggedIn || hasKey : hasKey || loggedIn
  return {
    provider: 'anthropic',
    model: settings.aiModel,
    authMode,
    hasKey,
    loggedIn,
    cliAvailable,
    canInstallCli,
    account,
    ready
  }
}

export function registerAIHandlers(): void {
  ipcMain.handle(IPC.aiChat, async (_e, req: AIChatRequest) => {
    return runDirector(req)
  })

  ipcMain.handle(IPC.aiStatus, async (): Promise<AIStatus> => buildStatus())

  ipcMain.handle(
    IPC.aiSetKey,
    async (_e, _provider: AIProvider, key: string): Promise<AIStatus> => {
      setAnthropicKey(key)
      // Saving a key implies the user wants to use it.
      if (key.trim().length > 0) setAuthMode('apiKey')
      return buildStatus()
    }
  )

  ipcMain.handle(IPC.aiLogin, async (): Promise<AIStatus> => {
    invalidateAntCache() // re-probe in case the user just installed `ant`
    const result = await antLogin()
    if (result.ok) setAuthMode('oauth')
    return buildStatus()
  })

  ipcMain.handle(IPC.aiLogout, async (): Promise<AIStatus> => {
    await antLogout()
    setAuthMode('apiKey')
    return buildStatus()
  })

  ipcMain.handle(IPC.aiInstallCli, async (): Promise<AIStatus> => {
    await installAnt()
    return buildStatus()
  })
}
