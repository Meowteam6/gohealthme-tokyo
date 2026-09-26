"use client";

// The Verdict (docs/DESIGN.md, "Verdict card"). After the run it takes the
// stake card's place: SPOTTER read the wearable, asks the player to confirm it
// is them (World ID for Agents) before any USDC moves, the payout is screened,
// and the run ends on a real screen: paid on a paper receipt, not confirmed
// with "Ask again", missed, nobody hit, or stopped for a reason that is not
// the player's. SPOTTER's pose lives in the page hero, except on the paid
// receipt, where he stands on the paper instead.
//
// The mapping from the ledger, the chain and the approval status to the screen
// is lib/game/verdict.ts. Nothing here decides money; it shows what the server
// already recorded, with every figure from lib/commitment.ts or the settle
// record, and mounts the other lanes' components through their contracts
// (docs/LANES.md).

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import HumanApprovalCard, { type ApprovalOutcome } from "@/components/world/HumanApprovalCard";
import PayoutScreening from "@/components/intercepta/PayoutScreening";
import AgentReceipt from "@/components/AgentReceipt";
import PayoutMoment from "@/components/PayoutMoment";
import ClaimPayout from "@/components/ClaimPayout";
import RefundClaim from "@/components/RefundClaim";
import ChallengeFriend from "@/components/run/ChallengeFriend";
import { Glyph } from "@/components/run/glyphs";
import { ButtonLink, Card, Fine } from "@/components/ui";
import { toUsd2, type LedgerEntry, type RunStatus } from "@/lib/agent-receipt";
import { fetchGoalId, formatUsdc, readOwed, type PoolInfo } from "@/lib/contract";
import { missConfirmByMs, missDeadlineMs } from "@/lib/miss-grace";
import { missRulePool } from "@/lib/miss-rule";
import { parseScreening, type ScreeningStatus } from "@/lib/game/lanes";
import { useLaneProbe } from "@/lib/game/useLaneProbe";
import { commitmentLostCopy, hitRange } from "@/lib/game/commitment-copy";
import { useCommitmentFee } from "@/lib/game/useCommitmentFee";
import {
  verdictCopy,
  verdictScreenOf,
  type LocalApproval,
  type VerdictScreen,
} from "@/lib/game/verdict";

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
  /** How many players hit, read from chain once the run settled; null while
   *  that read is loading or before settle. A commitment run's lost screen
   *  says where the stake went from it. */
  settleAchievers?: number | null;
  /** How many players are in, for what a hit pays before settle. */
  players?: number | null;
  /** "7 hours": the goal as a noun phrase. */
  goalShort?: string;
  /** "WHOOP", or null when the paired wearable is not known. */
  deviceName?: string | null;
  /** The next open run of the same kind, for "Go again tonight". */
  nextRunHref?: string;
  /** The player's ENS name, printed on the receipt. */
  paidTo?: string | null;
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

/** When the settle landed, from the ledger's settle entry. */
function settledAtOf(ledger: LedgerEntry[] | null): string | null {
  if (ledger === null) return null;
  for (let i = ledger.length - 1; i >= 0; i -= 1) {
    const entry = ledger[i];
    if (entry.kind === "settle" && entry.status === "settled") return entry.at;
  }
  return null;
}

export interface VerdictHead {
  /** Small line over the headline, sentence case: who read what. */
  eyebrow: string;
  headline: string;
  body: ReactNode;
}

/**
 * What the card says for each screen. The run's own goal and wearable fill
 * the words; the facts behind them are verdictCopy's and commitmentLostCopy's.
 */
