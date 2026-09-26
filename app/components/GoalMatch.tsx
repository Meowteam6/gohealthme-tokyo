"use client";

// The /goal match screen: the typed goal meets the money already staked on
// it. Ranking comes from the keyword route; the top match leads, the rest
// stay one tap away.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { displayGoalSpec, formatUsdc } from "@/lib/contract";
import { commitmentShortCopy } from "@/lib/commitment-copy";
import { Badge, EmptyState, ErrorNote, Money, Skeleton, buttonClasses } from "@/components/ui";
import { PAGE_COLUMN, PAGE_TITLE, SECTION_TITLE } from "@/components/night/kit";

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
      className={`relative block rounded-card bg-[linear-gradient(180deg,var(--surface-top)_0%,var(--surface)_120px)] px-4 py-[18px] text-foreground no-underline transition-shadow duration-[120ms] min-[960px]:p-6 ${
        lead ? "shadow-card-hero" : "shadow-card hover:shadow-card-hero"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone="muted">{match.initiative}</Badge>
        {lead ? <Badge tone="accent">Closest match</Badge> : null}
      </div>
      <p className="m-0 mt-3 text-[1.0625rem] font-semibold leading-snug">
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
          <p className="m-0 mt-2 text-[0.9375rem] leading-[1.45] text-muted">
            Stake <Money usd={entryFeeUsd} size="sm" /> on yourself.{" "}
            {commitmentShortCopy({
              id: /^\d+$/.test(match.poolId) ? BigInt(match.poolId) : 0n,
              bountyModel: match.bountyModel,
              goalSpec: match.goalSpec,
            })}
          </p>
        ) : null
      ) : balanceUsd !== null ? (
        <p className="m-0 mt-2 text-[0.9375rem] leading-[1.45] text-muted">
          <Money usd={balanceUsd} size="sm" /> in the pot.
        </p>
      ) : null}
      {entryFeeUsd !== null || deadline !== null ? (
        <div className="num mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-haze">
          {entryFeeUsd !== null ? (
            <span>
              Stake <Money usd={entryFeeUsd} size="sm" />
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
    <div className={`${PAGE_COLUMN} [&>*+*]:mt-6`}>
      <div className="min-w-0">
        <p className="m-0 text-sm font-semibold text-haze">
          {query === "" ? "Open challenges" : "Money on this goal"}
        </p>
        <h1 className={`${PAGE_TITLE} mt-1.5`}>
          {query === "" ? "Open goals with money behind them" : `"${query}"`}
        </h1>
      </div>

      {matches.isPending ? (
        <div className="[&>*+*]:mt-3" aria-busy="true">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : matches.isError ? (
        <ErrorNote
          title="Could not load the open challenges"
          detail="Base Sepolia did not answer. Try again in a moment."
          onRetry={() => {
            void matches.refetch();
          }}
        />
      ) : matched.length === 0 ? (
        <div className="[&>*+*]:mt-6">
          <EmptyState
            title="Nothing staked on this one yet."
            detail="No open run matches your goal. Create the run and stake on your goal, or look at what is already open."
            action={
              <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="/pools/create"
                  className={`${buttonClasses({ size: "sm" })}`}
                >
                  Create the run
                </Link>
                <Link href="/pools" className={buttonClasses({ variant: "secondary", size: "sm" })}>
                  Browse open challenges
                </Link>
              </div>
            }
          />
          {others.length > 0 ? (
            <section className="[&>*+*]:mt-3" aria-labelledby="other-open-runs">
              <h2 id="other-open-runs" className={SECTION_TITLE}>
                Other open challenges
              </h2>
              {others.map((match) => (
                <MatchCard key={match.poolId} match={match} lead={false} />
              ))}
            </section>
          ) : null}
        </div>
      ) : (
        <div className="[&>*+*]:mt-3">
          {matched.map((match, index) => (
            <MatchCard
              key={match.poolId}
              match={match}
              lead={index === 0 && match.score > 0}
            />
          ))}
          {others.length > 0 ? (
            <section className="pt-4 [&>*+*]:mt-3" aria-labelledby="other-open-runs">
              <h2 id="other-open-runs" className={SECTION_TITLE}>
                Other open challenges
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

