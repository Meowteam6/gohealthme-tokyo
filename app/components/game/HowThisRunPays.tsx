// "How this run pays" for a commitment run (bountyModel 2): the compliance
// line in SPOTTER's voice, with today's numbers from lib/commitment.ts. Shown
// on the run page before anyone stakes, locked or not, so the terms are read
// before the coin, never after it.

import { Skeleton } from "@/components/ui";
import { howThisRunPays, type CommitmentTerms } from "@/lib/game/commitment-copy";

export default function HowThisRunPays({
  terms,
  entryFee,
  loading,
  joining,
}: {
  /** Null when the player count is loading or could not be read. */
  terms: CommitmentTerms | null;
  entryFee: bigint;
  loading: boolean;
  joining: boolean;
}) {
  if (terms === null && loading) {
    return (
      <section aria-label="How this run pays" aria-busy="true" className="rounded-3xl border border-edge bg-surface p-4 sm:p-5">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="mt-3 h-16" />
      </section>
    );
  }
  // Count unreadable: only the lines that need no count. No sponsor figure
  // and no range (feeBps null suppresses every number past the stake).
  const lines = howThisRunPays(
    terms ?? { entryFee, players: 0, balance: 0n, feeBps: null },
    joining,
  );
  return (
    <section
      aria-labelledby="how-this-run-pays"
      className="rounded-3xl border border-edge bg-surface p-4 sm:p-5"
    >
      <h2
        id="how-this-run-pays"
        className="font-display text-xl font-bold leading-display"
      >
        How this run pays
      </h2>
      <p className="mt-2 text-sm text-foreground/85">{lines.same}</p>
      <ul className="mt-3 space-y-2 text-sm">
        <li className="flex gap-2">
          <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-gold" />
          <span>
            {lines.hit}
            {lines.range !== null ? (
              <span className="mt-0.5 block font-bold tabular-nums text-gold-deep">{lines.range}</span>
            ) : null}
          </span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-dusk" />
          <span>{lines.miss}</span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-foreground" />
          <span>{lines.nobody}</span>
        </li>
      </ul>
      <p className="mt-3 text-xs text-muted">
        {lines.fee !== null ? `${lines.fee} ` : ""}Test USDC on Base Sepolia, beta.
      </p>
    </section>
  );
}
