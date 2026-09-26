"use client";

// SPOTTER standing on the top edge of his caption box, for empty and loading
// slots (docs/DESIGN.md: one pose, on a card's edge, his line in the box).
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
import Perch from "@/components/spotter/Perch";
import SpotterCaption from "@/components/spotter/SpotterCaption";
import { spotterSays, type SpotterPick } from "@/lib/spotter-says";
import type { Locale, Surface, SpotterState } from "@/lib/spotter-lines";
import type { SpotterPose } from "@/lib/spotter-poses";

// State -> one of the eight night poses.
const POSE_BY_STATE: Record<SpotterState, SpotterPose> = {
  idle: "meditate",
  empty: "detective",
  verifying: "detective",
  "won-verified": "thumbsup",
  "paid-self-reported": "wave",
  broke: "facepalm",
  error: "facepalm",
  "streak-nudge": "thumbsup",
  joined: "sleep",
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
    <Perch
      pose={pose ?? POSE_BY_STATE[state]}
      width={size === "md" ? [88, 104] : [68, 76]}
      side={align === "right" ? "right" : "left"}
      inset={[14, 18]}
      decorative
      className="max-w-md"
    >
      <SpotterCaption line={text} />
    </Perch>
  );
}
