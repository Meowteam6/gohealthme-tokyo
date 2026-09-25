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
import { parseApprovalStatus, parseScreening, type ScreeningStatus } from "@/lib/game/lanes";
import { useLaneProbe } from "@/lib/game/useLaneProbe";
import {
  verdictCopy,
  verdictScreenOf,
  type ApprovalState,
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
  return !(screen.kind === "won" || screen.kind === "lost" || screen.kind === "cancelled");
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
  onApproval: (outcome: ApprovalOutcome | "retry") => void;
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
}) {
  const [local, setLocal] = useState<ApprovalOutcome | "retry" | null>(null);
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

  const approval = useLaneProbe(
    ["approval", goalId],
    goalParam !== null ? `/api/agent/approval/status?goalId=${goalParam}` : null,
    parseApprovalStatus,
    { refetchInterval: input.runStatus === "verifying" ? 3_000 : false },
  );
  const screening = useLaneProbe(
    ["screening", goalId],
    goalParam !== null ? `/api/screen/status?goalId=${goalParam}` : null,
    parseScreening,
    { refetchInterval: input.runStatus === "recorded" || input.runStatus === "verifying" ? 5_000 : false },
  );

  // A lane that is not on this build means the step is skipped, never that the
  // run is stuck: "unavailable" routes a pay decision straight to banked.
  const approvalState: ApprovalState =
    local === "retry"
      ? "pending"
      : approval.lane === "on"
        ? (approval.value ?? "none")
        : approval.lane === "loading"
          ? "none"
          : "unavailable";

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
    approval: approvalState,
    localApproval: local === "retry" ? null : local,
  });

  return {
    screen,
    goalId,
    screening: (screening.lane === "on" && screening.value !== null
      ? screening.value
      : { status: "unconfigured", reason: null }) as VerdictScreening,
    onApproval: (outcome: ApprovalOutcome | "retry") => {
      setLocal(outcome);
      approval.refetch();
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
  const [attempt, setAttempt] = useState(0);
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
        <RunPath step={screen.kind === "confirm-human" || screen.kind === "approval-failed" ? "verdict" : step} />
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

        {screen.kind === "confirm-human" && goalId !== null ? (
          <HumanApprovalCard
            key={attempt}
            goalId={goalId}
            poolId={pool.id.toString()}
            address={address}
            onResult={(outcome) => onApproval(outcome)}
          />
        ) : null}

        {screen.kind === "approval-failed" ? (
          <button
            type="button"
            onClick={() => {
              setAttempt((n) => n + 1);
              onApproval("retry");
            }}
            className="inline-flex min-h-12 items-center rounded-lg bg-accent px-5 font-semibold text-white shadow-[var(--shadow-pop)] hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            Ask again
          </button>
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
    case "approval-failed":
      return "Nothing moved. Your result is still here when you are.";
    case "banked":
      return "Banked. I pay when the clock runs out. No human in the loop.";
    case "not-yet":
      return "Not yet. Tonight still counts.";
    case "lost":
      return "The data said no. I do not round up.";
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
