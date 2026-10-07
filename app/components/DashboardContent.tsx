"use client";

// The signed-in home. Joined pools lead - for a fresh account that means the
// Browse-pools empty state is the first thing on screen, not a zero balance.
// The streak card renders only when wearable data can exist, and the balance
// card sits below the goal content because funding is secondary to progress.
//
// Two silences fixed here. The connect button used to swallow its failure into
// console.error, so a provider outage read as a dead button; it now says what
// went wrong, and when the provider is the problem it stops offering a connect
// flow that cannot succeed. And a verified claim waiting on its pool period
// used to look identical to one still being judged, with nothing on screen
// saying when the money arrives - the chain already knows, so the card says it.
//
// The /api/wearable/* reads on this page are wallet-gated: a streak and a week
// of sleep hours are health data, and a wallet address is public, so knowing
// the address is not permission to read them. Every read here is cachedOnly:
// opening the dashboard never opens a wallet. Email and passkey logins, and a
// wallet login that proved itself once this session, hold a Dynamic session
// token, so the data simply loads. Without one, the card says the data is
// locked and offers the quiet Verify wallet action (one explained signature,
// once per session), never an empty card that reads as "you have no wearable".

import { SignInLoadingCard } from "@/components/night/SlowSignInNotice";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useShell, useShellBrowserClosed } from "@/lib/shell-hooks";
import { SHELL_ALLOW_HEALTH } from "@/lib/shell-pairing";
import BalanceCard from "@/components/BalanceCard";
import ClaimPayout from "@/components/ClaimPayout";
import RefundClaim from "@/components/RefundClaim";
import Countdown from "@/components/Countdown";
import SignInPanel from "@/components/SignInPanel";
import SpotterSays from "@/components/SpotterSays";
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  FOCUS_RING,
  Skeleton,
  TEXT_LINK,
  buttonClasses,
} from "@/components/ui";
import {
  CARD_TITLE,
  EmptyCard,
  FIELD_HINT,
  Notice,
  PAGE_LEAD,
  PAGE_TITLE,
  PerchedHeader,
  QUIET_ACTION,
  SECTION_TITLE,
  type NoticeTone,
} from "@/components/night/kit";
import type { NightPose } from "@/lib/spotter-poses";
import {
  displayGoalSpec,
  evidenceTypeOf,
  fetchGoalId,
  fetchProofTier,
  formatUsdc,
  type ParticipantInfo,
  type PoolInfo,
} from "@/lib/contract";
import { dashboardDeferredLead, type ProofTier } from "@/lib/proof-tier";
import {
  fetchProviderState,
  providerAwaitingFirstSync,
  providerMetricUnavailable,
  providerAuthReason,
  providerConnected,
  providerDownReason,
  providerQueryKey,
} from "@/lib/wearable-provider";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useWalletAuth } from "@/lib/useWalletAuth";
import VerifyWalletAction from "@/components/VerifyWalletAction";
import { PopupBlockedError, startWearableLink } from "@/lib/wearable-connect";
import PhonePairPanel, { type PhoneSteps } from "@/components/PhonePairPanel";
import { resultLabel } from "@/lib/participant-status";
import { missConfirmByMs, missGraceSeconds } from "@/lib/miss-grace";
import { missRulePool } from "@/lib/miss-rule";
import {
  runApprovalLine,
  type RunApprovalLine,
  type RunApprovalStatus,
} from "@/lib/game/verdict";
import { parseStatus } from "@/lib/world/approval-client";
import RunBoard, { runNightsQuery, verifyActionOwner } from "@/components/game/RunBoard";
import CharacterCard from "@/components/game/CharacterCard";
import { useCharacter } from "@/lib/game/useCharacter";
import { MY_RUNS_KEY, fetchMyRuns } from "@/lib/game/useLobby";
import DisconnectDeviceButton from "@/components/DisconnectDeviceButton";
import {
  fetchProviderOptions,
  isProviderId,
  PhoneLinkRequiredError,
  providerOptionsQueryKey,
  whoopReturnMessage,
  type WearableProviderId,
} from "@/lib/wearable-connect";
import {
  authBlockReason,
  cachedOnlyRequester,
  fetchWithWalletAuth,
  type WalletAuthRequester,
} from "@/lib/client-auth";

interface JoinedPool {
  pool: PoolInfo;
  participant: ParticipantInfo;
}


/** A verified result on a pool that has not settled yet: the money is owed and
 *  is waiting on the clock, nothing else. The chain alone says this - the
 *  participant's verdict is recorded and the pool is unsettled - so no ledger
 *  read is needed to tell someone when to come back. */
function deferredUntil(entry: JoinedPool): bigint | null {
  const { pool, participant } = entry;
  if (pool.settled) return null;
  if (!participant.resultRecorded || !participant.verdict) return null;
  // A run that can record a miss settles only after MISS_GRACE_HOURS, once
  // every player's wearable had time to sync (lib/miss-grace.ts).
  return missRulePool(pool).ok
    ? pool.periodEnd + BigInt(missGraceSeconds())
    : pool.periodEnd;
}

