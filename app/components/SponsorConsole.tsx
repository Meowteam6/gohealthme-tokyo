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
import SignInPanel from "@/components/SignInPanel";
import { Icon, type IconName } from "@/components/SponsorIcons";
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Fine,
  Money,
  PoolCardSkeleton,
  TEXT_LINK,
} from "@/components/ui";
import {
  CARD_TITLE,
  EmptyCard,
  Notice,
  PerchedHeader,
  QUIET_ACTION,
  SECTION_TITLE,
} from "@/components/night/kit";
import type { NightPose } from "@/lib/spotter-poses";
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
    <Notice
      tone="limit"
      role="status"
      title="Outcomes could not be read right now"
      action={
        <button type="button" onClick={onRetry} className={QUIET_ACTION}>
          Read the outcomes again
        </button>
      }
    >
      Your runs and their balances are below. Joins, completions and payouts show
      again once the chain answers.
    </Notice>
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
    <span className="text-haze">Held</span>
  );
}

// One stat tile: a quiet icon, the label, and the figure in Figtree. Money
// renders through Money (gold, the only colour money gets); counts stay in
// the foreground with no colour adjective, per the honest-core rule.
function StatTile({
  icon,
  label,
  children,
}: {
  icon: IconName;
  /** Retired: the icon chip no longer carries a tone. */
  chip?: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border)]">
      <span className="inline-flex size-9 items-center justify-center rounded-control bg-surface-raised text-muted">
        <Icon name={icon} className="size-5" />
      </span>
      <div>
        <p className="text-[0.8125rem] text-haze">{label}</p>
        <p className="num mt-1 break-words text-[1.125rem] font-semibold leading-tight text-foreground sm:text-[1.25rem]">
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
    <section className="[&>*+*]:mt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={SECTION_TITLE}>Your runs at a glance</h2>
        <Badge tone="muted">
          {d.poolCount} {d.poolCount === 1 ? "run" : "runs"}
        </Badge>
      </div>

      {!outcomesOk ? (
        <div className="[&>*+*]:mt-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile
              icon="vault"
              chip="bg-accent/12 text-accent-deep"
              label="In your runs"
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
          label="In your runs"
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
          label="Paid to players who hit"
        >
          <MoneyValue
            usd={d.totalPaidUsdc !== null ? formatUsdc(d.totalPaidUsdc) : null}
          />
        </StatTile>
        <StatTile
          icon="users"
          chip="bg-secondary text-secondary-foreground"
          label="Players"
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
    <Card as="section" aria-labelledby="sponsor-promise" className="sm:px-8 sm:py-9">
      <div className="grid grid-cols-1 gap-8">
        <div>
          <span className="inline-flex items-center gap-2 rounded-tag bg-moonlight/10 px-3 py-1.5 text-[0.8125rem] font-semibold text-moonlight">
            <Icon name="shield" className="size-4" />
            The promise, not the fine print
          </span>
          <h2 id="sponsor-promise" className={`${SECTION_TITLE} mt-4`}>
            Your money is public.
            <br />
            Their health data never is.
          </h2>
          <p className="mt-3 max-w-xl text-[0.9375rem] leading-[1.5] text-muted">
            You always see what you funded and what got paid, in aggregate,
            never a player&apos;s actual steps, sleep or vitals. That line
            does not move for anyone.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {PRIVACY_POINTS.map((point) => (
            <div
              key={point.title}
              className="rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border)]"
            >
              <span className="inline-flex size-9 items-center justify-center rounded-control bg-surface-raised text-muted">
                <Icon name={point.icon} className="size-4" />
              </span>
              <p className="mt-3 text-base font-semibold text-foreground">{point.title}</p>
              <p className="mt-1 text-[0.875rem] leading-[1.5] text-muted">{point.body}</p>
            </div>
          ))}
        </div>
      </div>
    </Card>
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

  // The page frame: SPOTTER stands on the first card, whichever card leads
  // the page in its current state (docs/DESIGN.md, one pose per viewport).
  const frame = (pose: NightPose, first: ReactNode) => (
    <PerchedHeader
      title="Sponsor console"
      lead="Put USDC on a health goal, top it up as it fills, and watch what it buys. Every outcome here is aggregate only, and nobody ever sees a player's health data."
      pose={pose}
      below={
        <div className="mt-3 flex flex-wrap items-center gap-x-4">
          <Fine>Base Sepolia test USDC, beta.</Fine>
          <Link href="/pools" className={`${TEXT_LINK} text-sm`}>
            See all open runs
          </Link>
        </div>
      }
    >
      {first}
    </PerchedHeader>
  );

  // The big candy "create a pool" call to action. Collapsed it is a proud
  // invitation; expanded it hands off to the unchanged CreatePool form.
  const createPanel = showCreate ? (
    <div className="[&>*+*]:mt-3">
      <CreatePool embedded />
      <button type="button" onClick={() => setShowCreate(false)} className={QUIET_ACTION}>
        Hide the form
      </button>
    </div>
  ) : (
    <Card className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 className={CARD_TITLE}>Fund a new goal</h2>
        <p className="mt-1.5 max-w-md text-[0.9375rem] leading-[1.5] text-muted">
          Name the goal, set the reward and put in test USDC. The run&apos;s
          contract holds it and pays the players who hit the goal when the run
          settles.
        </p>
      </div>
      <Button onClick={() => setShowCreate(true)} className="w-full shrink-0 sm:w-auto">
        Create a run
      </Button>
    </Card>
  );

  if (!ready) {
    return (
      <div className="[&>*+*]:mt-8">
        {frame(
          "detective",
          <Card aria-busy="true">
            <p className="sr-only" role="status">
              Loading the sponsor console
            </p>
            <PoolCardSkeleton />
          </Card>,
        )}
      </div>
    );
  }

  if (!authenticated || address === null) {
    return (
      <div className="[&>*+*]:mt-8">
        {frame(
          "wave",
          <div className="[&>*+*]:mt-3">
            <SignInPanel surface="card" />
            <Fine>
              Creating and funding a run pulls USDC from your wallet, so the console
              opens once you sign in. Your runs and their aggregate outcomes live here.
            </Fine>
          </div>,
        )}
        <PrivacyFeature />
      </div>
    );
  }

  return (
    <div className="[&>*+*]:mt-10">
      {frame("detective", createPanel)}

      <PrivacyFeature />

      {consoleQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <PoolCardSkeleton />
          <PoolCardSkeleton />
        </div>
      ) : consoleQuery.isError ? (
        <ErrorNote
          title="Could not load your runs"
          detail={
            consoleQuery.error instanceof ContractNotConfiguredError
              ? "Runs are off on this build, so there are no runs to show."
              : "Base Sepolia did not answer. Your runs are safe on chain; try again in a moment."
          }
          retryLabel="Read my runs again"
          onRetry={() => {
            void consoleQuery.refetch();
          }}
        />
      ) : myPools.length === 0 ? (
        showCreate ? null : (
          <EmptyCard
            title="You have not funded a run yet"
            detail="Create your first funded run and it shows up here with its aggregate outcomes as players join and get verified."
            action={
              <Button size="sm" onClick={() => setShowCreate(true)}>
                Create a run
              </Button>
            }
          />
        )
      ) : (
        <>
          <PortfolioSummary
            aggregates={aggregates}
            outcomesOk={outcomesOk}
            onRetry={() => {
              void consoleQuery.refetch();
            }}
          />
          <section id="pools" className="[&>*+*]:mt-5">
            <h2 className={SECTION_TITLE}>Your runs</h2>
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
