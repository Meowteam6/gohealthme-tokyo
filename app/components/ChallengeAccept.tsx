"use client";

// The accept control inside the challenge link's run slip.
//
// Accepting a dare IS entering its run: this wraps the SAME JoinPool primitive
// the pool page uses, with the pool's on-chain entry fee read live (never a
// hardcoded amount; a zero fee would under-approve and the join would revert).
// One wallet, one entry is enforced on-chain by joinPool exactly as everywhere
// else.
//
// The run's lock is decided once, in lib/game/lobby.ts, from the same join gate
// (lib/wearable-join-gate.ts) both staking surfaces must use. It used to be a
// second copy of the pool page's five refusals; now it is the lobby's lock
// panel with its fix, so the dare and the lobby can never word a limit
// differently. The "sign so I can check your device" step is one tap here.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import JoinPool from "@/components/JoinPool";
import ApprovalNote from "@/components/game/ApprovalNote";
import LockPanel from "@/components/game/LockPanel";
import { fetchParticipant, fetchPool, formatUsdc } from "@/lib/contract";
import { useWalletAuth } from "@/lib/useWalletAuth";
import { Skeleton, TAP_TARGET } from "@/components/ui";
import {
  fetchProviderState,
  providerDownReason,
  providerQueryKey,
} from "@/lib/wearable-provider";
import {
  capabilityNeedsDevice,
  capabilityUnknown,
  fetchProviderOptions,
  providerOptionsQueryKey,
  viewerMetricsOf,
} from "@/lib/wearable-connect";
import { wearableJoinBlock } from "@/lib/wearable-join-gate";
import { poolCanPay, poolPhase } from "@/lib/pool-lifecycle";
import { needsDocumentVerifier, runSlotOf } from "@/lib/game/lobby";
import { useCharacter } from "@/lib/game/useCharacter";
import { useJoinChecks } from "@/lib/game/useJoinChecks";
import { useNowSeconds } from "@/lib/game/useNowSeconds";

