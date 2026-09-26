"use client";

// The Verdict. SPOTTER checks, then asks the player to confirm it is them
// (World ID for Agents, the boss moment) before any USDC moves, the payout is
// screened (one line), and the run ends on a real screen: won with the claim
// tap folded in, run failed and ask again, not there yet, run lost, stopped
// for a reason that is not the player's, or cancelled with the stake back.
//
// The mapping from the ledger, the chain and the approval status to the screen
// is lib/game/verdict.ts. Nothing here decides money; it shows what the server
// already recorded and mounts the other lanes' components through their
// contracts (docs/LANES.md).

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import HumanApprovalCard, { type ApprovalOutcome } from "@/components/world/HumanApprovalCard";
import PayoutScreening from "@/components/intercepta/PayoutScreening";
import AgentReceipt from "@/components/AgentReceipt";
import PayoutMoment from "@/components/PayoutMoment";
import ClaimPayout from "@/components/ClaimPayout";
import RefundClaim from "@/components/RefundClaim";
import SpotterSays from "@/components/SpotterSays";
import { toUsd2, type LedgerEntry, type RunStatus } from "@/lib/agent-receipt";
import { claimStepIndex, claimStepOf, type ClaimStep } from "@/lib/claim-rail";
import { fetchGoalId, type PoolInfo } from "@/lib/contract";
import { missConfirmByMs, missDeadlineMs } from "@/lib/miss-grace";
import { missRulePool } from "@/lib/miss-rule";
import { parseScreening, type ScreeningStatus } from "@/lib/game/lanes";
import { useLaneProbe } from "@/lib/game/useLaneProbe";
import {
  verdictCopy,
  verdictScreenOf,
  type LocalApproval,
  type VerdictScreen,
} from "@/lib/game/verdict";

/** The run's path in five words, the claim rail's steps renamed for the game. */
const PATH: { step: ClaimStep; label: string }[] = [
  { step: "join", label: "Enter" },
  { step: "prove", label: "Play" },
  { step: "checking", label: "SPOTTER checks" },
  { step: "verdict", label: "Verdict" },
  { step: "paid", label: "Paid" },
];

function RunPath({ step }: { step: ClaimStep }) {
  const active = claimStepIndex(step);
  return (
    <ol className="flex flex-wrap gap-x-3 gap-y-1 text-sm" aria-label="Where this run is">
      {PATH.map((p, i) => (
        <li
          key={p.step}
          aria-current={i === active ? "step" : undefined}
          className={
            i < active
              ? "text-accent"
              : i === active
                ? "font-bold text-foreground underline decoration-2 underline-offset-4"
                : "text-muted"
          }
        >
          {p.label}
        </li>
      ))}
    </ol>
  );
}

/** Which screens keep the proof surface (WearableCheck) mounted below: the
 *  ones where its polling loop or its retry button still matters. */
export function proofSurfaceNeeded(screen: VerdictScreen): boolean {
  switch (screen.kind) {
    case "won":
    case "lost":
    case "missed":
    case "cancelled":
    case "settled-final":
      return false;
    case "approval-failed":
      // Once the pool settled there is nothing left to check or retry.
      return !screen.settled;
    default:
      return true;
  }
}

export interface VerdictScreening {
  status: ScreeningStatus;
  reason: string | null;
}

export interface VerdictStageProps {
  pool: PoolInfo;
  address: `0x${string}`;
  joined: boolean;
  refunded: boolean;
  runStatus: RunStatus | null;
  ledger: LedgerEntry[] | null;
  hasClaim: boolean;
  screen: VerdictScreen;
  goalId: string | null;
  screening: VerdictScreening;
  onApproval: (outcome: ApprovalOutcome) => void;
}

/** The approval and screening reads, plus the screen they produce. */
export function useVerdict(input: {
  /** Null while the pool is still loading; the screen is "none" until then. */
  pool: PoolInfo | null;
  address: `0x${string}` | null;
  joined: boolean;
  refunded: boolean;
  runStatus: RunStatus | null;
  ledger: LedgerEntry[] | null;
  /** The participant's on-chain resultRecorded flag, when read. */
  resultRecorded?: boolean;
  /** Called when the card reports the human said yes, so the page can wake
   *  the run loop that records the result (docs/WORLD.md step 4). */
  onApproved?: () => void;
}) {
  const [local, setLocal] = useState<LocalApproval | null>(null);
  const goalQuery = useQuery({
    queryKey: ["goal-id", input.pool?.id.toString() ?? null, input.address],
    queryFn: () => {
      if (input.address === null || input.pool === null) {
        throw new Error("No claim identity yet.");
      }
      return fetchGoalId(input.pool.id, input.address);
    },
    enabled: input.address !== null && input.pool !== null && input.joined,
    staleTime: Infinity,
  });
  const goalId = goalQuery.data ?? null;
  const goalParam = goalId !== null ? encodeURIComponent(goalId) : null;

  const screening = useLaneProbe(
    ["screening", goalId],
    goalParam !== null ? `/api/screen/status?goalId=${goalParam}` : null,
    parseScreening,
    { refetchInterval: input.runStatus === "recorded" || input.runStatus === "verifying" ? 5_000 : false },
  );

  const screen: VerdictScreen =
    input.pool === null
      ? { kind: "none" }
      : verdictScreenOf({
    joined: input.joined,
    poolCancelled: input.pool.cancelled,
    poolSettled: input.pool.settled,
    refunded: input.refunded,
    runStatus: input.runStatus,
    ledger: input.ledger,
    localApproval: local,
    resultRecorded: input.resultRecorded,
    // On a run that can record a miss, the not-yet screen names the moment
    // SPOTTER takes its last look; later syncs no longer count.
    missDeadlineMs: missRulePool(input.pool).ok
      ? missDeadlineMs(input.pool.periodEnd)
      : null,
    // And the latest moment a hit can still be confirmed: the run settles by
    // then, and an unconfirmed hit gets its stake back without a share.
    missConfirmByMs: missRulePool(input.pool).ok
      ? missConfirmByMs(input.pool.periodEnd)
      : null,
  });

  return {
    screen,
    goalId,
    screening: (screening.lane === "on" && screening.value !== null
      ? screening.value
      : { status: "unconfigured", reason: null }) as VerdictScreening,
    onApproval: (outcome: ApprovalOutcome) => {
      setLocal({ outcome, ledgerLength: input.ledger?.length ?? 0 });
      if (outcome === "approved") input.onApproved?.();
    },
  };
}

