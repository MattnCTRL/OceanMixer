import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  Download,
  KeyRound,
  LogIn,
  LogOut,
  Loader2,
  RefreshCw,
  Terminal,
  UserRound,
  X
} from 'lucide-react'
import clsx from 'clsx'
import type { AIAuthMode, AIStatus, AppSettings } from '@shared/ipc'
import { LogoMark } from '@renderer/components/brand/Logo'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { useUIStore } from '@renderer/store/uiStore'

const CONSOLE_URL = 'https://console.anthropic.com/settings/keys'
const CLI_INSTALL_URL = 'https://github.com/anthropics/anthropic-cli/releases'
const CLI_BREW_CMD = 'brew install anthropics/tap/ant'

export function SettingsModal(): JSX.Element | null {
  const open = useUIStore((s) => s.settingsOpen)
  const close = useUIStore((s) => s.closeSettings)

  const [status, setStatus] = useState<AIStatus | null>(null)
  const [mode, setMode] = useState<AIAuthMode>('apiKey')
  const [keyInput, setKeyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const [defaultExportDir, setDefaultExportDir] =
    useState<AppSettings['defaultExportDir']>(undefined)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refreshStatus = useCallback(async () => {
    try {
      const s = await window.api.ai.status()
      setStatus(s)
      setMode(s.authMode)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  // Load status + settings whenever the modal opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSaveError(null)
    setLoginError(null)
    setInstallError(null)
    setJustSaved(false)
    setKeyInput('')
    ;(async () => {
      try {
        const s = await window.api.ai.status()
        if (!cancelled) {
          setStatus(s)
          setMode(s.authMode)
        }
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

  // Close on Escape while open (but not mid-login/install — those run long async).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !loginBusy && !installing) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close, loginBusy, installing])

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
      setMode(next.authMode)
      setKeyInput('')
      setJustSaved(true)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setJustSaved(false), 2500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      void refreshStatus()
    } finally {
      setSaving(false)
    }
  }, [keyInput, saving, refreshStatus])

  const handleSwitchMode = useCallback(async (m: AIAuthMode) => {
    setMode(m)
    setSaveError(null)
    setLoginError(null)
    setInstallError(null)
    try {
      await window.api.settings.set('authMode', m)
      const s = await window.api.ai.status()
      setStatus(s)
    } catch {
      /* preference persist is best-effort */
    }
  }, [])

  const handleLogin = useCallback(async () => {
    if (loginBusy) return
    setLoginBusy(true)
    setLoginError(null)
    try {
      const s = await window.api.ai.login()
      setStatus(s)
      setMode(s.authMode)
      if (!s.loggedIn) {
        setLoginError(
          s.cliAvailable
            ? 'Login did not complete. Please try again.'
            : 'The Anthropic CLI was not found. Install it, then try again.'
        )
      }
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoginBusy(false)
    }
  }, [loginBusy])

  const handleInstallCli = useCallback(async () => {
    if (installing) return
    setInstalling(true)
    setInstallError(null)
    try {
      const s = await window.api.ai.installCli()
      setStatus(s)
      setMode(s.authMode)
      if (!s.cliAvailable) {
        setInstallError(
          'The sign-in helper could not be installed automatically. Try the manual steps below.'
        )
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err))
    } finally {
      setInstalling(false)
    }
  }, [installing])

  const handleLogout = useCallback(async () => {
    try {
      const s = await window.api.ai.logout()
      setStatus(s)
      setMode(s.authMode)
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  if (!open) return null

  const ready = status?.ready ?? false
  const model = status?.model ?? 'claude-opus-4-8'
  const cliAvailable = status?.cliAvailable ?? false
  const canInstallCli = status?.canInstallCli ?? false
  const loggedIn = status?.loggedIn ?? false
  const account = status?.account

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loginBusy && !installing) close()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-ocean-border bg-ocean-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-ocean-border px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ocean-text">
            <LogoMark size={18} />
            Settings
          </h2>
          <Tooltip label="Close" keys="Esc" side="left">
            <button
              type="button"
              onClick={close}
              className="rounded-md p-1 text-ocean-muted transition-colors hover:bg-ocean-panel-2 hover:text-ocean-text"
              aria-label="Close settings"
            >
              <X className="h-4 w-4" />
            </button>
          </Tooltip>
        </div>

        <div className="max-h-[72vh] space-y-6 overflow-y-auto px-5 py-5">
          {/* AI section */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-ocean-accent" />
              <h3 className="text-sm font-semibold text-ocean-text">Creative Director</h3>
              {ready && (
                <span className="inline-flex items-center gap-1 rounded-full bg-ocean-ok/15 px-2 py-0.5 text-xs font-medium text-ocean-ok">
                  <Check className="h-3 w-3" />
                  Connected
                </span>
              )}
            </div>

            {/* Auth mode toggle */}
            <div className="inline-flex rounded-lg border border-ocean-border bg-ocean-bg p-0.5 text-xs font-medium">
              {(
                [
                  {
                    id: 'oauth',
                    label: 'Anthropic account',
                    icon: UserRound,
                    tip: 'Sign in with your Anthropic account',
                    desc: 'Use the same browser sign-in as the terminal. No API key required.'
                  },
                  {
                    id: 'apiKey',
                    label: 'API key',
                    icon: KeyRound,
                    tip: 'Use an Anthropic API key',
                    desc: 'Paste a key from the Anthropic Console. Stored locally on this machine.'
                  }
                ] as {
                  id: AIAuthMode
                  label: string
                  icon: typeof KeyRound
                  tip: string
                  desc: string
                }[]
              ).map((opt) => {
                const active = mode === opt.id
                const Icon = opt.icon
                return (
                  <Tooltip key={opt.id} label={opt.tip} description={opt.desc} side="bottom">
                    <button
                      type="button"
                      onClick={() => void handleSwitchMode(opt.id)}
                      className={clsx(
                        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors',
                        active
                          ? 'bg-ocean-accent text-ocean-bg'
                          : 'text-ocean-muted hover:text-ocean-text'
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {opt.label}
                    </button>
                  </Tooltip>
                )
              })}
            </div>

            {/* Account (OAuth) mode */}
            {mode === 'oauth' && (
              <div className="space-y-2">
                <p className="text-xs leading-relaxed text-ocean-muted">
                  Sign in with your Anthropic account (the same browser sign-in you use in
                  the terminal). No API key needed.
                </p>

                {loggedIn ? (
                  <div className="flex items-center justify-between rounded-md border border-ocean-border bg-ocean-bg px-3 py-2.5">
                    <span className="inline-flex items-center gap-2 text-sm text-ocean-text">
                      <Check className="h-4 w-4 text-ocean-ok" />
                      Signed in{account ? ` as ${account}` : ''}
                    </span>
                    <Tooltip
                      label="Sign out"
                      description="Disconnect this Anthropic account from OceanMixer."
                      side="left"
                    >
                      <button
                        type="button"
                        onClick={() => void handleLogout()}
                        className="inline-flex items-center gap-1.5 rounded-md border border-ocean-border px-2.5 py-1.5 text-xs font-medium text-ocean-text transition-colors hover:bg-ocean-panel-2"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        Sign out
                      </button>
                    </Tooltip>
                  </div>
                ) : cliAvailable ? (
                  <Tooltip
                    label="Sign in with Anthropic"
                    description="Opens your browser to complete the secure sign-in."
                    side="bottom"
                  >
                    <button
                      type="button"
                      onClick={() => void handleLogin()}
                      disabled={loginBusy}
                      className={clsx(
                        'inline-flex w-full items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-semibold transition-opacity',
                        loginBusy
                          ? 'cursor-wait bg-ocean-panel-2 text-ocean-muted'
                          : 'bg-gradient-to-r from-ocean-accent to-ocean-accent-2 text-ocean-bg hover:opacity-90'
                      )}
                    >
                      {loginBusy ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Waiting for browser sign-in…
                        </>
                      ) : (
                        <>
                          <LogIn className="h-4 w-4" />
                          Sign in with Anthropic
                        </>
                      )}
                    </button>
                  </Tooltip>
                ) : canInstallCli ? (
                  <div className="space-y-2">
                    <Tooltip
                      label="Install sign-in helper"
                      description="One-click: installs the small ant helper (via Homebrew) that handles account sign-in. This can take a minute."
                      side="bottom"
                    >
                      <button
                        type="button"
                        onClick={() => void handleInstallCli()}
                        disabled={installing}
                        className={clsx(
                          'inline-flex w-full items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-semibold transition-opacity',
                          installing
                            ? 'cursor-wait bg-ocean-panel-2 text-ocean-muted'
                            : 'bg-gradient-to-r from-ocean-accent to-ocean-accent-2 text-ocean-bg hover:opacity-90'
                        )}
                      >
                        {installing ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Installing…
                          </>
                        ) : (
                          <>
                            <Download className="h-4 w-4" />
                            Install sign-in helper
                          </>
                        )}
                      </button>
                    </Tooltip>
                    {installing && (
                      <p className="text-xs text-ocean-muted">
                        Setting up the sign-in helper. This can take a minute — please
                        keep this window open.
                      </p>
                    )}
                    {installError && (
                      <p className="text-xs font-medium text-ocean-danger">{installError}</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2 rounded-md border border-ocean-border bg-ocean-bg px-3 py-3">
                    <p className="inline-flex items-center gap-2 text-xs font-medium text-ocean-text">
                      <Terminal className="h-3.5 w-3.5 text-ocean-accent" />
                      Account sign-in uses the Anthropic CLI (<code>ant</code>), which
                      isn’t installed.
                    </p>
                    <p className="text-xs text-ocean-muted">Install it with:</p>
                    <code className="block select-text rounded bg-ocean-panel-2 px-2 py-1.5 text-xs text-ocean-text">
                      {CLI_BREW_CMD}
                    </code>
                    <div className="flex gap-2 pt-1">
                      <Tooltip
                        label="Download the CLI"
                        description="Opens the Anthropic CLI releases page in your browser."
                        side="bottom"
                      >
                        <button
                          type="button"
                          onClick={() => void window.api.app.openExternal(CLI_INSTALL_URL)}
                          className="text-xs font-medium text-ocean-accent-2 underline-offset-2 hover:underline"
                        >
                          Download the CLI
                        </button>
                      </Tooltip>
                      <Tooltip
                        label="Re-check"
                        description="Look again for the installed CLI."
                        side="bottom"
                      >
                        <button
                          type="button"
                          onClick={() => void refreshStatus()}
                          className="inline-flex items-center gap-1 text-xs font-medium text-ocean-muted hover:text-ocean-text"
                        >
                          <RefreshCw className="h-3 w-3" />
                          Re-check
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                )}
                {loginError && (
                  <p className="text-xs font-medium text-ocean-danger">{loginError}</p>
                )}
                <p className="text-xs leading-relaxed text-ocean-muted">
                  Credentials are managed locally by the sign-in helper and refresh
                  automatically.
                </p>
              </div>
            )}

            {/* API key mode */}
            {mode === 'apiKey' && (
              <div className="space-y-1.5">
                <label
                  htmlFor="anthropic-api-key"
                  className="block text-xs font-medium text-ocean-muted"
                >
                  Anthropic API key
                </label>
                <div className="flex gap-2">
                  <Tooltip
                    label="Anthropic API key"
                    description="Paste a key starting with sk-ant-. It’s stored locally and only used to call the Anthropic API."
                    side="top"
                  >
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
                      placeholder={
                        status?.hasKey
                          ? 'Key set — enter a new key to replace'
                          : 'sk-ant-...'
                      }
                      className="min-w-0 flex-1 rounded-md border border-ocean-border bg-ocean-bg px-3 py-2 text-sm text-ocean-text placeholder:text-ocean-muted/60 focus:border-ocean-accent focus:outline-none"
                    />
                  </Tooltip>
                  <Tooltip
                    label="Save API key"
                    keys="Enter"
                    description="Store the key locally and connect."
                    side="top"
                  >
                    <button
                      type="button"
                      onClick={() => void handleSaveKey()}
                      disabled={saving || keyInput.trim().length === 0}
                      className={clsx(
                        'inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold transition-opacity',
                        saving || keyInput.trim().length === 0
                          ? 'cursor-not-allowed bg-ocean-panel-2 text-ocean-muted'
                          : 'bg-gradient-to-r from-ocean-accent to-ocean-accent-2 text-ocean-bg hover:opacity-90'
                      )}
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </Tooltip>
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
                <p className="flex items-center justify-between pt-1 text-xs leading-relaxed text-ocean-muted">
                  <span>Stored locally; only used to call the Anthropic API.</span>
                  <Tooltip
                    label="Get a key"
                    description="Opens the Anthropic Console to create an API key."
                    side="left"
                  >
                    <button
                      type="button"
                      onClick={() => void window.api.app.openExternal(CONSOLE_URL)}
                      className="shrink-0 font-medium text-ocean-accent-2 underline-offset-2 hover:underline"
                    >
                      Get a key
                    </button>
                  </Tooltip>
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-ocean-muted">Model</span>
              <div className="rounded-md border border-ocean-border bg-ocean-bg px-3 py-2 text-sm text-ocean-text">
                {model}
              </div>
            </div>
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

        <div className="flex justify-end border-t border-ocean-border px-5 py-4">
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-ocean-border bg-ocean-panel-2 px-4 py-2 text-sm font-medium text-ocean-text transition-colors hover:border-ocean-accent"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
