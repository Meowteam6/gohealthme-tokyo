"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import JoinPool from "@/components/JoinPool";
import FundPool from "@/components/FundPool";
import ChallengeContribute from "@/components/ChallengeContribute";
import EvidenceUpload from "@/components/EvidenceUpload";
import { useDocumentProofAvailable } from "@/lib/useProofStatus";
import WearableCheck from "@/components/WearableCheck";
import ChallengeInviteShare from "@/components/ChallengeInviteShare";
import ClaimPayout from "@/components/ClaimPayout";
import {
  ButtonLink,
  Card,
  Chip,
  EmptyState,
  ErrorNote,
  Skeleton,
  TEXT_LINK,
} from "@/components/ui";
import ApprovalNote from "@/components/game/ApprovalNote";
import { usePlayers, useRunNights } from "@/components/game/RunBoard";
import VerdictStage, {
  proofSurfaceNeeded,
  useVerdict,
} from "@/components/game/VerdictStage";
import RunHero from "@/components/run/RunHero";
import RunLayout, { BackLink } from "@/components/run/RunLayout";
import {
  SoloNote,
  StakeAction,
  StakeCard,
  StakeChecks,
  StakeFailed,
  StakeStats,
  StakeTerms,
  StakeTermsPlain,
  StakeVault,
  type StakeCheck,
} from "@/components/run/StakeCard";
import StakeLock from "@/components/run/StakeLock";
import YourNight, { type NightRail } from "@/components/run/YourNight";
import WhosIn, { type RosterRow } from "@/components/run/WhosIn";
import AlsoOpen, { type AlsoOpenRow } from "@/components/run/AlsoOpen";
import ChallengeFriend from "@/components/run/ChallengeFriend";
import { Glyph } from "@/components/run/glyphs";
import {
  runStatusFromLedger,
  type LedgerEntry,
  type RunStatus,
} from "@/lib/agent-receipt";
import { lockCopy, needsDocumentVerifier, runSlotOf } from "@/lib/game/lobby";
import { useCharacter } from "@/lib/game/useCharacter";
import { useJoinChecks } from "@/lib/game/useJoinChecks";
import { useNowSeconds } from "@/lib/game/useNowSeconds";
import { fetchWithWalletAuth } from "@/lib/client-auth";
import { useWalletAuth } from "@/lib/useWalletAuth";
import { claimProofPathOf, type ProofPath } from "@/lib/claim-restore";
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
import { unsupportedMetricFor } from "@/lib/pool-availability";
import { uploadFallbackNote, wearableJoinBlock } from "@/lib/wearable-join-gate";
import {
  ContractNotConfiguredError,
  displayGoalSpec,
  evidenceTypeOf,
  fetchGoalId,
  fetchParticipant,
  fetchParticipantResults,
  fetchParticipants,
  fetchPool,
  fetchPools,
  formatUsdc,
  proofPolicyOf,
  type Modality,
  type PoolInfo,
} from "@/lib/contract";
import { poolCanPay, poolIsOver, poolPhase, type PoolPhase } from "@/lib/pool-lifecycle";
import { runEndCopy, settleTallyOf } from "@/lib/game/run-end";
import { verdictShowsClaim, type VerdictScreen } from "@/lib/game/verdict";
import SweepLeftover from "@/components/SweepLeftover";
import { useEmbeddedWallet } from "@/lib/wallet";
import { darePot } from "@/lib/challenges";
import { recordsMissesOf, sponsorPotOf, type CommitmentTerms } from "@/lib/game/commitment-copy";
import { missRulePool, missRuleReading } from "@/lib/miss-rule";
import { runName } from "@/lib/game/landing";
import { useCommitmentFee } from "@/lib/game/useCommitmentFee";
import { classifyWearableGoal, metricLabel } from "@/lib/wearable-goal";
import { fetchResolvedName, resolveOnce } from "@/lib/ens/client-cache";
import type { SpotterScreenState } from "@/lib/spotter-poses";
import {
  clockLabel,
  closeLabelOf,
  closesWithinDay,
  endsLabel,
  friendMathOf,
  isSleepMetric,
  leftLabel,
  nightTimelineOf,
  resultIcs,
  runHeadlineOf,
  soloLineOf,
  stakeTermsOf,
  type RunHeadline,
} from "@/lib/game/run-page";

// The run page (docs/DESIGN.md, "Run page"): the one big figure with SPOTTER
// standing on the card below it, the stake card in whichever state the join
// is in (right column on desktop, sticky), Your night, Who's in, and the other
// runs this wearable can check. After the run, the verdict takes the stake
// card's place. Every decision here is read from the libraries that make it
// (the join gate, runSlotOf, verdictScreenOf, lib/commitment.ts); this file
// only lays them out.

/** The claim ledger, read owner-only and cachedOnly (never prompts): it drives
 *  the claim rail's progress and the restored proof path. hasLedger tells a
 *  withheld claim (a claim exists, signature not cached) apart from no claim. */
interface ClaimLedgerData {
  ledger: LedgerEntry[] | null;
  hasLedger: boolean;
}

/** The lobby's pool list, same key and shape, so both screens share one read. */
function useOpenPools() {
  return useQuery({
    queryKey: ["pools"],
    queryFn: async () => ({
      pools: await fetchPools(),
      asOfSeconds: BigInt(Math.floor(Date.now() / 1000)),
    }),
    refetchInterval: 45_000,
  });
}

/** "After staking the page glow dims to 35%" (docs/DESIGN.md, Motion). */
function LightsOut({ on }: { on: boolean }) {
  useEffect(() => {
    document.body.classList.toggle("lights-out", on);
    return () => document.body.classList.remove("lights-out");
  }, [on]);
  return null;
}

/** SPOTTER's pose for the hero: the staging table, one pose per viewport.
 *  The paid verdict hides him here; he stands on the receipt instead. */
function heroSpotterOf(input: {
  screen: VerdictScreen;
  joined: boolean;
  phase: PoolPhase;
  sleepRun: boolean;
  /** How many hit, once settled: nobody hitting is calm, not a loss. */
  achievers: number | null;
}): SpotterScreenState | null {
  switch (input.screen.kind) {
    case "won":
      return null;
    case "checking":
    case "confirm-human":
    case "confirmed":
      return "verdict-confirm";
    case "approval-failed":
    case "bad-read":
    case "stopped":
      return "verdict-denied";
    case "lost":
      return input.achievers === 0 ? "outcome-none" : "verdict-lost";
    case "banked":
      return "outcome-hit";
    case "settled-final":
    case "cancelled":
      return "outcome-none";
    case "not-yet":
    case "none":
      break;
  }
  if (input.phase !== "live") return "outcome-none";
  if (input.joined) return input.sleepRun ? "run-joined" : "run-open";
  return "run-open";
}

