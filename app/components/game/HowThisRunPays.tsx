// "How this run pays" for a commitment run (bountyModel 2) on the run page,
// before anyone stakes, locked or not, so the terms are read before the coin.
// The list is components/CommitmentTerms.tsx, the same wording the landing,
// create-run and challenge pages use, fed this run's live count and sponsor
// pot; the fee line is read from chain.

import { CommitmentTermsList } from "@/components/CommitmentTerms";
import { Money, Skeleton } from "@/components/ui";
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
    <section
      aria-labelledby="how-this-run-pays"
      aria-busy={loading ? "true" : undefined}
      className="rounded-3xl border border-edge bg-surface p-4 sm:p-5"
    >
      <h2 id="how-this-run-pays" className="mb-3 font-display text-xl font-bold leading-display">
        How this run pays
      </h2>
      {terms !== null && terms.feeBps === 0 ? (
        <CommitmentTermsList
          entryFee={terms.entryFee}
          players={terms.players}
          sponsorPot={sponsorPotOf(terms)}
        />
      ) : loading ? (
        <div className="space-y-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-16" />
        </div>
      ) : (
        // The count or the fee did not read: the facts without a range, so no
        // number is stated that could be wrong.
        <ul className="space-y-2 text-base">
          <li>
            Everyone puts in the same stake: <Money usd={formatUsdc(entryFee)} size="sm" />.
          </li>
          <li>{COMMITMENT_FACTS.effort}</li>
          <li>
            {COMMITMENT_FACTS.hit} {COMMITMENT_FACTS.miss}
          </li>
          <li>{COMMITMENT_FACTS.nobody}</li>
          <li className="text-sm text-muted">Base Sepolia test money, beta.</li>
        </ul>
      )}
      {fee !== null ? <p className="mt-2 text-sm text-muted">{fee}</p> : null}
    </section>
  );
}
