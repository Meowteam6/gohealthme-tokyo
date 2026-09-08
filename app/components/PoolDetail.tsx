"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import Countdown from "@/components/Countdown";
import JoinPool from "@/components/JoinPool";
import FundPool from "@/components/FundPool";
import ChallengeContribute from "@/components/ChallengeContribute";
import EvidenceUpload from "@/components/EvidenceUpload";
import { useDocumentProofAvailable } from "@/lib/useProofStatus";
import WearableCheck from "@/components/WearableCheck";
import ClaimRail, { type ClaimRailState, type VerdictKind } from "@/components/ClaimRail";
import ShareChallenge from "@/components/ShareChallenge";
import ChallengeInviteShare from "@/components/ChallengeInviteShare";
import SpotterSays from "@/components/SpotterSays";
import SpotterMascot from "@/components/SpotterMascot";
import ClaimPayout from "@/components/ClaimPayout";
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Money,
  ProofTierBadges,
  Skeleton,
  TAP_TARGET,
} from "@/components/ui";
import { arcAddressUrl } from "@/lib/chains";
import {
  AGENT_WALLET_QUERY_KEY,
  agentIsBroke,
  fetchAgentWallet,
} from "@/lib/agent-budget";
import {
  projectReceipt,
  runStatusFromLedger,
  toUsd2,
  type LedgerEntry,
  type RunStatus,
} from "@/lib/agent-receipt";
import { claimStepOf } from "@/lib/claim-rail";
import { fetchWithWalletAuth } from "@/lib/client-auth";
import { useWalletAuth } from "@/lib/useWalletAuth";
import { claimProofPathOf, type ProofPath } from "@/lib/claim-restore";
import {
  fetchProviderState,
  providerDownReason,
  providerQueryKey,
} from "@/lib/wearable-provider";
import {
  capabilityUnknown,
  fetchProviderOptions,
  metricLabel,
  providerOptionsQueryKey,
  viewerMetricsOf,
} from "@/lib/wearable-connect";
import { unsupportedMetricFor } from "@/lib/pool-availability";
import type { WearableMetric } from "@/lib/wearable-goal";
import {
  BOUNTY_MODEL_LABELS,
  displayGoalSpec,
  evidenceTypeOf,
  fetchGoalId,
  fetchParticipant,
  fetchParticipants,
  fetchPool,
  formatUsdc,
  proofPolicyOf,
  type Modality,
} from "@/lib/contract";
import { poolCanPay, poolPhase } from "@/lib/pool-lifecycle";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useDisplayNames } from "@/lib/use-display-names";

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

type StatTint = "neutral" | "accent" | "warm";

/** A candy stat card: chunky border, a soft edge shadow, and a tinted icon
 *  chip. Money still renders through <Money> in the value slot — the tint lives
 *  on the card chrome, never inside the number. Reward and entry read WARM tan,
 *  not gold: a static balance is not money in motion. */
function StatCandy({
  icon,
  label,
  value,
  tint = "neutral",
  span = false,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  tint?: StatTint;
  span?: boolean;
}) {
  const ring: Record<StatTint, string> = {
    neutral: "border-edge bg-surface-raised",
    accent: "border-accent/25 bg-accent/5",
    warm: "border-[color:var(--secondary)] bg-secondary/40",
  };
  const chip: Record<StatTint, string> = {
    neutral: "bg-surface text-muted",
    accent: "bg-accent/15 text-accent-strong",
    warm: "bg-secondary text-secondary-foreground",
  };
  return (
    <div
      className={`flex flex-col gap-2 rounded-2xl border-2 p-4 shadow-sm ${ring[tint]} ${
        span ? "col-span-2" : ""
      }`}
    >
      <span
        className={`inline-flex size-8 items-center justify-center rounded-full ${chip[tint]}`}
      >
        {icon}
      </span>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          {label}
        </p>
        <p className="mt-0.5 font-display text-lg font-bold leading-snug text-foreground">
          {value}
        </p>
      </div>
    </div>
  );
}

/** The testnet play-money sticker. Tan, never gold — a testnet marker must not
 *  borrow the money-in-motion colour. */
