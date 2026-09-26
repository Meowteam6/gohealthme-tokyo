"use client";

// The History feed (/agent): signed in, the player's own claims lead and
// everyone's sit behind one toggle; signed out, the public feed with one line
// to sign in. Every claim the agent has touched,
// redacted server-side to money facts, statuses, and tx hashes - never the
// model's prose about anyone's medical documents (the /api/agent/feed route
// does the redaction). Split out of the identity card so the page can render
// SPOTTER's real settler identity server-side while this section streams the
// ledger on the client.
//
// Each card shows the whole public journey of a claim: what SPOTTER bought,
// its decision, whether it asked the winner to confirm with World ID and what
// came back, whether the payout wallet cleared screening, and where the money
// went. A declined, expired or held claim must never read as a pending payout.

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEmbeddedWallet } from "@/lib/wallet";
import {
  defaultHistoryView,
  historyItems,
  type HistoryView,
} from "@/lib/agent-history";
import { baseTxUrl } from "@/lib/chains";
import { toUsd2 } from "@/lib/agent-receipt";
import { credentialLabel } from "@/lib/world/credentials";
import type {
  PublicFeedApproval,
  PublicFeedClaim,
  PublicFeedScreen,
} from "@/lib/server/agent/feed-view";
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

function shortGoal(goalId: string): string {
  return `${goalId.slice(0, 10)}…${goalId.slice(-6)}`;
}

/** The human step, in public third-person words. */
const APPROVAL_LINE: Record<
  PublicFeedApproval["status"],
  { text: string; tone: "accent" | "warning" | "muted" }
> = {
  requested: { text: "asked the winner to confirm with World ID", tone: "muted" },
  approved: { text: "winner confirmed with World ID", tone: "accent" },
  declined: { text: "winner declined. Nothing moved.", tone: "warning" },
  expired: { text: "confirmation window closed. Nothing moved.", tone: "warning" },
  cancelled: { text: "run settled before the winner confirmed. Nothing moved.", tone: "warning" },
};

const SCREEN_LINE: Record<
  PublicFeedScreen["status"],
  { text: string; tone: "accent" | "warning" | "muted" }
> = {
  clear: { text: "payout wallet screened: clear", tone: "muted" },
  blocked: { text: "payout blocked by wallet screening", tone: "warning" },
  unavailable: { text: "payout held: wallet screening did not answer", tone: "warning" },
};

const TONE_CLASS = {
  accent: "text-accent-deep",
  warning: "text-warning",
  muted: "text-muted",
} as const;

function Tag({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-warning">
      {children}
    </span>
  );
}

