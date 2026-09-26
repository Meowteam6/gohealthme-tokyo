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
      <div role="status" className="rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border)]">
        <p className="num m-0 text-[0.9375rem] font-semibold text-foreground">
          <Money usd={formatUsdc(status.amount)} size="md" /> credited back to you.
        </p>
        <p className="m-0 mt-1 text-sm text-muted">
          It is waiting in your claimable balance. The claim below pulls it into
          your wallet.
        </p>
        <div className="mt-1">
          <ArcTxLink txHash={status.txHash} label="See it on Basescan" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border)]">
      <p className="num m-0 text-[0.9375rem] font-semibold text-foreground">
        This challenge was called off. Your <Money usd={formatUsdc(entryFee)} size="sm" /> stake is
        yours to take back.
      </p>
      <div className="mt-3 grid gap-3">
        <Button onClick={onClaim} disabled={busy} block>
          {busy ? "Crediting your stake back" : "Credit my stake back"}
        </Button>
        <GaslessBadge status={gasless} />
      </div>
      {status.kind === "error" ? (
        <div className="mt-3">
          <ErrorNote
            title="Could not claim the refund"
            detail={status.message}
            raw={status.raw}
            onRetry={reset}
            retryLabel="Try the refund again"
          />
        </div>
      ) : null}
    </div>
  );
}
