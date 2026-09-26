"use client";

// The accept control inside the challenge link's run slip.
//
// Accepting a challenge IS entering its run: this wraps the SAME JoinPool primitive
// the pool page uses, with the pool's on-chain entry fee read live (never a
// hardcoded amount; a zero fee would under-approve and the join would revert).
// One wallet, one entry is enforced on-chain by joinPool exactly as everywhere
// else.
//
// The run's lock is decided once, in lib/game/lobby.ts, from the same join gate
// (lib/wearable-join-gate.ts) both staking surfaces must use. It used to be a
// second copy of the pool page's five refusals; now it is the lobby's lock
// panel with its fix, so the challenge and the lobby can never word a limit
// differently. The "sign so I can check your device" step is one tap here.
// It wears the run page's stake card parts (components/run/StakeCard), so the
// terms, the lock and the hold read the same on both staking surfaces.

import { useQuery } from "@tanstack/react-query";
import JoinPool from "@/components/JoinPool";
import ApprovalNote from "@/components/game/ApprovalNote";
import StakeLock from "@/components/run/StakeLock";
import { MissUnderStake, MoneyTermsList } from "@/components/game/MoneyTerms";
import { StakeChecks, StakeTermsPlain } from "@/components/run/StakeCard";
import {
  displayGoalSpec,
  fetchParticipant,
  fetchParticipants,
  fetchPool,
  formatUsdc,
} from "@/lib/contract";
import { useCommitmentFee } from "@/lib/game/useCommitmentFee";
import { missDetailOf } from "@/lib/game/money-flow";
import { useRunMoney } from "@/lib/game/useRunMoney";
import {
  closeLabelOf,
  clockLabel,
  isSleepMetric,
  runHeadlineOf,
} from "@/lib/game/run-page";
import { useWalletAuth } from "@/lib/useWalletAuth";
import { ButtonLink, Skeleton, TEXT_LINK } from "@/components/ui";
import {
  fetchProviderState,
  providerDownReason,
  providerQueryKey,
} from "@/lib/wearable-provider";
import {
  capabilityHoldOf,
  capabilityNeedsDevice,
  capabilityUnknown,
  fetchProviderOptions,
  providerOptionsQueryKey,
  viewerMetricsOf,
} from "@/lib/wearable-connect";
import { uploadFallbackNote, wearableJoinBlock } from "@/lib/wearable-join-gate";
import { poolCanPay, poolPhase } from "@/lib/pool-lifecycle";
import { needsDocumentVerifier, runSlotOf } from "@/lib/game/lobby";
import { useCharacter } from "@/lib/game/useCharacter";
import { useJoinChecks } from "@/lib/game/useJoinChecks";
import { useNowSeconds } from "@/lib/game/useNowSeconds";

