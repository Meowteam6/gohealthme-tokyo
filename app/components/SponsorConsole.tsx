"use client";

// The sponsor console. A sponsor signs in, creates and funds health-goal pools,
// and sees what their USDC bought — in aggregate only. Three things govern it:
//
//   1. Reuse, not reinvention: pool creation runs through the existing
//      CreatePool form and top-ups through the existing FundPool component, both
//      unchanged. This file only adds the console shell, the sponsor's own-pool
//      filter, and the privacy-safe outcome view. Presentation is the warm-light
//      "gold" reskin; the data reads below are the originals.
//   2. k-anonymity floor (lib/sponsor-metrics): every outcome figure — per pool
//      and across the portfolio — is withheld unless it derives from at least
//      five participants. Sponsor capital (balances, the sponsor's own funding)
//      is always shown; it is not participant data.
//   3. No participant identity leaves the chain read: on-chain events are
//      reduced to counts and USDC sums keyed by pool id (lib/sponsor-data), and
//      no participant wallet or handle is ever rendered next to a health label.
//
// LEGAL-GATED and deliberately kept OUT of the copy here: any insurer /
// UnitedHealth "pays for behavior -> fewer claims" ROI framing, and any HIPAA /
// covered-entity claim. Those change the regulatory posture of the product and
// are held for legal review, not written into console UI.

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import CreatePool from "@/components/CreatePool";
import SponsorPoolOutcome from "@/components/SponsorPoolOutcome";
import SignInGate from "@/components/SignInGate";
import SceneHeader from "@/components/SceneHeader";
import { Icon, type IconName } from "@/components/SponsorIcons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Money,
  PoolCardSkeleton,
} from "@/components/ui";
import {
  ContractNotConfiguredError,
  fetchPools,
  formatUsdc,
  type PoolInfo,
} from "@/lib/contract";
import { toPoolAggregate, type PoolEventTotals } from "@/lib/sponsor-data";
import {
  portfolioAggregate,
  portfolioDisplay,
  type PoolAggregate,
} from "@/lib/sponsor-metrics";
import { useEmbeddedWallet } from "@/lib/wallet";

interface ConsoleData {
  pools: PoolInfo[];
  /** Null when the outcome scan could not be read. The pools still render;
   *  every outcome figure says it could not be read instead of reading as
   *  zero or "Fewer than 5". */
  totals: Record<string, PoolEventTotals> | null;
  asOfSeconds: bigint;
}

interface SerializedTotals {
  joined: number;
  completions: number;
  paidUsdc: string;
  toppedUpUsdc: string;
}

async function fetchOutcomeTotals(): Promise<Record<string, PoolEventTotals> | null> {
  try {
    const res = await fetch("/api/sponsor/outcomes");
    if (!res.ok) return null;
    const body = (await res.json()) as { totals?: Record<string, SerializedTotals> };
    if (body.totals === undefined) return null;
    const totals: Record<string, PoolEventTotals> = {};
    for (const [poolId, t] of Object.entries(body.totals)) {
      totals[poolId] = {
        joined: t.joined,
        completions: t.completions,
        paidUsdc: BigInt(t.paidUsdc),
        toppedUpUsdc: BigInt(t.toppedUpUsdc),
      };
    }
    return totals;
  } catch {
    return null;
  }
}

function OutcomesUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="status"
      className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-foreground/85"
    >
      <p className="font-semibold">Outcomes could not be read right now.</p>
      <p className="mt-1 text-muted">
        Your pools and their balances are below. Joins, completions and payouts
        show again once the chain answers.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 inline-flex min-h-11 items-center font-semibold text-accent-deep underline underline-offset-4"
      >
        Try again
      </button>
    </div>
  );
}

/** A withheld count reads as "Fewer than 5", never as a misleading exact zero. */
function CountValue({ value }: { value: number | null }) {
  return <>{value !== null ? value.toLocaleString("en-US") : "Fewer than 5"}</>;
}

/** A withheld money total reads as held, never as a false zero. */
function MoneyValue({ usd }: { usd: string | null }) {
  return usd !== null ? (
    <Money usd={usd} />
  ) : (
    <span className="text-muted">Held</span>
  );
}

