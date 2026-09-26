"use client";

// The claim card. HealthPoolsV3 is a pull-payment contract: settle() only
// CREDITS owed[user], so a settled win sits on-chain until the winner runs
// withdraw(). This card is that withdraw button - the one surface that turns a
// credited payout into USDC actually in the wallet.
//
// Honest-core: it shows ONLY when the chain says money is owed (readOwed > 0),
// and it reports success only after the Withdrawn event fired (the useWithdraw
// hook asserts that, never tx-success alone). Before the claim it says the money
// is settled and waiting; only after withdraw() lands does it say it is in the
// wallet. It renders nothing when nothing is owed, so it never nags.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { ArcTxLink, Button, Card, ErrorNote, Money, Stamp } from "@/components/ui";
import GaslessBadge from "@/components/GaslessBadge";
import Spotter from "@/components/spotter/Spotter";
import { formatUsdc, readOwed } from "@/lib/contract";
import { useWithdraw } from "@/lib/useWithdraw";

export default function ClaimPayout({
  address,
  className = "",
  quiet = false,
}: {
  address: Address;
  className?: string;
  /** Inside the paid Verdict: no second big number, just the claim. */
  quiet?: boolean;
}) {
  const queryClient = useQueryClient();
  const { status, busy, reset, gasless, withdraw } = useWithdraw();

  const owedQuery = useQuery({
    queryKey: ["owed", address],
    queryFn: () => readOwed(address),
    staleTime: 15_000,
  });
  const owed = owedQuery.data ?? 0n;

  const onClaim = () => {
    void withdraw()
      .then(async () => {
        // The claim drained owed[] and moved USDC into the wallet: refresh both
        // the owed read (this card) and the wallet balance card so neither shows
        // a stale figure.
        await queryClient.invalidateQueries({ queryKey: ["owed", address] });
        await queryClient.invalidateQueries({ queryKey: ["balance", address] });
      })
      // The hook already wrote the humanized error into status; nothing else to
      // do here, and swallowing keeps the rejection from going unhandled.
      .catch(() => {});
  };

  // After a confirmed withdraw the money really is in the wallet, so this is the
  // one place the copy may say so. Driven by the hook's asserted amount, never a
  // guess.
  if (status.kind === "done") {
    return (
      <Card className={`border-gold/40 ${className}`}>
        <div className="flex items-center gap-4 sm:gap-5">
          {quiet ? null : (
            <Spotter pose="payday" size="xs" alt="SPOTTER handing you your coin" />
          )}
          <div className="min-w-0">
            <Stamp tone="gold">Claimed</Stamp>
            <p className="mt-2">
              <Money
                usd={formatUsdc(status.amount)}
                sign="+"
                size={quiet ? "lg" : "xl"}
              />
            </p>
            <p className="mt-1 text-sm font-bold text-foreground">
              It is in your wallet now.
            </p>
            {status.txHash !== null ? (
              <p className="mt-2">
                <ArcTxLink txHash={status.txHash} label="See the receipt" />
                <span className="mt-0.5 block text-xs text-muted">
                  Public on Base Sepolia. Anyone can check it.
                </span>
              </p>
            ) : null}
          </div>
        </div>
      </Card>
    );
  }

  // A failed owed() read is not "nothing owed": a winner whose credit is on
  // chain must never see the claim vanish because an RPC hiccupped.
  if (owedQuery.isError && owedQuery.data === undefined) {
    return (
      <div className={className}>
        <ErrorNote
          title="Could not check what you are owed"
          detail="I could not read your claimable balance from Base Sepolia just now. Nothing moved; anything credited to you is still there."
          onRetry={() => {
            void owedQuery.refetch();
          }}
        />
      </div>
    );
  }

  // Nothing owed (or not read yet): render nothing. A settled win that has not
  // been credited yet, and a wallet that already withdrew, both land here.
  if (owed <= 0n) return null;

  const action = (
    <div className="space-y-3">
      <Button
        type="button"
        disabled={busy}
        onClick={onClaim}
        className="w-full sm:w-auto"
      >
        {busy ? "Claiming your USDC" : "Claim my USDC"}
      </Button>
      <GaslessBadge status={gasless} />
      {status.kind === "error" ? (
        <ErrorNote
          title="Could not claim just yet"
          detail={status.message}
          raw={status.raw}
          onRetry={reset}
        />
      ) : null}
    </div>
  );

  // Inside the paid Verdict the payout above is the screen's one big number,
  // so the claim is a plain sentence and the button.
  if (quiet) {
    return (
      <div className={`space-y-3 text-center sm:text-left ${className}`}>
        <p className="text-sm text-foreground">
          <Money usd={formatUsdc(owed)} size="sm" /> is ready to claim. One tap
          pulls it into your wallet.
        </p>
        {action}
      </div>
    );
  }

  return (
    <Card className={`border-gold/40 ${className}`}>
      <div className="flex items-start gap-4 sm:gap-5">
        <Spotter pose="payday" size="xs" alt="SPOTTER holding your coin" />
        <div className="min-w-0 flex-1">
          <Stamp tone="gold">Ready to claim</Stamp>
          <p className="mt-2">
            <Money usd={formatUsdc(owed)} sign="+" size="xl" />
          </p>
          <p className="mt-1 text-sm text-muted">
            Settled and waiting. It is credited to you on chain, and one tap
            pulls it into your wallet.
          </p>
          <div className="mt-4">{action}</div>
        </div>
      </div>
    </Card>
  );
}
