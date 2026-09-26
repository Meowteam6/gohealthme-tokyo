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
  missLineOf,
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
import {
  Badge,
  Card,
  Chip,
  ErrorNote,
  Money,
  Skeleton,
  TEXT_LINK,
  buttonClasses,
} from "@/components/ui";
import { CARD_TITLE } from "@/components/night/kit";

// The feed's human-readable stage names for a stalled claim. The feed-view
// only ever sends this fixed vocabulary (or "other"), never error prose.
const STAGE_LABEL: Record<string, string> = {
  buy: "buying the check",
  attester: "reading the evidence",
  record: "recording the result on-chain",
  settle: "settling the challenge",
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
  requested: { text: "Asked the player to confirm with World ID", tone: "muted" },
  approved: { text: "Player confirmed with World ID", tone: "accent" },
  declined: { text: "Player declined. Nothing moved.", tone: "warning" },
  expired: { text: "Confirmation window closed. Nothing moved.", tone: "warning" },
  cancelled: { text: "Challenge settled before the player confirmed. Nothing moved.", tone: "warning" },
};

const SCREEN_LINE: Record<
  PublicFeedScreen["status"],
  { text: string; tone: "accent" | "warning" | "muted" }
> = {
  clear: { text: "Payout wallet screened: clear", tone: "muted" },
  blocked: { text: "Payout blocked by wallet screening", tone: "warning" },
  unavailable: { text: "Payout held: wallet screening did not answer", tone: "warning" },
};

const TONE_CLASS = {
  accent: "text-moonlight",
  warning: "text-warning",
  muted: "text-haze",
} as const;

/** A tx link on a claim row: quiet, underlined, 44px tall. */
const TX_LINK = `${TEXT_LINK} text-sm`;