export function verdictHeadOf(input: {
  screen: VerdictScreen;
  goalShort: string;
  deviceName: string | null;
  selfStaked: boolean;
  entryFee: bigint;
  settleAchievers: number | null;
}): VerdictHead | null {
  const { screen, goalShort } = input;
  const base = verdictCopy(screen);
  if (base === null) return null;
  const read = `SPOTTER read your ${input.deviceName ?? "wearable"}`;
  const hit = goalShort === "the goal" ? "You hit the goal." : `You hit ${goalShort}.`;
  switch (screen.kind) {
    case "checking":
      return {
        eyebrow: `SPOTTER is reading your ${input.deviceName ?? "wearable"}`,
        headline: "Checking the run.",
        body: base.body,
      };
    case "confirm-human":
      return {
        eyebrow: read,
        headline: hit,
        body: "Confirm it's you and the contract pays you. Before any USDC moves, World ID checks that the person collecting is the person who played.",
      };
    case "confirmed":
      return { eyebrow: "Confirmed with World ID", headline: "That's you. Recording it now.", body: base.body };
    case "approval-failed":
      return {
        eyebrow: screen.settled ? "Not confirmed" : "Not confirmed yet",
        headline: "Nothing was paid.",
        body: screen.settled
          ? base.body
          : screen.outcome === "expired"
            ? "The World ID request expired before you answered. You hit the goal, so ask again before the run settles."
            : screen.outcome === "declined"
              ? "You said not now, so nothing moved. You hit the goal, so ask again before the run settles if that was a slip."
              : base.body,
      };
    case "banked":
      return {
        eyebrow: read,
        headline: screen.selfReported ? "Logged on your word." : `${hit} Banked.`,
        body: base.body,
      };
    case "won":
      return { eyebrow: "Credited to you on chain", headline: `${hit} Paid.`, body: null };
    case "not-yet":
      return { eyebrow: read, headline: "Not there yet.", body: base.body };
    case "lost": {
      if (!input.selfStaked) {
        return { eyebrow: read, headline: `${goalShort === "the goal" ? "The goal" : goalShort} not reached.`, body: base.body };
      }
      const lost = commitmentLostCopy({
        entryFee: input.entryFee,
        stakeBack: screen.stakeBack,
        achievers: input.settleAchievers,
      });
      return {
        eyebrow: read,
        headline:
          lost.headline === "Nobody hit it"
            ? "Nobody hit it."
            : goalShort === "the goal"
              ? "You missed the goal."
              : `You missed ${goalShort}.`,
        body: lost.body,
      };
    }
    case "missed":
      // A miss SPOTTER recorded on chain (lib/miss-rule.ts): where the stake
      // went is the settle's outcome, said by verdictCopy.
      return {
        eyebrow: read,
        headline:
          screen.outcome === "refunded"
            ? "Nobody hit it."
            : screen.outcome === "cancelled"
              ? "Run called off."
              : goalShort === "the goal"
                ? "You missed the goal."
                : `You missed ${goalShort}.`,
        body: base.body,
      };
    case "hit-unconfirmed":
      return { eyebrow: "Not confirmed", headline: `${hit} Not confirmed in time.`, body: base.body };
    case "settled-final":
      return { eyebrow: "Run settled", headline: "Every result is final.", body: base.body };
    case "bad-read":
      return {
        eyebrow: `SPOTTER tried your ${input.deviceName ?? "wearable"}`,
        headline: "I could not get a clean read.",
        body: base.body,
      };
    case "stopped":
      return { eyebrow: "The check stopped", headline: `${base.headline}.`, body: base.body };
    case "cancelled":
      return { eyebrow: "Run called off", headline: screen.refunded ? "Your stake is back." : "Take your stake back.", body: base.body };
    case "none":
      return null;
  }
}

/**
 * The verdict card drawn from props only: who read what, the headline, the
 * body, what a hit pays, and the slots the live card fills (the receipt, the
 * World ID ask, the screening line, the claim, the next action, SPOTTER's
 * receipt). VerdictStage feeds it the live run; the state gallery feeds it
 * fixtures.
 */
export function VerdictView({
  kind,
  head,
  money = null,
  receipt,
  approval,
  screening,
  claim,
  actions,
  log,
}: {
  kind: VerdictScreen["kind"];
  head: VerdictHead;
  /** What a hit pays before settle: the stake back, and the total. */
  money?: { stake: string; get: string; range: boolean } | null;
  receipt?: ReactNode;
  approval?: ReactNode;
  screening?: ReactNode;
  claim?: ReactNode;
  actions?: ReactNode;
  log?: ReactNode;
}) {
  return (
    <Card as="section" aria-labelledby="verdict-headline" data-verdict={kind}>
      <div aria-live="polite">
        <p className="m-0 text-sm font-semibold text-haze">{head.eyebrow}</p>
        <h2
          id="verdict-headline"
          className={`type-heading m-0 mt-1.5 text-[1.875rem] leading-[1.1] text-balance ${
            kind === "won" ? "max-w-[calc(100%-112px)]" : ""
          }`}
        >
          {head.headline}
        </h2>
        {head.body !== null ? (
          <p className="num m-0 mt-2.5 text-base leading-[1.5] text-muted [&_b]:font-semibold [&_b]:text-foreground">
            {head.body}
          </p>
        ) : null}
      </div>

      {money !== null ? (
        <dl className="num m-0 mt-3.5 grid gap-1 border-t border-edge pt-3 text-[0.9375rem]">
          <div className="flex justify-between gap-3">
            <dt className="text-haze">Your stake back</dt>
            <dd className="m-0 font-semibold">{money.stake}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-haze">{money.range ? "You get, by how many hit" : "You get"}</dt>
            <dd className="m-0 text-xl font-bold text-gold">{money.get}</dd>
          </div>
        </dl>
      ) : null}

      {receipt}
      {approval !== undefined && approval !== null ? <div className="mt-4">{approval}</div> : null}
      {screening !== undefined && screening !== null ? (
        <div className="mt-3 flex items-start gap-2 text-haze [&_p]:text-[0.8125rem]">
          <Glyph name="shield" size={15} className="mt-0.5" />
          {screening}
        </div>
      ) : null}
      {claim}
      {actions !== undefined && actions !== null ? <div className="mt-4 grid gap-2">{actions}</div> : null}
      {log !== undefined && log !== null ? (
        <details className="group mt-4 border-t border-edge pt-1">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
            See SPOTTER&apos;s receipt for this run
            <Glyph name="chev" className="text-haze transition-transform duration-[120ms] group-open:rotate-90" />
          </summary>
          <div className="pt-2">{log}</div>
        </details>
      ) : null}
    </Card>
  );
}