// A single candy stat tile. The icon chip carries the only tone; the figure
// itself renders through Money/CountValue with no colour adjective, per the
// honest-core rule. Gold is never used here — these are static, at-rest totals,
// and gold is reserved for money in motion.
function StatTile({
  icon,
  chip,
  label,
  children,
}: {
  icon: IconName;
  chip: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-3xl border-2 border-edge bg-surface p-4 shadow-[var(--shadow-pop-edge)]">
      <span
        className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${chip}`}
      >
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <div>
        <p className="text-xs font-medium text-muted">{label}</p>
        <p className="mt-0.5 font-display text-lg font-extrabold tracking-tight sm:text-xl">
          {children}
        </p>
      </div>
    </div>
  );
}

function PortfolioSummary({
  aggregates,
  outcomesOk,
  onRetry,
}: {
  aggregates: PoolAggregate[];
  outcomesOk: boolean;
  onRetry: () => void;
}) {
  const totals = useMemo(() => portfolioAggregate(aggregates), [aggregates]);
  const d = useMemo(() => portfolioDisplay(totals), [totals]);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Your pools at a <span className="text-accent-deep">glance</span>
        </h2>
        <Badge tone="muted">
          {d.poolCount} {d.poolCount === 1 ? "pool" : "pools"}
        </Badge>
      </div>

      {!outcomesOk ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile
              icon="vault"
              chip="bg-accent/12 text-accent-deep"
              label="In your pools"
            >
              <Money usd={formatUsdc(d.totalBalanceUsdc)} />
            </StatTile>
          </div>
          <OutcomesUnavailable onRetry={onRetry} />
        </div>
      ) : (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile
          icon="vault"
          chip="bg-accent/12 text-accent-deep"
          label="In your pools"
        >
          <Money usd={formatUsdc(d.totalBalanceUsdc)} />
        </StatTile>
        {/* Top-ups only: the create-time seed emits no PoolFunded event, and
            top-ups from anyone (a dare backer included) are counted. Named for
            what it is until lib/sponsor-data reads the seed and the funder. */}
        <StatTile
          icon="coins"
          chip="bg-accent/12 text-accent-deep"
          label="Top-ups, any funder"
        >
          <Money usd={formatUsdc(d.totalToppedUpUsdc)} />
        </StatTile>
        <StatTile
          icon="payout"
          chip="bg-accent/12 text-accent-deep"
          label="Paid to achievers"
        >
          <MoneyValue
            usd={d.totalPaidUsdc !== null ? formatUsdc(d.totalPaidUsdc) : null}
          />
        </StatTile>
        <StatTile
          icon="users"
          chip="bg-secondary text-secondary-foreground"
          label="Participants"
        >
          <CountValue value={d.totalJoined} />
        </StatTile>
        <StatTile
          icon="trophy"
          chip="bg-secondary text-secondary-foreground"
          label="Goal completions"
        >
          <CountValue value={d.totalCompletions} />
        </StatTile>
      </div>
      )}
    </section>
  );
}

// The privacy promise, made a proud feature instead of fine print, and kept
// to what /privacy says: wearable goals are checked on our server against a
// daily summary; only document goals go to the Chainlink enclave. No number
// lives on this band, so no honest-core primitive is needed here.
const PRIVACY_POINTS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "lock",
    title: "Checked, then dropped",
    body: "Wearable goals are checked on our server against a daily summary, never raw samples. Document goals are read inside a Chainlink enclave.",
  },
  {
    icon: "eye",
    title: "Verdict only",
    body: "One word goes on chain and to you: paid, or not yet. No steps, no sleep hours, no heart rate ever reaches the chain or this console.",
  },
  {
    icon: "fingerprint",
    title: "k-anonymous, always",
    body: "Cohort numbers read as “Fewer than 5” until a pool is big enough that no figure can point at one person.",
  },
];

function PrivacyFeature() {
  return (
    <section className="overflow-hidden rounded-3xl bg-accent-deep px-5 py-8 text-white sm:px-9 sm:py-10">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold">
            <Icon name="shield" className="h-4 w-4" />
            The promise, not the fine print
          </span>
          <h2 className="mt-4 font-display text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
            Your money is public.
            <br />
            Their health data never is.
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/80 sm:text-base">
            You always see what you funded and what got paid, in aggregate —
            never a participant&apos;s actual steps, sleep, or vitals. That line
            does not move for anyone.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {PRIVACY_POINTS.map((point) => (
            <div
              key={point.title}
              className="rounded-2xl bg-white/[0.08] p-4 backdrop-blur-sm"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
                <Icon name={point.icon} className="h-4 w-4" />
              </span>
              <p className="mt-3 font-display text-sm font-bold">
                {point.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-white/75">
                {point.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function SponsorConsole() {
  const { ready, authenticated, address } = useEmbeddedWallet();
  const [showCreate, setShowCreate] = useState(false);

  // Address-independent: the whole board plus its event totals in one snapshot,
  // then filtered to the signed-in sponsor's own pools below. Keeping the query
  // key stable lets it share cache across sign-ins and matches the pools page's
  // 45s poll so the phase split and balances stay honest while the tab is open.
  const consoleQuery = useQuery<ConsoleData>({
    queryKey: ["sponsor-console"],
    queryFn: async () => {
      // Outcome totals come from the server route: the historical log scan
      // cannot run from the browser (Arc's public RPCs prune history and cap
      // getLogs), so it runs server-side against the archival ARC_RPC_URL and
      // returns bigints as strings, which we parse back here.
      // A failed pools read is the page's error; a failed outcome read only
      // blanks the outcome figures (null), never zeros them.
      const [pools, totals] = await Promise.all([
        fetchPools(),
        fetchOutcomeTotals(),
      ]);
      return {
        pools,
        totals,
        asOfSeconds: BigInt(Math.floor(Date.now() / 1000)),
      };
    },
    refetchInterval: 45_000,
    enabled: authenticated && address !== null,
  });

  const myPools = useMemo(() => {
    if (consoleQuery.data === undefined || address === null) return [];
    const mine = address.toLowerCase();
    return consoleQuery.data.pools.filter(
      (pool) => pool.creator.toLowerCase() === mine,
    );
  }, [consoleQuery.data, address]);

  const outcomeTotals = consoleQuery.data?.totals;
  const outcomesOk = outcomeTotals !== null && outcomeTotals !== undefined;

  const aggregates = useMemo(
    () =>
      myPools.map((pool) =>
        toPoolAggregate(pool, consoleQuery.data?.totals?.[pool.id.toString()]),
      ),
    [myPools, consoleQuery.data],
  );

  const hero = (
    <SceneHeader
      title="Sponsor console"
      subtitle="Put USDC on a health goal, top it up as it fills, and watch exactly what it buys. Every outcome below is aggregate only, and nobody ever sees a participant's health data."
      eyebrow="Fund the goal"
      pose="spotter-detective.png"
      poseAlt="SPOTTER the otter, inspecting the ledger through a magnifying glass"
      spotterLine="I hold the bag, not your business. I check each goal and hand out one word: paid, or not yet."
    >
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Badge tone="warning">Base Sepolia · testnet · play money</Badge>
        <Link
          href="/pools"
          className="inline-flex items-center gap-1 text-sm font-semibold text-accent-deep underline decoration-accent/40 decoration-2 underline-offset-4 hover:decoration-accent"
        >
          Browse all pools
          <Icon name="arrow" className="h-4 w-4" />
        </Link>
      </div>
    </SceneHeader>
  );

  // The big candy "create a pool" call to action. Collapsed it is a proud
  // invitation; expanded it hands off to the unchanged CreatePool form.
  const createPanel = showCreate ? (
    <Card pop>
      <CreatePool />
      <button
        type="button"
        onClick={() => setShowCreate(false)}
        className="mt-4 min-h-11 text-sm font-medium text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Hide the form
      </button>
    </Card>
  ) : (
    <Card
      pop
      className="flex flex-col items-start gap-4 bg-dot-grid sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <h2 className="font-display text-xl font-bold tracking-tight sm:text-2xl">
          Fund a new goal
        </h2>
        <p className="mt-1 max-w-md text-sm leading-relaxed text-muted">
          Name the behavior, set the reward, and drop in testnet USDC. The
          pool holds it, and SPOTTER pays the people who hit the goal when the
          run settles.
        </p>
      </div>
      <Button
        variant="primary"
        pop
        onClick={() => setShowCreate(true)}
        className="shrink-0"
      >
        Create a pool
        <Icon name="arrow" className="h-5 w-5" />
      </Button>
    </Card>
  );

  if (!ready) {
    return (
      <div className="space-y-8">
        {hero}
        <div className="grid gap-4 sm:grid-cols-2">
          <PoolCardSkeleton />
          <PoolCardSkeleton />
        </div>
      </div>
    );
  }

  if (!authenticated || address === null) {
    return (
      <div className="space-y-8">
        {hero}
        <EmptyState
          title="Sign in to run a pool"
          detail="Creating and funding a bounty pulls USDC from your wallet, so the console opens once you sign in. Your pools and their aggregate outcomes live here."
          action={
            <SignInGate note="Sign in to run a pool.">
              {(openSignIn) => (
                <Button variant="primary" pop onClick={openSignIn}>
                  Sign in
                </Button>
              )}
            </SignInGate>
          }
        />
        <PrivacyFeature />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {hero}

      {createPanel}

      <PrivacyFeature />

      {consoleQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <PoolCardSkeleton />
          <PoolCardSkeleton />
        </div>
      ) : consoleQuery.isError ? (
        <ErrorNote
          title="Could not load your pools"
          detail={
            consoleQuery.error instanceof ContractNotConfiguredError
              ? "Runs are off on this build, so there are no pools to show."
              : "Base Sepolia did not answer. Your pools are safe on chain; try again in a moment."
          }
          onRetry={() => {
            void consoleQuery.refetch();
          }}
        />
      ) : myPools.length === 0 ? (
        <EmptyState
          title="You have not funded a pool yet"
          detail="Create your first bounty pool and it will show up here with its aggregate outcomes as people join and get verified."
        />
      ) : (
        <>
          <PortfolioSummary
            aggregates={aggregates}
            outcomesOk={outcomesOk}
            onRetry={() => {
              void consoleQuery.refetch();
            }}
          />
          <section id="pools" className="space-y-5">
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Your <span className="text-accent-deep">pools</span>
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {myPools.map((pool, i) => (
                <SponsorPoolOutcome
                  key={pool.id.toString()}
                  pool={pool}
                  aggregate={aggregates[i]}
                  outcomesOk={outcomesOk}
                  nowSeconds={consoleQuery.data?.asOfSeconds ?? 0n}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