export function ClaimCard({ claim, own = false }: { claim: PublicFeedClaim; own?: boolean }) {
  // A recorded miss pays nobody on this claim: it says where the stake goes
  // instead of leaving a bare "no pay" next to a tx link that reads like one.
  const missLine = missLineOf(claim, own);
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
  // DESIGN.md History: a claim that paid gets the verified pose; anything
  // still being checked, held, declined or refused gets the magnifier.
  const paid =
    settle !== null &&
    (settle.status === "settled" || settle.status === "already-settled") &&
    claim.decision === "pay";

  return (
    <li className="border-t border-edge py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-haze">{shortGoal(claim.goalId)}</span>
          {paid ? <Badge tone="accent">Paid</Badge> : null}
          {claim.selfReported ? <Badge tone="warning">Self-reported</Badge> : null}
          {claim.approval?.provider === "mock" ? <Badge tone="warning">Mocked World ID</Badge> : null}
          {claim.approval?.credential != null ? (
            <Badge tone="muted">{`World ID: ${credentialLabel(claim.approval.credential)}`}</Badge>
          ) : null}
        </span>
        <span className="num text-[0.8125rem] text-haze">{new Date(claim.at).toLocaleString()}</span>
      </div>
      <div className="mt-2.5 [&>*+*]:mt-1.5 text-[0.9375rem]">
        {claim.spends.map((spend, index) => (
          <p key={index} className="m-0 flex items-baseline justify-between gap-3">
            <span className="min-w-0 text-muted">
              {spend.label}
              <span className="ml-2 text-[0.8125rem] text-haze">
                {spend.settlement === "x402" ? "paid via x402" : "metered"}
              </span>
            </span>
            <Money usd={toUsd2(spend.amountUsd)} size="sm" />
          </p>
        ))}
        {claim.decision !== null ? (
          <p className="m-0 flex flex-wrap items-center gap-x-2">
            <span className="text-haze">SPOTTER&apos;s decision</span>
            <span
              className={`font-semibold ${
                claim.decision === "pay" ? "text-moonlight" : "text-warning"
              }`}
            >
              {claim.decision === "pay" ? "Pay" : "No pay"}
            </span>
            {resultTx !== null ? (
              <a href={baseTxUrl(resultTx)} target="_blank" rel="noopener noreferrer" className={TX_LINK}>
                Verdict tx
              </a>
            ) : null}
          </p>
        ) : null}
        {missLine !== null ? <p className="m-0 text-foreground">{missLine}</p> : null}
        {approval !== null ? (
          <p className={`m-0 ${TONE_CLASS[approval.tone]}`}>{approval.text}</p>
        ) : null}
        {screen !== null ? <p className={`m-0 ${TONE_CLASS[screen.tone]}`}>{screen.text}</p> : null}
        {settle !== null && settle.status === "settled" && settle.paidUsd !== null ? (
          <p className="m-0 flex items-center justify-between gap-3">
            <span className="font-semibold text-foreground">
              Paid <Money usd={toUsd2(settle.paidUsd)} sign="+" size="sm" />
            </span>
            {settle.txHash !== null ? (
              <a href={baseTxUrl(settle.txHash)} target="_blank" rel="noopener noreferrer" className={TX_LINK}>
                Payout tx
              </a>
            ) : null}
          </p>
        ) : settle !== null && settle.status === "already-settled" ? (
          <p className="m-0 text-haze">Paid in the challenge&apos;s settle</p>
        ) : deferredLine !== null ? (
          <p className="m-0 text-haze">{deferredLine}</p>
        ) : null}
        {claim.problem !== undefined ? (
          <p className="m-0 text-warning">
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
    <Card as="section" aria-labelledby="history-feed" className="[&>*+*]:mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="history-feed" className={CARD_TITLE}>
          {view === "mine" ? "Your history" : "Everyone's claims"}
        </h2>
        {signedIn ? (
          <div role="group" aria-label="Whose history" className="flex gap-2">
            {(["mine", "everyone"] as const).map((v) => (
              <Chip key={v} selected={view === v} onClick={() => setPicked(v)}>
                {TOGGLE_LABEL[v]}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>
      {!signedIn ? (
        <p className="m-0 text-[0.9375rem] text-muted">
          <Link
            href={`/character?next=${encodeURIComponent(pathname)}`}
            className="font-semibold text-foreground underline decoration-muted/40 underline-offset-4"
          >
            Sign in
          </Link>{" "}
          to see your own verdicts and payouts first.
        </p>
      ) : null}
      <div aria-live="polite">
        {feed.isPending ? (
          <div role="status" className="[&>*+*]:mt-2">
            <span className="sr-only">Reading SPOTTER&apos;s claims</span>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : items.length > 0 ? (
          <ol className="m-0 list-none p-0">
            {items.map((claim) => (
              <ClaimCard key={claim.goalId} claim={claim} own={view === "mine"} />
            ))}
          </ol>
        ) : feed.isError ? (
          <ErrorNote
            title="Could not read SPOTTER's claims right now"
            detail="This is a read problem on our side, not an empty ledger. It retries on its own every few seconds."
            retryLabel="Read the claims again"
            onRetry={() => {
              void feed.refetch();
            }}
          />
        ) : (
          <FeedEmpty
            title={view === "mine" ? "Nothing in your history yet" : "No claims settled yet"}
            detail={
              view === "mine"
                ? "When SPOTTER checks one of your challenges, its verdict, your World ID confirmation and the payout land here. Everyone's claims are one tap away."
                : "Enter a challenge and wear your wearable. SPOTTER checks the result and the payout shows here when the challenge settles."
            }
          />
        )}
      </div>
    </Card>
  );
}

/** The empty feed, inside the feed card: what lands here and the one action. */
export function FeedEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-control bg-fill-quiet px-4 py-6 text-center shadow-[inset_0_0_0_1px_var(--border)]">
      <p className="type-heading m-0 text-[1.5rem]">{title}</p>
      <p className="m-0 mx-auto mt-2 max-w-md text-[0.9375rem] text-muted">{detail}</p>
      <Link href="/pools" className={`mt-5 ${buttonClasses({ size: "sm" })}`}>
        See the open challenges
      </Link>
    </div>
  );
}
