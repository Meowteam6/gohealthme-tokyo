// "How this run pays" for a commitment run (bountyModel 2) on the run page,
// before anyone stakes, locked or not, so the terms are read before the coin.
// The list is components/CommitmentTerms.tsx, the same wording the challenge
// page uses, fed this run's live count and sponsor pot; the fee line is read
// from chain.

import { CommitmentTermsList } from "@/components/CommitmentTerms";
import { Card, Money, Skeleton } from "@/components/ui";
import { formatUsdc } from "@/lib/contract";
import {
  COMMITMENT_FACTS,
  feeLine,
  sponsorPotOf,
  type CommitmentTerms,
} from "@/lib/game/commitment-copy";

export default function HowThisRunPays({
  terms,
  entryFee,
  loading,
}: {
  /** Null when the player count is loading or could not be read. */
  terms: CommitmentTerms | null;
  entryFee: bigint;
  loading: boolean;
}) {
  const fee = terms !== null ? feeLine(terms.feeBps) : null;
  return (
    <Card as="section" aria-labelledby="how-this-run-pays" aria-busy={loading ? "true" : undefined}>
      <h2 id="how-this-run-pays" className="type-heading m-0 mb-3 text-[1.375rem] min-[900px]:text-[1.625rem]">
        How this run pays
      </h2>
      {terms !== null && terms.feeBps === 0 ? (
        <CommitmentTermsList
          entryFee={terms.entryFee}
          players={terms.players}
          sponsorPot={sponsorPotOf(terms)}
        />
      ) : loading ? (
        <div className="grid gap-2" aria-hidden="true">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-16" />
        </div>
      ) : (
        // The count or the fee did not read: the facts without a range, so no
        // number is stated that could be wrong.
        <ul className="m-0 grid list-none gap-2.5 p-0 text-[0.9375rem] leading-normal text-muted">
          <li>
            Everyone puts in the same stake: <Money usd={formatUsdc(entryFee)} size="sm" />.
          </li>
          <li>{COMMITMENT_FACTS.effort}</li>
          <li>
            {COMMITMENT_FACTS.hit} {COMMITMENT_FACTS.miss}
          </li>
          <li>{COMMITMENT_FACTS.nobody}</li>
          <li className="text-[0.8125rem] text-haze">Base Sepolia test USDC, beta.</li>
        </ul>
      )}
      {fee !== null ? <p className="m-0 mt-2 text-[0.8125rem] text-haze">{fee}</p> : null}
    </Card>
  );
}
