/**
 * Inspector — edits the properties of the currently selected clip.
 *
 * Reads the active clip fresh from useActiveClip() on every render so it
 * always reflects the latest applied state. Every mutation goes through the
 * store's history-tracked apply([...]) using EditOps.
 */

import { useMemo } from 'react'
import clsx from 'clsx'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Eye,
  EyeOff,
  Italic,
  X
} from 'lucide-react'
import type {
  ClipType,
  Effect,
  TextStyle,
  Transform,
  TransitionType
} from '@shared/types'
import type { EditOp } from '@shared/ai-ops'
import { useProjectStore, useActiveClip } from '@renderer/store/projectStore'
import { clamp, formatDuration } from '@renderer/lib/time'

/* ------------------------------------------------------------------ config */

const TRANSITION_TYPES: TransitionType[] = [
  'fade',
  'dissolve',
  'wipeleft',
  'wiperight',
  'slideup',
  'slidedown',
  'circleopen'
]

const TRANSITION_LABELS: Record<TransitionType, string> = {
  fade: 'Fade',
  dissolve: 'Dissolve',
  wipeleft: 'Wipe Left',
  wiperight: 'Wipe Right',
  slideup: 'Slide Up',
  slidedown: 'Slide Down',
  circleopen: 'Circle Open'
}

type AddableEffectType =
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'blur'
  | 'grayscale'

const ADDABLE_EFFECTS: { type: AddableEffectType; label: string }[] = [
  { type: 'brightness', label: 'Brightness' },
  { type: 'contrast', label: 'Contrast' },
  { type: 'saturation', label: 'Saturation' },
  { type: 'blur', label: 'Blur' },
  { type: 'grayscale', label: 'Grayscale' }
]

/** Sensible default params for newly added effects. */
const EFFECT_DEFAULTS: Record<AddableEffectType, Record<string, number>> = {
  brightness: { amount: 0 },
  contrast: { amount: 1 },
  saturation: { amount: 1 },
  blur: { amount: 4 },
  grayscale: {}
}

const EFFECT_LABELS: Record<Effect['type'], string> = {
  brightness: 'Brightness',
  contrast: 'Contrast',
  saturation: 'Saturation',
  hue: 'Hue',
  gamma: 'Gamma',
  blur: 'Blur',
  sharpen: 'Sharpen',
  grayscale: 'Grayscale',
  sepia: 'Sepia',
  vignette: 'Vignette',
  fadeIn: 'Fade In',
  fadeOut: 'Fade Out'
}

/* ---------------------------------------------------------------- helpers */

function hasTransform(type: ClipType): boolean {
  return type === 'video' || type === 'image' || type === 'text'
}
function hasAudio(type: ClipType): boolean {
  return type === 'video' || type === 'audio'
}
function hasTrim(type: ClipType): boolean {
  return type === 'video' || type === 'audio'
}

/** Primary editable param key for an effect. */
function primaryParam(effect: Effect): string | null {
  const keys = Object.keys(effect.params)
  return keys.length > 0 ? keys[0] : null
}

/** Slider range for a given effect param (matches the exporter's filter ranges). */
function paramRange(effectType: Effect['type']): { min: number; max: number; step: number } {
  switch (effectType) {
    case 'brightness':
      return { min: -1, max: 1, step: 0.05 }
    case 'contrast':
    case 'gamma':
      return { min: 0, max: 3, step: 0.05 }
    case 'saturation':
      return { min: 0, max: 3, step: 0.05 }
    case 'hue':
      return { min: -180, max: 180, step: 1 }
    case 'blur':
      return { min: 0, max: 20, step: 0.5 }
    case 'sharpen':
      return { min: 0, max: 5, step: 0.1 }
    case 'fadeIn':
    case 'fadeOut':
      return { min: 0, max: 5, step: 0.1 }
    default:
      return { min: 0, max: 1, step: 0.01 }
  }
}

/* ============================================================= component */