/** The loading page: the same grid, so nothing jumps when the run reads. */
function RunSkeleton() {
  return (
    <RunLayout
      hero={
        <div className="[grid-area:hero]" aria-busy="true">
          <Skeleton className="h-[26px] w-28" />
          <Skeleton className="mt-3 h-14 w-56 min-[960px]:h-24 min-[960px]:w-96" />
          <Skeleton className="mt-3 h-6 w-64" />
          <Skeleton className="mt-3 mb-5 h-5 w-44" />
        </div>
      }
      stake={
        <Card aria-busy="true">
          <Skeleton className="h-12" />
          <Skeleton className="mt-4 h-24" />
          <Skeleton className="mt-4 h-[60px]" />
        </Card>
      }
    >
      <Card aria-busy="true">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="mt-4 h-16" />
      </Card>
    </RunLayout>
  );
}

/** A joined player's night: the rail, SPOTTER's line and the nights read. */
function JoinedNight({
  pool,
  address,
  base,
}: {
  pool: PoolInfo;
  address: `0x${string}`;
  base: Omit<Parameters<typeof YourNight>[0], "children">;
}) {
  const { nights, line } = useRunNights({ pool, address, promptForData: false });
  const spec = classifyWearableGoal(pool.goalSpec);
  // A one-night run's caption is the goodnight line; a longer run's is where
  // the nights stand.
  const caption = spec.goalDays > 1 && line !== undefined ? line : base.caption;
  return (
    <YourNight {...base} caption={caption} captionLive>
      <div className="mt-4 border-t border-edge pt-3.5">{nights}</div>
    </YourNight>
  );
}

/** Who's in, named by ENS where a player has a name. Only the viewer's own
 *  row says anything about their night; everyone else shows "Hit" once the
 *  chain records it. */
function Roster({
  poolId,
  address,
  copy,
  action,
  youPlaying,
}: {
  poolId: bigint;
  address: string | null;
  copy?: (playerCount: number | null) => ReactNode;
  action?: ReactNode;
  /** The viewer's own status while the run is still on, e.g. "You, night to play". */
  youPlaying?: string;
}) {
  const players = usePlayers(poolId);
  const list = players.data ?? [];
  const names = useQueries({
    queries: list.map((p) => ({
      queryKey: ["ens-name", p.address.toLowerCase()],
      queryFn: () => resolveOnce(p.address, fetchResolvedName),
      staleTime: 5 * 60_000,
      retry: false,
    })),
  });
  const rows: RosterRow[] = list.map((p, i) => {
    const you = address !== null && p.address.toLowerCase() === address.toLowerCase();
    const ens = names[i]?.data ?? null;
    const shown = ens ?? `${p.address.slice(0, 6)}...${p.address.slice(-4)}`;
    return {
      key: p.address,
      name: <span title={p.address}>{shown}</span>,
      initial: ens !== null ? ens.slice(0, 1).toUpperCase() : p.address.slice(2, 3).toUpperCase(),
      you,
      hit: p.hit,
      status: you ? (p.hit ? "You, hit" : youPlaying ?? "You") : p.hit ? "Hit" : "",
    };
  });
  // The viewer's own row first: it is the one they came to find.
  rows.sort((a, b) => Number(b.you) - Number(a.you));
  return (
    <WhosIn
      rows={rows}
      loading={players.isLoading}
      error={
        players.isError ? (
          <div className="flex flex-wrap items-center gap-x-3">
            <p className="m-0 text-sm text-muted">I could not read the players just now.</p>
            <button type="button" onClick={() => void players.refetch()} className={TEXT_LINK}>
              Read them again
            </button>
          </div>
        ) : null
      }
      copy={copy?.(players.data !== undefined ? list.length : null)}
      action={action}
    />
  );
}

