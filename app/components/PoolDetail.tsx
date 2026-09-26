"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import JoinPool from "@/components/JoinPool";
import FundPool from "@/components/FundPool";
import ChallengeContribute from "@/components/ChallengeContribute";
import EvidenceUpload from "@/components/EvidenceUpload";
import { useDocumentProofAvailable } from "@/lib/useProofStatus";
import WearableCheck from "@/components/WearableCheck";
import ShareChallenge from "@/components/ShareChallenge";
import ChallengeInviteShare from "@/components/ChallengeInviteShare";
import SpotterSays from "@/components/SpotterSays";
import SpotterMascot from "@/components/SpotterMascot";
import ClaimPayout from "@/components/ClaimPayout";
import {
  Badge,
  Card,
  ErrorNote,
  ProofTierBadges,
  Skeleton,
  TAP_TARGET,
} from "@/components/ui";
import ApprovalNote from "@/components/game/ApprovalNote";
import LockPanel from "@/components/game/LockPanel";
import RunBoard from "@/components/game/RunBoard";
import Scoreboard from "@/components/game/Scoreboard";
import VerdictStage, {
  proofSurfaceNeeded,
  useVerdict,
} from "@/components/game/VerdictStage";
import { arcAddressUrl } from "@/lib/chains";
import {
  runStatusFromLedger,
  type LedgerEntry,
  type RunStatus,
} from "@/lib/agent-receipt";
import { needsDocumentVerifier, runSlotOf } from "@/lib/game/lobby";
import { formatRunClock, runClock } from "@/lib/game/tally";
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
  BOUNTY_MODEL_LABELS,
  ContractNotConfiguredError,
  displayGoalSpec,
  evidenceTypeOf,
  fetchGoalId,
  fetchParticipant,
  fetchParticipantResults,
  fetchParticipants,
  fetchPool,
  formatUsdc,
  proofPolicyOf,
  type Modality,
} from "@/lib/contract";
import { poolCanPay, poolIsOver, poolPhase } from "@/lib/pool-lifecycle";
import { runEndCopy, settleTallyOf } from "@/lib/game/run-end";
import { verdictShowsClaim } from "@/lib/game/verdict";
import SweepLeftover from "@/components/SweepLeftover";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useDisplayNames } from "@/lib/use-display-names";
import { darePot } from "@/lib/challenges";
import { commitmentJoinCopy } from "@/lib/commitment-copy";