export default function VerdictStage({
  pool,
  address,
  joined,
  refunded,
  runStatus,
  ledger,
  hasClaim,
  screen,
  goalId,
  screening,
  onApproval,
}: VerdictStageProps) {
  const copy = verdictCopy(screen);
  if (copy === null) return null;

  const step = claimStepOf(joined, hasClaim, runStatus);
  const selfStaked = pool.bountyModel === 2;
  const showScreening = screen.kind === "banked" || screen.kind === "won";

  return (
    <section
      aria-labelledby="verdict-headline"
      className="overflow-hidden rounded-xl border-2 border-foreground bg-surface"
    >
      <div className="space-y-4 p-4 sm:p-6">
        <RunPath
          step={
            screen.kind === "confirm-human" ||
            screen.kind === "approval-failed" ||
            screen.kind === "confirmed"
              ? "verdict"
              : step
          }
        />
        <div aria-live="polite">
          <h2
            id="verdict-headline"
            className="ghm-stamp font-display text-5xl font-black leading-[0.95] sm:text-6xl"
          >
            {copy.headline}
          </h2>
          <p className="mt-3 max-w-prose text-base text-foreground/85">{copy.body}</p>
        </div>

        {screen.kind === "won" ? (
          <div className="space-y-4">
            <PayoutMoment
              paidUsd={toUsd2(screen.paidUsd)}
              txHash={screen.txHash}
              selfReported={screen.selfReported}
              selfStaked={selfStaked}
            />
            {/* The claim tap, folded into the win: the chain credits the win
                and this pulls it into the wallet. It renders only while money
                is owed and says "in your wallet" only after Withdrawn fires. */}
            <ClaimPayout address={address} />
          </div>
        ) : (
          <SpotterSays surface="evidence" state="verifying" pose={copy.pose} say={spotterLineFor(screen)} />
        )}

        {/* One card, one position, for the ask and its three refusals: it owns
            the countdown, the fresh verification, and "Ask again" (none after
            the run settled), so it must not remount between those screens. */}
        {/* Not mounted once the pool settled: a settle is one-shot, so there
            is nothing left to ask and the card must not offer "ask again". */}
        {(screen.kind === "confirm-human" ||
          (screen.kind === "approval-failed" && !screen.settled)) &&
        goalId !== null ? (
          <HumanApprovalCard
            goalId={goalId}
            poolId={pool.id.toString()}
            address={address}
            onResult={onApproval}
          />
        ) : null}

        {showScreening ? (
          <PayoutScreening
            status={screening.status}
            reason={screening.reason ?? undefined}
          />
        ) : null}

        {screen.kind === "cancelled" ? (
          <div className="space-y-3">
            {!refunded ? (
              <RefundClaim poolId={pool.id} entryFee={pool.entryFee} address={address} />
            ) : null}
            <ClaimPayout address={address} />
          </div>
        ) : null}

        {/* After a settle, a refund or a share sits in owed[] until the player
            withdraws. The card renders only when the chain says money is owed,
            and says so when it cannot read that. */}
        {screen.kind === "settled-final" ||
        screen.kind === "lost" ||
        (screen.kind === "missed" && screen.outcome === "refunded") ||
        (screen.kind === "approval-failed" && screen.settled) ? (
          <ClaimPayout address={address} />
        ) : null}

        {ledger !== null && ledger.length > 0 && !proofSurfaceNeeded(screen) ? (
          <details className="rounded-lg border-2 border-foreground/15">
            <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold">
              SPOTTER&apos;s receipt for this run
            </summary>
            <div className="p-3">
              <AgentReceipt ledger={ledger} evidenceKind="wearable" />
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}

function spotterLineFor(screen: VerdictScreen): string {
  switch (screen.kind) {
    case "checking":
      return "Reading your nights. I buy the proof, I make the call.";
    case "confirm-human":
      return "Numbers check out. Now show me it is really you before I move a cent.";
    case "confirmed":
      return "That is you. Writing it down, then the money moves.";
    case "approval-failed":
      return screen.settled
        ? "No OK from you, no payout. The settle sent your stake home."
        : "Nothing moved. Your result is still here when you are.";
    case "banked":
      return "Banked. I pay when the clock runs out.";
    case "not-yet":
      return "Not yet. Tonight still counts.";
    case "lost":
      return "The data said no. I do not round up.";
    case "missed":
      return screen.outcome === "refunded"
        ? "Nobody hit, so every stake came home. Yours is below."
        : screen.outcome === "cancelled"
          ? "The creator called it off. Your stake is yours to claim."
          : "Your wearable saw the whole run. The data said no.";
    case "hit-unconfirmed":
      return "You hit it. Nobody confirmed it before the books closed.";
    case "settled-final":
      return "Books are closed on this one. Whatever is yours is below.";
    case "bad-read":
      return "Bad read on my side. Sync and send me back in.";
    case "stopped":
      return "This one stopped on my side, not yours.";
    case "cancelled":
      return "Run called off. Your stake goes back to you.";
    case "won":
    case "none":
      return "";
  }
}
