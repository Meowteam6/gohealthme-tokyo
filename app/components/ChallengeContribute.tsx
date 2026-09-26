"use client";

// Friend-facing "add to the reward" for a challenge pool. Anyone with the link
// can grow the pot the participant collects if they hit the goal.
//
// It WRAPS the existing FundPool primitive - the same approve + fundPool funnel
// every top-up uses (fundPool has no dead-pool guard, so growing a live
// challenge is exactly what it is for) - and pins challenge-appropriate framing
// around it. No new money path.
//
// HONEST DISCLOSURE (required, never hidden): sweep() returns the WHOLE
// remaining pot to the pool creator - the challenger - if the participant
// misses the goal. Contributions are NOT refunded pro-rata to whoever chipped
// in. A contributor sees that before they can tap.

import FundPool from "@/components/FundPool";
import { Money } from "@/components/ui";

export default function ChallengeContribute({
  poolId,
  prizeUsd,
}: {
  poolId: bigint;
  /** The prize as a formatted USDC string: pool.balance minus every player's
   *  own stake (lib/challenges darePot), read live on the server. null when it
   *  cannot be stated honestly, and then no figure is shown. */
  prizeUsd: string | null;
}) {
  return (
    <div className="space-y-4 rounded-3xl border border-edge bg-surface p-5 sm:p-6">
      <div className="space-y-1">
        <h2 className="font-display text-[1.75rem] font-extrabold leading-display tracking-display">
          Add to the pot
        </h2>
        {prizeUsd !== null ? (
          <p className="text-lg font-bold leading-snug">
            In the pot now: <Money usd={prizeUsd} />
          </p>
        ) : null}
        <p className="text-sm text-muted">
          Anyone with this link can add to the reward. Everything you chip in
          grows what they collect the moment they hit the goal.
        </p>
      </div>

      <div className="rounded-2xl border border-edge bg-surface-raised p-4">
        <p className="text-sm text-foreground/80">
          Before you add: if they miss the goal, the whole pot returns to the
          challenger who created it, not to contributors. What you add grows
          the reward and is not refunded to you.
        </p>
      </div>

      <FundPool
        poolId={poolId}
        heading="Add to the reward"
        description="Chip in USDC to grow the reward they get when they hit the goal."
        ctaLabel="Add to the reward"
      />
    </div>
  );
}