function ClaimCard({ claim }: { claim: PublicFeedClaim }) {
  const settle = claim.settle;
  const deferredLine =
    settle !== null &&
    settle.status === "deferred" &&
    settle.periodEndIso !== null
      ? settleMomentLine(new Date(settle.periodEndIso))
      : null;
  const approval =
    claim.approval !== null ? APPROVAL_LINE[claim.approval.status] : null;
  const screen = claim.screen !== undefined ? SCREEN_LINE[claim.screen.status] : null;
  const resultTx = claim.recordTxs?.resultTx ?? null;

  return (
    <li className="rounded-3xl border border-edge bg-surface-raised p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted">
          {shortGoal(claim.goalId)}
          {claim.selfReported ? <Tag>self-reported</Tag> : null}
          {claim.approval?.provider === "mock" ? <Tag>mocked World ID</Tag> : null}
          {claim.approval?.credential != null ? (
            <Tag>{`World ID: ${credentialLabel(claim.approval.credential)}`}</Tag>
          ) : null}
        </span>
        <span className="text-xs text-muted">
          {new Date(claim.at).toLocaleString()}
        </span>
      </div>
      <div className="mt-2 space-y-1 text-sm">
        {claim.spends.map((spend, index) => (
          <p key={index} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0">
              {spend.label}
              <span className="ml-2 text-xs text-muted">
                {spend.settlement === "x402" ? "paid via x402" : "metered"}
              </span>
            </span>
            <Money usd={toUsd2(spend.amountUsd)} size="sm" />
          </p>
        ))}
        {claim.decision !== null ? (
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xs uppercase tracking-wide text-muted">
              decision
            </span>
            <span
              className={
                claim.decision === "pay" ? "text-accent-deep" : "text-warning"
              }
            >
              {claim.decision === "pay" ? "pay" : "no pay"}
            </span>
            {resultTx !== null ? (
              <a
                href={baseTxUrl(resultTx)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent-deep underline"
              >
                verdict tx
              </a>
            ) : null}
          </p>
        ) : null}
        {approval !== null ? (
          <p className={`text-xs ${TONE_CLASS[approval.tone]}`}>{approval.text}</p>
        ) : null}
        {screen !== null ? (
          <p className={`text-xs ${TONE_CLASS[screen.tone]}`}>{screen.text}</p>
        ) : null}
        {settle !== null &&
        settle.status === "settled" &&
        settle.paidUsd !== null ? (
          <p className="flex items-baseline justify-between gap-3">
            <span className="text-accent-deep">
              paid <Money usd={toUsd2(settle.paidUsd)} sign="+" size="sm" />
            </span>
            {settle.txHash !== null ? (
              <a
                href={baseTxUrl(settle.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent-deep underline"
              >
                payout tx
              </a>
            ) : null}
          </p>
        ) : settle !== null && settle.status === "already-settled" ? (
          <p className="text-xs text-muted">paid in the pool&apos;s settle</p>
        ) : deferredLine !== null ? (
          <p className="text-xs text-muted">{deferredLine}</p>
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

interface FeedBody {
  claims: PublicFeedClaim[];
  mine?: PublicFeedClaim[];
}

const TOGGLE_LABEL: Record<HistoryView, string> = {
  mine: "Yours",
  everyone: "Everyone",
};

export default function AgentFeed() {
  const pathname = usePathname();
  const { authenticated, address } = useEmbeddedWallet();
  const signedIn = authenticated && address !== null;
  // Null until the player picks, so the default follows sign-in.
  const [picked, setPicked] = useState<HistoryView | null>(null);
  const view: HistoryView = signedIn ? (picked ?? defaultHistoryView(true)) : "everyone";

  const feed = useQuery({
    queryKey: ["agent-feed", signedIn ? address : null],
    queryFn: async (): Promise<FeedBody> => {
      const url = signedIn
        ? `/api/agent/feed?for=${encodeURIComponent(address)}`
        : "/api/agent/feed";
      const res = await fetch(url);
      // A failed read is an error, never an empty ledger: "SPOTTER has done
      // nothing yet" on an outage would be a false statement about the chain.
      if (!res.ok) throw new Error(`agent feed responded ${res.status}`);
      const body = (await res.json()) as Partial<FeedBody>;
      return { claims: body.claims ?? [], mine: body.mine };
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  const items = feed.data !== undefined ? historyItems(feed.data, view) : [];

  return (
    <section className="space-y-3" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold">
          {view === "mine" ? "Your history" : "Everyone's claims"}
        </h2>
        {signedIn ? (
          <div
            role="group"
            aria-label="Whose history"
            className="inline-flex rounded-full border-2 border-foreground p-0.5"
          >
            {(["mine", "everyone"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setPicked(v)}
                className={`min-h-11 rounded-full px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground ${
                  view === v ? "bg-foreground text-background" : "text-muted hover:text-foreground"
                }`}
              >
                {TOGGLE_LABEL[v]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {!signedIn ? (
        <p className="text-sm text-muted">
          <Link
            href={`/character?next=${encodeURIComponent(pathname)}`}
            className="font-semibold text-accent-deep underline"
          >
            Sign in
          </Link>{" "}
          to see your own verdicts and payouts first.
        </p>
      ) : null}
      {feed.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : items.length > 0 ? (
        <ol className="space-y-3">
          {items.map((claim) => (
            <ClaimCard key={claim.goalId} claim={claim} />
          ))}
        </ol>
      ) : feed.isError ? (
        <ErrorNote
          title="Could not read SPOTTER's claims right now"
          detail="This is a read problem on our side, not an empty ledger. It retries on its own every few seconds."
          onRetry={() => {
            void feed.refetch();
          }}
        />
      ) : view === "mine" ? (
        <EmptyState
          title="Nothing in your history yet."
          detail="When SPOTTER checks one of your runs, its verdict, your World ID confirmation and the payout land here. Everyone's claims are one tap away."
          action={
            <Link
              href="/pools"
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-5 py-2.5 font-display text-sm font-bold text-foreground hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
            >
              See the open runs
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          <SpotterSays surface="agent-empty" state="empty" size="md" />
          <EmptyState
            title="SPOTTER has not settled a claim yet."
            detail="Enter a run, prove it from your wearable or an uploaded record, and SPOTTER checks the result and pays out here when the run settles."
            action={
              <Link
                href="/pools"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 py-2.5 font-display text-sm font-bold text-foreground shadow-[var(--shadow-pop)] transition-transform hover:translate-y-px hover:bg-accent-hover active:translate-y-[3px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
              >
                See the open runs
              </Link>
            }
          />
        </div>
      )}
    </section>
  );
}
