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
import { EmptyState, ErrorNote, Money, Skeleton } from "@/components/ui";
import SpotterSays from "@/components/SpotterSays";

// The feed's human-readable stage names for a stalled claim. The feed-view
// only ever sends this fixed vocabulary (or "other"), never error prose.
const STAGE_LABEL: Record<string, string> = {
  buy: "buying the check",
  attester: "reading the evidence",
  record: "recording the result on-chain",
  settle: "settling the pool",
  approval: "the payout confirmation",
  other: "an internal step",
};

const APPROVAL_LINE: Record<string, string> = {
  requested: "asked the winner to confirm the payout",
  approved: "winner confirmed the payout",
  declined: "winner declined, nothing moved",
  expired: "confirmation window closed, nothing moved",
  cancelled: "confirmation cancelled, nothing moved",
};

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
    <li className="rounded-3xl border border-edge bg-surface-raised p-4 sm:p-5">
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
                payout tx
              </a>
            ) : null}
          </p>
        ) : deferredLine !== null ? (
          <p className="text-xs text-muted">{deferredLine}</p>
        ) : null}
        {claim.approval !== null ? (
          <p className="text-xs text-muted">
            {APPROVAL_LINE[claim.approval.status] ?? claim.approval.status}
            {claim.approval.provider === "mock" ? (
              <span className="ml-2 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                mocked World ID
              </span>
            ) : null}
          </p>
        ) : null}
        {claim.screen !== undefined && claim.screen.status !== "clear" ? (
          <p className="text-xs text-warning">
            {claim.screen.status === "blocked"
              ? "payout held: the wallet failed screening"
              : "payout held: screening could not answer yet"}
          </p>
        ) : null}
        {claim.problem !== undefined ? (
          <p className="text-xs text-warning">
            SPOTTER hit a problem at {STAGE_LABEL[claim.problem.stage] ?? STAGE_LABEL.other}.
            Nothing has been paid on this claim yet.
          </p>
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
      // A failed read is an error, never an empty ledger: "SPOTTER has done
      // nothing yet" must only ever mean exactly that.
      if (!res.ok) throw new Error(`agent feed ${res.status}`);
      const body = (await res.json()) as { claims?: PublicFeedClaim[] };
      return body.claims ?? [];
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-bold">Recent claims</h2>
      {feed.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : feed.isError && feed.data === undefined ? (
        <ErrorNote
          title="Could not read SPOTTER's claims right now."
          detail="This is a read problem on our side, not an empty ledger. It retries on its own."
          onRetry={() => void feed.refetch()}
        />
      ) : feed.data !== undefined && feed.data.length > 0 ? (
        <ol className="space-y-3">
          {feed.data.map((claim) => (
            <ClaimCard key={claim.goalId} claim={claim} />
          ))}
        </ol>
      ) : (
        <div className="space-y-4">
          <SpotterSays surface="agent-empty" state="empty" size="md" />
          <EmptyState
            title="SPOTTER has done nothing yet."
            detail="Join a run and prove it, from your wearable or an uploaded record, and SPOTTER checks it and pays out here."
            action={
              <Link
                href="/pools"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 py-2.5 font-display text-sm font-bold text-white shadow-[var(--shadow-pop)] transition-transform hover:translate-y-px hover:bg-accent-strong active:translate-y-[3px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
