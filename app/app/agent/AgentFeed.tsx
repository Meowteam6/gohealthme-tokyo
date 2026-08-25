"use client";

// The public claims feed on SPOTTER's page: every claim the agent has touched,
// redacted server-side to money facts, statuses, and tx hashes - never the
// model's prose about anyone's medical documents (the /api/agent/feed route
// does the redaction). Split out of the identity card so the page can render
// SPOTTER's real settler identity server-side while this section streams the
// ledger on the client.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { baseTxUrl } from "@/lib/chains";
import { toUsd2 } from "@/lib/agent-receipt";
import type { PublicFeedClaim } from "@/lib/server/agent/feed-view";
import { settleMomentLine } from "@/components/AgentReceipt";
import { EmptyState, Money, Skeleton } from "@/components/ui";
import SpotterSays from "@/components/SpotterSays";

// Where the empty state sends a first-time visitor. Pool 13 is picked
// deliberately: it is a [doc] pool with bountyModel = 1 (pro-rata split) and a
// funded balance, so a verified claim actually pays. The bountyModel = 0 pools
// were created with entryFee = 0, which makes totalOwed zero and settles to
// nobody - never point this at one of those. Verify the pool is still unsettled
// with periodEnd in the future before a demo.
const CLAIMABLE_POOL_ID = 13;

function shortGoal(goalId: string): string {
  return `${goalId.slice(0, 10)}…${goalId.slice(-6)}`;
}

function ClaimCard({ claim }: { claim: PublicFeedClaim }) {
  const settle = claim.settle;
  const deferredLine =
    settle !== null &&
    settle.status === "deferred" &&
    settle.periodEndIso !== null
      ? settleMomentLine(new Date(settle.periodEndIso))
      : null;

  return (
    <li className="rounded-xl border border-edge bg-surface-raised p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted">
          {shortGoal(claim.goalId)}
          {claim.selfReported ? (
            <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-warning">
              self-reported
            </span>
          ) : null}
        </span>
        <span className="text-xs text-muted">
          {new Date(claim.at).toLocaleString()}
        </span>
      </div>
      <div className="mt-2 space-y-1 text-sm">
        {claim.spends.map((spend, index) => (
          <p key={index} className="flex items-baseline justify-between gap-3">
            <span>
              {spend.label}
              <span className="ml-2 text-xs text-muted">
                {spend.settlement === "x402" ? "paid via x402" : "metered"}
              </span>
            </span>
            <Money usd={toUsd2(spend.amountUsd)} size="sm" />
          </p>
        ))}
        {claim.decision !== null ? (
          <p>
            <span className="text-xs uppercase tracking-wide text-muted">
              decision
            </span>{" "}
            <span
              className={
                claim.decision === "pay" ? "text-accent" : "text-warning"
              }
            >
              {claim.decision}
            </span>
          </p>
        ) : null}
        {settle !== null &&
        settle.status === "settled" &&
        settle.paidUsd !== null ? (
          <p className="flex items-baseline justify-between gap-3">
            <span className="text-accent">
              paid <Money usd={toUsd2(settle.paidUsd)} sign="+" size="sm" />
            </span>
            {settle.txHash !== null ? (
              <a
                href={baseTxUrl(settle.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent underline"
              >
                settle tx
              </a>
            ) : null}
          </p>
        ) : deferredLine !== null ? (
          <p className="text-xs text-muted">{deferredLine}</p>
        ) : null}
      </div>
    </li>
  );
}

export default function AgentFeed() {
  const feed = useQuery({
    queryKey: ["agent-feed"],
    queryFn: async (): Promise<PublicFeedClaim[]> => {
      const res = await fetch("/api/agent/feed");
      if (!res.ok) return [];
      const body = (await res.json()) as { claims?: PublicFeedClaim[] };
      return body.claims ?? [];
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Recent claims</h2>
      {feed.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : feed.data !== undefined && feed.data.length > 0 ? (
        <ol className="space-y-3">
          {feed.data.map((claim) => (
            <ClaimCard key={claim.goalId} claim={claim} />
          ))}
        </ol>
      ) : (
        <div className="space-y-4">
          <SpotterSays surface="agent-empty" state="empty" />
          <EmptyState
            title="SPOTTER has done nothing yet."
            detail="Join a pool, upload a record, and SPOTTER buys the verification and pays out here."
            action={
              <Link
                href={`/pools/${CLAIMABLE_POOL_ID}`}
                className="inline-flex min-h-11 items-center rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-background hover:bg-accent"
              >
                Give it something to verify
              </Link>
            }
          />
        </div>
      )}
    </section>
  );
}