export default function ChallengeAccept({
  poolId,
  returnTo,
}: {
  poolId: string;
  /** The challenge link, so a fix brings the player back to the dare. */
  returnTo: string;
}) {
  const view = useCharacter();
  const checks = useJoinChecks(view);
  const { address } = view;
  const requestAuth = useWalletAuth();
  const now = useNowSeconds();

  let poolIdBig: bigint | null;
  try {
    poolIdBig = BigInt(poolId);
  } catch {
    poolIdBig = null;
  }

  const poolQuery = useQuery({
    queryKey: ["pool", poolId],
    queryFn: () => {
      if (poolIdBig === null) throw new Error("Invalid pool id.");
      return fetchPool(poolIdBig);
    },
    enabled: poolIdBig !== null,
  });

  // Reflect an already-accepted dare so a returning player sees "you are in"
  // and a route onward, instead of an ALREADY_JOINED revert.
  const participantQuery = useQuery({
    queryKey: ["participant", poolId, address],
    queryFn: () => {
      if (poolIdBig === null) throw new Error("Invalid pool id.");
      if (address === null) throw new Error("No wallet connected.");
      return fetchParticipant(poolIdBig, address);
    },
    enabled: poolIdBig !== null && address !== null,
  });
  const joined = participantQuery.data?.joined === true;

  // The same two cachedOnly reads the lobby makes: opening a dare never fires
  // a wallet prompt. Unknown capability withholds the accept.
  const providerQuery = useQuery({
    queryKey: providerQueryKey(address),
    queryFn: () => {
      if (address === null) throw new Error("No wallet connected.");
      return fetchProviderState(address, (options) =>
        requestAuth({ ...options, cachedOnly: true }),
      );
    },
    enabled: address !== null,
    retry: false,
  });
  const capabilityQuery = useQuery({
    queryKey: providerOptionsQueryKey(address),
    queryFn: () => {
      if (address === null) throw new Error("No wallet connected.");
      return fetchProviderOptions(address, (options) =>
        requestAuth({ ...options, cachedOnly: true }),
      );
    },
    enabled: address !== null,
    retry: false,
    staleTime: 60_000,
  });

  if (poolIdBig === null) return null;

  if (poolQuery.isError) {
    // Never fall back to a zero fee: that join would revert on the missing
    // allowance. Say so and offer the re-read.
    return (
      <div className="space-y-2">
        <p className="text-sm">I could not read the stake for this dare just now.</p>
        <button
          type="button"
          onClick={() => void poolQuery.refetch()}
          className={`-ml-4 font-semibold text-accent underline underline-offset-2 ${TAP_TARGET}`}
        >
          Read it again
        </button>
      </div>
    );
  }
  if (address !== null && participantQuery.isError) {
    // Unknown whether this wallet is already in: never offer a join that
    // could revert ALREADY_JOINED after the wallet prompt.
    return (
      <div className="space-y-2">
        <p className="text-sm">I could not check whether you are already in this dare.</p>
        <button
          type="button"
          onClick={() => void participantQuery.refetch()}
          className={`-ml-4 font-semibold text-accent underline underline-offset-2 ${TAP_TARGET}`}
        >
          Check again
        </button>
      </div>
    );
  }
  if (
    poolQuery.data === undefined ||
    now === null ||
    (address !== null && participantQuery.isLoading)
  ) {
    return <Skeleton className="h-12 w-full rounded-lg" />;
  }

  const pool = poolQuery.data;
  const deviceLabel =
    (capabilityQuery.data?.providers ?? []).find(
      (p) => p.id === capabilityQuery.data?.selected,
    )?.label ?? null;
  const slot = runSlotOf({
    phase: poolPhase(pool, BigInt(now)),
    cancelled: pool.cancelled,
    canPay: poolCanPay(pool),
    joined,
    address,
    joinBlock: wearableJoinBlock({
      goalSpec: pool.goalSpec,
      address,
      joined,
      providerDown: providerDownReason(providerQuery.data),
      viewerMetrics: viewerMetricsOf(capabilityQuery.data),
      capabilityPending: address !== null && capabilityUnknown(capabilityQuery.data),
      needsDevice: capabilityNeedsDevice(capabilityQuery.data),
    }),
    // World, the closed-beta list (this path is public, so AccessGate never
    // ran), the document checker and the payout rule: loading holds the
    // stake, a failed read locks it behind a retry.
    worldLane: checks.worldLane,
    humanVerified: checks.humanVerified,
    gate: checks.gate,
    needsDocumentVerifier: needsDocumentVerifier(pool.goalSpec),
    verifier: checks.verifier,
    payouts: checks.payouts,
    deviceLabel,
  });

  switch (slot.kind) {
    case "in-run":
      return (
        <Link
          href={`/pools/${poolId}`}
          className={`w-full rounded-lg bg-foreground font-semibold text-background hover:bg-accent ${TAP_TARGET}`}
        >
          You are in. Go to your run
        </Link>
      );
    case "checking":
      return <Skeleton className="h-12 w-full rounded-lg" />;
    case "locked":
      return (
        <LockPanel
          lock={slot.lock}
          returnTo={returnTo}
          onCheckSensor={view.checkSensor}
          onRetry={checks.retry}
        />
      );
    case "closed":
      return (
        <p className="text-sm text-foreground/80">
          This dare has closed. If you were already in, your result settles on
          your run page.
        </p>
      );
    case "cannot-pay":
      return (
        <p className="text-sm text-foreground/80">
          This dare was set up so even a verified result pays zero, so there is
          nothing to accept here.
        </p>
      );
    case "playable":
      return (
        <div className="space-y-2">
          <p className="text-sm text-foreground/80">
            Accepting stakes your {formatUsdc(pool.entryFee)} USDC. Hit the goal
            and it comes back with the prize on top; the challenger never keeps
            it.
          </p>
          <ApprovalNote />
          <JoinPool poolId={poolIdBig} entryFee={pool.entryFee} alreadyJoined={joined} />
        </div>
      );
  }
}