function formatDay(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Every terminal state on this page ends with somewhere to go. A pool that
 *  has settled or expired is not a place to leave someone standing. */
function BrowsePoolsLink({ label = "Browse live pools" }: { label?: string }) {
  return (
    <Link
      href="/pools"
      className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-5 py-2.5 font-display text-sm font-bold text-white shadow-[var(--shadow-pop)] transition-transform hover:translate-y-px hover:bg-accent-strong active:translate-y-[3px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {label}
    </Link>
  );
}

// ------------------------------------------------------- reskin presentation
// Small inline icons — this app carries no icon dependency, so the few glyphs
// the candy stat cards and share row want are drawn here with currentColor so
// each inherits the tint of the chip it sits in. Decorative only (aria-hidden).
type IconName =
  | "back"
  | "coins"
  | "clock"
  | "users"
  | "calendar"
  | "wallet"
  | "flask";

function Icon({
  name,
  className = "size-4",
}: {
  name: IconName;
  className?: string;
}) {
  const paths: Record<IconName, ReactNode> = {
    back: <path d="M15 18l-6-6 6-6" />,
    coins: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v9M14.5 9.5a2.5 2.5 0 0 0-2.5-1.5c-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2a2.5 2.5 0 0 1-2.5-1.5" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    users: (
      <>
        <path d="M16 19v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="3.5" />
        <path d="M22 19v-2a4 4 0 0 0-3-3.87" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
        <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
      </>
    ),
    wallet: (
      <>
        <rect x="3" y="6" width="18" height="13" rx="2.5" />
        <path d="M3 10.5h18M16.5 14.5h1.5" />
      </>
    ),
    flask: (
      <>
        <path d="M9 3h6M10 3v6L4.7 17.2A2 2 0 0 0 6.4 20.3h11.2a2 2 0 0 0 1.7-3.1L14 9V3" />
        <path d="M7.5 14.5h9" />
      </>
    ),
  };
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/** Test money, always in sight (docs/DESIGN.md). */
function TestnetLine() {
  return (
    <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted">
      <Icon name="flask" className="size-3.5" />
      Base Sepolia test USDC, no real money
    </p>
  );
}

/** The claim ledger, read owner-only and cachedOnly (never prompts): it drives
 *  the claim rail's progress and the restored proof path. hasLedger tells a
 *  withheld claim (a claim exists, signature not cached) apart from no claim. */
interface ClaimLedgerData {
  ledger: LedgerEntry[] | null;
  hasLedger: boolean;
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
  // The public origin for the shareable pool link. useSyncExternalStore is the
  // hydration-safe way to read a client-only value: null on the server and the
  // hydrating render, the real origin once mounted - no setState-in-effect, no
  // mismatch. Same pattern ShareChallenge uses for its own origin.
  const shareOrigin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => null,
  );
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

  // SPOTTER's own wallet status is one line in the header on every screen
  // (components/game/SpotterStatusLine.tsx), not a wall on this page.

  const joined = participantQuery.data?.joined === true;
  const canPay =
    poolQuery.data !== undefined && poolCanPay(poolQuery.data.pool);

  // The claim's ledger, read owner-only and cachedOnly so opening a pool page
  // never prompts for a signature. It drives the claim rail's step and the
  // restored proof path. One read here replaces the wearable-only path probe:
  // the rail needs the ledger for every joined, payable pool, not just wearable
  // ones. The refetch interval follows the run - fast while verifying, slow
  // while a deferred settlement waits, stopped once terminal - and it is a GET
  // that never drives SPOTTER's run loop, so it does not conflict with the
  // upload/wearable client that does.
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

  // Resolve the funder address to a handle when it has claimed one. Called
  // unconditionally with whatever is known this render (empty until the pool
  // loads), so the rules of hooks hold across the early returns below.
  const { displayName, handleFor } = useDisplayNames(
    poolQuery.data ? [poolQuery.data.pool.creator] : [],
  );

  if (poolId === null) {
    return (
      <ErrorNote
        title="Invalid pool"
        detail={`"${id}" is not a valid pool id.`}
      />
    );
  }

  if (poolQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-9 w-3/4" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="h-14" />
      </div>
    );
  }

  if (poolQuery.isError || poolQuery.data === undefined) {
    return (
      <ErrorNote
        title="Could not load this pool"
        detail={
          poolQuery.error instanceof ContractNotConfiguredError
            ? "Runs are not switched on for this build yet."
            : "I could not read this run from Base Sepolia just now. Nothing changed on your side."
        }
        onRetry={() => {
          void poolQuery.refetch();
        }}
      />
    );
  }

  const { pool, asOfSeconds } = poolQuery.data;

  // A challenge is a private, person-aimed dare. Its goal (health-adjacent),
  // the challenger's @handle, and the "challenge" initiative badge are for the
  // people who belong here only: the target once they have joined through the
  // invite link, and the creator. Every other visitor - including a stranger
  // walking sequential /pools/<n> ids - gets a neutral notice with no goal, no
  // handle, no badge, and no money action. Challenge-ness is the immutable
  // on-chain initiative, never the Supabase challenges row (which can be absent).
  const isChallenge = pool.initiative === "challenge";
  const isCreator =
    address !== null && address.toLowerCase() === pool.creator.toLowerCase();
  if (isChallenge && !joined && !isCreator) {
    // Signed in but participant status still loading: we cannot yet tell a
    // joined target from a stranger, so hold on a neutral skeleton rather than
    // flashing the private notice at someone who came in through their link.
    // Nothing about the challenge is revealed either way.
    if (address !== null && participantQuery.isLoading) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-14" />
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <SpotterMascot pose="watching" size="md" className="mx-auto" />
        <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">
          This is a private challenge
        </h1>
        <p className="mt-3 text-sm text-muted">
          Open it from the invite link you were sent. That link carries the
          details this page keeps private.
        </p>
        <BrowsePoolsLink label="Browse open pools instead" />
      </div>
    );
  }

  const participantCount = participantsQuery.data?.length ?? null;
  const evidenceType = evidenceTypeOf(pool.goalSpec);
  const isDocGoal = evidenceType === "document";
  const goalTitle = displayGoalSpec(pool.goalSpec);

  // The proof policy is the single source of truth for how this pool may be
  // proven: its floor (highest-trust modality) and the full accepted set. The
  // prove surface renders one path per accepted modality; the mounted path is
  // the visitor's tap, else the path their existing claim used, else the floor
  // — clamped to the accepted set so a stale restore can never mount a modality
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
  // link. This page used to run its own chain in its own order, and the order
  // was wrong: the not-yet-checked branch pre-empted both the unsupported and
  // the outage branches, so a full provider outage rendered "connect a device
  // first, you have not linked one yet" to a wallet that had Junction linked.
  // Two surfaces deciding the same thing differently is precisely what that
  // module's header says it exists to prevent, and this page was the surface
  // still doing it.
  //
  // The kinds are mutually exclusive by construction, so the JSX below can no
  // longer disagree with the gate about precedence however it is ordered.
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

  // The run's one decision, shared with the lobby and the dare link
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
  const unverifiableNow = joinBlock.kind === "outage";
  const unsupportedForViewer = joinBlock.kind === "unsupported";

  // A participant who ALREADY joined and then switched device is in the worst
  // position of anyone: the fee is spent and their new device cannot prove the
  // goal. The gate deliberately passes them - withholding a join they already
  // made protects nothing - so the mismatch is computed separately here, and
  // they are told rather than left reading an outage message that is neither
  // their fault nor fixable by waiting.
  const unsupportedAfterJoin =
    joined && unsupportedMetricFor(pool.goalSpec, viewerMetrics) !== null;

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
  const verdictHoldsClaim =
    joined &&
    address !== null &&
    verdictShowsClaim(screen) &&
    (over || (canPay && !(isDocGoal && !docAvailable)));

  // The single mounted claim surface. Wearable pools default to the wearable
  // check with the document upload one tap away; document pools upload only.
  const claimSection = !joined ? null : isDocGoal && !docAvailable ? (
    <div className="rounded-3xl border border-warning/40 bg-warning/10 p-4 sm:p-5">
      <p className="font-display text-lg font-bold">Document proof is paused</p>
      <p className="mt-2 text-sm text-foreground/80">
        I cannot read uploaded records right now - the verifier is not live.
        Your stake is safe: if the pool ends before it is back, you are
        refunded automatically. Wearable goals still verify today.
      </p>
    </div>
  ) : (
    <>
      {address !== null ? (
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
        />
      ) : null}
      {showProofSurface && multiPath ? (
        <div className="flex flex-wrap gap-2">
          {accepted.map((m) => {
            const selected = proofPath === m;
            const tone = selected
              ? m === "self-reported"
                ? "border-warning/50 bg-warning/10 text-warning"
                : "border-accent/50 bg-accent/10 text-accent-strong"
              : "border-edge bg-surface-raised text-muted hover:text-foreground";
            const label =
              m === "wearable"
                ? "Verify from wearable"
                : m === "document"
                  ? "Upload proof"
                  : "Upload a photo (self-reported)";
            return (
              <button
                key={m}
                type="button"
                aria-pressed={selected}
                onClick={() => choosePath(m)}
                className={`rounded-full border-2 font-display font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${TAP_TARGET} ${tone}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
      {/* The proof surface stays mounted while its polling loop or its retry
          still matters (proofSurfaceNeeded). Once the Verdict above is
          showing, it keeps the receipt and the buttons and drops the status
          paragraphs the Verdict already says. */}
      {showProofSurface ? (
      <section
        id="proof-upload"
        className="rounded-xl border-2 border-foreground/15 bg-surface p-4 sm:p-6"
      >
        <h2 className="mb-3 font-display text-3xl font-extrabold leading-tight">
          {verdictShown ? "SPOTTER's check" : "Prove tonight"}
        </h2>
        {!verdictShown ? (
          <div className="mb-5">
            <SpotterSays
              surface="join"
              state="joined"
              pose="cheer"
              say="You are in. When your nights are banked, send me in to check."
            />
          </div>
        ) : null}
        {claimPathPending ? (
          <div className="space-y-3">
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
          <EvidenceUpload
            poolId={pool.id}
            goalSpec={pool.goalSpec}
            modality="self-reported"
          />
        ) : (
          <EvidenceUpload
            poolId={pool.id}
            goalSpec={pool.goalSpec}
            modality="document"
          />
        )}
      </section>
      ) : null}
    </>
  );

  // The funder's claimed handle, or null when the wallet never claimed one.
  // Null means the header shows "A sponsor" with the address as a demoted link
  // rather than a raw hex string standing in as the funder's identity.
  const funderHandle = handleFor(pool.creator);

  const clockNow = now ?? Number(asOfSeconds);
  const clock = runClock(pool.periodStart, pool.periodEnd, clockNow);

  const workbench = (
    <div className="min-w-0 space-y-8">
      <header className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          {/* -ml-4 keeps the text optically flush while the padding keeps a
              real 44px thumb target. */}
          <Link
            href="/pools"
            className={`-ml-4 inline-flex items-center gap-1 text-muted hover:text-foreground ${TAP_TARGET}`}
          >
            <Icon name="back" className="size-4" />
            Lobby
          </Link>
          <TestnetLine />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{pool.initiative}</Badge>
          <ProofTierBadges policy={policy} />
          {phase === "cancelled" ? (
            <Badge tone="warning">Cancelled</Badge>
          ) : phase === "settled" ? (
            <Badge tone="muted">Settled</Badge>
          ) : phase === "expired" ? (
            <Badge tone="warning">Ended</Badge>
          ) : null}
          {unverifiableNow && phase === "live" ? (
            <Badge tone="warning">Wearable checks down</Badge>
          ) : null}
          {(unsupportedForViewer || unsupportedAfterJoin) && phase === "live" ? (
            <Badge tone="warning">Your wearable cannot measure this</Badge>
          ) : null}
        </div>
        <h1 className="font-display text-5xl font-black leading-[0.95] tracking-tight text-balance sm:text-6xl">
          {goalTitle}
        </h1>
        {pool.bountyModel === 2 ? (
          <p className="text-sm text-muted">
            Started by{" "}
            <a
              href={arcAddressUrl(pool.creator)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-edge underline-offset-2 hover:text-foreground"
            >
              {displayName(pool.creator)}
            </a>
            . Everyone stakes their own; the nights decide.
          </p>
        ) : (
          <p className="text-sm text-muted">
            {funderHandle !== null ? "Prize put up by " : "Prize put up by a sponsor, "}
            <a
              href={arcAddressUrl(pool.creator)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-edge underline-offset-2 hover:text-foreground"
            >
              {displayName(pool.creator)}
            </a>
          </p>
        )}
        {joined && address !== null ? null : (
          <Scoreboard
            caption="Run scoreboard"
            cells={[
              {
                // After a settle the balance is what was not paid out, not a prize.
                label: over ? "Left in pool" : "Prize pool",
                value: formatUsdc(pool.balance),
                tone: "money",
                unit: "test USDC",
              },
              {
                label: pool.bountyModel === 2 ? "Stake to enter" : "Entry",
                value: formatUsdc(pool.entryFee),
                tone: "money",
                unit: "test USDC",
              },
              {
                label: "Time left",
                value: formatRunClock(clock),
                unit: `${participantCount ?? "--"} in the run`,
              },
            ]}
          />
        )}
        {/* A dare's link is its PRIVATE /c/<token> invite and pool ids are
            walkable, so only the creator gets it, revealed after a one-tap
            signature. Public runs share from the block further down. */}
        {isChallenge && isCreator && address !== null ? (
          <div className="rounded-xl border-2 border-foreground/15 bg-surface p-4">
            <h2 className="mb-2 font-display text-2xl font-extrabold">Send the dare</h2>
            <ChallengeInviteShare poolId={pool.id} address={address} />
          </div>
        ) : null}
        <p className="text-xs text-muted">
          {BOUNTY_MODEL_LABELS[pool.bountyModel] ?? "Custom payout"}. Runs{" "}
          {formatDay(pool.periodStart)} to {formatDay(pool.periodEnd)}.
        </p>
      </header>

      {/* A win or refund credited on chain from ANY run shows here until it
          is claimed, unless this run's own Verdict is already showing the
          claim (a win, a settled result, or a cancelled run's refund). */}
      {address !== null && !verdictHoldsClaim ? (
        <ClaimPayout address={address} />
      ) : null}

      {joined && address !== null ? (
        <RunBoard pool={pool} address={address} promptForData={false} />
      ) : null}

      {phase === "live" ? (
        <div className="space-y-4">
          {slot.kind === "cannot-pay" ? (
            <section className="rounded-xl border-2 border-warning/60 bg-warning/5 p-4 sm:p-5">
              <h2 className="font-display text-3xl font-extrabold text-warning">
                This run cannot pay out
              </h2>
              <p className="mt-1 text-sm text-foreground/80">
                It was set up with no reward per achiever, so even a verified
                result would land you zero. I am not letting you enter a run
                that cannot pay.
              </p>
              <BrowsePoolsLink label="Back to the lobby" />
            </section>
          ) : address !== null && !joined && participantQuery.isError ? (
            // Unknown whether this wallet is already in: never offer a join
            // that could revert ALREADY_JOINED after the wallet prompt.
            <ErrorNote
              title="I could not check whether you are in this run"
              detail="Nothing changed on your side."
              onRetry={() => {
                void participantQuery.refetch();
              }}
            />
          ) : slot.kind === "checking" ||
            (address !== null && participantQuery.isLoading) ? (
            // A read the join depends on has not answered yet: hold the stake
            // rather than offer it and take it back a moment later.
            <Skeleton className="h-40" />
          ) : slot.kind === "locked" ? (
            <LockPanel
              lock={slot.lock}
              returnTo={`/pools/${id}`}
              onCheckSensor={character.checkSensor}
              onRetry={checks.retry}
            />
          ) : slot.kind === "playable" ? (
            <section className="rounded-xl border-2 border-foreground bg-surface p-4 sm:p-6">
              <h2 className="font-display text-4xl font-black leading-none">
                {isChallenge ? "Take the dare" : "Enter the run"}
              </h2>
              <p className="mt-3 mb-4 text-sm text-foreground/80">
                {pool.bountyModel === 2
                  ? commitmentJoinCopy(pool, formatUsdc(pool.entryFee))
                  : isDocGoal
                    ? `Pay the ${formatUsdc(pool.entryFee)} USDC entry, then hand SPOTTER your record. The prize pays the moment the document checks out.`
                    : `Pay the ${formatUsdc(pool.entryFee)} USDC entry, hit the goal inside the run, and the prize pays the moment SPOTTER confirms it.`}
              </p>
              {participantCount === 0 ? (
                <p className="mb-4 text-sm font-semibold">Nobody is in yet. You would be first.</p>
              ) : null}
              {slot.proof === "upload" ? (
                <p className="mb-4 rounded-lg border-2 border-warning/40 bg-warning/5 p-3 text-sm">
                  {uploadFallbackNote(pool.goalSpec)}
                </p>
              ) : null}
              <div className="mb-4">
                <ApprovalNote />
              </div>
              <JoinPool
                poolId={pool.id}
                entryFee={pool.entryFee}
                alreadyJoined={joined}
              />
            </section>
          ) : null}

          {canPay ? claimSection : null}
        </div>
      ) : phase === "expired" ? (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <SpotterMascot
                pose="nature"
                size="sm"
                className="mx-auto sm:mx-0"
              />
              <div className="min-w-0">
                <h2 className="font-display text-lg font-semibold">
                  This pool has ended
                </h2>
                <p className="mt-1 text-sm text-muted">
                  The goal window closed on {formatDay(pool.periodEnd)}, so
                  joining is closed. I pay out the verified achievers now that
                  the period is over.
                </p>
                {!joined ? (
                  <>
                    <p className="mt-2 text-sm text-muted">
                      {participantCount === 0
                        ? "Nobody joined this one, so there is nothing here for me to pay."
                        : "You are not in this pool, so nothing here pays out for you."}
                    </p>
                    <BrowsePoolsLink />
                  </>
                ) : null}
              </div>
            </div>
          </Card>

          {joined ? (
            <>
              <p className="font-display text-xs font-semibold uppercase tracking-wide text-muted">
                Your claim
              </p>
              {claimSection}
            </>
          ) : null}
        </div>
      ) : (
        // Settled or cancelled. What happened is read from the chain
        // (lib/game/run-end.ts), never assumed: a pool nobody hit, a cancelled
        // pool and a pool with winners each say what is true. A joined player
        // gets their Verdict with the claim folded in (refund, share or win);
        // the creator gets the leftover.
        <div className="space-y-4">
          {(() => {
            const endPhase = phase === "cancelled" ? "cancelled" : "settled";
            const tally =
              resultsQuery.data !== undefined ? settleTallyOf(resultsQuery.data) : null;
            const copy = runEndCopy({
              phase: endPhase,
              bountyModel: pool.bountyModel,
              joined,
              tally,
            });
            return (
              <Card>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <SpotterMascot
                    pose="nature"
                    size="sm"
                    className="mx-auto sm:mx-0"
                  />
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-semibold">
                      {copy.headline}
                    </h2>
                    {endPhase === "settled" && resultsQuery.isLoading ? (
                      <Skeleton className="mt-2 h-10" />
                    ) : (
                      <p className="mt-1 text-sm text-muted">{copy.body}</p>
                    )}
                    {endPhase === "settled" && resultsQuery.isError ? (
                      <div className="mt-3">
                        <ErrorNote
                          title="Could not read who hit it"
                          detail="I could not read the results on this run from Base Sepolia just now. Nothing changed; anything credited to you is still claimable."
                          onRetry={() => {
                            void resultsQuery.refetch();
                          }}
                        />
                      </div>
                    ) : null}
                    {!joined && !isCreator ? (
                      <>
                        <p className="mt-2 text-sm text-muted">
                          You were not in this run, so nothing here is yours.
                        </p>
                        <BrowsePoolsLink label="Find an open run" />
                      </>
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })()}

          {joined && address !== null ? (
            <>
              <p className="font-display text-xs font-semibold uppercase tracking-wide text-muted">
                Your result
              </p>
              {claimLedgerQuery.isLoading || participantQuery.isLoading ? (
                // Hold until the ledger and the chain answer, so a winner
                // never sees "Run settled" flip to "You won the run".
                <Skeleton className="h-48" />
              ) : (
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
              />
              )}
            </>
          ) : null}

          <SweepLeftover pool={pool} phase={phase} address={address} />

          {/* Secondary on purpose: the claim or the take-back above is the one
              primary action on this screen. */}
          {joined || isCreator ? (
            <Link
              href="/pools"
              className={`inline-flex items-center text-sm font-semibold text-muted underline decoration-edge underline-offset-2 hover:text-foreground ${TAP_TARGET}`}
            >
              Find an open run
            </Link>
          ) : null}
        </div>
      )}

      {!over && canPay && !fundingPaused ? (
        isChallenge ? (
          // A challenge pool's top-up must carry the sweep disclosure: miss the
          // goal and sweep() returns the whole pot to the challenger, not
          // pro-rata to contributors. ChallengeContribute is the funnel that
          // states that before anyone can add - never the bare FundPool, which
          // tops up with no disclosure. Re-sharing a challenge uses its private
          // /c/<token> invite link (handed out at creation and on the landing),
          // never this gated pool URL, so no share row is offered here.
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
          <div className="space-y-4">
            {/* Share block: bring more people onto a PUBLIC pool. The pool's own
                page URL is public and safe to send, so it is handed to the
                existing ShareChallenge for Text / Email / Copy. shareOrigin is
                read on the client, so the row appears once mounted. */}
            {shareOrigin !== null ? (
              <div className="rounded-3xl border-2 border-edge bg-surface p-5 shadow-[var(--shadow-pop-edge)] sm:p-7">
                <h2 className="mb-1 font-display text-xl font-extrabold">
                  Bring people in
                </h2>
                <p className="mb-4 text-sm text-muted">
                  More people on the goal makes for a livelier pool. Send it to
                  someone who should be in.
                </p>
                <ShareChallenge
                  url={`${shareOrigin}/pools/${id}`}
                  title="Join me on GoHealthMe"
                  message={`Get in on this goal with me on GoHealthMe: ${goalTitle}.`}
                  emailSubject="Join this pool on GoHealthMe"
                  shareLabel="Share pool"
                />
              </div>
            ) : null}
            <div className="space-y-4">
              <p className="font-display text-xs font-semibold uppercase tracking-wide text-muted">
                Sweeten the pot
              </p>
              <Card>
                <FundPool poolId={pool.id} />
              </Card>
            </div>
          </div>
        )
      ) : null}
    </div>
  );

  return <div className="mx-auto w-full max-w-3xl">{workbench}</div>;
}
