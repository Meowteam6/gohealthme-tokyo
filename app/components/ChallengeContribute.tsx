"use client";

// Friend-facing "add to the pot" for a challenge run: a reward challenge
// (grow the reward) or a stake-on-yourself run (back the person staked).
//
// It WRAPS the existing FundPool primitive - the same approve + fundPool funnel
// every top-up uses (fundPool has no dead-pool guard, so growing a live
// challenge is exactly what it is for) - and pins challenge-appropriate framing
// around it. No new money path.
//
// HONEST DISCLOSURE (required, never hidden): fundPool records nobody, so a
// chip-in is never refunded to whoever added it. It is split among whoever
// hits; if nobody hits, sweep() hands it to the pool's creator - the
// challenger, or on a stake-on-yourself run the very person being backed.
// FundPool shows that warning (ChipInWarning) before anyone can tap.

import FundPool from "@/components/FundPool";
import type { ChipInTerms } from "@/components/ChipInWarning";
import { CARD_TITLE } from "@/components/night/kit";
import { Card, Stat, StatRow } from "@/components/ui";
import { chipInIntroOf, type ChallengeRunKind } from "@/lib/game/money-sharing";

export default function ChallengeContribute({
  poolId,
  prizeUsd,
  kind,
  chipIn,
}: {
  poolId: bigint;
  /** The prize as a formatted USDC string: pool.balance minus every player's
   *  own stake (lib/challenges darePot), read live on the server. null when it
   *  cannot be stated honestly, and then no figure is shown. */
  prizeUsd: string | null;
  /** Which flow this run is (lib/game/money-sharing challengeRunKindOf). */
  kind: ChallengeRunKind;
  /** Who the warning names and how the run pays, read from chain. */
  chipIn: ChipInTerms;
}) {
  const intro = chipInIntroOf(kind, chipIn.creator);
  return (
    <Card as="section" aria-labelledby="add-to-pot" className="[&>*+*]:mt-4">
      <div>
        <h2 id="add-to-pot" className={CARD_TITLE}>
          Add to the pot
        </h2>
        <p className="m-0 mt-1.5 text-[0.9375rem] leading-[1.5] text-muted">{intro.lead}</p>
      </div>
      {/* The extra beyond every stake. The Pot on this screen is the whole
          balance, so this part is named for what it is. */}
      {prizeUsd !== null ? (
        <StatRow className="border-t border-edge pt-3">
          <Stat label="Extra so far" value={prizeUsd} unit="USDC" tone="money" size="lg" />
        </StatRow>
      ) : null}

      <FundPool
        poolId={poolId}
        heading="How much to add"
        description="Test USDC goes from your wallet into the challenge's contract, never to SPOTTER."
        ctaLabel={intro.cta}
        chipIn={chipIn}
      />
    </Card>
  );
}
