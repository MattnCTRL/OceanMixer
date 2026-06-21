/**
 * Lightweight hover/focus tooltip.
 *
 * Renders into a body portal at computed coordinates so it never clips inside
 * scrollable panels, clamps to the viewport, and supports an optional longer
 * description plus a keyboard-shortcut chip. Wrap any control:
 *
 *   <Tooltip label="Split clip" keys="S" description="Cut at the playhead">
 *     <button>…</button>
 *   </Tooltip>
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Side = 'top' | 'bottom' | 'left' | 'right'

interface TooltipProps {
  label: ReactNode
  description?: ReactNode
  keys?: string
  side?: Side
  delayMs?: number
  className?: string
  children: ReactNode
}

export function Tooltip({
  label,
  description,
  keys,
  side = 'top',
  delayMs = 350,
  className,
  children
}: TooltipProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLSpanElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const compute = (): void => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const tw = tipRef.current?.offsetWidth ?? 180
    const th = tipRef.current?.offsetHeight ?? 40
    const gap = 8
    let top: number
    let left: number
    switch (side) {
      case 'bottom':
        top = r.bottom + gap
        left = r.left + r.width / 2 - tw / 2
        break
      case 'left':
        top = r.top + r.height / 2 - th / 2
        left = r.left - tw - gap
        break
      case 'right':
        top = r.top + r.height / 2 - th / 2
        left = r.right + gap
        break
      default:
        top = r.top - th - gap
        left = r.left + r.width / 2 - tw / 2
    }
    const m = 6
    left = Math.max(m, Math.min(left, window.innerWidth - tw - m))
    top = Math.max(m, Math.min(top, window.innerHeight - th - m))
    setPos({ top, left })
  }

  const show = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setOpen(true)
      requestAnimationFrame(compute)
    }, delayMs)
  }
  const hide = (): void => {
    if (timer.current) clearTimeout(timer.current)
    setOpen(false)
    setPos(null)
  }

  return (
    <span
      ref={wrapRef}
      className={className ? `inline-flex ${className}` : 'inline-flex'}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            style={{
              position: 'fixed',
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              opacity: pos ? 1 : 0
            }}
            className="pointer-events-none z-[100] max-w-xs rounded-md border border-ocean-line bg-ocean-panel-2/95 px-2.5 py-1.5 text-xs text-ocean-text shadow-xl backdrop-blur-sm transition-opacity"
          >
            <div className="flex items-center gap-1.5">
              <span className="font-medium">{label}</span>
              {keys && (
                <kbd className="rounded border border-ocean-line bg-ocean-bg px-1 text-[10px] text-ocean-muted">
                  {keys}
                </kbd>
              )}
            </div>
            {description && (
              <div className="mt-0.5 text-[11px] leading-snug text-ocean-muted">{description}</div>
            )}
          </div>,
          document.body
        )}
    </span>
  )
}
