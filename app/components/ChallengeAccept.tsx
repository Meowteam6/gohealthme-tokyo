"use client";

// The Accept control on the you've-been-challenged landing.
//
// Accepting a challenge IS joining its pool: this wraps the SAME JoinPool
// primitive the pool page uses. Every pool on the deployed contract carries an
// entry fee above zero (the contract requires every player to be a staker), so
// accepting means staking that lock-in - JoinPool approves and pulls exactly
// p.entryFee, read LIVE from the chain here, never a hardcoded amount. Passing a
// zero fee would skip the approval and the join would revert on the missing
// allowance, so the real fee has to be known before the button can act. One
// wallet, one entry is enforced on-chain by joinPool exactly as everywhere else.
// After joining, the target is handed off to the pool page, which is where
// evidence upload and the claim rail live - this landing does not reimplement
// that flow, it routes into it.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import JoinPool from "@/components/JoinPool";
import { fetchParticipant, fetchPool, formatUsdc } from "@/lib/contract";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useWalletAuth } from "@/lib/useWalletAuth";
import { Money, Skeleton, TAP_TARGET } from "@/components/ui";
import {
  fetchProviderState,
  providerDownReason,
  providerQueryKey,
} from "@/lib/wearable-provider";
import {
  capabilityNeedsDevice,
  capabilityUnknown,
  fetchProviderOptions,
  metricLabel,
  providerOptionsQueryKey,
  viewerMetricsOf,
} from "@/lib/wearable-connect";
import { wearableJoinBlock } from "@/lib/wearable-join-gate";

// A full-width Next Link dressed as the shared candy control. Emerald-tinted
// once you are in (the go-get-paid onward step), tan and secondary before that
// (the quieter "see the whole thing" read). Button is a <button> and cannot be
// a Link, so its look is matched here.
const ONWARD_BASE =
  "flex min-h-11 w-full items-center justify-center rounded-full border-2 px-5 py-3 font-display text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function ChallengeAccept({ poolId }: { poolId: string }) {
  const { address } = useEmbeddedWallet();
  const requestAuth = useWalletAuth();

  let poolIdBig: bigint | null;
  try {
    poolIdBig = BigInt(poolId);
  } catch {
    poolIdBig = null;
  }

  // The lock-in is the pool's on-chain entry fee, read live. JoinPool approves
  // and pulls exactly this, so the value has to be resolved before we can hand
  // it a safe amount - a zero fee would under-approve and the join would revert.
  const poolQuery = useQuery({
    queryKey: ["pool", poolId],
    queryFn: () => {
      if (poolIdBig === null) throw new Error("Invalid pool id.");
      return fetchPool(poolIdBig);
    },
    enabled: poolIdBig !== null,
  });

  // Reflect an already-accepted challenge so a returning target sees "you are
  // in" and a route onward, instead of tapping accept and hitting an
  // ALREADY_JOINED revert. Owner-scoped and best-effort: an unknown status just
  // shows the accept button, which fails closed on-chain anyway.
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

  // The same two reads the pool page makes, and the same cachedOnly rule:
  // opening a challenge link must not fire a wallet prompt. Unknown capability
  // withholds the accept rather than assuming it is fine, which is the whole
  // point - this surface used to mount JoinPool with no check at all.
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

  const joinBlock = wearableJoinBlock({
    goalSpec: poolQuery.data?.goalSpec ?? "",
    address,
    joined,
    providerDown: providerDownReason(providerQuery.data),
    viewerMetrics: viewerMetricsOf(capabilityQuery.data),
    capabilityPending:
      address !== null && capabilityUnknown(capabilityQuery.data),
    needsDevice: capabilityNeedsDevice(capabilityQuery.data),
  });

  if (poolIdBig === null) return null;

  const entryFee = poolQuery.data?.entryFee ?? null;

  return (
    <div className="space-y-4">
      {entryFee !== null && entryFee > 0n && !joined ? (
        <p className="text-sm text-muted">
          Accepting stakes your <Money usd={formatUsdc(entryFee)} size="sm" />{" "}
          lock-in. Hit the goal and it comes back with the reward; the challenger
          never keeps it.
        </p>
      ) : null}

      {joinBlock.kind !== "ok" ? (
        // The share link is probably the commonest way anyone reaches a pool,
        // and it mounted JoinPool with no device check at all - so every limit
        // the pool page surfaces before the stake was bypassed here. Same
        // decision as the pool page, made in lib/wearable-join-gate.ts so the
        // two surfaces cannot drift apart again.
        <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4">
          <p className="text-sm font-semibold text-warning">
            {joinBlock.kind === "outage"
              ? "I cannot check this goal right now"
              : joinBlock.kind === "unsupported"
                ? "Your device cannot measure this one"
                : joinBlock.kind === "no-device"
                  ? "Connect a device first"
                  : "Let me check your device first"}
          </p>
          <p className="mt-1 text-sm text-foreground/80">
            {joinBlock.kind === "outage"
              ? joinBlock.reason
              : joinBlock.kind === "unsupported"
                ? `This challenge is measured in ${metricLabel(joinBlock.metric)}, which your connected device does not report. That is the hardware, not a delay.`
                : joinBlock.kind === "no-device"
                  ? "You have not linked a device yet, so there is nothing for SPOTTER to verify. Connect one and this opens up."
                  : "Not every device can measure every goal and I have not checked yours yet. Open your dashboard and I will look."}
          </p>
          <p className="mt-2 text-sm text-foreground/80">
            The lock-in is real money, so I am not taking it for a goal I might
            not be able to verify for you.
          </p>
          <Link
            href="/dashboard"
            className={`mt-3 inline-block rounded-xl border-2 border-edge font-semibold hover:border-accent/50 ${TAP_TARGET}`}
          >
            {joinBlock.kind === "outage" ? "Go to my dashboard" : "Check my device"}
          </Link>
        </div>
      ) : entryFee !== null ? (
        <JoinPool poolId={poolIdBig} entryFee={entryFee} alreadyJoined={joined} />
      ) : poolQuery.isError ? (
        // Never fall back to a zero fee - that would send a join that reverts on
        // the missing allowance. When the live read fails, say so and send them
        // to the pool page, where the join primitive loads the fee fresh.
        <p className="text-sm text-muted">
          Could not read the stake for this challenge right now. Open the full
          challenge below to accept it.
        </p>
      ) : (
        // Hold the button until the live read lands; JoinPool renders once it
        // knows the exact lock-in to approve.
        <Skeleton className="h-12 w-full rounded-xl" />
      )}

      <Link
        href={`/pools/${poolId}`}
        className={`${ONWARD_BASE} ${
          joined
            ? "border-accent bg-accent/10 text-accent-strong hover:bg-accent/20"
            : "border-edge bg-secondary text-secondary-foreground hover:border-accent/50"
        }`}
      >
        {joined ? "Upload your proof and get paid" : "See the full challenge"}
      </Link>
    </div>
  );
}