function TestnetSticker() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">
      <Icon name="flask" className="size-3.5" />
      Testnet · play money
    </span>
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
  // Held while the one-tap device check is signing, so the button cannot be
  // pressed twice into two wallet prompts.
  const [checkingDevice, setCheckingDevice] = useState(false);

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

  // SPOTTER pays for verification from its own wallet. When that wallet is
  // empty, a claim started here dies at the buy step, so say so before the
  // person taps rather than after.
  const agentWalletQuery = useQuery({
    queryKey: AGENT_WALLET_QUERY_KEY,
    queryFn: fetchAgentWallet,
    staleTime: 15_000,
  });

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
          poolQuery.error instanceof Error
            ? poolQuery.error.message
            : "We could not reach the network just now. Give it another try."
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
  // A self-reported claim (photo/screenshot) is the low-trust tier: the rail
  // must never call it "Verified". Any self-reported verdict on the ledger
  // marks the claim.
  const claimIsSelfReported =
    claimLedger?.some((e) => e.kind === "verdict" && e.selfReported === true) ===
    true;
  // joinPool reverts with PERIOD_ENDED once the period closes, so an expired
  // pool must never offer it. Evidence and the receipt stay visible for joined
  // participants until settlement runs.
  const phase = poolPhase(pool, asOfSeconds);

  // A wearable goal with the provider refusing us cannot be checked at all.
  // The entry fee is real money paid up front, so the join action comes off
  // the page rather than selling a goal SPOTTER has no way to verify.
  const providerDown = providerDownReason(providerQuery.data);
  const unverifiableNow = providerDown !== null && evidenceType === "wearable";

  const viewerProvider = (capabilityQuery.data?.providers ?? []).find(
    (option) => option.id === capabilityQuery.data?.selected,
  );
  // The metric this viewer's device can never produce, or null. This is the
  // check that has to happen HERE, before the entry fee: the same mismatch
  // discovered at claim time is a rejection after the money has already moved.
  const unsupportedMetric = unsupportedMetricFor(
    pool.goalSpec,
    viewerMetricsOf(capabilityQuery.data),
  );
  const unsupportedForViewer = unsupportedMetric !== null && !joined;

  // "We have not established what this wallet's device measures" is NOT the
  // same as "it measures everything", and treating them alike defeated the
  // whole gate: the client credential cache is module memory that dies with
  // the tab, so ANY hard load of this page starts unsigned, the capability
  // read 401s, and the join button appeared for a goal the device can never
  // prove. It also silently reopened after the 8-minute signature TTL, since
  // the refetch replaced a good answer with an empty one.
  //
  // Only for a CONNECTED wallet on a WEARABLE goal they have not joined. A
  // logged-out visitor browsing the board is not about to stake, and a
  // document goal does not depend on a device at all.
  const capabilityPending =
    address !== null &&
    evidenceType === "wearable" &&
    !joined &&
    capabilityUnknown(capabilityQuery.data);
  const agentBroke = agentIsBroke(agentWalletQuery.data?.balanceUsd ?? null);
  // Wait for the restore before mounting a tab on a multi-path pool; mounting
  // the wrong one first would start a poll loop the correct tab then supersedes.
  const claimPathPending =
    multiPath && joined && claimLedgerQuery.isLoading;

  // Claim-rail state, derived from the same ledger the receipt reads so the
  // rail and the workbench can never disagree. The paid step is the ONLY one
  // that renders a payout figure, and it is fed exclusively by a settle entry
  // the ledger marked settled - a deferred verdict (runStatus "recorded") maps
  // to the verdict step and shows verified-and-settling, never paid.
  const step = claimStepOf(joined, hasClaim, runStatus);
  const receipt = claimLedger !== null ? projectReceipt(claimLedger) : null;
  const settledEntry = claimLedger?.find(
    (e) => e.kind === "settle" && e.status === "settled",
  );
  const paid =
    settledEntry !== undefined &&
    settledEntry.kind === "settle" &&
    settledEntry.paidUsd !== undefined
      ? {
          paidUsd: toUsd2(settledEntry.paidUsd),
          txHash: settledEntry.txHash ?? null,
        }
      : null;
  const verdict: VerdictKind | null =
    runStatus === "recorded"
      ? "deferred"
      : runStatus === "no-pay"
        ? "no-pay"
        : runStatus === "cap-exceeded" ||
            runStatus === "blocked" ||
            runStatus === "error"
          ? "stopped"
          : null;
  const railState: ClaimRailState = {
    step,
    spentUsd: receipt?.spentUsd ?? "0.00",
    capUsd: receipt?.capUsd ?? null,
    verdict,
    paid,
    selfReported: claimIsSelfReported,
  };
  // The rail tracks a claim journey, so it shows only where one exists: a live
  // payable pool, or an expired one the visitor is joined to (their claim can
  // still settle). Settled or structurally-unpayable pools have no journey.
  const showRail =
    canPay && (phase === "live" || (phase === "expired" && joined));

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
      {agentBroke ? (
        <div className="rounded-3xl border border-warning/40 bg-warning/10 p-4 sm:p-5">
          <SpotterSays surface="agent-header" state="broke" size="sm" />
          <p className="mt-3 text-sm text-foreground/80">
            I buy every verification from my own wallet, and right now it is
            empty. A check started now stops at the buy step and nobody gets
            paid. Nothing you did - come back once I am topped up.
          </p>
          <Link
            href="/agent"
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full border-2 border-warning/50 px-5 py-2.5 font-display text-sm font-bold text-warning transition-colors hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            See my wallet
          </Link>
        </div>
      ) : null}
      {multiPath ? (
        <div className="flex flex-wrap gap-2">
          {accepted.map((m) => {
            const selected = proofPath === m;
            const tone = selected
              ? m === "self-reported"
                ? "border-warning/50 bg-warning/10 text-warning"
                : "border-accent/50 bg-accent-deep text-accent"
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
      {/* The prove-it surface is the whole game, so it is the loudest card on
          the page: a thick emerald border with a soft emerald ring glow and a
          floating "Prove it now" tab. SPOTTER encourages before, then flips to
          the detective pose while the run is verifying. The real WearableCheck
          / EvidenceUpload mount unchanged inside — only the frame is new. */}
      <section
        id="proof-upload"
        className="relative rounded-3xl border-2 border-accent bg-surface p-5 shadow-[0_0_0_5px_rgba(16,185,129,0.12)] sm:p-7"
      >
        <span className="absolute -top-3 left-5 inline-flex items-center rounded-full bg-accent px-3 py-1 font-display text-xs font-extrabold uppercase tracking-wide text-white shadow-[var(--shadow-pop)]">
          Prove it now
        </span>
        <h2 className="mb-3 mt-2 font-display text-2xl font-extrabold leading-tight">
          Prove it
        </h2>
        <div className="mb-5">
          {runStatus === "verifying" ? (
            <SpotterSays surface="evidence" state="verifying" size="sm" />
          ) : (
            <SpotterSays surface="join" state="joined" size="sm" />
          )}
        </div>
        {claimPathPending ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-16" />
          </div>
        ) : proofPath === "wearable" ? (
          <WearableCheck
            poolId={pool.id}
            goalSpec={pool.goalSpec}
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
    </>
  );

  // The funder's claimed handle, or null when the wallet never claimed one.
  // Null means the header shows "A sponsor" with the address as a demoted link
  // rather than a raw hex string standing in as the funder's identity.
  const funderHandle = handleFor(pool.creator);

  const workbench = (
    <div className="min-w-0 space-y-8">
      <div className="rounded-3xl border-2 border-accent/15 bg-surface p-5 shadow-[var(--shadow-pop-edge)] sm:p-7">
        <div className="mb-4 flex items-center justify-between gap-3">
          {/* -ml-2 keeps the text optically flush while the padding still gives
              the link a real 44px thumb target. */}
          <Link
            href="/pools"
            className={`-ml-2 inline-flex items-center gap-1 text-muted hover:text-foreground ${TAP_TARGET}`}
          >
            <Icon name="back" className="size-4" />
            All pools
          </Link>
          <TestnetSticker />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{pool.initiative}</Badge>
          <ProofTierBadges policy={policy} />
          {phase === "settled" ? (
            <Badge tone="muted">Settled</Badge>
          ) : phase === "expired" ? (
            <Badge tone="warning">Expired</Badge>
          ) : (
            <Badge tone="accent">Live</Badge>
          )}
          {unverifiableNow && phase === "live" ? (
            <Badge tone="warning">Cannot verify right now</Badge>
          ) : null}
          {unsupportedForViewer && phase === "live" ? (
            <Badge tone="warning">Your device cannot measure this</Badge>
          ) : null}
        </div>
        {isDocGoal ? (
          <p className="mt-3 text-sm font-semibold uppercase tracking-wide text-accent">
            Preventive care - Earn from a {formatUsdc(pool.balance)} USDC bounty
          </p>
        ) : null}
        <h1 className="mt-3 font-display text-3xl font-extrabold leading-[1.08] tracking-tight sm:text-4xl">
          {goalTitle}
        </h1>
        {/* A self-staked commitment pool (model 2) has no funder - every
            participant stakes their own USDC and the creator merely set the
            pool up - so it must never read "A sponsor". Name the creator
            instead. For sponsor-funded models (0, 1) the funder's claimed
            handle names them; otherwise the identity reads "A sponsor" and the
            raw address is demoted to a small secondary link, so a wall of hex
            never stands in for the funder. */}
        {pool.bountyModel === 2 ? (
          <p className="mt-2 text-sm text-muted">
            Created by{" "}
            <a
              href={arcAddressUrl(pool.creator)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono underline decoration-edge underline-offset-2 hover:text-foreground"
            >
              {displayName(pool.creator)}
            </a>
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">
            {funderHandle !== null ? "Funder " : "A sponsor "}
            <a
              href={arcAddressUrl(pool.creator)}
              target="_blank"
              rel="noopener noreferrer"
              className={
                funderHandle !== null
                  ? "font-mono underline decoration-edge underline-offset-2 hover:text-foreground"
                  : "ml-1 font-mono text-xs underline decoration-edge underline-offset-2 hover:text-foreground"
              }
            >
              {displayName(pool.creator)}
            </a>
          </p>
        )}
        {/* Invite others, up top where it is findable. A PUBLIC pool's own URL
            is safe to hand out, so it gets the full Share / Text / Email / Copy
            row. A CHALLENGE's shareable link is its PRIVATE /c/<token> invite,
            and pool ids are sequential and walkable, so the token must never be
            rendered on this page. The creator already holds that invite (from
            creation and on their Challenges page); point them there instead of
            leaking it here. */}
        {shareOrigin !== null ? (
          <div className="mt-5 rounded-2xl border border-edge bg-surface-raised p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Invite others
            </p>
            {isChallenge ? (
              isCreator && address !== null ? (
                // The creator gets their real /c/<token> link inline, revealed
                // after a one-tap signature - the token is never rendered for a
                // non-creator viewer of this walkable page.
                <ChallengeInviteShare poolId={pool.id} address={address} />
              ) : (
                <p className="text-sm text-muted">
                  This challenge is private. Only the person who created it can
                  share the invite link.
                </p>
              )
            ) : (
              <ShareChallenge
                url={`${shareOrigin}/pools/${id}`}
                title="Join me on GoHealthMe"
                message={`Get in on this goal with me on GoHealthMe: ${goalTitle}.`}
                emailSubject="Join this pool on GoHealthMe"
                shareLabel="Share"
              />
            )}
          </div>
        ) : null}
        {phase === "live" ? (
          <div className="mt-5">
            <SpotterSays surface="pools-header" state="idle" size="md" />
          </div>
        ) : null}
      </div>

      {/* owed[] is a GLOBAL per-wallet balance, so a settled win from any pool
       *  shows here the moment it is credited - one tap withdraws it. It renders
       *  nothing when nothing is owed, so it never intrudes on a fresh visitor. */}
      {address !== null ? <ClaimPayout address={address} /> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCandy
          tint="warm"
          icon={<Icon name="coins" />}
          label="Reward pool"
          value={<Money usd={formatUsdc(pool.balance)} />}
        />
        <StatCandy
          tint="warm"
          icon={<Icon name="wallet" />}
          label={pool.bountyModel === 2 ? "Entry stake" : "Entry fee"}
          value={<Money usd={formatUsdc(pool.entryFee)} />}
        />
        <StatCandy
          tint="accent"
          icon={<Icon name="clock" />}
          label="Time remaining"
          value={
            <Countdown
              periodStart={pool.periodStart}
              periodEnd={pool.periodEnd}
            />
          }
        />
        <StatCandy
          tint="accent"
          icon={<Icon name="users" />}
          label="Participants"
          value={participantCount !== null ? participantCount : "--"}
        />
        <StatCandy
          icon={<Icon name="calendar" />}
          label="Starts"
          value={formatDay(pool.periodStart)}
        />
        <StatCandy
          icon={<Icon name="calendar" />}
          label="Ends"
          value={formatDay(pool.periodEnd)}
        />
        <StatCandy
          span
          tint="accent"
          icon={<Icon name="wallet" />}
          label="Payout model"
          value={
            <span className="text-base">
              {BOUNTY_MODEL_LABELS[pool.bountyModel] ?? "Custom model"}
            </span>
          }
        />
      </div>

      {phase === "live" ? (
        <div className="space-y-4">
          <p className="font-display text-xs font-semibold uppercase tracking-wide text-muted">
            Participant actions
          </p>
          {!canPay ? (
            <section className="rounded-3xl border border-warning/40 bg-warning/10 p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <SpotterMascot
                  pose="watching"
                  size="sm"
                  className="mx-auto sm:mx-0"
                />
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-semibold text-warning">
                    This pool cannot pay out
                  </h2>
                  <p className="mt-1 text-sm text-foreground/80">
                    It was set up with no reward per achiever, so even a verified
                    claim would land you zero. I am not going to let you join or
                    upload here - you would pass and still walk away with nothing.
                  </p>
                  <BrowsePoolsLink label="Find a pool that can pay" />
                </div>
              </div>
            </section>
          ) : capabilityPending ? (
            <section className="rounded-3xl border border-accent/30 bg-accent/15 p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <SpotterMascot
                  pose="watching"
                  size="sm"
                  className="mx-auto sm:mx-0"
                />
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-semibold text-accent-deep">
                    Let me check your device first
                  </h2>
                  <p className="mt-1 text-sm text-foreground/80">
                    Not every device can measure every goal, and I have not
                    checked yours yet. Sign to let me look - nothing is charged
                    and no transaction is sent.
                  </p>
                  <p className="mt-2 text-sm text-foreground/80">
                    The {formatUsdc(pool.entryFee)} USDC entry fee is real
                    money, so I am not selling you a spot before I know I can
                    verify you.
                  </p>
                  <Button
                    type="button"
                    pop
                    className="mt-3"
                    disabled={checkingDevice}
                    onClick={() => {
                      setCheckingDevice(true);
                      // The PROMPTING requester, deliberately. Browsing must
                      // never open a wallet modal, but this is the moment
                      // before an entry fee and the person asked for it.
                      void requestAuth({ refresh: true })
                        .then(() => capabilityQuery.refetch())
                        .finally(() => setCheckingDevice(false));
                    }}
                  >
                    {checkingDevice ? "Checking" : "Sign and check my device"}
                  </Button>
                </div>
              </div>
            </section>
          ) : unsupportedForViewer ? (
            <section className="rounded-3xl border border-warning/40 bg-warning/10 p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <SpotterMascot
                  pose="watching"
                  size="sm"
                  className="mx-auto sm:mx-0"
                />
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-semibold text-warning">
                    Your {viewerProvider?.label ?? "device"} cannot measure this
                    one
                  </h2>
                  <p className="mt-1 text-sm text-foreground/80">
                    This goal is measured in{" "}
                    {metricLabel(unsupportedMetric as WearableMetric)}, and{" "}
                    {viewerProvider?.label ?? "your connected device"} does not
                    report it. That is the hardware, not an outage, so it will
                    not start working later.
                  </p>
                  <p className="mt-2 text-sm text-foreground/80">
                    The {formatUsdc(pool.entryFee)} USDC entry fee is real
                    money, so I am not going to sell you a spot for a goal I
                    could never verify for you. Connect a device that tracks{" "}
                    {metricLabel(unsupportedMetric as WearableMetric)} and this
                    pool opens up.
                  </p>
                  <Link
                    href="/dashboard"
                    className={`mt-3 inline-block rounded-xl border-2 border-edge font-semibold hover:border-accent/50 ${TAP_TARGET}`}
                  >
                    Change your device
                  </Link>
                </div>
              </div>
            </section>
          ) : unverifiableNow && !joined ? (
            <section className="rounded-3xl border border-warning/40 bg-warning/10 p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <SpotterMascot
                  pose="watching"
                  size="sm"
                  className="mx-auto sm:mx-0"
                />
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-semibold text-warning">
                    I cannot check this goal right now
                  </h2>
                  <p className="mt-1 text-sm text-foreground/80">{providerDown}</p>
                  <p className="mt-2 text-sm text-foreground/80">
                    The {formatUsdc(pool.entryFee)} USDC entry fee is real money,
                    so I am not going to sell you a spot while I have no way to
                    read the goal. Document-verified pools are unaffected.
                  </p>
                  <BrowsePoolsLink label="Find a pool that can pay" />
                </div>
              </div>
            </section>
          ) : (
            <div className="rounded-3xl border-2 border-accent/20 bg-surface p-5 shadow-[var(--shadow-pop-edge)] sm:p-7">
              <p className="mb-1 font-display text-xs font-bold uppercase tracking-wide text-accent-strong">
                Ready when you are
              </p>
              <h2 className="mb-2 font-display text-2xl font-extrabold leading-tight">
                {isChallenge ? "Take the dare" : "Join this pool"}
              </h2>
              <p className="mb-4 text-sm text-muted">
                {pool.bountyModel === 2
                  ? `Stake the ${formatUsdc(pool.entryFee)} USDC entry, hit the goal during the period, and your stake comes back plus a share of what everyone who didn't show up left behind.`
                  : isDocGoal
                    ? `Pay the ${formatUsdc(pool.entryFee)} USDC entry fee, then upload your record. The bounty pays out the moment your document is verified.`
                    : `Pay the ${formatUsdc(pool.entryFee)} USDC entry fee, hit the goal during the period, and the bounty pays out the moment your result is verified.`}
              </p>
              {participantCount === 0 ? (
                <p className="mb-4 rounded-xl border border-dashed border-accent/30 bg-accent/20 p-3 text-sm text-accent-deep">
                  No one has joined yet, be the first.
                </p>
              ) : null}
              <JoinPool
                poolId={pool.id}
                entryFee={pool.entryFee}
                alreadyJoined={joined}
              />
            </div>
          )}

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
        <Card>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <SpotterMascot
              pose="nature"
              size="sm"
              className="mx-auto sm:mx-0"
            />
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold">
                This pool has settled
              </h2>
              <p className="mt-1 text-sm text-muted">
                I paid the verified achievers. Nothing more happens on this pool
                - the next payout is on a pool that is still open.
              </p>
              <BrowsePoolsLink />
            </div>
          </div>
        </Card>
      )}

      {phase !== "settled" && canPay ? (
        isChallenge ? (
          // A challenge pool's top-up must carry the sweep disclosure: miss the
          // goal and sweep() returns the whole pot to the challenger, not
          // pro-rata to contributors. ChallengeContribute is the funnel that
          // states that before anyone can add - never the bare FundPool, which
          // tops up with no disclosure. Re-sharing a challenge uses its private
          // /c/<token> invite link (handed out at creation and on the landing),
          // never this gated pool URL, so no share row is offered here.
          <ChallengeContribute poolId={pool.id} potUsd={formatUsdc(pool.balance)} />
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

  // Two-column on desktop: the workbench (actions + detailed receipt) on the
  // left, the sticky claim rail on the right. On mobile the rail becomes a
  // fixed bottom sheet, so the page reserves room beneath the content for it.
  return (
    <div className={showRail ? "pb-24 lg:pb-0" : undefined}>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8">
        {workbench}
        {showRail ? <ClaimRail state={railState} /> : null}
      </div>
    </div>
  );
}