function formatSettleMoment(periodEnd: bigint): string {
  return new Date(Number(periodEnd) * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The deferred-claim note. A recorded-but-unsettled claim is owed money and is
 *  waiting on the clock - but a self-reported claim must NEVER read "Verified"
 *  here. The tier comes from the on-chain HealthVerdict facet (fetchProofTier);
 *  when it is unknown (registry unset or a read miss) the copy stays neutral and
 *  never claims verification. */
function DeferredNote({
  tier,
  settlesAt,
}: {
  tier: ProofTier | null;
  settlesAt: bigint;
}) {
  const { lead, tone, selfReported } = dashboardDeferredLead(tier);
  return (
    <Notice tone={tone === "warning" ? "limit" : "ok"} role="status">
      {lead} SPOTTER settles this {selfReported ? "self-reported claim " : ""}
      at <b>{formatSettleMoment(settlesAt)}</b> (
      <Countdown periodStart={0n} periodEnd={settlesAt} />). Nothing for you to do.
    </Notice>
  );
}

/** A run whose payout waits on (or just got) the player's World ID OK. The
 *  run page owns the ask itself; this line says it is there and links to it. */
function ApprovalRunNote({
  line,
  poolId,
}: {
  line: RunApprovalLine;
  poolId: bigint;
}) {
  const tone: NoticeTone =
    line.tone === "warning" ? "limit" : line.tone === "accent" ? "ok" : "info";
  return (
    <Notice
      tone={tone}
      role="status"
      action={
        line.openRun ? (
          <Link href={`/pools/${poolId.toString()}`} className={QUIET_ACTION}>
            Open this challenge
          </Link>
        ) : undefined
      }
    >
      {line.text}
    </Notice>
  );
}

/** Where one run's World ID payout confirmation stands, and whether SPOTTER
 *  read a hit on it that nobody confirmed yet. */
interface RunApproval {
  status: RunApprovalStatus;
  hit: boolean;
}

/** Where each open run's World ID payout confirmation stands, keyed by pool
 *  id. The status route is public and machine-only; a failed read is
 *  "unknown", never silence. */
async function fetchRunApprovals(
  address: `0x${string}`,
  runs: readonly JoinedPool[],
): Promise<Map<string, RunApproval>> {
  const map = new Map<string, RunApproval>();
  await Promise.all(
    runs.map(async ({ pool }) => {
      const key = pool.id.toString();
      try {
        const goalId = await fetchGoalId(pool.id, address);
        const response = await fetch(
          `/api/agent/approval/status?goalId=${encodeURIComponent(goalId)}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          map.set(key, { status: "unknown", hit: false });
          return;
        }
        const parsed = parseStatus(await response.json().catch(() => null));
        map.set(key, { status: parsed?.status ?? "unknown", hit: parsed?.hit === true });
      } catch {
        map.set(key, { status: "unknown", hit: false });
      }
    }),
  );
  return map;
}

/** The dashboard's hit line input: set only when SPOTTER read a hit on this
 *  run that is not confirmed, with the latest moment it can be confirmed on a
 *  run that can record a miss (lib/miss-grace.ts). */
function hitOf(
  approval: RunApproval | undefined,
  pool: PoolInfo,
): { confirmByMs: number | null } | undefined {
  if (approval?.hit !== true) return undefined;
  return { confirmByMs: missRulePool(pool).ok ? missConfirmByMs(pool.periodEnd) : null };
}

function finalApprovalOf(
  status: RunApprovalStatus | undefined,
): "approved" | "declined" | "expired" | "cancelled" | null {
  return status === "approved" ||
    status === "declined" ||
    status === "expired" ||
    status === "cancelled"
    ? status
    : null;
}

function ConnectButton({
  address,
  label = "Connect health data",
  secondary = false,
  provider,
}: {
  address: `0x${string}`;
  label?: string;
  secondary?: boolean;
  /** Link this provider specifically. Omitted, the wallet's choice is used. */
  provider?: WearableProviderId;
}) {
  // The failure used to go to console.error only, which made the button look
  // dead to anyone whose connect flow could not start. It is a money-adjacent
  // path (no wearable, no verification, no payout), so it reports.
  const [error, setError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  // A provider that can only be linked on a phone is not an error state: the
  // user did nothing wrong and a retry cannot help. It gets its own calm panel
  // rather than the red ErrorNote, which would read as a fault.
  const [phoneSteps, setPhoneSteps] = useState<PhoneSteps | null>(null);
  const [opening, setOpening] = useState(false);
  const requestAuth = useWalletAuth();
  // Inside the iPhone app Junction's page opens in the Safari sheet; when it
  // closes, re-read the device so the cards flip without a tap.
  const queryClient = useQueryClient();
  useShellBrowserClosed(() => {
    void queryClient.invalidateQueries({ queryKey: ["wearable-providers"] });
    void queryClient.invalidateQueries({ queryKey: ["wearable-progress"] });
  });

  return (
    <>
      <Button
        type="button"
        variant={secondary ? "secondary" : "primary"}
        size="sm"
        aria-busy={opening}
        disabled={opening}
        onClick={() => {
          setError(null);
          setFallbackUrl(null);
          setPhoneSteps(null);
          setOpening(true);
          void startWearableLink(address, requestAuth, provider)
            .catch((err: unknown) => {
              if (err instanceof PopupBlockedError) {
                // The URL is good; the browser just refused the auto-open.
                // Offer a link the user taps directly - a real gesture nav is
                // never blocked.
                setFallbackUrl(err.linkUrl);
                return;
              }
              if (err instanceof PhoneLinkRequiredError) {
                setPhoneSteps({
                  instructions: err.instructions,
                  pairing: err.pairing,
                  installUrl: err.installUrl,
                });
                return;
              }
              setError(
                err instanceof Error
                  ? err.message
                  : "Could not open the connect flow.",
              );
            })
            .finally(() => setOpening(false));
        }}
        className="mt-3"
      >
        {opening ? "Opening the connect flow" : label}
      </Button>
      {phoneSteps !== null ? (
        <div className="mt-3">
          <PhonePairPanel steps={phoneSteps} />
        </div>
      ) : null}
      {error !== null ? (
        <div className="mt-3">
          <ErrorNote
            title="Could not start the connect flow"
            detail={`${error} Nothing was connected and nothing was charged.`}
            onRetry={() => setError(null)}
          />
        </div>
      ) : null}
      {fallbackUrl !== null ? (
        <div className="mt-3">
          <a
            href={fallbackUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses()}
          >
            Open the wearable connect page
          </a>
          <p className={FIELD_HINT}>
            Your browser blocked the auto-open. Tap to continue to the secure
            connect page. Nothing is charged.
          </p>
        </div>
      ) : null}
    </>
  );
}

/**
 * The device choice, shown only when this deployment actually offers more than
 * one way in. With a single configured provider there is no decision to make,
 * and a picker with one option is just a second button that says the same
 * thing as the first.
 *
 * Each provider says what it can and cannot do, because the two are not
 * interchangeable: Junction covers several brands but is a paid intermediary,
 * and WHOOP is first-party but only WHOOP. A person choosing between them is
 * entitled to know that before they hand over health data.
 */
function ProviderChoice({ address }: { address: `0x${string}` }) {
  const requestAuth = cachedOnlyRequester(useWalletAuth());
  const { data, isPending } = useQuery({
    queryKey: providerOptionsQueryKey(address),
    queryFn: () => fetchProviderOptions(address, requestAuth),
    staleTime: 60_000,
  });

  const offered = (data?.providers ?? []).filter((option) => option.configured);

  // While the read is in flight `offered` is empty, and painting the single
  // button here would swap one affordance for two a moment later.
  if (isPending) return <Skeleton className="mt-3 h-24" />;

  // One provider is not a choice, and a picker with one option is just a
  // second button saying what the first one says. The plain button IS this
  // branch - rendering it separately alongside the picker is what produced
  // three connect buttons on a two-provider deployment.
  if (offered.length < 2) return <ConnectButton address={address} provider={offered[0]?.id} />;

  // The call to action is per provider because the verbs are not the same:
  // Junction and WHOOP connect an account here and now, while a phone-based
  // provider only sets your wallet up and finishes on the device. Interpolating
  // one word into "Connect X" would promise something that does not happen.
  const copy: Record<
    WearableProviderId,
    { blurb: string; cta: string; reconnect: string }
  > = {
    junction: {
      blurb: "WHOOP, Oura, Fitbit or Garmin, through Junction.",
      cta: "Connect Junction",
      reconnect: "Reconnect Junction",
    },
    whoop: {
      blurb:
        "WHOOP only, connected directly. Reads your sleep and workouts, nothing else. No step count.",
      cta: "Connect WHOOP",
      reconnect: "Reconnect WHOOP",
    },
    apple: {
      blurb: "Apple Watch and iPhone. Sleep and workouts, read on your phone.",
      // "Pair", like the WHOOP card: the tap hands the iPhone a one-time code
      // and the pairing card below flips to paired on its own once the app
      // has synced. Nothing is typed when the site is open on the iPhone.
      cta: "Pair my Apple Watch",
      reconnect: "Re-pair my Apple Watch",
    },
  };

  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {offered.map((option) => (
        <div
          key={option.id}
          className="rounded-control bg-fill-quiet p-3.5 text-[0.9375rem] shadow-[inset_0_0_0_1px_var(--border-strong)]"
        >
          {/* flex-wrap and min-w-0 so a longer provider name and its badge
              stack instead of overflowing at 390px. */}
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 font-semibold text-foreground">
              {option.label}
            </p>
            {option.connected ? <Badge tone="accent">Connected</Badge> : null}
          </div>
          <p className="m-0 mt-1 text-[0.8125rem] leading-[1.45] text-haze">{copy[option.id].blurb}</p>
          <ConnectButton
            address={address}
            provider={option.id}
            label={
              option.connected
                ? copy[option.id].reconnect
                : copy[option.id].cta
            }
            secondary
          />
        </div>
      ))}
    </div>
  );
}

const STREAK_LOCKED = "Your streak is private to your wallet.";

function StreakCard({
  address,
  pool,
  verifyAction = true,
}: {
  address: `0x${string}`;
  pool?: PoolInfo;
  /** Whether a locked streak offers the Verify wallet button. Off when an
   *  earlier locked card on the page already carries it. */
  verifyAction?: boolean;
}) {
  const requestAuth = cachedOnlyRequester(useWalletAuth());
  const inShell = useShell();
  const healthQuery = useQuery({
    queryKey: providerQueryKey(address, pool?.id),
    queryFn: () => fetchProviderState(address, requestAuth, pool),
    retry: false,
  });

  const state = healthQuery.data;
  const downReason = providerDownReason(state);
  const authReason = providerAuthReason(state);
  const progress = state?.kind === "ok" ? state.progress : null;

  return (
    <Card>
      <h2 className={CARD_TITLE}>Your streak</h2>
      {healthQuery.isLoading ? (
        <div className="mt-3 [&>*+*]:mt-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
      ) : downReason !== null ? (
        // No connect button here on purpose: while the provider is refusing
        // us, the connect call fails too, so offering it is a loop with no
        // exit. Document-verified pools still work, so point at those.
        <>
          <Notice tone="limit" className="mt-3">
            {downReason} Connecting a device would not change it, so there is
            nothing for you to do here right now.
          </Notice>
          <Link
            href="/pools"
            className={`mt-3 ${buttonClasses({ variant: "secondary", size: "sm" })}`}
          >
            Find a goal you can still prove
          </Link>
        </>
      ) : authReason !== null ? (
        // Locked, not empty. Offering the connect flow here would tell someone
        // with a linked device to link it again. Verifying re-reads every
        // wallet-gated card on the page (lib/session-proof.ts), the synced-data
        // card below included, so a page shows the button once.
        verifyAction ? (
          <VerifyWalletAction lead={STREAK_LOCKED} className="mt-3" />
        ) : (
          <p className="m-0 mt-3 text-[0.9375rem] leading-[1.45] text-muted">
            {STREAK_LOCKED} The Verify wallet button above unlocks it too.
          </p>
        )
      ) : !providerConnected(state) ? (
        <>
          <p className="m-0 mt-2 text-[0.9375rem] text-muted">
            No wearable connected yet. Connect one to start tracking your streak
            toward your goal.
          </p>
          {/* Owns the connect affordance in both shapes: the picker when this
              deployment offers a choice, a single button when it does not.
              Naming brands here instead would promise Oura and Garmin on a
              deployment that only has WHOOP configured. */}
          <ProviderChoice address={address} />
        </>
      ) : providerMetricUnavailable(state) ? (
        // Syncing, but this device does not produce a sleep score. A delay
        // message here would be advice that can never come true. Apple
        // publishes no score at all, for any Watch: it sends sleep hours and
        // sleep efficiency, and the line says which to pick instead.
        <>
          <Notice tone="limit" className="mt-3">
            {progress?.provider === "apple"
              ? "Your Apple Watch is syncing. It sends hours of sleep and sleep efficiency, not a sleep score, so there is no sleep-score streak to show here. Pick a challenge scored on hours of sleep or sleep efficiency and this fills in."
              : "Your device is syncing, and it does not report a sleep score, so there is no streak to show here. That is the hardware, not a delay. Connect a device that scores your sleep and this fills in."}
          </Notice>
          <ProviderChoice address={address} />
          <ConnectButton
            address={address}
            label="Connect a different device"
            secondary
          />
        </>
      ) : providerAwaitingFirstSync(state) ? (
        // Linked and working, with nothing delivered yet. Rendering the streak
        // here would show a zero, which reads as "you missed every night" about
        // somebody whose device simply has not uploaded. Every new user passes
        // through this state.
        <>
          <Notice tone="info" className="mt-3">
            {progress?.provider === "apple"
              ? inShell
                ? `Your iPhone is paired and has not sent anything yet. ${SHELL_ALLOW_HEALTH}, or wait for its next background sync. `
                : "Your iPhone is paired and has not sent anything yet. Open the GoHealthMe app on your iPhone, or wait for its next background sync. "
              : "Your device is connected and has not sent anything yet. The first sync usually lands within a few minutes. "}
            SPOTTER will not check this goal until the data is here, so nothing
            is charged while you wait.
          </Notice>
          <ConnectButton
            address={address}
            label="Connect a different device"
            secondary
          />
        </>
      ) : (
        <div className="mt-3">
          {/* The streak count is the one big figure on this card, in Figtree
           *  like every number. SPOTTER speaks to it in his caption box only:
           *  the page already has its one pose. */}
          <p className="num m-0 text-[3rem] font-semibold leading-none tracking-[-0.03em] text-foreground">
            {progress?.streakDays ?? 0}
            <span className="text-lg font-medium tracking-normal text-muted">
              {progress?.targetDays !== null && progress?.targetDays !== undefined
                ? ` of ${progress.targetDays} days`
                : " days"}
            </span>
          </p>
          <p className="m-0 mt-2 text-[0.9375rem] text-haze">
            {progress?.metric ?? "Verified streak"}
            {progress?.lastSync !== null && progress?.lastSync !== undefined
              ? `. Last sync ${progress.lastSync}`
              : ""}
          </p>
          <div className="mt-3">
            {(progress?.streakDays ?? 0) > 0 ? (
              <SpotterSays surface="dashboard-header" state="streak-nudge" bare />
            ) : (
              <SpotterSays surface="dashboard-empty" state="empty" bare />
            )}
          </div>
          <ConnectButton
            address={address}
            label="Connect / switch provider"
            secondary
          />
          <DisconnectDeviceButton address={address} />
        </div>
      )}
    </Card>
  );
}

interface RecentData {
  connected: boolean;
  /** Which integration answered, so the card can say where the data came from. */
  provider?: WearableProviderId | null;
  sleep: Array<{ date: string; score: number | null; hours: number | null }>;
  activity: Array<{ date: string; steps: number | null }>;
}

/** Per-day sleep and steps are health data, so the read is signed. A 401 is
 *  reported as its own state: the card is hidden rather than shown empty, and
 *  the streak card above carries the one call to action. */
type RecentDataResult =
  | { kind: "data"; data: RecentData }
  | { kind: "auth-required"; reason: string };

async function fetchRecentData(
  address: `0x${string}`,
  requestAuth: WalletAuthRequester,
): Promise<RecentDataResult> {
  const sent = await fetchWithWalletAuth(
    `/api/wearable/data?address=${address}`,
    undefined,
    requestAuth,
  );
  if (sent.response.status === 401) {
    return {
      kind: "auth-required",
      reason:
        authBlockReason(sent.auth) ??
        "Sign with your wallet to see your synced data.",
    };
  }
  if (!sent.response.ok) {
    throw new Error(`Recent data feed responded ${sent.response.status}.`);
  }
  const j = (await sent.response.json()) as Partial<RecentData>;
  return {
    kind: "data",
    data: {
      connected: j.connected === true,
      // Dropped here before, so the card below always credited Junction -
      // including for WHOOP reads, which WHOOP's brand rules require be
      // attributed to WHOOP.
      provider: isProviderId(j.provider) ? j.provider : null,
      sleep: Array.isArray(j.sleep) ? j.sleep : [],
      activity: Array.isArray(j.activity) ? j.activity : [],
    },
  };
}

/**
 * Where the numbers on the card came from, named per provider.
 *
 * A Record rather than a ternary so a new provider is a compile error instead
 * of a silent wrong credit, and because WHOOP's brand rules require data
 * sourced from them to say so. Null falls back to a generic line that is true
 * of every provider rather than guessing at one.
 */
const SOURCE_NOTE: Record<WearableProviderId, string> = {
  whoop: "Data by WHOOP, pulled live.",
  junction: "Pulled live from your linked device via Junction.",
  // Not "pulled": Apple is the one provider we cannot pull from. These numbers
  // were computed on the phone and sent here, in the background on the
  // phone's own schedule or whenever the app is opened, and saying so is the
  // honest way to explain a day that has not landed yet.
  apple: "Sent from your iPhone by the GoHealthMe app, on its own and whenever you open it.",
};

/** Shows the latest few days pulled from the linked provider (demo proof). */
function RecentDataCard({ address }: { address: `0x${string}` }) {
  const requestAuth = cachedOnlyRequester(useWalletAuth());
  const recentQuery = useQuery({
    queryKey: ["wearable-data", address],
    queryFn: () => fetchRecentData(address, requestAuth),
    retry: false,
  });

  const result = recentQuery.data;
  const data = result?.kind === "data" ? result.data : undefined;
  if (
    recentQuery.isLoading ||
    data === undefined ||
    !data.connected ||
    (data.sleep.length === 0 && data.activity.length === 0)
  ) {
    return null; // only render once a provider is linked and data exists
  }

  return (
    <Card>
      <h2 className={CARD_TITLE}>Latest synced data</h2>
      <p className="m-0 mt-1 text-[0.9375rem] text-haze">
        {data.provider === null || data.provider === undefined
          ? "Pulled live from your linked device."
          : SOURCE_NOTE[data.provider]}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {data.sleep.length > 0 && (
          <div>
            <h3 className="m-0 text-[0.9375rem] font-semibold text-muted">Sleep</h3>
            <ul className="num m-0 mt-2 list-none divide-y divide-edge p-0 text-[0.9375rem]">
              {data.sleep.slice(0, 7).map((d) => (
                <li key={`s-${d.date}`} className="flex justify-between gap-3 py-1.5">
                  <span className="text-haze">{d.date}</span>
                  <span className="font-semibold text-foreground">
                    {d.hours !== null ? `${d.hours}h` : "No data"}
                    {d.score !== null ? (
                      <span className="font-normal text-haze">, score {d.score}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.activity.length > 0 && (
          <div>
            <h3 className="m-0 text-[0.9375rem] font-semibold text-muted">Steps</h3>
            <ul className="num m-0 mt-2 list-none divide-y divide-edge p-0 text-[0.9375rem]">
              {data.activity.slice(0, 7).map((d) => (
                <li key={`a-${d.date}`} className="flex justify-between gap-3 py-1.5">
                  <span className="text-haze">{d.date}</span>
                  <span className="font-semibold text-foreground">
                    {d.steps !== null ? d.steps.toLocaleString() : "No data"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * What WHOOP's redirect left behind in the URL.
 *
 * The OAuth flow takes over the tab and drops the user back here, so without
 * this the page would look exactly the same whether they connected, declined,
 * or hit a failure - and a person who just clicked through a consent screen
 * has no way to tell which. Declining is worded as the ordinary choice it is,
 * not as an error.
 *
 * The parameter is cleared once shown, so a refresh or a shared URL does not
 * replay a stale outcome.
 */
function WhoopReturnNote({ liveConnected }: { liveConnected: boolean | null }) {
  const [note, setNote] = useState<ReturnType<typeof whoopReturnMessage>>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const status = url.searchParams.get("whoop");
    if (status === null) return;
    // Reading the URL is the "subscribe to an external system" case the rule
    // exempts, and it is genuinely once-per-mount: the parameter is consumed
    // and removed in the same tick, so there is no cascade to guard against.
    // A lazy useState initializer cannot be used instead - it would run during
    // the server render, where there is no window, and then disagree with the
    // client on first paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNote(whoopReturnMessage(status));
    url.searchParams.delete("whoop");
    window.history.replaceState(null, "", url.toString());
  }, []);

  if (note === null) return null;

  // The redirect that sets this URL param is a hop through WHOOP's own
  // domain, and by the time it lands back here the session on THIS tab may
  // no longer be the wallet that started the flow - a stale param left over
  // from a previous sign-in, a link reopened after switching accounts, or
  // (as happened once in testing) a connect driven outside a live session
  // entirely. A leftover "connected" is not proof that the CURRENT wallet is
  // connected, and saying "your sleep now backs your claims" to whoever
  // happens to be signed in when that param is read would misstate whose
  // claims are actually backed. liveConnected is the dashboard's own
  // provider-status query for the address on screen right now; the
  // reassuring "ok" variant renders only when that query agrees.
  if (note.tone === "ok" && liveConnected !== true) return null;

  // A failed connection is an error and renders as one, through the same
  // ErrorNote every other failure on this page uses. Inventing a second error
  // style here would make the same severity look like two different things.
  if (note.tone === "error") {
    return <ErrorNote title="WHOOP was not connected" detail={note.message} />;
  }

  return (
    <Notice tone={note.tone === "ok" ? "ok" : "info"} role="status">
      {note.message}
    </Notice>
  );
}

export default function DashboardContent() {
  const { ready, authenticated, address } = useEmbeddedWallet();
  const requestAuth = cachedOnlyRequester(useWalletAuth());
  const character = useCharacter();

  const joinedQuery = useQuery({
    queryKey: [MY_RUNS_KEY, address],
    queryFn: () => {
      if (address === null) throw new Error("No wallet address.");
      return fetchMyRuns(address);
    },
    enabled: address !== null,
  });

  // The streak card only makes sense when wearable data can exist: either a
  // provider is already linked or the user has skin in a wearable pool. For
  // everyone else (document goals, fresh accounts) it is noise. The key
  // matches StreakCard's no-pool query exactly so the cache serves both
  // instead of fetching the same endpoint twice per dashboard load.
  const connectionQuery = useQuery({
    queryKey: providerQueryKey(address),
    queryFn: () => {
      if (address === null) throw new Error("No wallet address.");
      return fetchProviderState(address, requestAuth);
    },
    enabled: address !== null,
    retry: false,
  });

  // Trust tier per deferred (recorded-but-unsettled) claim, read from the
  // on-chain HealthVerdict facet so a self-reported claim can never render as
  // "Verified" on its settling card. Only the deferred subset is read.
  const deferredEntries = (joinedQuery.data ?? []).filter(
    (entry) => deferredUntil(entry) !== null,
  );
  const deferredKey = deferredEntries
    .map((entry) => entry.pool.id.toString())
    .join(",");
  const deferredTierQuery = useQuery({
    queryKey: ["deferred-proof-tier", address, deferredKey],
    enabled: address !== null && deferredEntries.length > 0,
    queryFn: async (): Promise<Map<string, ProofTier>> => {
      const map = new Map<string, ProofTier>();
      await Promise.all(
        deferredEntries.map(async (entry) => {
          try {
            if (address === null) return;
            const goalId = await fetchGoalId(entry.pool.id, address);
            map.set(entry.pool.id.toString(), await fetchProofTier(goalId));
          } catch {
            map.set(entry.pool.id.toString(), "unknown");
          }
        }),
      );
      return map;
    },
  });

  // World ID payout confirmation per run that has nothing recorded yet: open
  // runs show whether SPOTTER is waiting on the player, finished runs say
  // "payout not confirmed" instead of "no proof was submitted".
  const approvalRuns = (joinedQuery.data ?? []).filter(
    ({ pool, participant }) => !pool.cancelled && !participant.resultRecorded,
  );
  const approvalKey = approvalRuns.map(({ pool }) => pool.id.toString()).join(",");
  const approvalQuery = useQuery({
    queryKey: ["run-approvals", address, approvalKey],
    enabled: address !== null && approvalRuns.length > 0,
    queryFn: () => {
      if (address === null) throw new Error("No wallet address.");
      return fetchRunApprovals(address, approvalRuns);
    },
    // A pending ask expires in about 90 seconds; keep the line honest.
    refetchInterval: 15_000,
  });

  // The nights read of every open wearable challenge, in page order: the same
  // cache entries the boards render from (one fetch each, not two). A locked
  // page offers Verify wallet once, in the first locked card, because one tap
  // re-reads every card; this is how the page knows which card that is.
  const openWearableRuns = (joinedQuery.data ?? []).filter(
    ({ pool }) =>
      !pool.settled && !pool.cancelled && evidenceTypeOf(pool.goalSpec) === "wearable",
  );
  const boardReads = useQueries({
    queries:
      address === null
        ? []
        : openWearableRuns.map(({ pool }) => runNightsQuery(address, pool, requestAuth)),
  });

  if (!ready) {
    return (
      <MyRunsFrame pose="detective">
        <SignInLoadingCard label="Loading your challenges">
          <LoadingLines />
        </SignInLoadingCard>
      </MyRunsFrame>
    );
  }

  if (!authenticated || address === null) {
    // The email-first panel is the default path (we make the wallet); an
    // external wallet is the deliberate second choice inside it. Replacing the
    // bare login() button here means a first-time visitor never has to guess
    // what "Sign in" will pop up.
    return (
      <MyRunsFrame
        pose="wave"
        lead="Sign in to see your challenges, your nights and your payouts. Base Sepolia test USDC."
      >
        <SignInPanel surface="card" />
      </MyRunsFrame>
    );
  }

  const wearableConnected = providerConnected(connectionQuery.data);
  const runs = joinedQuery.data ?? [];
  // An unsettled run is on the board; a settled or cancelled one is a
  // result line with whatever is left to do on it.
  const wearableRun = openWearableRuns[0];
  const openRuns = runs.filter(({ pool }) => !pool.settled && !pool.cancelled);
  const finishedRuns = runs.filter(({ pool }) => pool.settled || pool.cancelled);

  // The general streak card earns its place only when no live wearable run
  // already shows the nights on its own board.
  const streakShown =
    wearableRun === undefined &&
    (wearableConnected || providerAuthReason(connectionQuery.data) !== null);
  // Which locked card carries the one Verify wallet button. Every other locked
  // card says its data is locked and points at it. With nothing locked, no
  // card is told to drop a button, so a read this page has not seen yet can
  // never leave a card locked with no way in.
  const verifyOwner = verifyActionOwner([
    ...openWearableRuns.map(({ pool }, i) => ({
      id: `board:${pool.id.toString()}`,
      state: boardReads[i]?.data,
    })),
    ...(streakShown ? [{ id: "streak", state: connectionQuery.data }] : []),
  ]);
  const offersVerify = (id: string) => verifyOwner === null || verifyOwner === id;

  // The one otter on the page: a run board carries its own scene, so when a
  // live run leads the page the header stands no second pose; otherwise
  // SPOTTER stands on the first card, in the pose that fits what it says.
  const headerPose: NightPose | null = joinedQuery.isLoading
    ? "detective"
    : joinedQuery.isError
      ? "thinking"
      : runs.length === 0
        ? "meditate"
        : openRuns.length > 0
          ? null
          : "thumbsup";

  const firstCard = joinedQuery.isLoading ? (
    <LoadingCard label="Reading your challenges from Base Sepolia" />
  ) : joinedQuery.isError ? (
    <Card>
      <ErrorNote
        title="Could not read your challenges"
        detail="I could not read your challenges from Base Sepolia just now. Nothing changed on your side."
        retryLabel="Read my challenges again"
        onRetry={() => void joinedQuery.refetch()}
      />
    </Card>
  ) : runs.length === 0 ? (
    <EmptyCard
      title="You are not in a challenge yet"
      detail="Pick a challenge and put money on yourself, or start one with a friend. Your nights show up here."
      action={
        <Link href="/pools" className={buttonClasses({ size: "sm" })}>
          Find a challenge
        </Link>
      }
    />
  ) : (
    <CharacterCard view={character} variant="strip" />
  );

  // /challenges left the nav (2026-09-27); this is one of its two ways in.
  const friendsLink = (
    <p className="m-0 mt-2">
      <Link href="/challenges" className={TEXT_LINK}>
        Challenges with friends
      </Link>
    </p>
  );

  return (
    <div className="[&>*+*]:mt-8">
      {headerPose !== null ? (
        <PerchedHeader title="My challenges" lead={MY_RUNS_LEAD} below={friendsLink} pose={headerPose}>
          {firstCard}
        </PerchedHeader>
      ) : (
        <div className="[&>*+*]:mt-5">
          <header>
            <h1 className={PAGE_TITLE}>My challenges</h1>
            <p className={PAGE_LEAD}>{MY_RUNS_LEAD}</p>
            {friendsLink}
          </header>
          {firstCard}
        </div>
      )}

      {/* A settled win is CREDITED on-chain but not in the wallet until the
       *  winner withdraws, so the claim comes right after the header: it
       *  renders only when the chain says money is owed. */}
      <ClaimPayout address={address} />

      {/* Says what WHOOP's redirect just did, since the OAuth flow takes over
       *  the tab and otherwise returns the player to an unchanged page. */}
      <WhoopReturnNote
        liveConnected={
          connectionQuery.data === undefined ? null : wearableConnected
        }
      />

      {runs.length > 0 && !joinedQuery.isLoading && !joinedQuery.isError ? (
        <>
          {openRuns.map((entry) => {
            const settlesAt = deferredUntil(entry);
            const approval = approvalQuery.data?.get(entry.pool.id.toString());
            const approvalLine = runApprovalLine(
              approval?.status ?? "none",
              {
                settled: entry.pool.settled,
                cancelled: entry.pool.cancelled,
                resultRecorded: entry.participant.resultRecorded,
              },
              hitOf(approval, entry.pool),
            );
            return (
              <div key={entry.pool.id.toString()} className="[&>*+*]:mt-3">
                <RunBoard
                  pool={entry.pool}
                  address={address}
                  showLink
                  verifyAction={offersVerify(`board:${entry.pool.id.toString()}`)}
                />
                {approvalLine !== null ? (
                  <ApprovalRunNote line={approvalLine} poolId={entry.pool.id} />
                ) : null}
                {settlesAt !== null ? (
                  <DeferredNote
                    tier={deferredTierQuery.data?.get(entry.pool.id.toString()) ?? null}
                    settlesAt={settlesAt}
                  />
                ) : null}
              </div>
            );
          })}

          {finishedRuns.length > 0 ? (
            <section aria-labelledby="finished-runs" className="[&>*+*]:mt-3">
              <h2 id="finished-runs" className={SECTION_TITLE}>
                Completed challenges
              </h2>
              {finishedRuns.map((entry) => {
                const { pool, participant } = entry;
                const approval = approvalQuery.data?.get(pool.id.toString());
                const result = resultLabel(
                  pool,
                  participant,
                  finalApprovalOf(approval?.status),
                  approval?.hit === true,
                );
                return (
                  <FinishedRunRow
                    key={pool.id.toString()}
                    pool={pool}
                    result={result}
                    refund={
                      pool.cancelled && !participant.refunded ? (
                        <RefundClaim poolId={pool.id} entryFee={pool.entryFee} address={address} />
                      ) : null
                    }
                  />
                );
              })}
            </section>
          ) : null}
        </>
      ) : null}

      {streakShown ? (
        <StreakCard address={address} verifyAction={offersVerify("streak")} />
      ) : null}
      <RecentDataCard address={address} />
      <BalanceCard address={address} />
    </div>
  );
}

export const MY_RUNS_LEAD = "Every challenge you are in, night by night, and what each one paid.";

/** A finished run: its goal, the result the chain recorded, what is left in
 *  it, and the refund when it was cancelled. */
export function FinishedRunRow({
  pool,
  result,
  refund,
}: {
  pool: PoolInfo;
  result: { text: string; tone: "accent" | "muted" | "warning" };
  refund?: ReactNode;
}) {
  return (
    <Card variant="flat" padding="none" className="px-4 py-3.5">
      <Link
        href={`/pools/${pool.id.toString()}`}
        className={`-mx-2 -my-1.5 block rounded-control px-2 py-1.5 no-underline hover:bg-fill-quiet ${FOCUS_RING}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="m-0 min-w-[12rem] flex-1 break-words text-base font-semibold leading-snug text-foreground">
            {displayGoalSpec(pool.goalSpec)}
          </h3>
          <Badge tone={result.tone}>{result.text}</Badge>
        </div>
        <p className="num m-0 mt-1.5 text-[0.9375rem] text-haze">
          {/* After settle this is what was NOT paid out; calling it the prize
              read as if the player who hit won nothing. */}
          Left in the pot <span className={`font-semibold ${pool.balance > 0n ? "text-gold" : "text-dusk"}`}>{formatUsdc(pool.balance)}</span>{" "}
          test USDC
        </p>
      </Link>
      {refund !== null && refund !== undefined ? <div className="mt-3">{refund}</div> : null}
    </Card>
  );
}

/** The page frame for the states before any run is on screen. */
export function MyRunsFrame({
  pose,
  lead = MY_RUNS_LEAD,
  children,
}: {
  pose: NightPose;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <PerchedHeader title="My challenges" lead={lead} pose={pose}>
      {children}
    </PerchedHeader>
  );
}

/** The loading card's three lines, on their own for SignInLoadingCard. */
function LoadingLines() {
  return (
    <>
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-3/4" />
    </>
  );
}

export function LoadingCard({ label }: { label: string }) {
  return (
    <Card aria-busy="true">
      <p className="sr-only" role="status">
        {label}
      </p>
      <LoadingLines />
    </Card>
  );
}