export default function PoolDetail({ id }: { id: string }) {
  const { address } = useEmbeddedWallet();
  const requestAuth = useWalletAuth();
  const character = useCharacter();
  const checks = useJoinChecks(character);
  const now = useNowSeconds();
  // Wearable pools offer two proof paths, but only one may be mounted at a
  // time: WearableCheck and EvidenceUpload both drive SPOTTER's run loop for
  // the same goal id, and two concurrent pollers with conflicting evidence
  // kinds is an untested surface on a money path.
  //
  // The visitor's own choice wins; below it, whichever path an existing claim
  // used (so a returning user is not stranded behind the other tab); below
  // that, the wearable default. Derived rather than stored so the restore can
  // never race the render or overwrite a tap.
  const [pinnedPath, setPinnedPath] = useState<ProofPath | null>(null);
  const choosePath = (path: ProofPath) => setPinnedPath(path);
  const poolId = useMemo(() => {
    try {
      const parsed = BigInt(id);
      return parsed > 0n ? parsed : null;
    } catch {
      return null;
    }
  }, [id]);

  // The clock is read alongside the fetch, not during render, so the phase
  // decision stays pure. The query client disables focus refetches, so a
  // polling interval re-classifies the pool while the page sits open - a
  // live pool crossing its period end must drop the join UI, not offer a
  // button that reverts with PERIOD_ENDED.
  const docAvailable = useDocumentProofAvailable();
  const poolQuery = useQuery({
    queryKey: ["pool", id],
    queryFn: async () => {
      if (poolId === null) throw new Error("Invalid pool id.");
      return {
        pool: await fetchPool(poolId),
        asOfSeconds: BigInt(Math.floor(Date.now() / 1000)),
      };
    },
    enabled: poolId !== null,
    refetchInterval: 30_000,
  });

  const participantsQuery = useQuery({
    queryKey: ["participants", id],
    queryFn: () => {
      if (poolId === null) throw new Error("Invalid pool id.");
      return fetchParticipants(poolId);
    },
    enabled: poolId !== null,
  });

  const participantQuery = useQuery({
    queryKey: ["participant", id, address],
    queryFn: () => {
      if (poolId === null) throw new Error("Invalid pool id.");
      if (address === null) throw new Error("No wallet connected.");
      return fetchParticipant(poolId, address);
    },
    enabled: poolId !== null && address !== null,
  });

  // Wearable goals depend on an outside provider that can refuse us outright.
  // Shares one query key with the dashboard and the pool list.
  //
  // cachedOnly: this read decides whether to offer a join button, and nobody
  // asked to unlock anything by opening a pool page. It uses a signature the
  // session already has and otherwise comes back unsigned - which reports as
  // "not known", never as an outage, so no goal is pulled off the page over a
  // signature the visitor was never asked for.
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

  // What the viewer's own device can measure. cachedOnly for the same reason
  // as the read above: opening a pool page must never fire a wallet prompt.
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

  const openPools = useOpenPools();

  const joined = participantQuery.data?.joined === true;
  const canPay =
    poolQuery.data !== undefined && poolCanPay(poolQuery.data.pool);

  // The claim's ledger, read owner-only and cachedOnly so opening a pool page
  // never prompts for a signature. It drives the claim rail's step and the
  // restored proof path. The refetch interval follows the run - fast while
  // verifying, slow while a deferred settlement waits, stopped once terminal -
  // and it is a GET that never drives SPOTTER's run loop, so it does not
  // conflict with the upload/wearable client that does.
  const claimLedgerQuery = useQuery<ClaimLedgerData>({
    queryKey: ["claim-ledger", id, address],
    queryFn: async (): Promise<ClaimLedgerData> => {
      if (poolId === null || address === null) {
        throw new Error("No claim identity yet.");
      }
      const goalId = await fetchGoalId(poolId, address);
      const sent = await fetchWithWalletAuth(
        `/api/agent/run/${goalId}?poolId=${poolId.toString()}`,
        undefined,
        (options) => requestAuth({ ...options, cachedOnly: true }),
      );
      if (!sent.response.ok) {
        throw new Error(`ledger read responded ${sent.response.status}`);
      }
      const body = (await sent.response.json().catch(() => ({}))) as {
        ledger?: LedgerEntry[];
        hasLedger?: boolean;
      };
      const ledger = Array.isArray(body.ledger) ? body.ledger : null;
      return {
        ledger,
        hasLedger: body.hasLedger === true || (ledger?.length ?? 0) > 0,
      };
    },
    enabled: poolId !== null && address !== null && joined && canPay,
    retry: false,
    staleTime: 5_000,
    refetchInterval: (query) => {
      // A settled or cancelled run cannot move its claim any more.
      if (poolQuery.data?.pool.settled === true) return false;
      const data = query.state.data;
      if (data === undefined) return 3_000;
      const status =
        data.ledger !== null
          ? runStatusFromLedger(data.ledger)
          : data.hasLedger
            ? "verifying"
            : null;
      switch (status) {
        case "verifying":
          return 2_500;
        case "recorded":
          return 10_000;
        case "missed":
          // Final on chain; only the closing row after settle is still to come.
          return 30_000;
        case "paid":
        case "no-pay":
        case "cap-exceeded":
        case "blocked":
        case "error":
          return false;
        default:
          // Joined with no claim yet: watch for one starting.
          return 4_000;
      }
    },
  });

  const claimLedger = claimLedgerQuery.data?.ledger ?? null;
  const hasClaim = claimLedgerQuery.data?.hasLedger === true;
  const runStatus: RunStatus | null =
    claimLedger !== null
      ? runStatusFromLedger(claimLedger)
      : hasClaim
        ? "verifying"
        : null;
  const restoredPath: ProofPath | null =
    claimLedger !== null ? claimProofPathOf(claimLedger) : null;

  // The Verdict: the ledger, the chain and the World approval status mapped
  // to one screen (lib/game/verdict.ts). Called before any early return.
  // A yes from the player wakes the run loop: WearableCheck remounts, restores
  // the ledger (now approved) and polls the run, which records the result.
  const [proofRun, setProofRun] = useState(0);
  const verdict = useVerdict({
    pool: poolQuery.data?.pool ?? null,
    address,
    joined,
    refunded: participantQuery.data?.refunded === true,
    runStatus,
    ledger: claimLedger,
    resultRecorded: participantQuery.data?.resultRecorded,
    onApproved: () => {
      setProofRun((n) => n + 1);
      void claimLedgerQuery.refetch();
    },
  });

  // Every participant's on-chain result, read only once the pool settled, so
  // the finished-run card says who hit it instead of assuming a payout.
  const settledNow =
    poolQuery.data !== undefined &&
    poolQuery.data.pool.settled &&
    !poolQuery.data.pool.cancelled;
  const resultsQuery = useQuery({
    queryKey: ["participant-results", id],
    queryFn: () => {
      if (poolId === null) throw new Error("Invalid pool id.");
      return fetchParticipantResults(poolId);
    },
    enabled: poolId !== null && settledNow,
    staleTime: 60_000,
  });
  const commitmentFee = useCommitmentFee(poolQuery.data?.pool.bountyModel === 2);

  if (poolId === null) {
    return (
      <div className="pb-10">
        <BackLink />
        <div className="mt-3 max-w-xl">
          <ErrorNote
            title="That run does not exist"
            detail={`"${id}" is not a run number. Pick one from the open runs.`}
          />
          <ButtonLink href="/pools" variant="tertiary" className="mt-2">
            See the open runs
          </ButtonLink>
        </div>
      </div>
    );
  }

  if (poolQuery.isLoading) return <RunSkeleton />;

  if (poolQuery.isError || poolQuery.data === undefined) {
    return (
      <div className="pb-10">
        <BackLink />
        <div className="mt-3 max-w-xl">
          <ErrorNote
            title="Could not load this run"
            detail={
              poolQuery.error instanceof ContractNotConfiguredError
                ? "Runs are not switched on for this build yet."
                : "I could not read this run from Base Sepolia just now. Nothing changed on your side."
            }
            onRetry={() => {
              void poolQuery.refetch();
            }}
            retryLabel="Read the run again"
          />
          <ButtonLink href="/pools" variant="tertiary" className="mt-2">
            See the open runs instead
          </ButtonLink>
        </div>
      </div>
    );
  }

  const { pool, asOfSeconds } = poolQuery.data;

  // A challenge is a private, person-aimed challenge. Its goal (health-
  // adjacent), the challenger's @handle, and the "challenge" initiative are
  // for the people who belong here only: the target once they have joined
  // through the invite link, and the creator. Every other visitor - including
  // a stranger walking sequential /pools/<n> ids - gets a neutral notice with
  // no goal, no handle, and no money action. Challenge-ness is the immutable
  // on-chain initiative, never the Supabase challenges row.
  const isChallenge = pool.initiative === "challenge";
  const isCreator =
    address !== null && address.toLowerCase() === pool.creator.toLowerCase();
  if (isChallenge && !joined && !isCreator) {
    // Signed in but participant status still loading: we cannot yet tell a
    // joined target from a stranger, so hold on a neutral skeleton rather than
    // flashing the private notice at someone who came in through their link.
    if (address !== null && participantQuery.isLoading) return <RunSkeleton />;
    return (
      <div className="pb-10">
        <BackLink />
        <div className="mx-auto mt-6 max-w-md">
          <EmptyState
            pose="detective"
            title="This is a private challenge"
            detail="Open it from the invite link you were sent. That link carries the details this page keeps private."
            action={<ButtonLink href="/pools">See the open runs</ButtonLink>}
          />
        </div>
      </div>
    );
  }

  const participantCount = participantsQuery.data?.length ?? null;
  // A commitment run's money terms, for the numbers every surface states.
  // Only meaningful before settle: afterwards the balance tracks payouts.
  const selfStaked = pool.bountyModel === 2;
  // Whether a miss here can go to the players who hit (lib/miss-rule.ts);
  // every other run refunds a miss at settle, and its terms say so.
  const recordsMisses = recordsMissesOf(pool);
  const commitmentTerms: CommitmentTerms | null =
    selfStaked && participantCount !== null && !pool.settled && !pool.cancelled
      ? {
          entryFee: pool.entryFee,
          players: participantCount,
          balance: pool.balance,
          feeBps: commitmentFee.bps,
          recordsMisses,
        }
      : null;
  const settleAchievers =
    resultsQuery.data !== undefined ? settleTallyOf(resultsQuery.data).achievers : null;
  const evidenceType = evidenceTypeOf(pool.goalSpec);
  const isDocGoal = evidenceType === "document";
  const goalTitle = displayGoalSpec(pool.goalSpec);

  // The proof policy is the single source of truth for how this pool may be
  // proven: its floor (highest-trust modality) and the full accepted set. The
  // prove surface renders one path per accepted modality; the mounted path is
  // the visitor's tap, else the path their existing claim used, else the floor
  // - clamped to the accepted set so a stale restore can never mount a modality
  // the pool does not accept.
  const policy = proofPolicyOf(pool.goalSpec);
  // While the document verifier is off, only the wearable path is offered.
  const accepted = docAvailable
    ? policy.accepted
    : policy.accepted.filter((m) => m === "wearable");
  const multiPath = accepted.length > 1;
  const candidatePath: Modality = pinnedPath ?? restoredPath ?? policy.floor;
  const proofPath: Modality = accepted.includes(candidatePath)
    ? candidatePath
    : policy.floor;
  // The upload path a wearable-floor pool can switch to from WearableCheck (a
  // self-reported photo on a hybrid pool); undefined on a pure-wearable pool.
  const uploadAltPath = accepted.find((m) => m !== "wearable");
  // joinPool reverts with PERIOD_ENDED once the period closes, so an expired
  // pool must never offer it. Evidence and the receipt stay visible for joined
  // participants until settlement runs.
  const phase = poolPhase(pool, asOfSeconds);

  // ONE decision, made in lib/wearable-join-gate.ts, shared with the challenge
  // link. The kinds are mutually exclusive by construction, so the JSX below
  // can never disagree with the gate about precedence however it is ordered.
  const providerDown = providerDownReason(providerQuery.data);
  const viewerProvider = (capabilityQuery.data?.providers ?? []).find(
    (option) => option.id === capabilityQuery.data?.selected,
  );
  const viewerMetrics = viewerMetricsOf(capabilityQuery.data);

  const joinBlock = wearableJoinBlock({
    goalSpec: pool.goalSpec,
    address,
    joined,
    providerDown,
    viewerMetrics,
    capabilityPending:
      address !== null && capabilityUnknown(capabilityQuery.data),
    needsDevice: capabilityNeedsDevice(capabilityQuery.data),
    capabilityHold: capabilityHoldOf(capabilityQuery.data),
    uploadAvailable: docAvailable,
  });

  // The run's one decision, shared with the lobby and the challenge link
  // (lib/game/lobby.ts): the join gate above, plus World proof-of-human, the
  // closed-beta list, the document checker and the payout rule. A limit is a
  // lock with its fix, here, before any stake; a read still loading holds the
  // stake and a failed one locks it behind a retry.
  const slot = runSlotOf({
    phase: poolPhase(pool, asOfSeconds),
    cancelled: pool.cancelled,
    canPay,
    joined,
    address,
    joinBlock,
    worldLane: checks.worldLane,
    humanVerified: checks.humanVerified,
    gate: checks.gate,
    needsDocumentVerifier: needsDocumentVerifier(pool.goalSpec),
    verifier: checks.verifier,
    payouts: checks.payouts,
    deviceLabel: viewerProvider?.label ?? null,
  });
  // Nobody tops up a run that cannot be checked or whose win could not pay on
  // this build, and nobody tops one up on a guess while that is unknown.
  const fundingPaused =
    (needsDocumentVerifier(pool.goalSpec) && checks.verifier !== "available") ||
    checks.payouts !== "ready";

  // A participant who ALREADY joined and then switched device is in the worst
  // position of anyone: the stake is in and their new device cannot prove the
  // goal. The gate deliberately passes them - withholding a join they already
  // made protects nothing - so the mismatch is computed separately here, and
  // they are told rather than left reading an outage message.
  const unsupportedAfterJoin =
    joined ? unsupportedMetricFor(pool.goalSpec, viewerMetrics) : null;

  // Wait for the restore before mounting a tab on a multi-path pool; mounting
  // the wrong one first would start a poll loop the correct tab then supersedes.
  const claimPathPending =
    multiPath && joined && claimLedgerQuery.isLoading;

  const screen = verdict.screen;
  const showProofSurface = proofSurfaceNeeded(screen);
  const verdictShown = screen.kind !== "none";
  // The Verdict is mounted for a joined player on a finished run, and on a
  // live or ended run whenever the claim surface is (not while the document
  // verifier is paused). When it carries its own claim card, the page-level
  // one stays hidden so there is never a second withdraw button.
  const over = poolIsOver(phase);
  const live = phase === "live";
  const verdictHoldsClaim =
    joined &&
    address !== null &&
    verdictShowsClaim(screen) &&
    (over || (canPay && !(isDocGoal && !docAvailable)));

  // ---------------------------------------------------------- words, numbers

  const headline: RunHeadline = runHeadlineOf({ goalSpec: pool.goalSpec, periodEnd: pool.periodEnd });
  const sleepRun = isSleepMetric(headline.metric);
  const clockNow = now ?? Number(asOfSeconds);
  const left = leftLabel(pool.periodEnd, clockNow);
  const endClock = clockLabel(Number(pool.periodEnd));
  const deviceName = viewerProvider?.label ?? null;
  const stake = formatUsdc(pool.entryFee);
  const pot = formatUsdc(pool.balance);
  const sponsorPot = commitmentTerms !== null ? sponsorPotOf(commitmentTerms) : 0n;
  const terms =
    selfStaked && commitmentTerms !== null && !commitmentFee.loading
      ? stakeTermsOf({
          entryFee: pool.entryFee,
          sponsorPot,
          goalShort: headline.short,
          feeBps: commitmentFee.bps,
          recordsMisses,
        })
      : null;
  // How SPOTTER reads the goal when it can record a miss, said before the
  // stake so a player knows the count a miss is judged on.
  const missRule = selfStaked ? missRulePool(pool) : null;
  const missReading = missRule !== null && missRule.ok ? missRuleReading(missRule.spec) : null;
  const solo = terms !== null && commitmentTerms !== null ? soloLineOf(commitmentTerms) : null;
  const friendMath = commitmentTerms !== null ? friendMathOf(commitmentTerms, joined) : null;

  const tag =
    phase === "cancelled"
      ? { tone: "ended" as const, label: "Cancelled" }
      : phase === "settled"
        ? { tone: "ended" as const, label: "Settled" }
        : phase === "expired"
          ? { tone: "ended" as const, label: "Ended" }
          : closesWithinDay(pool.periodEnd, clockNow)
            ? // The landing and the lobby tag a day run "Open now" (openTag in
              // lib/game/landing.ts); "today" read as the close's day.
              { tone: "live" as const, label: sleepRun ? "Open tonight" : "Open now" }
            : { tone: "live" as const, label: "Open" };
  const ends: ReactNode =
    phase === "cancelled" ? (
      <>
        Called off before <b>{endsLabel(pool.periodEnd)}</b>
      </>
    ) : live && left !== null ? (
      <>
        Ends <b>{endsLabel(pool.periodEnd)}</b>, in {left}
      </>
    ) : (
      <>
        Ended <b>{endsLabel(pool.periodEnd)}</b>
      </>
    );

  const hero = (
    <RunHero
      tag={tag}
      figure={headline.figure}
      rest={headline.figure !== null ? headline.rest : goalTitle}
      ends={ends}
      spotter={heroSpotterOf({ screen, joined, phase, sleepRun, achievers: settleAchievers })}
    />
  );

  // The next open run of the same kind, for "Go again tonight" and Also open.
  const openRuns: PoolInfo[] = (() => {
    const data = openPools.data;
    if (data === undefined) return [];
    return data.pools.filter(
      (p) =>
        p.id !== pool.id &&
        p.initiative !== "challenge" &&
        poolPhase(p, data.asOfSeconds) === "live" &&
        poolCanPay(p) &&
        unsupportedMetricFor(p.goalSpec, viewerMetrics) === null,
    );
  })().sort((a, b) => Number(a.periodEnd - b.periodEnd));
  const sameKind = openRuns.find(
    (p) => classifyWearableGoal(p.goalSpec).metric === headline.metric,
  );
  const nextRunHref = sameKind !== undefined ? `/pools/${sameKind.id.toString()}` : "/pools";

  // ------------------------------------------------------------ stake card

  const statsFor = (joinedView: boolean) =>
    selfStaked ? (
      <StakeStats joined={joinedView} stake={stake} pot={pot} players={participantCount} />
    ) : (
      <StakeStats
        stakeLabel="Entry"
        potLabel="Prize pool"
        stake={stake}
        pot={pot}
        players={participantCount}
      />
    );

  const termsBlock = selfStaked ? (
    terms !== null ? (
      <>
        <StakeTerms terms={terms} />
        {missReading !== null ? (
          <p className="m-0 mt-2 text-[0.8125rem] leading-[1.45] text-haze">{missReading}</p>
        ) : null}
      </>
    ) : participantsQuery.isLoading || commitmentFee.loading ? (
      <div className="mt-3.5 grid gap-2.5 border-t border-edge pt-3.5" aria-busy="true">
        <Skeleton className="h-5" />
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-5 w-3/5" />
      </div>
    ) : (
      <StakeTermsPlain>
        {recordsMisses
          ? "Hit it and your stake comes back with a share of the missed stakes and the pot. Miss it and your stake goes to the players who hit. If nobody hits, every stake comes back."
          : "Hit it and your stake comes back with a share of any sponsor pot. This run cannot record a miss, so a miss comes back at settle too. If nobody hits, every stake comes back."}
      </StakeTermsPlain>
    )
  ) : (
    <StakeTermsPlain>
      {isDocGoal
        ? `Pay the ${stake} USDC entry, then hand SPOTTER your record. The prize pays once the document checks out and the run allows.`
        : `Pay the ${stake} USDC entry, hit the goal inside the run, and the prize pays once SPOTTER confirms it and the run allows.`}
    </StakeTermsPlain>
  );

  // What stands between this player and the stake, in the order the card
  // reads. A lock replaces the check it fails; cleared checks say so.
  const timeline =
    headline.metric === "sleep_hours" && headline.goalDays === 1
      ? nightTimelineOf({ nowSec: clockNow, periodEnd: pool.periodEnd, goalHours: headline.threshold })
      : null;
  const cleared: StakeCheck[] = [];
  if (slot.kind === "playable") {
    if (slot.proof === "upload") {
      cleared.push({ key: "upload", glyph: "info", children: uploadFallbackNote(pool.goalSpec) });
    } else if (evidenceType === "wearable" && deviceName !== null && headline.metric !== null) {
      cleared.push({
        key: "device",
        glyph: "ok",
        children: (
          <>
            <b>Your {deviceName}</b> tracks {metricLabel(headline.metric)}, so it can check this run
          </>
        ),
      });
    }
    const name = character.character?.name ?? null;
    if (checks.worldLane === "on" && checks.humanVerified) {
      cleared.push({
        key: "human",
        glyph: "ok",
        children:
          name !== null ? (
            <>
              Joining as <b>{name}</b>, verified as one person
            </>
          ) : (
            <>Verified as one person with World ID</>
          ),
      });
    } else if (name !== null) {
      cleared.push({
        key: "human",
        glyph: "ok",
        children: (
          <>
            Joining as <b>{name}</b>
          </>
        ),
      });
    }
    if (timeline !== null && !timeline.fits) {
      cleared.push({
        key: "late",
        glyph: "info",
        children: (
          <>
            <b>Less than {headline.short} is left before the {endClock} close,</b> so tonight can no
            longer reach the goal.
          </>
        ),
      });
    }
  }

  const preamble = (
    <>
      {statsFor(false)}
      {termsBlock}
      {solo !== null ? <SoloNote line={solo} /> : null}
      <StakeChecks items={cleared} />
      <ApprovalNote />
    </>
  );

  const shareText = `Put money on yourself with me on GoHealthMe: ${goalTitle}.`;
  const friendAction =
    !isChallenge && live ? (
      <ChallengeFriend path={`/pools/${pool.id.toString()}`} text={shareText} />
    ) : null;

  const icsHref =
    now !== null && live
      ? `data:text/calendar;charset=utf-8,${encodeURIComponent(
          resultIcs({
            poolId: pool.id,
            periodEnd: pool.periodEnd,
            title: goalTitle,
            deviceName: deviceName ?? "wearable",
            nowSec: now,
          }),
        )}`
      : null;

  // The single mounted claim surface. Wearable pools default to the wearable
  // check with the document upload one tap away; document pools upload only.
  const verdictCard =
    joined && address !== null ? (
      <VerdictStage
        pool={pool}
        address={address}
        joined={joined}
        refunded={participantQuery.data?.refunded === true}
        runStatus={runStatus}
        ledger={claimLedger}
        hasClaim={hasClaim}
        screen={screen}
        goalId={verdict.goalId}
        screening={verdict.screening}
        onApproval={verdict.onApproval}
        settleAchievers={settleAchievers}
        players={participantCount}
        goalShort={headline.short}
        deviceName={deviceName}
        nextRunHref={nextRunHref}
        paidTo={character.character?.name ?? null}
      />
    ) : null;

  const proofSurface =
    !joined || !showProofSurface ? null : isDocGoal && !docAvailable ? (
      <Card as="section" aria-labelledby="proof-h">
        <h2 id="proof-h" className="m-0 text-[1.0625rem] font-semibold">
          Document proof is paused
        </h2>
        <p className="m-0 mt-2 text-[0.9375rem] text-muted">
          I cannot read uploaded records right now: the verifier is not live.
          Your stake is safe. If the run ends before it is back, you are
          refunded automatically. Wearable goals still verify today.
        </p>
      </Card>
    ) : (
      <Card as="section" id="proof-upload" aria-labelledby="proof-h">
        <h2 id="proof-h" className="m-0 text-[1.0625rem] font-semibold">
          {verdictShown ? "SPOTTER's check" : "Send SPOTTER in"}
        </h2>
        {multiPath ? (
          <div role="radiogroup" aria-label="How to prove it" className="mt-3.5 flex flex-wrap gap-2">
            {accepted.map((m) => (
              <Chip key={m} role="radio" selected={proofPath === m} onClick={() => choosePath(m)}>
                {m === "wearable"
                  ? "From my wearable"
                  : m === "document"
                    ? "Upload proof"
                    : "Upload a photo (self-reported)"}
              </Chip>
            ))}
          </div>
        ) : null}
        <div className="mt-4">
          {claimPathPending ? (
            <div className="grid gap-3" aria-busy="true">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-16" />
            </div>
          ) : proofPath === "wearable" ? (
            <WearableCheck
              key={proofRun}
              poolId={pool.id}
              goalSpec={pool.goalSpec}
              verdictShown={verdictShown}
              onSwitchToDocument={
                uploadAltPath !== undefined
                  ? () => choosePath(uploadAltPath)
                  : undefined
              }
            />
          ) : proofPath === "self-reported" ? (
            <EvidenceUpload poolId={pool.id} goalSpec={pool.goalSpec} modality="self-reported" />
          ) : (
            <EvidenceUpload poolId={pool.id} goalSpec={pool.goalSpec} modality="document" />
          )}
        </div>
      </Card>
    );

  let stakeCard: ReactNode;
  if (joined && verdictShown && canPay && verdictCard !== null) {
    // After a claim exists, the verdict takes the stake card's place.
    stakeCard = verdictCard;
  } else if (live) {
    const joinMounted = slot.kind === "playable" || slot.kind === "in-run";
    let body: ReactNode;
    if (slot.kind === "cannot-pay") {
      body = (
        <>
          {statsFor(false)}
          <p className="m-0 mt-4 text-[1.0625rem] font-semibold">This run cannot pay out</p>
          <p className="m-0 mt-1 text-[0.9375rem] text-muted">
            It was set up with no reward per achiever, so even a verified result
            would pay you nothing. I am not letting anyone stake into it.
          </p>
          <StakeAction>
            <ButtonLink href={nextRunHref} block>
              Find a run that pays
            </ButtonLink>
          </StakeAction>
        </>
      );
    } else if (address !== null && !joined && participantQuery.isError) {
      // Unknown whether this wallet is already in: never offer a join that
      // could revert ALREADY_JOINED after the wallet prompt.
      body = (
        <>
          {statsFor(false)}
          <div className="mt-4">
            <StakeFailed
              title="I could not check whether you are in this run"
              detail="Nothing changed on your side."
              onRetry={() => {
                void participantQuery.refetch();
              }}
              retryLabel="Check again"
            />
          </div>
        </>
      );
    } else if (
      slot.kind === "checking" ||
      (address !== null && participantQuery.isLoading)
    ) {
      // A read the join depends on has not answered yet: hold the stake
      // rather than offer it and take it back a moment later.
      body = (
        <div aria-busy="true">
          {statsFor(false)}
          <Skeleton className="mt-4 h-24" />
          <Skeleton className="mt-4 h-[60px]" />
          <p className="m-0 mt-2 text-[0.8125rem] text-haze">Checking what this run needs from you.</p>
        </div>
      );
    } else if (slot.kind === "locked" && slot.lock.kind === "sign-in") {
      const fix = lockCopy(slot.lock, `/pools/${id}`).fix;
      body = (
        <>
          {statsFor(false)}
          {termsBlock}
          {solo !== null ? <SoloNote line={solo} /> : null}
          <StakeAction
            id="stake-action"
            fine="Sign in with Base or email, no seed phrase. You make your player once, then land back on this run."
          >
            <ButtonLink href={fix.kind === "link" ? fix.href : "/character"} block>
              Sign in to stake {stake} USDC
            </ButtonLink>
          </StakeAction>
          <StakeVault />
        </>
      );
    } else if (slot.kind === "locked") {
      body = (
        <>
          {statsFor(false)}
          {termsBlock}
          {solo !== null ? <SoloNote line={solo} /> : null}
          <StakeLock
            lock={slot.lock}
            returnTo={`/pools/${id}`}
            onCheckSensor={character.checkSensor}
            onRetry={checks.retry}
          />
          <StakeVault />
        </>
      );
    } else if (joinMounted) {
      // One mount for playable and in-run, so a fresh join keeps its receipt
      // when the participant read flips to joined underneath it.
      body = (
        <JoinPool
          poolId={pool.id}
          entryFee={pool.entryFee}
          alreadyJoined={joined}
          view={{
            preamble,
            goalTitle: headline.figure !== null ? `${headline.figure} ${headline.rest}` : goalTitle,
            joined: {
              stake,
              pot,
              players: participantCount,
              night: sleepRun,
              deviceName: deviceName ?? "wearable",
              goalShort: headline.short,
              closeLabel: closeLabelOf(pool.periodEnd),
              closeClock: endClock,
              icsHref,
              action: friendAction,
            },
            barAction: friendAction !== null ? (
              <ChallengeFriend
                path={`/pools/${pool.id.toString()}`}
                text={shareText}
                variant="secondary"
              />
            ) : null,
          }}
        />
      );
    } else {
      body = null;
    }
    stakeCard = (
      <StakeCard label={joined ? "Your stake" : "Stake on this run"}>
        {body}
        {unsupportedAfterJoin !== null ? (
          <p className="m-0 mt-3 flex items-start gap-2.5 text-sm leading-[1.45] text-foreground">
            <Glyph name="info" size={18} className="mt-px text-muted" />
            <span>
              {deviceName ?? "Your wearable"} does not report {metricLabel(unsupportedAfterJoin)}, so it
              cannot prove this run. Pair the wearable you joined with to send SPOTTER in.
            </span>
          </p>
        ) : null}
      </StakeCard>
    );
  } else if (phase === "expired") {
    stakeCard =
      joined && verdictCard !== null && verdictShown ? (
        verdictCard
      ) : (
        <StakeCard label="This run has ended">
          {statsFor(joined)}
          <p className="m-0 mt-4 text-[1.0625rem] font-semibold">
            {joined ? "Time is up. Send SPOTTER in." : "This run has ended"}
          </p>
          <p className="m-0 mt-1 text-[0.9375rem] text-muted">
            {joined
              ? `Joining closed at ${endClock}. Sync your ${deviceName ?? "wearable"} and send SPOTTER in below, before the run settles.`
              : participantCount === 0
                ? "Nobody joined this one, so there is nothing here to pay out."
                : "You are not in this run, so nothing here pays out for you."}
          </p>
          {!joined ? (
            <StakeAction>
              <ButtonLink href={nextRunHref} block>
                Find an open run
              </ButtonLink>
            </StakeAction>
          ) : null}
        </StakeCard>
      );
  } else {
    // Settled or cancelled. What happened is read from the chain
    // (lib/game/run-end.ts), never assumed. A joined player gets their
    // Verdict with the claim folded in; everyone else the run's result.
    const endPhase = phase === "cancelled" ? "cancelled" : "settled";
    const tally = resultsQuery.data !== undefined ? settleTallyOf(resultsQuery.data) : null;
    const copy = runEndCopy({ phase: endPhase, bountyModel: pool.bountyModel, joined, tally });
    if (joined && address !== null) {
      stakeCard =
        claimLedgerQuery.isLoading || participantQuery.isLoading ? (
          // Hold until the ledger and the chain answer, so a winner never
          // sees "Run settled" flip to a paid receipt.
          <Card aria-busy="true">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-3 h-10 w-3/4" />
            <Skeleton className="mt-4 h-40" />
          </Card>
        ) : (
          verdictCard
        );
    } else {
      stakeCard = (
        <StakeCard label="How this run ended">
          <StakeStats stake={stake} pot={pot} potLabel="Left in pool" players={participantCount} stakeLabel={selfStaked ? "Stake" : "Entry"} />
          <p className="m-0 mt-4 text-[1.0625rem] font-semibold">{copy.headline}</p>
          {endPhase === "settled" && resultsQuery.isLoading ? (
            <Skeleton className="mt-2 h-10" />
          ) : (
            <p className="m-0 mt-1 text-[0.9375rem] text-muted">{copy.body}</p>
          )}
          {endPhase === "settled" && resultsQuery.isError ? (
            <div className="mt-3">
              <ErrorNote
                title="Could not read who hit it"
                detail="I could not read the results on this run from Base Sepolia just now. Nothing changed; anything credited to you is still claimable."
                onRetry={() => {
                  void resultsQuery.refetch();
                }}
                retryLabel="Read the results again"
              />
            </div>
          ) : null}
          {!isCreator ? (
            <StakeAction fine="You were not in this run, so nothing here is yours.">
              <ButtonLink href={nextRunHref} block>
                Find an open run
              </ButtonLink>
            </StakeAction>
          ) : null}
        </StakeCard>
      );
    }
  }

  // ------------------------------------------------------------ Your night

  const railFor = (): NightRail | null =>
    timeline !== null && timeline.fits
      ? {
          latestPct: timeline.latestPct,
          latestLabel: clockLabel(timeline.latestSec),
          blockLabel: `${headline.threshold}h`,
        }
      : null;
  const device = deviceName ?? "wearable";
  const lockedCaption =
    slot.kind === "locked" && slot.lock.kind === "cannot-measure"
      ? `${slot.lock.deviceLabel ?? "Your wearable"} can't send me ${metricLabel(slot.lock.metric)}. Pair a wearable that tracks it and I'll check this run.`
      : null;
  const caption = joined
    ? sleepRun && headline.goalDays === 1
      ? `You're in. I'm asleep till ${endClock}. You should be too.`
      : `You're in. Sync your ${device} before ${endClock} and send me in to check.`
    : lockedCaption ??
      (deviceName !== null
        ? sleepRun
          ? `Wear your ${deviceName} to bed. When you wake, sync it and send me in to read the night.`
          : `Wear your ${deviceName}. Sync it before ${endClock} and send me in to read the day.`
        : sleepRun
          ? "Wear whatever tracks your sleep to bed. When you wake, sync it and send me in to read the night."
          : `Wear whatever tracks it. Sync it before ${endClock} and send me in to read the day.`);
  const rail = railFor();
  const appName = deviceName !== null ? `the ${deviceName} app` : "your wearable's app";
  const note: ReactNode =
    timeline !== null && timeline.fits ? (
      <>
        To fit {headline.short} before the {endClock} close, be asleep by{" "}
        <b>{clockLabel(timeline.latestSec)}</b> at the latest. Your {device} counts time asleep, not
        time in bed. Open {appName} when you wake so the night syncs.
      </>
    ) : timeline !== null ? (
      <>
        Less than {headline.short} is left before the {endClock} close, so tonight can no longer
        reach the goal.
      </>
    ) : (
      <>
        The run closes at <b>{endClock}</b>
        {left !== null ? `, in ${left}` : ""}. Only {sleepRun ? "nights" : "days"} your {device} has
        scored and synced count, so open {appName} before then.
      </>
    );
  const nightBase = {
    title: sleepRun ? "Your night" : "Your day",
    nowLabel: now !== null ? `Now ${clockLabel(now)}` : null,
    caption,
    endLabel: endClock,
    rail,
    railLabel:
      rail !== null
        ? `From now to the ${endClock} close. Asleep by ${rail.latestLabel} fits ${headline.short}.`
        : `From now to the ${endClock} close.`,
    note,
  };
  const yourNight =
    !live || evidenceType !== "wearable" ? null : joined && address !== null ? (
      <JoinedNight pool={pool} address={address} base={nightBase} />
    ) : (
      <YourNight {...nightBase} />
    );

  // -------------------------------------------------------------- Who's in

  const rosterCopy = (count: number | null): ReactNode => {
    if (!live) return undefined;
    if (friendMath !== null) {
      return (
        <>
          Bring a friend. If you both hit, each gets <b>{friendMath.bothHit}</b>. If they miss, you
          get <b>{friendMath.friendMisses}</b>.
        </>
      );
    }
    if (count !== null && count > 0 && !isChallenge) {
      // Only a run that records a miss grows with its players. Anywhere else a
      // miss is refunded, so another player splits the same sponsor pot.
      if (recordsMisses) return <>More players, bigger pot. Each one stakes {stake} too.</>;
      return sponsorPot > 0n ? (
        <>
          Each player stakes {stake}. A miss here comes back, so the players who hit share the{" "}
          <b>{formatUsdc(sponsorPot)}</b> sponsor pot.
        </>
      ) : (
        <>Each player stakes {stake}. A miss here comes back, so a hit is your stake back.</>
      );
    }
    return undefined;
  };

  // -------------------------------------------------------------- Also open

  const alsoRows: AlsoOpenRow[] = openRuns.slice(0, 2).map((p) => ({
    href: `/pools/${p.id.toString()}`,
    // The lobby row's name for the same run, so a link lands on what it said.
    title: runName(p),
    ends: endsLabel(p.periodEnd),
    stake: formatUsdc(p.entryFee),
    pot: formatUsdc(p.balance),
  }));

  return (
    <>
      <LightsOut on={joined && live} />
      <RunLayout hero={hero} stake={stakeCard}>
        {/* A win or refund credited on chain from ANY run shows here until it
            is claimed, unless this run's own Verdict is already showing the
            claim (a win, a settled result, or a cancelled run's refund). */}
        {address !== null && !verdictHoldsClaim ? <ClaimPayout address={address} /> : null}

        {yourNight}
        {canPay ? proofSurface : null}

        {/* A challenge's link is its PRIVATE /c/<token> invite and pool ids
            are walkable, so only the creator gets it, revealed after a
            one-tap signature. Public runs share from Who's in. */}
        {isChallenge && isCreator && address !== null ? (
          <Card as="section" aria-labelledby="send-h">
            <h2 id="send-h" className="m-0 text-[1.0625rem] font-semibold">
              Send the challenge
            </h2>
            <div className="mt-3">
              <ChallengeInviteShare poolId={pool.id} address={address} />
            </div>
          </Card>
        ) : null}

        <Roster
          poolId={pool.id}
          address={address}
          youPlaying={live ? (sleepRun ? "You, night to play" : "You, day to play") : undefined}
          copy={rosterCopy}
          action={joined ? null : friendAction !== null ? (
            <ChallengeFriend path={`/pools/${pool.id.toString()}`} text={shareText} variant="secondary" />
          ) : null}
        />

        {over ? <SweepLeftover pool={pool} phase={phase} address={address} /> : null}

        {!isChallenge ? (
          <AlsoOpen
            rows={alsoRows}
            sub={deviceName !== null ? `Other runs your ${deviceName} can check` : "Other runs open now"}
          />
        ) : null}

        {!over && canPay && !fundingPaused ? (
          isChallenge ? (
            // A challenge pool's top-up must carry the sweep disclosure: miss
            // the goal and sweep() returns the whole pot to the challenger,
            // not pro-rata to contributors. ChallengeContribute states that
            // before anyone can add.
            <ChallengeContribute
              poolId={pool.id}
              prizeUsd={(() => {
                // The prize net of every player's own stake, never raw balance.
                const { prize } = darePot({
                  balance: pool.balance,
                  entryFee: pool.entryFee,
                  participantCount,
                  settled: pool.settled,
                  cancelled: pool.cancelled,
                });
                return prize !== null ? formatUsdc(prize) : null;
              })()}
            />
          ) : (
            <Card as="section" aria-labelledby="pot-h">
              <details className="group">
                <summary
                  id="pot-h"
                  className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[1.0625rem] font-semibold [&::-webkit-details-marker]:hidden"
                >
                  Add to the pot
                  <Glyph name="chev" className="text-haze transition-transform duration-[120ms] group-open:rotate-90" />
                </summary>
                <div className="mt-2">
                  <FundPool
                    poolId={pool.id}
                    heading="Add test USDC to this run's pot"
                    description={
                      recordsMisses
                        ? "Anyone can add to the pot. Players who hit split it with the missed stakes."
                        : "Anyone can add to the pot. Players who hit split it equally."
                    }
                    ctaLabel="Approve and add to the pot"
                  />
                </div>
              </details>
            </Card>
          )
        ) : null}

      </RunLayout>
    </>
  );
}
