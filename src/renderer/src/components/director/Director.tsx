/**
 * AI Creative Director chat panel.
 *
 * Lets the user converse with the AI editor. The Director reasons over the live
 * project (sent on every turn) and may return EditOps which are applied through
 * the shared store pipeline, so AI edits share undo/redo with manual edits.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Sparkles, Send, KeyRound, AlertTriangle, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import type { AIMessage, AIChatRequest, AIStatus } from '@shared/ipc'
import { useProjectStore } from '@renderer/store/projectStore'

/** A chat entry. `system` entries are local-only notices (warnings, errors). */
interface ChatEntry {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  /** number of edits applied as a result of an assistant turn */
  appliedCount?: number
}

const EXAMPLE_PROMPTS = [
  'Lay all my clips end to end',
  "Add a title that says 'My Trip' for the first 3 seconds",
  'Trim the first clip to 5 seconds'
]

let entryCounter = 0
function nextEntryId(): string {
  entryCounter += 1
  return `entry_${Date.now().toString(36)}_${entryCounter}`
}

export function Director(): JSX.Element {
  const [status, setStatus] = useState<AIStatus | null>(null)
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const loadingRef = useRef(false)

  /* Load AI status on mount. */
  useEffect(() => {
    let cancelled = false
    window.api.ai
      .status()
      .then((s) => {
        if (!cancelled) setStatus(s)
      })
      .catch(() => {
        if (!cancelled) setStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  /* Auto-scroll to bottom whenever the conversation grows or loading toggles. */
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries, loading])

  const send = useCallback(async (raw: string) => {
    const text = raw.trim()
    if (!text || loadingRef.current) return

    loadingRef.current = true
    setLoading(true)
    setInput('')

    // Build the prior conversation (user/assistant only) before appending.
    let priorMessages: AIMessage[] = []
    setEntries((prev) => {
      priorMessages = prev
        .filter((e): e is ChatEntry & { role: 'user' | 'assistant' } => e.role !== 'system')
        .map((e) => ({ role: e.role, content: e.content }))
      return [...prev, { id: nextEntryId(), role: 'user', content: text }]
    })

    const userMsg: AIMessage = { role: 'user', content: text }
    const state = useProjectStore.getState()
    const req: AIChatRequest = {
      project: state.project,
      messages: [...priorMessages, userMsg],
      selectedClipId: state.selectedClipIds[0],
      playheadSec: state.playheadSec
    }

    try {
      const res = await window.api.ai.chat(req)

      if (res.error) {
        setEntries((prev) => [
          ...prev,
          {
            id: nextEntryId(),
            role: 'assistant',
            content: res.reply || ''
          },
          {
            id: nextEntryId(),
            role: 'system',
            content: `Error: ${res.error}`
          }
        ])
      } else {
        let appliedCount = 0
        let warnings: string[] = []
        if (res.ops && res.ops.length > 0) {
          warnings = useProjectStore.getState().apply(res.ops)
          appliedCount = res.ops.length
        }

        setEntries((prev) => {
          const out: ChatEntry[] = [
            ...prev,
            {
              id: nextEntryId(),
              role: 'assistant',
              content: res.reply,
              appliedCount: appliedCount > 0 ? appliedCount : undefined
            }
          ]
          if (warnings.length > 0) {
            out.push({
              id: nextEntryId(),
              role: 'system',
              content: warnings.join('\n')
            })
          }
          return out
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setEntries((prev) => [
        ...prev,
        {
          id: nextEntryId(),
          role: 'system',
          content: `Could not reach the AI service: ${message}`
        }
      ])
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [])

  const onSubmit = useCallback(() => {
    void send(input)
  }, [input, send])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void send(input)
      }
    },
    [input, send]
  )

  const onChipClick = useCallback((prompt: string) => {
    setInput(prompt)
    textareaRef.current?.focus()
  }, [])

  const ready = status?.ready ?? false
  const isEmpty = entries.length === 0

  return (
    <div className="flex h-full flex-col bg-ocean-panel text-ocean-text">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-ocean-border px-3 py-2">
        <Sparkles size={16} className="text-ocean-accent" />
        <span className="text-sm font-medium">Creative Director</span>
        {status?.model ? (
          <span className="ml-auto truncate text-xs text-ocean-muted" title={status.model}>
            {status.model}
          </span>
        ) : null}
      </div>

      {/* Not-connected notice */}
      {status && !ready ? (
        <div className="flex items-start gap-2 border-b border-ocean-border bg-ocean-panel-2 px-3 py-2 text-xs text-ocean-muted">
          <KeyRound size={14} className="mt-0.5 shrink-0 text-ocean-accent-2" />
          <span>
            Not connected. Open <span className="text-ocean-text">Settings</span> from the top bar to
            sign in with your Anthropic account or add an API key. You can still type, but the
            Director can&apos;t make edits yet.
          </span>
        </div>
      ) : null}

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {isEmpty ? (
          <div className="flex flex-col gap-3 py-6 text-center">
            <div className="flex flex-col items-center gap-2 text-ocean-muted">
              <Sparkles size={28} className="text-ocean-accent" />
              <p className="text-sm">
                Tell the Director what you want to make. It can cut, arrange, title, and trim your
                timeline.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => onChipClick(prompt)}
                  className="rounded-md border border-ocean-border bg-ocean-panel-2 px-3 py-2 text-left text-xs text-ocean-text transition-colors hover:border-ocean-accent hover:text-ocean-accent"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          entries.map((entry) => <Bubble key={entry.id} entry={entry} />)
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-ocean-muted">
            <Loader2 size={14} className="animate-spin text-ocean-accent" />
            <span>Director is thinking…</span>
          </div>
        ) : null}
      </div>

      {/* Input */}
      <div className="border-t border-ocean-border p-2">
        <div className="flex items-end gap-2 rounded-md border border-ocean-border bg-ocean-panel-2 p-2 focus-within:border-ocean-accent">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="Ask the Director to edit your project…"
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent text-sm text-ocean-text placeholder:text-ocean-muted focus:outline-none"
          />
          <button
            type="button"
            onClick={onSubmit}
            disabled={loading || input.trim().length === 0}
            aria-label="Send"
            className={clsx(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
              loading || input.trim().length === 0
                ? 'cursor-not-allowed bg-ocean-panel text-ocean-muted'
                : 'bg-ocean-accent text-ocean-bg hover:opacity-90'
            )}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
        <p className="mt-1 px-1 text-[10px] text-ocean-muted">
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- Bubble */

function Bubble({ entry }: { entry: ChatEntry }): JSX.Element {
  if (entry.role === 'system') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-ocean-border bg-ocean-panel-2 px-3 py-2 text-xs text-ocean-muted">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-ocean-danger" />
        <span className="whitespace-pre-wrap">{entry.content}</span>
      </div>
    )
  }

  const isUser = entry.role === 'user'
  return (
    <div className={clsx('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={clsx(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm',
          isUser
            ? 'bg-ocean-accent text-ocean-bg'
            : 'border border-ocean-border bg-ocean-panel-2 text-ocean-text'
        )}
      >
        <p className="whitespace-pre-wrap break-words">{entry.content}</p>
        {!isUser && entry.appliedCount ? (
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-ocean-ok/20 px-2 py-0.5 text-[10px] font-medium text-ocean-ok">
            <Sparkles size={10} />
            Applied {entry.appliedCount} {entry.appliedCount === 1 ? 'edit' : 'edits'}
          </span>
        ) : null}
      </div>
    </div>
  )
}
