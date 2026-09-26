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
import Spotter from "@/components/spotter/Spotter";
import SpotterCaption from "@/components/spotter/SpotterCaption";
import { spotterSays, type SpotterPick } from "@/lib/spotter-says";
import type { Locale, Surface, SpotterState } from "@/lib/spotter-lines";
import type { SpotterPose } from "@/lib/spotter-poses";

// State -> a transparent cutout pose (never the square painted cards).
const POSE_BY_STATE: Record<SpotterState, SpotterPose> = {
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
  pose?: SpotterPose;
  size?: "sm" | "md";
  align?: "left" | "right";
  locale?: Locale;
}) {
  const picked = useSyncExternalStore(
    noSubscription,
    () => (say !== undefined ? null : pickFor(surface, state, locale)),
    () => null,
  );

  const text = say ?? picked?.text;
  if (text === undefined) return null;

  return (
    <div
      className={`flex items-end gap-3 ${align === "right" ? "flex-row-reverse" : ""}`}
    >
      <Spotter
        pose={pose ?? POSE_BY_STATE[state]}
        size={size === "md" ? "sm" : "xs"}
        decorative
      />
      <SpotterCaption line={text} className="max-w-xs" />
    </div>
  );
}
