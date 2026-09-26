import type { CSSProperties } from "react";
import type { StageWidth } from "@/lib/spotter-poses";

// The moon: the one warm light on the night field (docs/DESIGN.md). A flat SVG
// disc with soft maria and a glow behind it that fades in once. Decoration
// only. The caller positions it (absolute, behind the card SPOTTER sleeps on).
// `id` keeps the SVG gradient ids unique if a page ever draws two.

export default function Moon({
  diameter = [184, 300],
  id = "moon",
  className = "",
}: {
  /** Diameter in px: one number, or [phone, from 900px]. */
  diameter?: number | StageWidth;
  id?: string;
  className?: string;
}) {
  const [sm, lg] = typeof diameter === "number" ? [diameter, diameter] : diameter;
  const style = { "--moon-d-sm": `${sm}px`, "--moon-d-lg": `${lg}px` } as CSSProperties;
  return (
    <span aria-hidden="true" className={`night-moon animate-moonrise block ${className}`} style={style}>
      <svg viewBox="0 0 200 200" className="relative block h-full w-full">
        <defs>
          <radialGradient id={`${id}-fill`} cx="36%" cy="32%" r="75%">
            <stop offset="0" style={{ stopColor: "var(--moon-1)" }} />
            <stop offset=".45" style={{ stopColor: "var(--moon-2)" }} />
            <stop offset=".82" style={{ stopColor: "var(--moon-3)" }} />
            <stop offset="1" style={{ stopColor: "var(--moon-4)" }} />
          </radialGradient>
          <filter id={`${id}-maria`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency=".022" numOctaves={3} seed={11} />
            <feColorMatrix values="0 0 0 0 .62  0 0 0 0 .52  0 0 0 0 .36  3.2 0 0 0 -1.55" />
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
          <clipPath id={`${id}-clip`}>
            <circle cx="100" cy="100" r="99.5" />
          </clipPath>
        </defs>
        <circle cx="100" cy="100" r="100" fill={`url(#${id}-fill)`} />
        <rect
          width="200"
          height="200"
          filter={`url(#${id}-maria)`}
          clipPath={`url(#${id}-clip)`}
          opacity=".42"
        />
      </svg>
    </span>
  );
}
