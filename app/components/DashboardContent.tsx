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
// The two /api/wearable/* reads on this page are signature-gated: a streak and
// a week of sleep hours are health data, and a wallet address is public, so
// knowing the address is not permission to read them. This is the one surface
// where a signature prompt on load is the right call - it is the signed-in
// user's own dashboard, asking for their own data - and one signature covers
// every read for the session. A refused prompt shows the reason and a way to
// try again, never an empty card that reads as "you have no wearable".

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  EmptyState,
  ErrorNote,
  Skeleton,
} from "@/components/ui";
import {
  displayGoalSpec,
  evidenceTypeOf,
  fetchGoalId,
  fetchParticipant,
  fetchPools,
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
import { PopupBlockedError, startWearableLink } from "@/lib/wearable-connect";
import { resultLabel } from "@/lib/participant-status";
import {
  disconnectWearable,
  fetchProviderOptions,
  isProviderId,
  PhoneLinkRequiredError,
  providerOptionsQueryKey,
  whoopReturnMessage,
  type WearableProviderId,
} from "@/lib/wearable-connect";
import {
  authBlockReason,
  fetchWithWalletAuth,
  type WalletAuthRequester,
} from "@/lib/client-auth";

interface JoinedPool {
  pool: PoolInfo;
  participant: ParticipantInfo;
}

async function fetchJoinedPools(address: `0x${string}`): Promise<JoinedPool[]> {
  const pools = await fetchPools();
  const participants = await Promise.all(
    pools.map((pool) => fetchParticipant(pool.id, address)),
  );
  return pools
    .map((pool, i) => ({ pool, participant: participants[i] }))
    .filter((entry) => entry.participant.joined);
}

/** A verified result on a pool that has not settled yet: the money is owed and
 *  is waiting on the clock, nothing else. The chain alone says this - the
 *  participant's verdict is recorded and the pool is unsettled - so no ledger
 *  read is needed to tell someone when to come back. */
function deferredUntil(entry: JoinedPool): bigint | null {
  const { pool, participant } = entry;
  if (pool.settled) return null;
  if (!participant.resultRecorded || !participant.verdict) return null;
  return pool.periodEnd;
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
  const cls =
    tone === "warning"
      ? "border-warning/40 bg-warning/10 text-warning"
      : "border-accent/30 bg-accent/20 text-accent-deep";
  return (
    <p className={`mt-3 rounded-xl border border-dashed p-3 text-sm ${cls}`}>
      {lead} SPOTTER settles this {selfReported ? "self-reported claim " : ""}
      when the pool period ends at {formatSettleMoment(settlesAt)} (
      <Countdown periodStart={0n} periodEnd={settlesAt} />) - no human involved,
      nothing for you to do.
    </p>
  );
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
  const [phoneSteps, setPhoneSteps] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const requestAuth = useWalletAuth();

  return (
    <>
      <Button
        type="button"
        variant={secondary ? "secondary" : "primary"}
        pop
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
                setPhoneSteps(err.instructions);
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
        <p
          role="status"
          aria-live="polite"
          className="mt-3 rounded-xl border border-accent/30 bg-accent/15 p-4 text-sm text-accent-deep"
        >
          {phoneSteps}
        </p>
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
            className={`inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-5 py-2.5 font-display text-sm font-bold text-white shadow-[var(--shadow-pop)] transition-transform hover:translate-y-px hover:bg-accent-strong active:translate-y-[3px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
          >
            Open the wearable connect page
          </a>
          <p className="mt-2 text-xs text-muted">
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
  const requestAuth = useWalletAuth();
  const { data } = useQuery({
    queryKey: providerOptionsQueryKey(address),
    queryFn: () => fetchProviderOptions(address, requestAuth),
    staleTime: 60_000,
  });

  const offered = (data?.providers ?? []).filter((option) => option.configured);
  if (offered.length < 2) return null;

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
  };

  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {offered.map((option) => (
        <div
          key={option.id}
          className="rounded-xl border border-edge p-3 text-sm"
        >
          {/* flex-wrap and min-w-0 so a longer provider name and its badge
              stack instead of overflowing at 390px. */}
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 font-semibold text-foreground">
              {option.label}
            </p>
            {option.connected ? <Badge tone="accent">Connected</Badge> : null}
          </div>
          <p className="mt-1 text-muted">{copy[option.id].blurb}</p>
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

function StreakCard({
  address,
  pool,
}: {
  address: `0x${string}`;
  pool?: PoolInfo;
}) {
  const requestAuth = useWalletAuth();
  const queryClient = useQueryClient();
  const healthQuery = useQuery({
    queryKey: providerQueryKey(address, pool?.id),
    queryFn: () => fetchProviderState(address, requestAuth, pool),
    retry: false,
  });

  const state = healthQuery.data;
  const downReason = providerDownReason(state);
  const authReason = providerAuthReason(state);
  const progress = state?.kind === "ok" ? state.progress : null;

  /** Sign, then re-read every junction card on the page. This button is the
   *  only place to sign from, so refetching just this card would leave the
   *  synced-data card below it hidden until a reload. */
  const unlock = () => {
    void (async () => {
      await requestAuth({ refresh: true });
      // These are the CURRENT key prefixes. They were still the old
      // junction-* names after the routes were renamed, so signing did not
      // refetch anything and the button silently did nothing.
      await queryClient.invalidateQueries({ queryKey: ["wearable-progress"] });
      await queryClient.invalidateQueries({ queryKey: ["wearable-data"] });
      await queryClient.invalidateQueries({ queryKey: ["wearable-providers"] });
    })();
  };

  return (
    <Card pop className="bg-dot-grid">
      <h2 className="font-display text-lg font-semibold">Streak progress</h2>
      {healthQuery.isLoading ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
      ) : downReason !== null ? (
        // No connect button here on purpose: while the provider is refusing
        // us, the connect call fails too, so offering it is a loop with no
        // exit. Document-verified pools still work, so point at those.
        <>
          <p className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-foreground/80">
            {downReason} Connecting a device would not change it, so there is
            nothing for you to do here right now.
          </p>
          <Link
            href="/pools"
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full border-2 border-edge bg-secondary px-5 py-2.5 font-display text-sm font-bold text-secondary-foreground transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Find a goal you can still prove
          </Link>
        </>
      ) : authReason !== null ? (
        // Locked, not empty. Offering the connect flow here would tell someone
        // with a linked device to link it again.
        <>
          <p className="mt-3 rounded-xl border border-accent/40 bg-accent/20 p-4 text-sm text-foreground/80">
            {authReason}
          </p>
          <Button type="button" pop onClick={unlock} className="mt-3">
            Sign and show my streak
          </Button>
        </>
      ) : !providerConnected(state) ? (
        <>
          <p className="mt-3 rounded-xl border border-dashed border-edge p-4 text-sm text-muted">
            No wearable connected yet. Link WHOOP, Oura, Fitbit or Garmin to
            start tracking your streak toward your goal.
          </p>
          {/* The picker renders nothing when only one provider is configured,
              and the plain button below is what that deployment shows. */}
          <ProviderChoice address={address} />
          <ConnectButton address={address} />
        </>
      ) : providerMetricUnavailable(state) ? (
        // Syncing, but this device does not produce a sleep score. A delay
        // message here would be advice that can never come true.
        <>
          <p className="mt-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-foreground/80">
            Your device is syncing, and it does not report a sleep score, so
            there is no streak to show here. That is the hardware, not a delay.
            Connect a device that scores your sleep and this fills in.
          </p>
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
          <p className="mt-3 rounded-xl border border-accent/30 bg-accent/15 p-4 text-sm text-accent-deep">
            Your device is connected and has not sent anything yet. The first
            sync usually lands within a few minutes. SPOTTER will not check this
            goal until the data is here, so nothing is charged while you wait.
          </p>
          <ConnectButton
            address={address}
            label="Connect a different device"
            secondary
          />
        </>
      ) : (
        <div className="mt-3">
          {/* The streak count is the dashboard's one hero moment, so SPOTTER
           *  speaks to it. An active streak gets a cheering, dry nudge; a count
           *  of zero has nothing to celebrate yet, so the bubble stays a dry
           *  empty-state line - never a loud one, which is reserved for a
           *  verified payout. */}
          <div className="mb-3">
            {(progress?.streakDays ?? 0) > 0 ? (
              <SpotterSays
                surface="dashboard-header"
                state="streak-nudge"
                pose="cheer"
              />
            ) : (
              <SpotterSays surface="dashboard-empty" state="empty" />
            )}
          </div>
          <p className="font-display text-4xl font-bold text-accent">
            {progress?.streakDays ?? 0}
            <span className="font-display text-lg font-semibold text-foreground">
              {progress?.targetDays !== null && progress?.targetDays !== undefined
                ? ` of ${progress.targetDays} days`
                : " days"}
            </span>
          </p>
          <p className="mt-1 text-sm text-muted">
            {progress?.metric ?? "Verified streak"}
            {progress?.lastSync !== null && progress?.lastSync !== undefined
              ? ` · last sync ${progress.lastSync}`
              : ""}
          </p>
          <ConnectButton
            address={address}
            label="Connect / switch provider"
            secondary
          />
          <DisconnectButton address={address} />
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
 * Unlinking a device.
 *
 * This existed as a route with no caller: a WHOOP user had no way to revoke
 * from inside the product, while the privacy page told them they could do it
 * from their dashboard. That is a dead end AND a false claim in a
 * compliance-facing document.
 *
 * Junction owns its own link, so the route answers 409 with the page to go to.
 * That is guidance rather than an error and renders as a calm note.
 */
function DisconnectButton({ address }: { address: `0x${string}` }) {
  const requestAuth = useWalletAuth();
  const queryClient = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={() => {
          setNote(null);
          setError(null);
          setBusy(true);
          void disconnectWearable(address, requestAuth)
            .then(async (guidance) => {
              setNote(guidance);
              if (guidance === null) {
                await queryClient.invalidateQueries({
                  queryKey: ["wearable-progress"],
                });
                await queryClient.invalidateQueries({
                  queryKey: ["wearable-data"],
                });
                await queryClient.invalidateQueries({
                  queryKey: ["wearable-providers"],
                });
              }
            })
            .catch((err: unknown) => {
              setError(
                err instanceof Error
                  ? err.message
                  : "Could not disconnect the device.",
              );
            })
            .finally(() => setBusy(false));
        }}
        className="mt-3"
      >
        {busy ? "Disconnecting" : "Disconnect this device"}
      </Button>
      {note !== null ? (
        <p
          role="status"
          className="mt-3 rounded-xl border border-edge bg-surface p-4 text-sm text-muted"
        >
          {note}
        </p>
      ) : null}
      {error !== null ? (
        <div className="mt-3">
          <ErrorNote
            title="Could not disconnect"
            detail={error}
            onRetry={() => setError(null)}
          />
        </div>
      ) : null}
    </>
  );
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
};

/** Shows the latest few days pulled from the linked provider (demo proof). */
function RecentDataCard({ address }: { address: `0x${string}` }) {
  const requestAuth = useWalletAuth();
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
      <h2 className="font-display text-lg font-semibold">Latest synced data</h2>
      <p className="mt-1 text-sm text-muted">
        {data.provider === null || data.provider === undefined
          ? "Pulled live from your linked device."
          : SOURCE_NOTE[data.provider]}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {data.sleep.length > 0 && (
          <div>
            <h3 className="font-display text-sm font-semibold text-muted">Sleep</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {data.sleep.slice(0, 7).map((d) => (
                <li key={`s-${d.date}`} className="flex justify-between">
                  <span className="text-muted">{d.date}</span>
                  <span className="font-medium">
                    {d.hours !== null ? `${d.hours}h` : "—"}
                    {d.score !== null ? ` · score ${d.score}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.activity.length > 0 && (
          <div>
            <h3 className="font-display text-sm font-semibold text-muted">Steps</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {data.activity.slice(0, 7).map((d) => (
                <li key={`a-${d.date}`} className="flex justify-between">
                  <span className="text-muted">{d.date}</span>
                  <span className="font-medium">
                    {d.steps !== null ? d.steps.toLocaleString() : "—"}
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
function WhoopReturnNote() {
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

  // A failed connection is an error and renders as one, through the same
  // ErrorNote every other failure on this page uses. Inventing a second error
  // style here would make the same severity look like two different things.
  if (note.tone === "error") {
    return <ErrorNote title="WHOOP was not connected" detail={note.message} />;
  }

  // Light emerald tint with deep-emerald text, not a translucent dark box:
  // bg-accent-deep at low opacity renders as sage grey on the cream theme and
  // puts bright emerald text near 1.6:1 contrast on it.
  const tone =
    note.tone === "ok"
      ? "border-accent/30 bg-accent/15 text-accent-deep"
      : "border-edge bg-surface text-muted";

  return (
    <p className={`rounded-xl border p-4 text-sm ${tone}`} role="status">
      {note.message}
    </p>
  );
}

export default function DashboardContent() {
  const { ready, authenticated, address } = useEmbeddedWallet();
  const requestAuth = useWalletAuth();

  const joinedQuery = useQuery({
    queryKey: ["joined-pools", address],
    queryFn: () => {
      if (address === null) throw new Error("No wallet address.");
      return fetchJoinedPools(address);
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

  if (!ready) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (!authenticated || address === null) {
    // The email-first panel is the default path (we make the wallet); an
    // external wallet is the deliberate second choice inside it. Replacing the
    // bare login() button here means a first-time visitor never has to guess
    // what "Sign in" will pop up.
    return (
      <div className="mx-auto max-w-md space-y-4">
        <div className="text-center">
          <p className="font-display text-lg font-semibold">
            Sign in to see your goals
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Your joined pools, streak progress, and payouts live here once you
            sign in.
          </p>
        </div>
        <SignInPanel />
      </div>
    );
  }

  const wearableConnected = providerConnected(connectionQuery.data);
  const wearablePool = (joinedQuery.data ?? []).find(
    ({ pool }) => evidenceTypeOf(pool.goalSpec) === "wearable",
  )?.pool;

  return (
    <div className="space-y-6">
      {/* A settled win is CREDITED on-chain but not in the wallet until the
       *  winner withdraws, so the claim card leads the page: it is the highest-
       *  value action here and renders only when the chain says money is owed. */}
      <ClaimPayout address={address} />

      {/* Says what WHOOP's redirect just did, since the OAuth flow takes over
       *  the tab and otherwise returns the user to an unchanged-looking page. */}
      <WhoopReturnNote />
      <section className="space-y-4">
        <h2 className="font-display text-lg font-semibold">Joined pools</h2>
        {joinedQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : joinedQuery.isError ? (
          <ErrorNote
            title="Could not load your pools"
            detail={
              joinedQuery.error instanceof Error
                ? joinedQuery.error.message
                : "Unknown error reading from Base Sepolia."
            }
            onRetry={() => {
              void joinedQuery.refetch();
            }}
          />
        ) : (joinedQuery.data ?? []).length === 0 ? (
          <EmptyState
            title="Nothing on the line yet"
            detail="Pick a goal with USDC staked on it. One wallet, one entry, and SPOTTER pays the moment you prove it."
            action={
              <Link
                href="/pools"
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-6 py-2.5 font-display text-sm font-bold text-white shadow-[var(--shadow-pop)] transition-transform hover:translate-y-px hover:bg-accent-strong active:translate-y-[3px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Browse pools
              </Link>
            }
          />
        ) : (
          (joinedQuery.data ?? []).map((entry) => {
            const { pool, participant } = entry;
            const result = resultLabel(pool, participant);
            const settlesAt = deferredUntil(entry);
            return (
              <div key={pool.id.toString()}>
              <Link
                href={`/pools/${pool.id.toString()}`}
                className="block rounded-3xl border border-edge bg-surface p-5 transition-colors hover:border-accent/50 sm:p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge>{pool.initiative}</Badge>
                  <Badge tone={result.tone}>{result.text}</Badge>
                </div>
                <h3 className="mt-3 font-display text-lg font-semibold leading-snug">
                  {displayGoalSpec(pool.goalSpec)}
                </h3>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
                  <span>
                    Reward pool{" "}
                    <span className="font-semibold text-accent">
                      {formatUsdc(pool.balance)} USDC
                    </span>
                  </span>
                  <Countdown
                    periodStart={pool.periodStart}
                    periodEnd={pool.periodEnd}
                  />
                </div>
                {settlesAt !== null ? (
                  <DeferredNote
                    tier={deferredTierQuery.data?.get(pool.id.toString()) ?? null}
                    settlesAt={settlesAt}
                  />
                ) : null}
              </Link>
              {pool.cancelled && !participant.refunded ? (
                <RefundClaim
                  poolId={pool.id}
                  entryFee={pool.entryFee}
                  address={address}
                />
              ) : null}
            </div>
            );
          })
        )}
      </section>

      {/* The locked case earns the card too: a wearable may well be linked
       *  and simply unreadable until the signature lands, and dropping the
       *  card would leave nowhere to sign from. */}
      {wearableConnected ||
      wearablePool !== undefined ||
      providerAuthReason(connectionQuery.data) !== null ? (
        <StreakCard address={address} pool={wearablePool} />
      ) : null}
      <RecentDataCard address={address} />
      <BalanceCard address={address} />
    </div>
  );
}
