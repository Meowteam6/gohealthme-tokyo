// The run page's small glyphs (docs/DESIGN.md, "Run page"). Decorative, drawn
// in currentColor or the night tokens, never a hex, so a light theme only has
// to redefine the variables. Every glyph sits beside words that say the same.

import type { ReactNode } from "react";

export type GlyphName =
  | "ok"
  | "lock"
  | "wallet"
  | "vault"
  | "hit"
  | "miss"
  | "back"
  | "chev"
  | "out"
  | "shield"
  | "info";

const PATHS: Record<GlyphName, { box: number; body: ReactNode }> = {
  ok: {
    box: 16,
    body: (
      <>
        <circle cx="8" cy="8" r="7" className="fill-moonlight/15" />
        <path d="M5 8.2 7 10l4-4.2" fill="none" className="stroke-moonlight" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  lock: {
    box: 16,
    body: (
      <>
        <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5.5 7V5.3a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </>
    ),
  },
  wallet: {
    box: 16,
    body: (
      <>
        <rect x="2" y="4" width="12" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.5 8.5h1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M4 4 10.5 2.2V4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </>
    ),
  },
  vault: {
    box: 20,
    body: (
      <>
        <rect x="2.5" y="4" width="15" height="12.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="10" cy="10.2" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M5 16.5v1.3M15 16.5v1.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
  hit: {
    box: 20,
    body: (
      <>
        <circle cx="10" cy="10" r="8" className="fill-moonlight/15" />
        <path d="M6.4 10.2 8.8 12.4 13.6 7.6" fill="none" className="stroke-moonlight" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  miss: {
    box: 20,
    body: (
      <>
        <circle cx="10" cy="10" r="7.2" fill="none" className="stroke-dusk" strokeWidth="1.6" />
        <path d="M7 10h6" className="stroke-dusk" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
  back: {
    box: 20,
    body: (
      <>
        <path d="M7.2 5.4 4.2 8.4l3 3" fill="none" className="stroke-muted" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4.6 8.4h7a4 4 0 0 1 0 8H8" fill="none" className="stroke-muted" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
  chev: {
    box: 16,
    body: <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  },
  out: {
    box: 12,
    body: <path d="M4 2h6v6M10 2 3 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
  },
  shield: {
    box: 16,
    body: (
      <path
        d="M8 1.5 13.5 4v4c0 3.2-2.3 5.6-5.5 6.5C4.8 13.6 2.5 11.2 2.5 8V4L8 1.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    ),
  },
  info: {
    box: 16,
    body: (
      <>
        <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 7.2v3.8M8 4.9v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
};

export function Glyph({
  name,
  size,
  className = "",
}: {
  name: GlyphName;
  size?: number;
  className?: string;
}) {
  const g = PATHS[name];
  const px = size ?? g.box;
  return (
    <svg
      width={px}
      height={px}
      viewBox={`0 0 ${g.box} ${g.box}`}
      aria-hidden="true"
      className={`flex-none ${className}`}
    >
      {g.body}
    </svg>
  );
}
