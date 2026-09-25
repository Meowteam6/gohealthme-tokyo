"use client";

// A small transparent SPOTTER + an anchored speech bubble, for empty/loading
// slots so no screen is ever just the run-across easter egg.
//
// Hydration: the pick is random, so it is drawn ONLY on the client, through
// useSyncExternalStore with a null server snapshot - the server render and the
// hydrating render both show nothing and the line appears right after. The
// pick is memoised per slot for the page's lifetime so the snapshot is stable.
// Renders nothing if the slot has no line.
//
// The game screens pass `say` instead: a fixed line per state, so the same
// state always reads the same sentence (a judge sees it twice and it matches).

import { useSyncExternalStore } from "react";
import { spotterSays, type SpotterPick } from "@/lib/spotter-says";
import type { Locale, Surface, SpotterState, Tone } from "@/lib/spotter-lines";

// State -> a TRANSPARENT pose (spotter-*.png cutouts only; never the cream-bg
// card poses, which would show a square).
const POSE_BY_STATE: Record<SpotterState, string> = {
  idle: "lounging",
  empty: "peek",
  verifying: "detective",
  "won-verified": "payday",
  "paid-self-reported": "standing",
  broke: "broke",
  error: "facepalm",
  "streak-nudge": "flex",
  joined: "cheer",
};

// Tone -> a subtle bubble accent. GOLD is never used here: gold is money in
// motion, which lives in the mono amount slot, not SPOTTER's mouth.
const TONE_BORDER: Record<Tone, string> = {
  loud: "border-accent",
  warn: "border-warning/60",
  dry: "border-foreground",
  deadpan: "border-foreground",
};

const SIZE: Record<string, string> = { sm: "w-16", md: "w-24" };

const picks = new Map<string, SpotterPick | null>();

function pickFor(
  surface: Surface,
  state: SpotterState,
  locale: Locale | undefined,
): SpotterPick | null {
  const key = `${surface}:${state}:${locale ?? "en"}`;
  if (!picks.has(key)) picks.set(key, spotterSays(surface, state, { locale }));
  return picks.get(key) ?? null;
}

const noSubscription = () => () => {};

export default function SpotterSays({
  surface,
  state,
  pose,
  size = "sm",
  align = "left",
  locale,
  say,
}: {
  surface: Surface;
  state: SpotterState;
  /** A fixed line for this state. Skips the random pick. */
  say?: string;
  pose?: string;
  size?: "sm" | "md";
  align?: "left" | "right";
  locale?: Locale;
}) {
  const picked = useSyncExternalStore(
    noSubscription,
    () => (say !== undefined ? null : pickFor(surface, state, locale)),
    () => null,
  );

  const pick: SpotterPick | null =
    say !== undefined ? { id: "fixed", text: say, tone: "dry" } : picked;
  if (pick === null) return null;
  const resolvedPose = pose ?? POSE_BY_STATE[state];

  return (
    <div
      className={`flex items-end gap-2 ${align === "right" ? "flex-row-reverse" : ""}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/spotter/spotter-${resolvedPose}.png`}
        alt=""
        aria-hidden="true"
        className={`${SIZE[size]} h-auto shrink-0 self-end`}
      />
      <div
        className={`max-w-[17rem] rounded-2xl ${align === "left" ? "rounded-bl-none" : "rounded-br-none"} border-2 ${TONE_BORDER[pick.tone]} bg-surface px-3 py-2 text-sm font-medium leading-snug text-foreground`}
      >
        <span className="sr-only">SPOTTER says: </span>
        {pick.text}
      </div>
    </div>
  );
}
