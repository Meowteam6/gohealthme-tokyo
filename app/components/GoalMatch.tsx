"use client";

// The /goal match screen: the typed goal meets the money already staked on
// it. Ranking comes from the keyword route; the top match leads, the rest
// stay one tap away.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { displayGoalSpec, formatUsdc } from "@/lib/contract";
import { commitmentShortCopy } from "@/lib/commitment-copy";
import { Badge, EmptyState, ErrorNote, Money, Skeleton, buttonClasses } from "@/components/ui";

interface Match {
  poolId: string;
  initiative: string;
  goalSpec: string;
  balance: string;
  entryFee: string;
  periodEnd: string;
  bountyModel: number;
  score: number;
}

// The match API returns base-unit strings; a cached or partial response must
// degrade to an omitted row, never to a BigInt throw that takes down the page.
function safeUsdc(raw: unknown): string | null {
  return typeof raw === "string" && /^\d+$/.test(raw)
    ? formatUsdc(BigInt(raw))
    : null;
}

function formatDeadline(periodEnd: unknown): string | null {
  const seconds = typeof periodEnd === "string" ? Number(periodEnd) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function MatchCard({ match, lead }: { match: Match; lead: boolean }) {
  const balanceUsd = safeUsdc(match.balance);
  const entryFeeUsd = safeUsdc(match.entryFee);
  const deadline = formatDeadline(match.periodEnd);
  return (
    <Link
      href={`/pools/${match.poolId}`}
      className={`block rounded-2xl border bg-surface p-5 transition-colors hover:border-accent/50 ${
        lead ? "border-accent/40" : "border-edge"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge>{match.initiative}</Badge>
        {lead ? <Badge tone="accent">closest match</Badge> : null}
      </div>
      <p className="mt-3 text-base font-semibold">
        {displayGoalSpec(match.goalSpec)}
      </p>
      {/* A self-staked commitment pool (model 2) is funded by the participants'
          own stakes, so it must never claim a sponsor put the money up. Sponsor
          pools keep the existing framing. */}
      {/* The commitment rule, short, and only on a pool that can record a
          miss; every other self-staked pool refunds a miss at settle
          (lib/commitment-copy.ts). */}
      {match.bountyModel === 2 ? (
        entryFeeUsd !== null ? (
          <p className="mt-2 text-sm text-muted">
            Stake <Money usd={entryFeeUsd} size="sm" /> USDC on yourself.{" "}
            {commitmentShortCopy({
              id: /^\d+$/.test(match.poolId) ? BigInt(match.poolId) : 0n,
              bountyModel: match.bountyModel,
              goalSpec: match.goalSpec,
            })}
          </p>
        ) : null
      ) : balanceUsd !== null ? (
        <p className="mt-2 text-sm text-muted">
          <Money usd={balanceUsd} size="sm" /> USDC in the pot.
        </p>
      ) : null}
      {entryFeeUsd !== null || deadline !== null ? (
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
          {entryFeeUsd !== null ? (
            <span>
              Entry fee <Money usd={entryFeeUsd} size="sm" />
            </span>
          ) : null}
          {deadline !== null ? <span>Ends {deadline}</span> : null}
        </div>
      ) : null}
    </Link>
  );
}

export default function GoalMatch({ query }: { query: string }) {
  const matches = useQuery({
    queryKey: ["goal-match", query],
    queryFn: async (): Promise<Match[]> => {
      const res = await fetch(`/api/goals/match?q=${encodeURIComponent(query)}`);
      // The route's error body can carry config and RPC detail; the page
      // shows its own plain copy and never relays it.
      if (!res.ok) throw new Error(`goal match responded ${res.status}`);
      const body = (await res.json()) as { matches?: Match[] };
      return body.matches ?? [];
    },
  });

  // The route keeps every open pool, scored. A typed goal that matches
  // nothing must reach the "nothing staked" state, with the other open runs
  // offered below it under their own heading, never presented as a match.
  const all = matches.data ?? [];
  const matched = query === "" ? all : all.filter((m) => m.score > 0);
  const others = query === "" ? [] : all.filter((m) => m.score <= 0);

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <p className="text-sm font-semibold uppercase tracking-widest text-accent-deep">
          {query === "" ? "Open runs" : "Money on this goal"}
        </p>
        <h1 className="mt-2 break-words text-3xl font-bold tracking-tight">
          {query === "" ? "Open goals with money behind them" : `"${query}"`}
        </h1>
      </div>

      {matches.isPending ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : matches.isError ? (
        <ErrorNote
          title="Could not load pools"
          detail="Base Sepolia did not answer. Try again in a moment."
          onRetry={() => {
            void matches.refetch();
          }}
        />
      ) : matched.length === 0 ? (
        <div className="space-y-6">
          <EmptyState
            title="Nothing staked on this one yet."
            detail="No open run matches your goal. Create the pool and stake your goal, or look at what is already open."
            action={
              <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="/pools/create"
                  className={`${buttonClasses({ size: "sm" })}`}
                >
                  Create the pool
                </Link>
                <Link
                  href="/pools"
                  className="inline-flex min-h-11 items-center rounded-xl border border-edge px-6 py-3 text-sm font-semibold text-foreground hover:bg-surface-raised"
                >
                  Browse open runs
                </Link>
              </div>
            }
          />
          {others.length > 0 ? (
            <section className="space-y-3" aria-labelledby="other-open-runs">
              <h2
                id="other-open-runs"
                className="text-sm font-semibold uppercase tracking-widest text-muted"
              >
                Other open runs
              </h2>
              {others.map((match) => (
                <MatchCard key={match.poolId} match={match} lead={false} />
              ))}
            </section>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {matched.map((match, index) => (
            <MatchCard
              key={match.poolId}
              match={match}
              lead={index === 0 && match.score > 0}
            />
          ))}
          {others.length > 0 ? (
            <section className="space-y-3 pt-4" aria-labelledby="other-open-runs">
              <h2
                id="other-open-runs"
                className="text-sm font-semibold uppercase tracking-widest text-muted"
              >
                Other open runs
              </h2>
              {others.map((match) => (
                <MatchCard key={match.poolId} match={match} lead={false} />
              ))}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

