import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, KeyRound, X } from 'lucide-react'
import clsx from 'clsx'
import type { AIStatus, AppSettings } from '@shared/ipc'

const CONSOLE_URL = 'https://console.anthropic.com/settings/keys'

export function SettingsModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): JSX.Element | null {
  const [status, setStatus] = useState<AIStatus | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [defaultExportDir, setDefaultExportDir] =
    useState<AppSettings['defaultExportDir']>(undefined)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refreshStatus = useCallback(async () => {
    try {
      const s = await window.api.ai.status()
      setStatus(s)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  // Load status + settings whenever the modal opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSaveError(null)
    setJustSaved(false)
    setKeyInput('')
    ;(async () => {
      try {
        const s = await window.api.ai.status()
        if (!cancelled) setStatus(s)
      } catch (err) {
        if (!cancelled) setSaveError(err instanceof Error ? err.message : String(err))
      }
      try {
        const dir = await window.api.settings.get('defaultExportDir')
        if (!cancelled) setDefaultExportDir(dir)
      } catch {
        /* non-fatal: leave export dir unset */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Clear the pending "Key saved" timer on unmount.
  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [])

  const handleSaveKey = useCallback(async () => {
    const trimmed = keyInput.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setSaveError(null)
    setJustSaved(false)
    try {
      const next = await window.api.ai.setKey('anthropic', trimmed)
      setStatus(next)
      setKeyInput('')
      setJustSaved(true)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setJustSaved(false), 2500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      // Make sure the status reflects reality after a failure.
      void refreshStatus()
    } finally {
      setSaving(false)
    }
  }, [keyInput, saving, refreshStatus])

  const handleOpenConsole = useCallback(() => {
    void window.api.app.openExternal(CONSOLE_URL)
  }, [])

  if (!open) return null

  const hasKey = status?.hasKey ?? false
  const model = status?.model ?? 'claude-opus-4-8'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-ocean-border bg-ocean-panel shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ocean-border px-5 py-4">
          <h2 className="text-base font-semibold text-ocean-text">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ocean-muted transition-colors hover:bg-ocean-panel-2 hover:text-ocean-text"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] space-y-6 overflow-y-auto px-5 py-5">
          {/* AI section */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-ocean-accent" />
              <h3 className="text-sm font-semibold text-ocean-text">
                AI (Creative Director)
              </h3>
              {hasKey && (
                <span className="inline-flex items-center gap-1 rounded-full bg-ocean-ok/15 px-2 py-0.5 text-xs font-medium text-ocean-ok">
                  <Check className="h-3 w-3" />
                  Connected
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="anthropic-api-key"
                className="block text-xs font-medium text-ocean-muted"
              >
                Anthropic API key
              </label>
              <div className="flex gap-2">
                <input
                  id="anthropic-api-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void handleSaveKey()
                    }
                  }}
                  placeholder={hasKey ? 'Key set — enter a new key to replace' : 'sk-ant-...'}
                  className="min-w-0 flex-1 rounded-md border border-ocean-border bg-ocean-bg px-3 py-2 text-sm text-ocean-text placeholder:text-ocean-muted/60 focus:border-ocean-accent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveKey()}
                  disabled={saving || keyInput.trim().length === 0}
                  className={clsx(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    saving || keyInput.trim().length === 0
                      ? 'cursor-not-allowed bg-ocean-panel-2 text-ocean-muted'
                      : 'bg-ocean-accent text-ocean-bg hover:opacity-90'
                  )}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>

              {justSaved && (
                <p className="inline-flex items-center gap-1 text-xs font-medium text-ocean-ok">
                  <Check className="h-3.5 w-3.5" />
                  Key saved
                </p>
              )}
              {saveError && (
                <p className="text-xs font-medium text-ocean-danger">{saveError}</p>
              )}

              <p className="pt-1 text-xs leading-relaxed text-ocean-muted">
                Your key is stored locally on this machine and only used to call the
                Anthropic API.
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-ocean-muted">Model</span>
              <div className="rounded-md border border-ocean-border bg-ocean-bg px-3 py-2 text-sm text-ocean-text">
                {model}
              </div>
            </div>

            <button
              type="button"
              onClick={handleOpenConsole}
              className="text-xs font-medium text-ocean-accent-2 underline-offset-2 hover:underline"
            >
              Anthropic Console
            </button>
          </section>

          <div className="h-px bg-ocean-border" />

          {/* Project defaults */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-ocean-text">Project defaults</h3>
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-ocean-muted">
                Default export folder
              </span>
              <div
                className="truncate rounded-md border border-ocean-border bg-ocean-bg px-3 py-2 text-sm text-ocean-text"
                title={defaultExportDir || undefined}
              >
                {defaultExportDir ? (
                  defaultExportDir
                ) : (
                  <span className="text-ocean-muted">
                    Not set — you’ll be asked on export
                  </span>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-ocean-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-ocean-border bg-ocean-panel-2 px-4 py-2 text-sm font-medium text-ocean-text transition-colors hover:bg-ocean-bg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
