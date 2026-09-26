"use client";

// The creator's "take back the leftover" action on a finished run: the only
// app path to HealthPoolsV3.sweep(). What it offers is decided in
// lib/game/run-end.ts (sweepStateOf); the transfer is asserted on the
// FundsSwept event in lib/useSweepPool.ts.
//
// Honest about the one state the contract makes impossible: on a cancelled
// pool, sweep() reverts REFUNDS_PENDING until every player has taken their
// stake back, and nothing the creator does can force that. The card says so
// and how much is still waiting, instead of offering a button that reverts.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { ArcTxLink, Button, Card, ErrorNote, Money, Stamp } from "@/components/ui";
import GaslessBadge from "@/components/GaslessBadge";
import { fetchRefundLiability, formatUsdc, type PoolInfo } from "@/lib/contract";
import { sweepStateOf } from "@/lib/game/run-end";
import type { PoolPhase } from "@/lib/pool-lifecycle";
import { useSweepPool } from "@/lib/useSweepPool";

export default function SweepLeftover({
  pool,
  phase,
  address,
  className = "",
}: {
  pool: PoolInfo;
  phase: PoolPhase;
  address: Address | null;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const { status, busy, reset, gasless, sweep } = useSweepPool();
  const isCreator =
    address !== null && address.toLowerCase() === pool.creator.toLowerCase();
  const cancelled = phase === "cancelled";

  const liabilityQuery = useQuery({
    queryKey: ["refund-liability", pool.id.toString()],
    queryFn: () => fetchRefundLiability(pool.id),
    enabled: isCreator && cancelled,
    staleTime: 15_000,
  });

  if (!isCreator) return null;

  if (status.kind === "done") {
    return (
      <Card pop className={`border-gold/40 ${className}`}>
        <Stamp tone="gold">Taken back</Stamp>
        <p className="mt-2">
          <Money usd={formatUsdc(status.amount)} tone="gold" sign="+" size="xl" />
        </p>
        <p className="mt-1 text-sm font-semibold text-foreground">
          The leftover is in your wallet now. This challenge is empty.
        </p>
        <p className="mt-2">
          <ArcTxLink txHash={status.txHash} label="See the public receipt" />
        </p>
      </Card>
    );
  }

  if (cancelled && liabilityQuery.isError) {
    return (
      <div className={className}>
        <ErrorNote
          title="Could not check the refunds on this challenge"
          detail="I could not read how many stakes are still waiting to be taken back. Nothing moved."
          onRetry={() => {
            void liabilityQuery.refetch();
          }}
        />
      </div>
    );
  }

  const state = sweepStateOf({
    phase,
    isCreator,
    balance: pool.balance,
    entryFee: pool.entryFee,
    refundLiability: cancelled ? (liabilityQuery.data ?? null) : 0n,
  });

  if (state.kind === "hidden") return null;

  if (state.kind === "empty") {
    return (
      <p className={`rounded-xl border-2 border-edge bg-surface p-4 text-sm text-muted ${className}`}>
        You started this challenge. Nothing is left in it to take back.
      </p>
    );
  }

  if (state.kind === "refunds-pending") {
    return (
      <div className={`rounded-xl border-2 border-warning/40 bg-warning/10 p-4 text-sm ${className}`}>
        <p className="font-display text-lg font-bold">Leftover locked until refunds are taken</p>
        <p className="mt-1 text-foreground/80">
          {state.pendingStakes === 1
            ? "1 player has not taken their stake back yet"
            : `${state.pendingStakes} players have not taken their stakes back yet`}{" "}
          ({formatUsdc(state.pendingAmount)} test USDC). The contract keeps the
          rest of the pot locked until every stake is claimed, and nobody can
          claim a stake for them. It unlocks here the moment the last one does.
        </p>
      </div>
    );
  }

  const onSweep = () => {
    void sweep(pool.id)
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: ["pool", pool.id.toString()] });
        await queryClient.invalidateQueries({ queryKey: ["sponsor-console"] });
      })
      // The hook wrote the humanized error into status.
      .catch(() => {});
  };

  return (
    <Card pop className={className}>
      <p className="font-display text-lg font-bold">Take back the leftover</p>
      <p className="mt-2">
        <Money usd={formatUsdc(state.amount)} size="xl" />
      </p>
      <p className="mt-1 text-sm text-muted">
        {cancelled
          ? "Every player has their stake back. What is left is yours; one tap sends it to your wallet."
          : "Winners were credited at settle. What is left in the pot is yours; one tap sends it to your wallet."}
      </p>
      <div className="mt-4 space-y-3">
        <Button type="button" pop disabled={busy} onClick={onSweep} className="w-full sm:w-auto">
          {busy ? "Sending it to your wallet" : "Take it back"}
        </Button>
        <GaslessBadge status={gasless} />
        {status.kind === "error" ? (
          <ErrorNote
            title="Could not take it back just yet"
            detail={status.message}
            raw={status.raw}
            onRetry={reset}
          />
        ) : null}
      </div>
    </Card>
  );
}
