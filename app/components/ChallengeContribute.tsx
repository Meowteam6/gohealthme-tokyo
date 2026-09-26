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
import { CARD_TITLE, Notice } from "@/components/night/kit";
import { Card, Stat, StatRow } from "@/components/ui";

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
    <Card as="section" aria-labelledby="add-to-pot" className="[&>*+*]:mt-4">
      <div>
        <h2 id="add-to-pot" className={CARD_TITLE}>
          Add to the pot
        </h2>
        <p className="m-0 mt-1.5 text-[0.9375rem] leading-[1.5] text-muted">
          Anyone with this link can add to the reward. What you chip in grows what
          they collect when they hit the goal and the run settles.
        </p>
      </div>
      {prizeUsd !== null ? (
        <StatRow className="border-t border-edge pt-3">
          <Stat label="In the pot now" value={prizeUsd} unit="USDC" tone="money" size="lg" />
        </StatRow>
      ) : null}

      <Notice tone="limit" title="Before you add">
        If they miss the goal, the whole pot returns to the challenger who created
        it, not to the people who chipped in. What you add grows the reward and is
        not refunded to you.
      </Notice>

      <FundPool
        poolId={poolId}
        heading="How much to add"
        description="Test USDC goes from your wallet into the run's contract, never to SPOTTER."
        ctaLabel="Add to the reward"
      />
    </Card>
  );
}
