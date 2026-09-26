"use client";

// The run card in the hero (docs/DESIGN.md, "RunCard (hero)"): a real open run
// read from chain, its exact stake, pot and players, the money sentence from
// lib/commitment.ts, and the one action. Every state is a card of the same
// shape, so SPOTTER always has an edge to sleep on and nothing jumps.

import Link from "next/link";
import type { ReactNode } from "react";
import { formatUsdc, POOLS_NOT_CONFIGURED_COPY } from "@/lib/contract";
import {
  endsAtWords,
  heroNote,
  openTag,
  runName,
  termsOf,
  type OpenRun,
} from "@/lib/game/landing";
import type { OpenRunsStatus } from "@/lib/game/useOpenRuns";
import { formatRunClock, runClock } from "@/lib/game/tally";
import { useNowSeconds } from "@/lib/game/useNowSeconds";
import LandingCta from "@/components/game/LandingCta";
import { FitLine } from "@/components/game/RunRow";
import type { Fit } from "@/lib/game/wearable-fit";
import { Button, Card, Fine, RunCard, Skeleton, Stat, StatRow, Tag, buttonClasses } from "@/components/ui";

export interface FeaturedRunCardProps {
  status: OpenRunsStatus;
  run: OpenRun | null;
  feeBps: number | null;
  /** The signed-in player is already in this run. */
  joined?: boolean;
  /** Whether the wearable the visitor picked can check this run. */
  fit?: Fit | null;
  onRetry?: () => void;
}

function Shell({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
  return (
    <Card
      variant="hero"
      padding="none"
      aria-busy={busy ? "true" : undefined}
      className="z-[2] px-4 pb-3.5 pt-4 min-[900px]:px-6 min-[900px]:pb-[18px] min-[900px]:pt-[22px]"
    >
      {children}
    </Card>
  );
}

function LoadingCard() {
  return (
    <Shell busy>
      <p className="sr-only" role="status">
        Reading tonight&apos;s runs
      </p>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-[26px] w-28 rounded-tag" />
        <Skeleton className="h-4 w-36" />
      </div>
      <Skeleton className="mt-3 h-6 w-3/4" />
      <div className="mt-3 grid grid-cols-3 gap-3 border-t border-edge pt-3">
        <Skeleton className="h-11" />
        <Skeleton className="h-11" />
        <Skeleton className="h-11" />
      </div>
      <Skeleton className="mt-3 h-10" />
      <Skeleton className="mt-3.5 h-[52px] rounded-control" />
      <Skeleton className="mx-auto mt-2 h-4 w-2/3" />
    </Shell>
  );
}

export default function FeaturedRunCard({
  status,
  run,
  feeBps,
  joined = false,
  fit = null,
  onRetry,
}: FeaturedRunCardProps) {
  const now = useNowSeconds();

  if (status === "loading") return <LoadingCard />;

  if (status === "error" || status === "not-configured") {
    return (
      <Shell>
        <div role="alert">
          <Tag tone="muted">Read failed</Tag>
          <h2 className="m-0 mt-2.5 text-[1.25rem] font-semibold leading-tight tracking-[-0.01em] min-[900px]:text-[1.375rem]">
            {status === "not-configured"
              ? POOLS_NOT_CONFIGURED_COPY
              : "I could not read the runs from Base Sepolia just now."}
          </h2>
          <p className="m-0 mt-2 text-sm leading-[1.45] text-muted">
            {status === "not-configured"
              ? "Nothing on this page can take a stake until runs are open."
              : "Nothing changed on your side, and nothing was staked."}
          </p>
        </div>
        {status === "error" && onRetry !== undefined ? (
          <div className="mt-3.5 flex flex-col gap-1">
            <Button variant="secondary" block onClick={onRetry}>
              Read the runs again
            </Button>
          </div>
        ) : null}
        <Fine className="mt-2 text-center">Test USDC during beta.</Fine>
      </Shell>
    );
  }

  if (run === null) {
    return (
      <Shell>
        <Tag tone="muted" dot={false}>
          Nothing open
        </Tag>
        <h2 className="m-0 mt-2.5 text-[1.25rem] font-semibold leading-tight tracking-[-0.01em] min-[900px]:text-[1.375rem]">
          No run is open right now
        </h2>
        <p className="m-0 mt-2 text-sm leading-[1.45] text-muted">
          Start one, set the stake and the goal, and I will read the wearables.
        </p>
        <div className="mt-3.5">
          <Link href="/pools/create" className={buttonClasses({ block: true })}>
            Start a run
          </Link>
        </div>
        <Fine className="mt-2 text-center">Test USDC during beta.</Fine>
      </Shell>
    );
  }

  const { pool } = run;
  const terms = termsOf(run, feeBps);
  const note = terms !== null ? heroNote(terms) : null;
  const clock = now === null ? null : runClock(pool.periodStart, pool.periodEnd, now);

  return (
    <RunCard
      id="featured-run"
      tag={<Tag>{now === null ? "Open" : openTag(pool.goalSpec, pool.periodEnd, now)}</Tag>}
      ends={
        now === null || clock === null ? (
          <span className="invisible">Ends</span>
        ) : (
          <>
            Ends <b>{endsAtWords(pool.periodEnd)}</b>
            {clock.ended ? ", ended" : `, in ${formatRunClock(clock)}`}
          </>
        )
      }
      title={runName(pool)}
      stats={
        <StatRow>
          <Stat label="Stake" value={formatUsdc(pool.entryFee)} unit="USDC" size="lg" />
          <Stat label="Pot" value={formatUsdc(pool.balance)} unit="USDC" tone="money" size="lg" />
          <Stat label="Players in" value={run.players === null ? "--" : run.players} size="lg" />
        </StatRow>
      }
      note={
        joined ? (
          <>You&apos;re in. Your {formatUsdc(pool.entryFee)} is in the pot.</>
        ) : note !== null ? (
          note.map((s, i) => (s.strong === true ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))
        ) : (
          "I could not count the players just now, so the run page has the exact figures."
        )
      }
      action={
        <LandingCta poolId={pool.id} entryFee={pool.entryFee} joined={joined} locked={!joined && fit !== null && !fit.ok} />
      }
      fine={joined ? "Test USDC during beta." : "Test USDC during beta. Refunded if nobody hits."}
    >
      {!joined && fit !== null ? <FitLine ok={fit.ok}>{fit.line}</FitLine> : null}
    </RunCard>
  );
}
