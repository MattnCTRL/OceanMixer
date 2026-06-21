/**
 * First-run Welcome card.
 *
 * A polished, branded onboarding modal shown on the very first launch (and any
 * time the user re-opens it). It greets with the OceanMixer mark + wordmark, a
 * one-line tagline, and a short list of "next step" actions that hand off to the
 * real helpers (media picker, recorder, AI Director settings, shortcuts).
 *
 * Takes no props: reads `welcomeOpen` / `dismissWelcome` from the UI store and
 * renders nothing while closed. The integrator mounts it unconditionally.
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { FilePlus, Keyboard, Mic, Sparkles, X } from 'lucide-react'

import { LogoMark, Wordmark } from '@renderer/components/brand/Logo'
import { useUIStore } from '@renderer/store/uiStore'
import { useProjectStore } from '@renderer/store/projectStore'

interface StepProps {
  icon: ReactNode
  title: string
  blurb: string
  action: string
  onAction: () => void
}

function Step({ icon, title, blurb, action, onAction }: StepProps): JSX.Element {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-ocean-border bg-ocean-panel-2 p-3 transition-colors hover:border-ocean-accent">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ocean-bg text-ocean-accent">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ocean-text">{title}</div>
        <div className="text-xs leading-snug text-ocean-muted">{blurb}</div>
      </div>
      <button
        type="button"
        onClick={onAction}
        className="shrink-0 rounded-md border border-ocean-border bg-ocean-panel px-3 py-1.5 text-xs font-medium text-ocean-text transition-colors hover:border-ocean-accent"
      >
        {action}
      </button>
    </div>
  )
}

export function WelcomeCard(): JSX.Element | null {
  const welcomeOpen = useUIStore((s) => s.welcomeOpen)
  const dismissWelcome = useUIStore((s) => s.dismissWelcome)
  const openRecorder = useUIStore((s) => s.openRecorder)
  const openSettings = useUIStore((s) => s.openSettings)
  const openShortcuts = useUIStore((s) => s.openShortcuts)

  useEffect(() => {
    if (!welcomeOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismissWelcome()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [welcomeOpen, dismissWelcome])

  if (!welcomeOpen) return null

  const importMedia = async (): Promise<void> => {
    try {
      const assets = await window.api.dialog.openMedia()
      if (assets && assets.length > 0) {
        useProjectStore.getState().importAssets(assets)
        dismissWelcome()
      }
    } catch {
      /* user cancelled or dialog failed — keep the card open */
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismissWelcome()
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-ocean-border bg-ocean-panel shadow-2xl">
        {/* Gradient accent header */}
        <div className="relative bg-gradient-to-br from-ocean-accent/15 via-ocean-panel to-ocean-accent-2/15 px-6 pb-6 pt-7">
          <button
            type="button"
            aria-label="Close"
            onClick={dismissWelcome}
            className="absolute right-3 top-3 rounded-md p-1.5 text-ocean-muted transition-colors hover:bg-ocean-panel-2 hover:text-ocean-text"
          >
            <X size={18} />
          </button>

          <div className="flex flex-col items-center text-center">
            <LogoMark size={48} />
            <h1 className="mt-3 text-2xl tracking-tight">
              Welcome to <Wordmark className="text-2xl" />
            </h1>
            <p className="mt-1.5 max-w-sm text-sm text-ocean-muted">
              Mix your own photos, video &amp; music — with an AI director that does the cuts.
            </p>
          </div>
        </div>

        {/* Next steps */}
        <div className="space-y-2.5 px-6 py-5">
          <Step
            icon={<FilePlus size={18} />}
            title="Import media"
            blurb="Bring in your photos, video clips and audio files."
            action="Import"
            onAction={importMedia}
          />
          <Step
            icon={<Mic size={18} />}
            title="Record audio or music"
            blurb="Capture a voiceover or lay down a track right here."
            action="Record"
            onAction={openRecorder}
          />
          <Step
            icon={<Sparkles size={18} />}
            title="Connect the AI Director"
            blurb="Let it suggest and assemble cuts from your footage."
            action="Connect"
            onAction={openSettings}
          />
          <Step
            icon={<Keyboard size={18} />}
            title="Keyboard shortcuts"
            blurb="Learn the keys that make editing fast."
            action="View"
            onAction={openShortcuts}
          />
        </div>

        {/* Footer CTA */}
        <div className="border-t border-ocean-line px-6 py-4">
          <button
            type="button"
            onClick={dismissWelcome}
            className="w-full rounded-md bg-gradient-to-r from-ocean-accent to-ocean-accent-2 px-4 py-2.5 text-sm font-semibold text-ocean-bg transition-opacity hover:opacity-90"
          >
            Start editing
          </button>
        </div>
      </div>
    </div>
  )
}