export function Inspector(): JSX.Element {
  const active = useActiveClip()
  const apply = useProjectStore((s) => s.apply)

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-sm text-ocean-muted">
          Select a clip to edit its properties.
        </p>
      </div>
    )
  }

  const { clip } = active
  const clipId = clip.id

  const run = (op: EditOp): void => {
    apply([op])
  }

  const setProps = (props: Extract<EditOp, { op: 'setClipProps' }>['props']): void => {
    run({ op: 'setClipProps', clipId, props })
  }

  const setTransform = (patch: Partial<Transform>): void => {
    setProps({ transform: patch })
  }

  const setText = (patch: Partial<TextStyle>): void => {
    setProps({ text: patch })
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-ocean-panel text-ocean-text">
      {/* Header */}
      <Section title="Clip">
        <Field label="Label">
          <input
            type="text"
            value={clip.label ?? ''}
            placeholder="Untitled clip"
            onChange={(e) => setProps({ label: e.target.value })}
            className="w-full rounded border border-ocean-border bg-ocean-panel-2 px-2 py-1 text-sm text-ocean-text outline-none focus:border-ocean-accent"
          />
        </Field>
        <div className="flex items-center justify-between text-xs text-ocean-muted">
          <span className="capitalize">{clip.type}</span>
          <span>{formatDuration(clip.duration)}</span>
        </div>
      </Section>

      {/* Transform */}
      {hasTransform(clip.type) && (
        <Section title="Transform">
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="X (px)"
              value={clip.transform.x}
              step={1}
              onChange={(v) => setTransform({ x: v })}
            />
            <NumberField
              label="Y (px)"
              value={clip.transform.y}
              step={1}
              onChange={(v) => setTransform({ y: v })}
            />
          </div>
          <SliderField
            label="Scale"
            value={clip.transform.scale}
            min={0.1}
            max={4}
            step={0.01}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => setTransform({ scale: v })}
          />
          <SliderField
            label="Rotation"
            value={clip.transform.rotation}
            min={-180}
            max={180}
            step={1}
            format={(v) => `${Math.round(v)}°`}
            onChange={(v) => setTransform({ rotation: v })}
          />
          <SliderField
            label="Opacity"
            value={clip.transform.opacity}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setTransform({ opacity: v })}
          />
        </Section>
      )}

      {/* Text */}
      {clip.type === 'text' && clip.text && (
        <Section title="Text">
          <Field label="Content">
            <textarea
              value={clip.text.text}
              rows={3}
              onChange={(e) => setText({ text: e.target.value })}
              className="w-full resize-y rounded border border-ocean-border bg-ocean-panel-2 px-2 py-1 text-sm text-ocean-text outline-none focus:border-ocean-accent"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Font size"
              value={clip.text.fontSize}
              min={1}
              step={1}
              onChange={(v) => setText({ fontSize: Math.max(1, v) })}
            />
            <Field label="Color">
              <input
                type="color"
                value={clip.text.color}
                onChange={(e) => setText({ color: e.target.value })}
                className="h-7 w-full cursor-pointer rounded border border-ocean-border bg-ocean-panel-2"
              />
            </Field>
          </div>
          <Field label="Alignment">
            <div className="flex gap-1">
              <ToggleButton
                active={clip.text.align === 'left'}
                onClick={() => setText({ align: 'left' })}
                title="Align left"
              >
                <AlignLeft size={15} />
              </ToggleButton>
              <ToggleButton
                active={clip.text.align === 'center'}
                onClick={() => setText({ align: 'center' })}
                title="Align center"
              >
                <AlignCenter size={15} />
              </ToggleButton>
              <ToggleButton
                active={clip.text.align === 'right'}
                onClick={() => setText({ align: 'right' })}
                title="Align right"
              >
                <AlignRight size={15} />
              </ToggleButton>
              <div className="mx-1 w-px self-stretch bg-ocean-border" />
              <ToggleButton
                active={!!clip.text.bold}
                onClick={() => setText({ bold: !clip.text?.bold })}
                title="Bold"
              >
                <Bold size={15} />
              </ToggleButton>
              <ToggleButton
                active={!!clip.text.italic}
                onClick={() => setText({ italic: !clip.text?.italic })}
                title="Italic"
              >
                <Italic size={15} />
              </ToggleButton>
            </div>
          </Field>
        </Section>
      )}

      {/* Audio */}
      {hasAudio(clip.type) && (
        <Section title="Audio">
          <SliderField
            label="Volume"
            value={clip.volume}
            min={0}
            max={2}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setProps({ volume: v })}
          />
          <CheckboxField
            label="Muted"
            checked={clip.muted}
            onChange={(checked) => setProps({ muted: checked })}
          />
        </Section>
      )}

      {/* Playback */}
      <Section title="Playback">
        <SliderField
          label="Speed"
          value={clip.speed}
          min={0.25}
          max={4}
          step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(v) => setProps({ speed: v })}
        />
      </Section>

      {/* Trim */}
      {hasTrim(clip.type) && (
        <Section title="Trim">
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="In (s)"
              value={clip.inPoint}
              min={0}
              step={0.1}
              onChange={(v) =>
                run({
                  op: 'trimClip',
                  clipId,
                  inPoint: Math.max(0, v),
                  outPoint: clip.outPoint
                })
              }
            />
            <NumberField
              label="Out (s)"
              value={clip.outPoint}
              min={0}
              step={0.1}
              onChange={(v) =>
                run({
                  op: 'trimClip',
                  clipId,
                  inPoint: clip.inPoint,
                  outPoint: Math.max(clip.inPoint, v)
                })
              }
            />
          </div>
        </Section>
      )}

      {/* Transition */}
      <Section title="Transition (in)">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Type">
            <select
              value={clip.transitionIn?.type ?? 'none'}
              onChange={(e) => {
                const value = e.target.value
                if (value === 'none') {
                  run({ op: 'setTransition', clipId, transition: null })
                } else {
                  run({
                    op: 'setTransition',
                    clipId,
                    transition: {
                      type: value as TransitionType,
                      durationSec: clip.transitionIn?.durationSec ?? 0.5
                    }
                  })
                }
              }}
              className="w-full rounded border border-ocean-border bg-ocean-panel-2 px-2 py-1 text-sm text-ocean-text outline-none focus:border-ocean-accent"
            >
              <option value="none">None</option>
              {TRANSITION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TRANSITION_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <NumberField
            label="Duration (s)"
            value={clip.transitionIn?.durationSec ?? 0.5}
            min={0.1}
            step={0.1}
            disabled={!clip.transitionIn}
            onChange={(v) => {
              if (!clip.transitionIn) return
              run({
                op: 'setTransition',
                clipId,
                transition: {
                  type: clip.transitionIn.type,
                  durationSec: Math.max(0.1, v)
                }
              })
            }}
          />
        </div>
      </Section>

      {/* Effects */}
      <EffectsSection
        clipId={clipId}
        effects={clip.effects}
        onAdd={(type) =>
          run({
            op: 'addEffect',
            clipId,
            effect: {
              type,
              params: { ...EFFECT_DEFAULTS[type] },
              enabled: true
            }
          })
        }
        onRemove={(effectId) => run({ op: 'removeEffect', clipId, effectId })}
        onUpdate={(effectId, patch) => run({ op: 'updateEffect', clipId, effectId, ...patch })}
      />
    </div>
  )
}

