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
import { formatUsdc, readOwed } from "@/lib/contract";
import { useWithdraw } from "@/lib/useWithdraw";

export default function ClaimPayout({
  address,
  className = "",
}: {
  address: Address;
  className?: string;
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
      <Card pop className={`border-gold/40 ${className}`}>
        <div className="flex items-center gap-4 sm:gap-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/spotter/spotter-payday.webp"
            alt="SPOTTER the otter with your coin"
            className="h-16 w-auto shrink-0 sm:h-20"
          />
          <div className="min-w-0">
            <Stamp tone="gold">Claimed</Stamp>
            <p className="mt-2">
              <Money usd={formatUsdc(status.amount)} tone="gold" sign="+" size="xl" />
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              It is in your wallet now.
            </p>
            {status.txHash !== null ? (
              <p className="mt-2">
                <ArcTxLink txHash={status.txHash} label="See the public receipt" />
                <span className="mt-0.5 block text-xs text-muted">
                  (anyone can check this - that&apos;s the point)
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

  return (
    <Card pop className={`border-gold/40 ${className}`}>
      <div className="flex items-start gap-4 sm:gap-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/spotter/spotter-payday.webp"
          alt="SPOTTER the otter holding your coin"
          className="h-16 w-auto shrink-0 sm:h-20"
        />
        <div className="min-w-0 flex-1">
          <Stamp tone="gold">Ready to claim</Stamp>
          <p className="mt-2">
            <Money usd={formatUsdc(owed)} tone="gold" sign="+" size="xl" />
          </p>
          <p className="mt-1 text-sm text-muted">
            Settled and waiting. It is credited to you on-chain - one tap pulls it
            into your wallet.
          </p>
          <div className="mt-4 space-y-3">
            <Button
              type="button"
              pop
              disabled={busy}
              onClick={onClaim}
              className="w-full sm:w-auto"
            >
              {busy ? "Claiming your USDC" : "Claim your USDC"}
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
        </div>
      </div>
    </Card>
  );
}
