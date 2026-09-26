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
import Spotter from "@/components/spotter/Spotter";
import { Stamp } from "@/components/ui";
import {
  poseFor,
  type SpotterPose,
  type SpotterScreenState,
  type SpotterSize,
} from "@/lib/spotter-poses";
import { toUsd2, type LedgerEntry, type RunStatus } from "@/lib/agent-receipt";
import { claimStepIndex, claimStepOf, type ClaimStep } from "@/lib/claim-rail";
import { fetchGoalId, type PoolInfo } from "@/lib/contract";
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
              ? "text-accent-deep"
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

/** How a Verdict screen is staged: SPOTTER's pose and size, the wash behind
 *  him, and the stamp. Only the paid screen gets gold and only a lost run gets
 *  dusk; a loss is never red (docs/DESIGN.md). Screens with an action below
 *  keep SPOTTER smaller so the action stays in reach on a phone. */
export interface VerdictStaging {
  spotter: { state: SpotterScreenState } | { pose: SpotterPose; size: SpotterSize };
  wash: "plain" | "dusk";
  stamp: string | null;
}

export function verdictStagingOf(screen: VerdictScreen, pose: SpotterPose): VerdictStaging {
  switch (screen.kind) {
    case "checking":
      return { spotter: { state: "checking" }, wash: "plain", stamp: null };
    case "confirm-human":
      return { spotter: { pose: "wallet", size: "md" }, wash: "plain", stamp: null };
    case "confirmed":
      return { spotter: { pose: "thumbsup", size: "md" }, wash: "plain", stamp: "Confirmed" };
    case "approval-failed": {
      const state: SpotterScreenState =
        screen.outcome === "expired" ? "confirmation-expired" : "confirmation-declined";
      return {
        spotter: { pose: poseFor(state).pose, size: screen.settled ? "lg" : "md" },
        wash: "plain",
        stamp: null,
      };
    }
    case "lost":
      return { spotter: { state: "verdict-not-met" }, wash: "dusk", stamp: "Not met" };
    case "won":
      // PayoutMoment stages itself: payday, the coin, the gold wash.
      return { spotter: { state: "verdict-paid" }, wash: "plain", stamp: "Confirmed" };
    default:
      return { spotter: { pose, size: "md" }, wash: "plain", stamp: null };
  }
}

/** Dusk: a lost run. Light enough that ink and muted text keep AA on it. */
const DUSK_WASH =
  "linear-gradient(180deg, color-mix(in srgb, var(--dusk) 12%, var(--surface)) 0%, color-mix(in srgb, var(--dusk) 28%, var(--surface)) 100%)";

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
  const staging = verdictStagingOf(screen, copy.pose);
  const line = spotterLineFor(screen);

  return (
    <section
      aria-labelledby="verdict-headline"
      className="overflow-hidden rounded-3xl border-2 border-foreground bg-surface"
      style={staging.wash === "dusk" ? { background: DUSK_WASH } : undefined}
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

        {screen.kind === "won" ? (
          <div aria-live="polite" className="space-y-4">
            <PayoutMoment
              bleed
              paidUsd={toUsd2(screen.paidUsd)}
              txHash={screen.txHash}
              selfReported={screen.selfReported}
              selfStaked={selfStaked}
              headline={copy.headline}
              headlineId="verdict-headline"
            />
            {/* The claim tap, folded into the win: the chain credits the win
                and this pulls it into the wallet. It renders only while money
                is owed and says "in your wallet" only after Withdrawn fires.
                Quiet here: the payout above is this screen's one big number. */}
            <ClaimPayout address={address} quiet />
          </div>
        ) : (
          <div className="flex flex-col items-center text-center">
            <Spotter
              {...staging.spotter}
              line={line === "" ? undefined : line}
              live
              className={staging.wash === "dusk" ? "[&_img]:grayscale-[25%]" : ""}
            />
            <div aria-live="polite" className="mt-3 w-full">
              {staging.stamp !== null ? (
                <Stamp tone="accent">{staging.stamp}</Stamp>
              ) : null}
              <h2
                id="verdict-headline"
                className="ghm-stamp mt-3 font-display text-[clamp(2rem,9vw,3.25rem)] font-extrabold leading-display tracking-display text-balance"
              >
                {copy.headline}
              </h2>
              <p
                className={`mx-auto mt-3 max-w-prose text-base text-pretty ${
                  staging.wash === "dusk" ? "text-foreground" : "text-foreground/85"
                }`}
              >
                {copy.body}
              </p>
            </div>
          </div>
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
        (screen.kind === "approval-failed" && screen.settled) ? (
          <ClaimPayout address={address} />
        ) : null}

        {ledger !== null && ledger.length > 0 && !proofSurfaceNeeded(screen) ? (
          <details className="rounded-2xl border border-edge bg-surface">
            <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-bold">
              See SPOTTER&apos;s receipt for this run
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

// SPOTTER's one line per screen: deadpan, first person, aimed at the night or
// the situation, never at the player. The facts live in the headline and body.
function spotterLineFor(screen: VerdictScreen): string {
  switch (screen.kind) {
    case "checking":
      return "Reading your nights. I buy the proof, I make the call.";
    case "confirm-human":
      return "Numbers check out. Show me it is really you before I move a cent.";
    case "confirmed":
      return "That is you. Writing it down, then the money moves.";
    case "approval-failed":
      return screen.settled
        ? "No OK, no payout. The settle sent your stake home."
        : screen.outcome === "expired"
          ? "The clock ran out on me. Nothing moved."
          : "Nothing moved. Your result waits here for you.";
    case "banked":
      return "Banked. I pay when the clock runs out.";
    case "not-yet":
      return "Not yet. Tonight still counts.";
    case "lost":
      return "The night did not cooperate. I do not round up.";
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