export default function ChallengeAccept({
  poolId,
  returnTo,
  termsAbove = false,
}: {
  poolId: string;
  /** The challenge link, so a fix brings the player back to the challenge. */
  returnTo: string;
  /** The challenge's intro already states the terms right above this slip,
   *  so the slip keeps only the miss chip under the stake button. */
  termsAbove?: boolean;
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

  // Reflect an already-accepted challenge so a returning player sees "you are in"
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

  // The same two cachedOnly reads the lobby makes: opening a challenge never fires
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
  // Commitment runs (bountyModel 2) show the same terms line under the coin
  // as the pool page, from the same on-chain count and fee.
  const selfStaked = poolQuery.data?.bountyModel === 2;
  const playersQuery = useQuery({
    queryKey: ["run-players-count", poolId],
    queryFn: () => {
      if (poolIdBig === null) throw new Error("Invalid pool id.");
      return fetchParticipants(poolIdBig);
    },
    enabled: poolIdBig !== null && selfStaked,
    staleTime: 30_000,
  });
  const commitmentFee = useCommitmentFee(selfStaked);
  // The flow's chips and terms (docs/MONEY-FLOWS.md), from the same reads.
  const money = useRunMoney({
    pool: poolQuery.data ?? null,
    players: playersQuery.data?.length ?? null,
    includeJoiner: !joined,
    viewer: address,
    feeBps: commitmentFee.bps,
  });

  if (poolIdBig === null) return null;

  if (poolQuery.isError) {
    // Never fall back to a zero fee: that join would revert on the missing
    // allowance. Say so and offer the re-read.
    return (
      <div role="alert">
        <p className="m-0 text-[0.9375rem] text-muted">I could not read the stake for this challenge just now.</p>
        <button type="button" onClick={() => void poolQuery.refetch()} className={TEXT_LINK}>
          Read it again
        </button>
      </div>
    );
  }
  if (address !== null && participantQuery.isError) {
    // Unknown whether this wallet is already in: never offer a join that
    // could revert ALREADY_JOINED after the wallet prompt.
    return (
      <div role="alert">
        <p className="m-0 text-[0.9375rem] text-muted">I could not check whether you are already in this challenge.</p>
        <button type="button" onClick={() => void participantQuery.refetch()} className={TEXT_LINK}>
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
    return <Skeleton className="h-[60px] w-full rounded-control" />;
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
      capabilityHold: capabilityHoldOf(capabilityQuery.data),
      uploadAvailable: checks.verifier === "available",
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

  const stake = formatUsdc(pool.entryFee);
  const headline = runHeadlineOf({ goalSpec: pool.goalSpec, periodEnd: pool.periodEnd });
  const flowTerms = money?.copy ?? null;

  switch (slot.kind) {
    case "in-run":
      return (
        <ButtonLink href={`/pools/${poolId}`} block>
          You are in. Go to your run
        </ButtonLink>
      );
    case "checking":
      return <Skeleton className="h-[60px] w-full rounded-control" />;
    case "locked":
      return (
        <StakeLock
          lock={slot.lock}
          returnTo={returnTo}
          onCheckSensor={view.checkSensor}
          onRetry={checks.retry}
        />
      );
    case "closed":
      return (
        <p className="m-0 text-[0.9375rem] text-muted">
          This challenge has closed. If you were already in, your result settles on
          your run page.
        </p>
      );
    case "cannot-pay":
      return (
        <p className="m-0 text-[0.9375rem] text-muted">
          This challenge was set up so even a verified result pays zero, so there is
          nothing to accept here.
        </p>
      );
    case "playable": {
      return (
        <JoinPool
          poolId={poolIdBig}
          entryFee={pool.entryFee}
          alreadyJoined={joined}
          view={{
            preamble: (
              <>
                {termsAbove ? null : flowTerms !== null ? (
                  <MoneyTermsList copy={flowTerms} id="challenge-terms" />
                ) : (
                  <StakeTermsPlain>
                    Accepting stakes your {stake} USDC. Hit the goal and it comes back with
                    your share on top; the challenger never keeps it.
                  </StakeTermsPlain>
                )}
                {slot.proof === "upload" ? (
                  <StakeChecks
                    items={[{ key: "upload", glyph: "info", children: uploadFallbackNote(pool.goalSpec) }]}
                  />
                ) : null}
                <ApprovalNote />
              </>
            ),
            underStake:
              money !== null && money.miss !== null && flowTerms !== null ? (
                <MissUnderStake miss={money.miss} detail={missDetailOf(flowTerms)} />
              ) : null,
            goalTitle:
              headline.figure !== null
                ? `${headline.figure} ${headline.rest}`
                : displayGoalSpec(pool.goalSpec),
            joined: {
              stake,
              pot: formatUsdc(pool.balance),
              players: playersQuery.data !== undefined ? playersQuery.data.length : null,
              night: isSleepMetric(headline.metric),
              deviceName: deviceLabel ?? "wearable",
              goalShort: headline.short,
              closeLabel: closeLabelOf(pool.periodEnd),
              closeClock: clockLabel(Number(pool.periodEnd)),
              action: (
                <ButtonLink href={`/pools/${poolId}`} variant="secondary" block>
                  Go to your run
                </ButtonLink>
              ),
            },
            barAction: null,
          }}
        />
      );
    }
  }
}
