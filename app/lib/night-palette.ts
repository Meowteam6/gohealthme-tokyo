// The Night Shift palette for the few consumers that cannot read CSS custom
// properties: the share-card renderer (app/opengraph-image.tsx) and the
// browser theme colour (app/layout.tsx viewport). globals.css is the source of
// truth; lib/night-palette.test.ts fails if these drift from it.

export const NIGHT_PALETTE = {
  background: "#0b1330",
  surface: "#111b3d",
  surfaceRaised: "#18244d",
  foreground: "#f3ebdd",
  muted: "#c4cae0",
  haze: "#8f98b8",
  moonlight: "#f6e4b6",
  gold: "#f5b94a",
  moon1: "#fff8e6",
  moon2: "#f7e6bb",
  moon3: "#e8ce95",
  moon4: "#d8b978",
} as const;

export type NightPaletteKey = keyof typeof NIGHT_PALETTE;
