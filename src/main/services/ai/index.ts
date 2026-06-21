/**
 * AI IPC surface — registers the Creative Director handlers.
 *
 * Channels (see src/shared/ipc.ts):
 *   IPC.aiChat   — run the Director over a project + conversation, return ops.
 *   IPC.aiStatus — report provider/model and whether a key is configured.
 *   IPC.aiSetKey — store the Anthropic key and return refreshed status.
 *
 * The integrator calls registerAIHandlers() once from src/main/ipc/index.ts.
 */

import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { AIChatRequest, AIProvider, AIStatus } from '@shared/ipc'
import { getAnthropicKey, getSettings, setAnthropicKey } from '../settings'
import { runDirector } from './director'

export function registerAIHandlers(): void {
  ipcMain.handle(IPC.aiChat, async (_e, req: AIChatRequest) => {
    return runDirector(req)
  })

  ipcMain.handle(IPC.aiStatus, (): AIStatus => {
    return {
      provider: 'anthropic',
      hasKey: !!getAnthropicKey(),
      model: getSettings().aiModel
    }
  })

  ipcMain.handle(
    IPC.aiSetKey,
    (_e, _provider: AIProvider, key: string): AIStatus => {
      setAnthropicKey(key)
      return {
        provider: 'anthropic',
        hasKey: !!key,
        model: getSettings().aiModel
      }
    }
  )
}
