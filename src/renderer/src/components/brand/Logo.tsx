/**
 * OceanMixer brand mark + wordmark.
 *
 * The mark is a rounded gradient tile holding a soundwave/equalizer whose bar
 * heights follow a wave envelope — "ocean" (the blue→indigo gradient, the wave)
 * meets "mixer" (the level bars). Pure inline SVG, no asset files, themeable.
 */

import { useId } from 'react'

export function LogoMark({
  size = 24,
  className
}: {
  size?: number
  className?: string
}): JSX.Element {
  const gid = useId().replace(/:/g, '')
  const grad = `om-grad-${gid}`
  const glow = `om-glow-${gid}`

  // Bar geometry: 5 rounded bars, heights forming a centered wave crest.
  const bars = [
    { x: 9, h: 12 },
    { x: 17, h: 22 },
    { x: 25, h: 32 },
    { x: 33, h: 22 },
    { x: 41, h: 12 }
  ]
  const cx = 24

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 60 60"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="OceanMixer"
    >
      <defs>
        <linearGradient id={grad} x1="6" y1="6" x2="54" y2="54" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3fa7ff" />
          <stop offset="1" stopColor="#6c5cff" />
        </linearGradient>
        <linearGradient id={glow} x1="0" y1="0" x2="0" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect x="3" y="3" width="54" height="54" rx="15" fill={`url(#${grad})`} />
      <rect x="3" y="3" width="54" height="27" rx="15" fill={`url(#${glow})`} />

      <g transform="translate(6 0)">
        {bars.map((b) => (
          <rect
            key={b.x}
            x={b.x - 2}
            y={30 - b.h / 2}
            width="4.5"
            height={b.h}
            rx="2.25"
            fill="#ffffff"
            opacity="0.96"
          />
        ))}
        {/* a soft wave line tying the bars together */}
        <path
          d={`M ${bars[0].x} 30 Q ${(bars[0].x + cx) / 2} 18 ${cx} 30 T ${bars[bars.length - 1].x} 30`}
          stroke="#ffffff"
          strokeOpacity="0.5"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      </g>
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }): JSX.Element {
  return (
    <span className={className}>
      <span className="bg-gradient-to-r from-ocean-accent to-ocean-accent-2 bg-clip-text font-semibold text-transparent">
        Ocean
      </span>
      <span className="font-semibold text-ocean-text">Mixer</span>
    </span>
  )
}

export function Logo({
  size = 22,
  className
}: {
  size?: number
  className?: string
}): JSX.Element {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <LogoMark size={size} />
      <Wordmark className="text-[15px] tracking-tight" />
    </span>
  )
}