/* ----------------------------------------------------------- effects UI */

interface EffectsSectionProps {
  clipId: string
  effects: Effect[]
  onAdd: (type: AddableEffectType) => void
  onRemove: (effectId: string) => void
  onUpdate: (effectId: string, patch: { params?: Record<string, number>; enabled?: boolean }) => void
}

function EffectsSection({
  effects,
  onAdd,
  onRemove,
  onUpdate
}: EffectsSectionProps): JSX.Element {
  const addOptions = useMemo(() => ADDABLE_EFFECTS, [])

  return (
    <Section title="Effects">
      {effects.length === 0 && (
        <p className="text-xs text-ocean-muted">No effects applied.</p>
      )}
      <div className="flex flex-col gap-2">
        {effects.map((effect) => {
          const key = primaryParam(effect)
          const range = paramRange(effect.type)
          return (
            <div
              key={effect.id}
              className={clsx(
                'rounded border border-ocean-border bg-ocean-panel-2 p-2',
                !effect.enabled && 'opacity-50'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ocean-text">
                  {EFFECT_LABELS[effect.type]}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    title={effect.enabled ? 'Disable effect' : 'Enable effect'}
                    onClick={() => onUpdate(effect.id, { enabled: !effect.enabled })}
                    className="rounded p-1 text-ocean-muted transition-colors hover:bg-ocean-panel hover:text-ocean-text"
                  >
                    {effect.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                  <button
                    type="button"
                    title="Remove effect"
                    onClick={() => onRemove(effect.id)}
                    className="rounded p-1 text-ocean-muted transition-colors hover:bg-ocean-danger/20 hover:text-ocean-danger"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              {key !== null && (
                <div className="mt-1">
                  <div className="flex items-center justify-between text-xs text-ocean-muted">
                    <span className="capitalize">{key}</span>
                    <span className="tabular-nums">{effect.params[key]}</span>
                  </div>
                  <input
                    type="range"
                    min={range.min}
                    max={range.max}
                    step={range.step}
                    value={effect.params[key]}
                    onChange={(e) =>
                      onUpdate(effect.id, { params: { [key]: Number(e.target.value) } })
                    }
                    className="h-1 w-full cursor-pointer accent-ocean-accent"
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-2">
        <label className="mb-1 block text-xs text-ocean-muted">Add effect</label>
        <select
          value=""
          onChange={(e) => {
            const value = e.target.value
            if (value) {
              onAdd(value as AddableEffectType)
              e.target.value = ''
            }
          }}
          className="w-full rounded border border-ocean-border bg-ocean-panel-2 px-2 py-1 text-sm text-ocean-text outline-none focus:border-ocean-accent"
        >
          <option value="">Add effect…</option>
          {addOptions.map((o) => (
            <option key={o.type} value={o.type}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </Section>
  )
}

/* ------------------------------------------------------- primitive parts */

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="border-b border-ocean-border p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ocean-muted">
        {title}
      </h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ocean-muted">{label}</span>
      {children}
    </label>
  )
}

interface NumberFieldProps {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  onChange: (value: number) => void
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  onChange
}: NumberFieldProps): JSX.Element {
  return (
    <Field label={label}>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const parsed = parseFloat(e.target.value)
          if (Number.isNaN(parsed)) return
          onChange(parsed)
        }}
        className={clsx(
          'w-full rounded border border-ocean-border bg-ocean-panel-2 px-2 py-1 text-sm text-ocean-text outline-none focus:border-ocean-accent',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      />
    </Field>
  )
}

interface SliderFieldProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  format?: (value: number) => string
  onChange: (value: number) => void
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange
}: SliderFieldProps): JSX.Element {
  const display = format ? format(value) : value.toString()
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-ocean-muted">{label}</span>
        <span className="text-xs tabular-nums text-ocean-text">{display}</span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(clamp(parseFloat(e.target.value), min, max))}
        className="h-1 w-full cursor-pointer accent-ocean-accent"
      />
    </div>
  )
}

function CheckboxField({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}): JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer accent-ocean-accent"
      />
      <span className="text-sm text-ocean-text">{label}</span>
    </label>
  )
}

function ToggleButton({
  active,
  onClick,
  title,
  children
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={clsx(
        'flex h-7 w-7 items-center justify-center rounded border transition-colors',
        active
          ? 'border-ocean-accent bg-ocean-accent/20 text-ocean-accent'
          : 'border-ocean-border bg-ocean-panel-2 text-ocean-muted hover:text-ocean-text'
      )}
    >
      {children}
    </button>
  )
}
