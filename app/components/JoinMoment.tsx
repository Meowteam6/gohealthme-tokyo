// The receipt left once the stake is in: SPOTTER has the coin, the run is on.
// Deliberately calm (docs/DESIGN.md, "Celebration only at the verdict"): a
// join proves nothing and pays nothing, so there is no takeover, no confetti
// and no gold. The line is fixed so the same state always reads the same, and
// it is dry, never loud, because loud is reserved for a verified payout.
//
// A fresh join in this mount announces itself politely; a returning player who
// was already in gets the same card without the announcement. Which one is the
// caller's call, read from its own local join state, never the transaction.

import { ArcTxLink, Stamp } from "@/components/ui";
import Spotter from "@/components/spotter/Spotter";

export default function JoinMoment({
  txHash,
  fresh = true,
}: {
  txHash: string | null;
  /** True right after a join landed in this mount: the card is announced. */
  fresh?: boolean;
}) {
  return (
    <div
      role={fresh ? "status" : undefined}
      className="flex items-center gap-4 rounded-3xl border border-edge bg-surface p-5 sm:gap-5 sm:p-6"
    >
      <Spotter pose="thumbsup" size="xs" alt="SPOTTER giving you a thumbs up" />
      <div className="min-w-0">
        <Stamp tone="accent">Joined</Stamp>
        <p className="mt-3 font-display text-xl font-bold leading-tight tracking-display text-balance">
          You are in. One wallet, one entry.
        </p>
        <p className="mt-1 text-sm text-muted">
          SPOTTER has your stake. Now go do the thing.
        </p>
        {txHash !== null ? (
          <p className="mt-2">
            <ArcTxLink txHash={txHash} label="See the public receipt" />
            <span className="mt-0.5 block text-xs text-muted">
              Anyone can check it. That is the point.
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
