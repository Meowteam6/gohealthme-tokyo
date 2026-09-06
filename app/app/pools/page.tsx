"use client";

// The pool list, ordered by what a visitor can act on: live pools lead
// (soonest-ending first, urgency sells), pools past their period but not yet
// settled sit behind them, settled history last. The phase split lives in
// lib/pool-lifecycle so this page, the pool detail, and goal matching can
// never disagree about which pools are joinable.
//
// Two things the phase split alone cannot say, both of which were lying to
// visitors, live in lib/pool-availability:
//   - An expired pool nobody joined is not "awaiting settlement". settle() has
//     nobody to pay, so it would sit under that heading forever promising a
//     payout that will never come. Participant counts come off the chain.
//   - A wearable goal cannot be verified while the wearable provider refuses
//     us, and its entry fee is real money paid up front. Those pools come out
//     of the joinable group for as long as the provider stays down; the state
//     is read from the junction route, never hard-coded to a pool id.

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import PoolCard from "@/components/PoolCard";
import SpotterSays from "@/components/SpotterSays";
import {
  Badge,
  ErrorNote,
  PoolCardSkeleton,
  TAP_TARGET,
} from "@/components/ui";
import { fetchParticipants, fetchPools, type PoolInfo } from "@/lib/contract";
import {
  groupPoolsByPhase,
  poolCanPay,
  type PoolPhase,
} from "@/lib/pool-lifecycle";
import {
  splitByVerifiability,
  splitExpiredPools,
} from "@/lib/pool-availability";
import {
  fetchProviderState,
  providerDownReason,
  providerQueryKey,
} from "@/lib/wearable-provider";
import { useEmbeddedWallet } from "@/lib/wallet";
import { hideDocumentPools } from "@/lib/pool-visibility";
import { useDocumentProofAvailable } from "@/lib/useProofStatus";
import { useWalletAuth } from "@/lib/useWalletAuth";

function PoolGrid({ pools, phase }: { pools: PoolInfo[]; phase: PoolPhase }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {pools.map((pool) => (
        <PoolCard key={pool.id.toString()} pool={pool} phase={phase} />
      ))}
    </div>
  );
}

// A warm SPOTTER-voiced label for each grouping. Kept to a single scannable
// line so the board reads at a glance - no engineering words (no "settle",
// no "settlement", no chain jargon) ever reach the visitor.
function SectionLabel({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "warning";
}) {
  return (
    <p
      className={`font-display text-sm font-bold uppercase tracking-wide ${
        tone === "warning" ? "text-warning" : "text-accent-strong"
      }`}
    >
      {children}
    </p>
  );
}

