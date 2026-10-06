// Night Shift on the iPhone: the website's tokens, carried over by hand.
//
// Colours mirror app/lib/night-palette.ts and app/app/globals.css (globals.css
// is the source of truth; if a value changes there, change it here). Radii are
// the web's control, card and tag steps. The web sets words in Fraunces and
// numbers in Figtree; the app uses the system font (San Francisco) and keeps
// the same hierarchy with weight, size and tracking. Menlo stands in for
// Geist Mono on the wallet address and the pairing code. Nothing here loads a
// font or touches behaviour.

import { Platform, StyleSheet } from "react-native";

export const colors = {
  // Fields.
  background: "#0b1330",
  surface: "#111b3d",
  surfaceTop: "#16214a",
  surfaceRaised: "#18244d",
  surfaceDeep: "#070c20",
  // Text.
  foreground: "#f3ebdd",
  muted: "#e2e6f2",
  haze: "#8f98b8",
  // Light.
  moonlight: "#f6e4b6",
  gold: "#f5b94a",
  // The moon face (primary button) and its ink.
  accent: "#f3ebdd",
  accentTop: "#fbf5ea",
  accentBottom: "#e9dfcc",
  accentForeground: "#0b1330",
  // Tones.
  danger: "#f4a3a3",
  warning: "#dce1f2",
  // Hairlines and quiet fills.
  border: "rgba(214, 222, 255, 0.10)",
  borderStrong: "rgba(214, 222, 255, 0.18)",
  fillQuiet: "rgba(214, 222, 255, 0.06)",
  litEdge: "rgba(246, 228, 182, 0.12)",
  dangerFill: "rgba(244, 163, 163, 0.08)",
  dangerEdge: "rgba(244, 163, 163, 0.32)",
} as const;

export const radius = {
  control: 14,
  card: 22,
  tag: 8,
} as const;

/** The 8pt grid, plus the 20pt page gutter. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  gutter: 20,
} as const;

export const fonts = {
  mono: Platform.OS === "ios" ? "Menlo" : "monospace",
} as const;

/** Type roles. Words carry weight 600, body copy 400, meta 600 at 13pt. */
export const type = StyleSheet.create({
  wordmark: {
    fontSize: 22,
    fontWeight: "600",
    lineHeight: 26,
    letterSpacing: -0.3,
    color: colors.foreground,
  },
  display: {
    fontSize: 26,
    fontWeight: "600",
    lineHeight: 31,
    letterSpacing: -0.4,
    color: colors.foreground,
  },
  heading: {
    fontSize: 22,
    fontWeight: "600",
    lineHeight: 27,
    letterSpacing: -0.3,
    color: colors.foreground,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.muted,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    color: colors.haze,
  },
  fine: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.haze,
  },
  mono: {
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
  },
  // Text actions match the web's TEXT_LINK: muted, underlined. Moonlight is
  // the moon, tags and banked nights, never a link.
  link: {
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
    color: colors.muted,
    textDecorationLine: "underline",
  },
  danger: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.danger,
  },
  buttonPrimary: {
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.1,
    color: colors.accentForeground,
  },
  buttonSecondary: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.foreground,
  },
});

/** Shared surfaces and controls. */
export const controls = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopColor: colors.litEdge,
    padding: space.xl,
    gap: space.lg,
  },
  field: {
    minHeight: 52,
    backgroundColor: colors.surfaceDeep,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    color: colors.foreground,
  },
  // The moon: cream face, lit top edge, a warm glow under it, ink text.
  buttonPrimary: {
    minHeight: 52,
    borderRadius: radius.control,
    backgroundColor: colors.accent,
    borderTopWidth: 1,
    borderTopColor: colors.accentTop,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.xl,
    shadowColor: colors.moonlight,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  buttonPressed: {
    opacity: 0.94,
    transform: [{ scale: 0.98 }],
  },
  // Disabled drops to the quiet fill with haze text; a dimmed moon reads as broken.
  buttonDisabled: {
    backgroundColor: colors.fillQuiet,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopColor: colors.border,
    shadowOpacity: 0,
  },
  buttonSecondary: {
    minHeight: 44,
    borderRadius: radius.control,
    backgroundColor: colors.fillQuiet,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.lg,
  },
  textAction: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  // A quiet row with a left accent bar, like the web's Notice.
  notice: {
    flexDirection: "row",
    gap: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    paddingVertical: space.md,
    paddingRight: space.lg,
    paddingLeft: space.md,
  },
  noticeBar: {
    width: 3,
    borderRadius: 2,
    alignSelf: "stretch",
  },
  noticeText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
  },
});

export type NoticeTone = "info" | "limit" | "error";

/** Box fill, hairline, bar and text colour per Notice tone, as on the web. */
export const noticeTones: Record<
  NoticeTone,
  { background: string; border: string; bar: string; text: string }
> = {
  info: {
    background: colors.fillQuiet,
    border: colors.border,
    bar: colors.haze,
    text: colors.muted,
  },
  limit: {
    background: colors.surfaceRaised,
    border: colors.borderStrong,
    bar: colors.warning,
    text: colors.warning,
  },
  error: {
    background: colors.dangerFill,
    border: colors.dangerEdge,
    bar: colors.danger,
    text: colors.danger,
  },
};
