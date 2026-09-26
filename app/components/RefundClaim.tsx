"use client";

// The refund button for a joiner of a CANCELLED pool. Step one of two: this
// credits the stake to owed[] on-chain (RefundCredited); the ClaimPayout card
// then shows it as ready to pull into the wallet. Shows only while the pool is
// cancelled and this participant has not claimed yet.

import { useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { ArcTxLink, Button, ErrorNote, Money } from "@/components/ui";
import GaslessBadge from "@/components/GaslessBadge";
import { formatUsdc } from "@/lib/contract";
import { useClaimRefund } from "@/lib/useClaimRefund";

export default function RefundClaim({
  poolId,
  entryFee,
  address,
}: {
  poolId: bigint;
  entryFee: bigint;
  address: Address;
}) {
  const queryClient = useQueryClient();
  const { status, busy, reset, gasless, claimRefund } = useClaimRefund();

  const onClaim = () => {
    void claimRefund(poolId)
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: ["owed", address] });
        await queryClient.invalidateQueries({ queryKey: ["joined-pools"] });
      })
      .catch(() => {});
  };

  if (status.kind === "done") {
    return (
      <div role="status" className="mt-3 rounded-3xl border border-edge bg-surface p-4 text-sm">
        <p className="font-bold text-foreground">
          <Money usd={formatUsdc(status.amount)} size="md" /> credited back to you.
        </p>
        <p className="mt-1 text-muted">
          It is waiting in your claimable balance. The Claim my USDC card pulls
          it into your wallet.
        </p>
        <p className="mt-2">
          <ArcTxLink txHash={status.txHash} label="See the public receipt" />
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-3xl border border-edge bg-surface p-4 text-sm">
      <p className="font-bold text-foreground">
        This run was called off. Your{" "}
        <Money usd={formatUsdc(entryFee)} size="sm" /> stake is yours to take
        back.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button onClick={onClaim} disabled={busy}>
          {busy ? "Crediting your stake back" : "Credit my stake back"}
        </Button>
        <GaslessBadge status={gasless} />
      </div>
      {status.kind === "error" ? (
        <div className="mt-3">
          <ErrorNote title="Could not claim the refund" detail={status.message} raw={status.raw} onRetry={reset} />
        </div>
      ) : null}
    </div>
  );
}