export default function VerdictStage({
  pool,
  address,
  joined,
  refunded,
  ledger,
  screen,
  goalId,
  screening,
  onApproval,
  settleAchievers = null,
  players = null,
  goalShort = "the goal",
  deviceName = null,
  nextRunHref = "/pools",
  paidTo = null,
}: VerdictStageProps) {
  const selfStaked = pool.bountyModel === 2;
  const fee = useCommitmentFee(selfStaked && screen.kind === "confirm-human");
  const owedQuery = useQuery({
    queryKey: ["owed", address],
    queryFn: () => readOwed(address),
    staleTime: 15_000,
    enabled:
      screen.kind === "won" ||
      screen.kind === "lost" ||
      screen.kind === "missed" ||
      screen.kind === "hit-unconfirmed",
  });
  const head = verdictHeadOf({
    screen,
    goalShort,
    deviceName,
    selfStaked,
    entryFee: pool.entryFee,
    settleAchievers,
  });
  if (head === null) return null;

  const stake = formatUsdc(pool.entryFee);
  const claimWaiting = (owedQuery.data ?? 0n) > 0n;

  // What a hit pays before settle: every player hitting at the low end, only
  // you at the high end (lib/commitment.ts).
  const range =
    screen.kind === "confirm-human" && selfStaked && players !== null && !pool.settled
      ? hitRange({ entryFee: pool.entryFee, players, balance: pool.balance, feeBps: fee.bps }, false)
      : null;
  const paid = screen.kind === "won" ? toUsd2(screen.paidUsd) : null;

  return (
    <VerdictView
      kind={screen.kind}
      head={head}
      money={
        range !== null
          ? {
              stake,
              get:
                range.low === range.high
                  ? formatUsdc(range.low)
                  : `${formatUsdc(range.low)} to ${formatUsdc(range.high)}`,
              range: range.low !== range.high,
            }
          : null
      }
      receipt={
        screen.kind === "won" && paid !== null ? (
          <PayoutMoment
            paidUsd={paid}
            txHash={screen.txHash}
            selfReported={screen.selfReported}
            selfStaked={selfStaked}
            entryFee={pool.entryFee}
            payee={paidTo}
            paidAt={settledAtOf(ledger)}
            tuck
          />
        ) : null
      }
      // One card, one position, for the ask and its three refusals: it owns
      // the countdown, the fresh verification, and "Ask again" (none after
      // the run settled), so it must not remount between those screens. Not
      // mounted once the pool settled: a settle is one-shot.
      approval={
        (screen.kind === "confirm-human" ||
          (screen.kind === "approval-failed" && !screen.settled)) &&
        goalId !== null ? (
          <HumanApprovalCard
            goalId={goalId}
            poolId={pool.id.toString()}
            address={address}
            onResult={onApproval}
          />
        ) : null
      }
      screening={
        screen.kind === "banked" || screen.kind === "won" ? (
          <PayoutScreening status={screening.status} reason={screening.reason ?? undefined} />
        ) : null
      }
      claim={
        screen.kind === "cancelled" ? (
          <div className="mt-4 grid gap-3">
            {!refunded ? (
              <RefundClaim poolId={pool.id} entryFee={pool.entryFee} address={address} />
            ) : null}
            <ClaimPayout address={address} quiet />
          </div>
        ) : // After a settle, a refund, a share or a win sits in owed[] until
        // the player withdraws. The claim renders only when the chain says
        // money is owed, and says so when it cannot read that.
        screen.kind === "won" ||
          screen.kind === "settled-final" ||
          screen.kind === "lost" ||
          screen.kind === "hit-unconfirmed" ||
          (screen.kind === "missed" && screen.outcome === "refunded") ||
          (screen.kind === "approval-failed" && screen.settled) ? (
          <ClaimPayout address={address} quiet className="mt-4" />
        ) : null
      }
      actions={
        screen.kind === "won" ||
        screen.kind === "lost" ||
        screen.kind === "missed" ||
        screen.kind === "hit-unconfirmed" ? (
          <>
            <ButtonLink href={nextRunHref} variant={claimWaiting ? "secondary" : "primary"} block>
              Go again tonight
            </ButtonLink>
            {screen.kind === "won" && paid !== null && joined ? (
              <ChallengeFriend
                path={`/pools/${pool.id.toString()}`}
                text={`SPOTTER just paid me ${paid} test USDC for hitting ${goalShort} on GoHealthMe. Put money on yourself.`}
                label={`Share my ${paid}`}
                variant={claimWaiting ? "tertiary" : "secondary"}
              />
            ) : (
              <Fine>Tonight counts on its own. One night never follows you into the next run.</Fine>
            )}
          </>
        ) : null
      }
      log={
        ledger !== null && ledger.length > 0 && !proofSurfaceNeeded(screen) ? (
          <AgentReceipt ledger={ledger} evidenceKind="wearable" />
        ) : null
      }
    />
  );
}