export default function PoolsPage() {
  const { address } = useEmbeddedWallet();
  const requestAuth = useWalletAuth();

  // The clock is read alongside the fetch, not during render, so grouping
  // stays pure and every card is classified against one snapshot. The query
  // client disables focus refetches, so a polling interval keeps the phase
  // split honest while the tab sits open across a pool's period end.
  const docAvailable = useDocumentProofAvailable();
  const poolsQuery = useQuery({
    queryKey: ["pools"],
    queryFn: async () => ({
      pools: await fetchPools(),
      asOfSeconds: BigInt(Math.floor(Date.now() / 1000)),
    }),
    refetchInterval: 45_000,
  });

  const grouped = useMemo(() => {
    if (poolsQuery.data === undefined) return null;
    // Drop pools that structurally cannot pay before grouping, so they never
    // reach the joinable list. Two such pools were live and sorted to the top
    // of the page advertising the largest bounties on it, which is the worst
    // possible thing to hand a first-time visitor: they would join, upload,
    // verify, and be paid nothing by a transaction that succeeds.
    // Challenge pools are private, person-aimed dares reached only by their
    // unguessable link. They must never appear on the public board even when
    // live and payable, so drop them here alongside the unpayable ones. The
    // signal is the immutable on-chain initiative, already on PoolInfo - never
    // the Supabase challenges row, which can be missing.
    const payable = poolsQuery.data.pools
      .filter(poolCanPay)
      .filter((pool) => pool.initiative !== "challenge");
    // While the document verifier is off, upload-floor pools are not offered.
    const { visible } = hideDocumentPools(payable, docAvailable);
    return groupPoolsByPhase(visible, poolsQuery.data.asOfSeconds);
  }, [poolsQuery.data, docAvailable]);
  const hiddenDocCount = useMemo(() => {
    if (poolsQuery.data === undefined || docAvailable) return 0;
    const live = groupPoolsByPhase(
      poolsQuery.data.pools.filter(poolCanPay),
      poolsQuery.data.asOfSeconds,
    ).live;
    return hideDocumentPools(live, false).hidden.length;
  }, [poolsQuery.data, docAvailable]);

  // Only expired pools need a head count: it is what separates "settlement
  // still has work to do here" from "this can never pay anyone". Live and
  // settled pools are unaffected, so the read stays small.
  const expiredIds = useMemo(
    () => (grouped?.expired ?? []).map((pool) => pool.id.toString()),
    [grouped],
  );

  const countsQuery = useQuery({
    queryKey: ["expired-participant-counts", expiredIds.join(",")],
    queryFn: async (): Promise<Record<string, number>> => {
      const counted = await Promise.all(
        expiredIds.map(async (poolId) => {
          const participants = await fetchParticipants(BigInt(poolId));
          return [poolId, participants.length] as const;
        }),
      );
      return Object.fromEntries(counted);
    },
    enabled: expiredIds.length > 0,
    staleTime: 5 * 60_000,
  });

  // Shares one query key with the dashboard and the pool page: same endpoint,
  // one request per address. Without a wallet there is nobody to ask about, so
  // the check stays disabled and nothing is held back on a guess.
  //
  // cachedOnly: browsing a list of pools is not a request to unlock private
  // data, so this never opens a wallet prompt. Unsigned reads report as "not
  // known", which leaves every goal on the board.
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
  const providerDown = providerDownReason(providerQuery.data);

  const liveSplit = splitByVerifiability(
    grouped?.live ?? [],
    providerDown !== null,
  );
  const expiredSplit = splitExpiredPools(
    grouped?.expired ?? [],
    (pool) => countsQuery.data?.[pool.id.toString()] ?? null,
  );

  return (
    <div className="space-y-6">
      {/* Hero: SPOTTER inviting you onto the board. Ported from the gold browse
          design - dot-grid candy panel, two-tone display headline, a deadpan
          SPOTTER dare, and the testnet play-money disclosure kept in plain
          sight (tan sticker, never gold - gold is only ever money in motion). */}
      <section className="relative overflow-hidden rounded-3xl border-2 border-edge bg-surface p-6 shadow-[var(--shadow-pop-edge)] sm:p-8">
        <div
          aria-hidden="true"
          className="bg-dot-grid pointer-events-none absolute inset-0 opacity-70"
        />
        <div className="relative flex flex-col items-start gap-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <p className="font-display text-xs font-bold uppercase tracking-widest text-accent-strong">
              Live pools
            </p>
            <h1 className="mt-2 font-display text-4xl font-extrabold leading-[1.05] text-balance sm:text-5xl">
              Find a goal <span className="text-accent">worth money.</span>
            </h1>
            <p className="mt-3 max-w-md text-pretty text-base leading-relaxed text-muted">
              Put a little down, hit your goal, and the pool pays you out. Miss
              it, and your stake helps pay whoever showed up.
            </p>

            <div className="mt-5 inline-flex items-center gap-2 rounded-full border-2 border-edge bg-secondary px-3.5 py-1.5 text-xs font-bold text-secondary-foreground">
              Testnet play money on Base Sepolia - practice cash, not real
              dollars. Yet.
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Badge tone="muted">Base Sepolia</Badge>
              <Link
                href="/challenge/new"
                className={`rounded-full border-2 border-[color:var(--coral-strong)]/40 bg-secondary font-display font-bold text-[color:var(--coral-strong)] hover:border-[color:var(--coral-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${TAP_TARGET}`}
              >
                Challenge a friend
              </Link>
              <Link
                href="/pools/create"
                className={`rounded-full bg-accent font-display font-bold text-white shadow-[var(--shadow-pop)] transition-transform hover:translate-y-px hover:bg-accent-strong active:translate-y-[3px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${TAP_TARGET}`}
              >
                Create pool
              </Link>
            </div>
          </div>

          <div className="relative flex shrink-0 flex-col items-center self-center">
            <div className="relative max-w-[13rem] rounded-2xl rounded-bl-sm border border-edge bg-surface px-4 py-3 shadow-sm">
              <p className="text-sm font-medium leading-snug text-foreground">
                Pick one, stake it, and prove me wrong. I&apos;ll be watching the
                wearables.
              </p>
              <span className="mt-1 block text-[11px] font-bold uppercase tracking-wide text-accent-strong">
                SPOTTER
              </span>
            </div>
            <div className="otter-float mt-1 h-40 w-40 sm:h-48 sm:w-48">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/spotter/spotter-point.png"
                alt="SPOTTER the otter pointing you toward a pool to join"
                className="h-full w-full object-contain drop-shadow-md"
              />
            </div>
          </div>
        </div>
      </section>

      {poolsQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <PoolCardSkeleton />
          <PoolCardSkeleton />
          <PoolCardSkeleton />
        </div>
      ) : poolsQuery.isError ? (
        <ErrorNote
          title="Could not load pools"
          detail={
            poolsQuery.error instanceof Error
              ? poolsQuery.error.message
              : "Unknown error reading from Base Sepolia."
          }
          onRetry={() => {
            void poolsQuery.refetch();
          }}
        />
      ) : grouped === null ||
        grouped.live.length + grouped.expired.length + grouped.settled.length ===
          0 ? (
        // "Quiet on the river": a lounging SPOTTER moment, not a bare message.
        <div className="flex flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-edge bg-secondary/40 px-6 py-12 text-center">
          <div className="otter-float h-28 w-28">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/spotter/spotter-lounging.png"
              alt="SPOTTER the otter floating on its back, taking it easy"
              className="h-full w-full object-contain drop-shadow-md"
            />
          </div>
          <div className="max-w-sm">
            <h3 className="font-display text-xl font-extrabold">
              Quiet on the river
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              No pools are running yet. Put the first goal on the board and
              SPOTTER will watch it for you.
            </p>
          </div>
          <Link
            href="/pools/create"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-5 py-3 font-display text-sm font-bold text-white shadow-[var(--shadow-pop)] transition-transform hover:translate-y-px hover:bg-accent-strong active:translate-y-[3px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Create the first pool
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            <SectionLabel>Jump in now</SectionLabel>
            {hiddenDocCount > 0 ? (
              <p className="text-xs text-muted">
                Document pools are paused while we build the verifier - only
                wearable goals are open to join right now.
              </p>
            ) : null}
            {liveSplit.verifiable.length === 0 ? (
              grouped.live.length === 0 ? (
                <div className="rounded-3xl border-2 border-dashed border-edge bg-secondary/40 px-5 py-8">
                  <SpotterSays surface="pools-empty" state="empty" size="md" />
                  <p className="mt-3 text-sm text-muted">
                    Nobody has put a goal on the board yet. Start one and be the
                    first in.
                  </p>
                </div>
              ) : (
                <p className="rounded-2xl border-2 border-warning/40 bg-warning/10 p-3 text-sm text-foreground/80">
                  Every live pool right now is a wearable goal, and SPOTTER
                  can&apos;t check those until the provider is back. Start a
                  document-verified pool and put a goal on the board.
                </p>
              )
            ) : (
              <PoolGrid pools={liveSplit.verifiable} phase="live" />
            )}
          </section>

          {providerDown !== null && liveSplit.unverifiable.length > 0 ? (
            <section className="space-y-3">
              <SectionLabel tone="warning">
                Wearables need a minute - not joinable yet
              </SectionLabel>
              <p className="rounded-2xl border-2 border-warning/40 bg-warning/10 p-3 text-sm text-foreground/80">
                {providerDown} The entry fee is real money, so these are held
                back until SPOTTER can check them again. Document-verified pools
                run through the confidential attester and are unaffected.
              </p>
              {/* Dimmed and moved out of the joinable group, but still
                  readable: the pool page repeats the reason and withholds the
                  join action there too. */}
              <div className="opacity-60">
                <PoolGrid pools={liveSplit.unverifiable} phase="live" />
              </div>
            </section>
          ) : null}

          {expiredSplit.awaitingSettlement.length > 0 ? (
            <section className="space-y-3">
              <SectionLabel>Time&apos;s up - SPOTTER&apos;s counting</SectionLabel>
              <p className="text-sm text-muted">
                The window closed. SPOTTER is working out who hit their goal and
                paying them out.
              </p>
              <PoolGrid
                pools={expiredSplit.awaitingSettlement}
                phase="expired"
              />
            </section>
          ) : null}

          {expiredSplit.closedEmpty.length > 0 ? (
            <section className="space-y-3">
              <SectionLabel>Quiet on the riverbank</SectionLabel>
              <p className="text-sm text-muted">
                Their window closed with nobody signed up, so there is no one for
                SPOTTER to pay. Nothing is pending here - they just sit on the
                riverbank as history.
              </p>
              <PoolGrid pools={expiredSplit.closedEmpty} phase="expired" />
            </section>
          ) : null}

          {grouped.settled.length > 0 ? (
            <section className="space-y-3">
              <SectionLabel>All wrapped up</SectionLabel>
              <PoolGrid pools={grouped.settled} phase="settled" />
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
