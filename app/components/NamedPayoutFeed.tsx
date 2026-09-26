"use client";

// The human named Payout Feed. Each row is one settled payout: who got paid
// (their handle, or a truncated address when unclaimed), how much in USDC, when,
// a link to the settlement tx on Basescan, and a self-reported tag when the win
// rested on a photo. Nothing else.
//
// THE REDACTION RULE holds here because the row has nowhere to put a health
// category: the API (/api/social/feed) returns handle + address + amount + tx +
// time only, and this component renders exactly those. There is no goal text,
// no initiative, no service label on this surface.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, ErrorNote, FOCUS_RING, Money, Skeleton, buttonClasses } from "@/components/ui";
import { CARD_TITLE } from "@/components/night/kit";
import { arcTxUrl } from "@/lib/chains";
import { shortAddress } from "@/lib/social";

interface NamedPayout {
  at: string;
  handle: string | null;
  address: string | null;
  amountUsd: string;
  txHash: string;
  /** Absent on an older API response; read as not self-reported only when
   *  explicitly false, so an unknown tier never earns a "verified" framing. */
  selfReported?: boolean;
}

interface FeedResponse {
  payouts: NamedPayout[];
}

// Privacy only. The feed carries self-reported payouts too, so it never calls
// a row "verified"; the tier is tagged per row instead.
const PRIVACY_COPY = "Amounts are public. The health goal behind them never is.";

function ShieldLockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <rect x="9.25" y="11" width="5.5" height="4.5" rx="1" />
      <path d="M10.5 11V9.75a1.5 1.5 0 013 0V11" />
    </svg>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const sec = Math.max(0, Math.floor(diff / 1000));
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (sec < 60) return "just now";
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  return `${day}d ago`;
}

function nameOf(payout: NamedPayout): string {
  if (payout.handle !== null && payout.handle !== "") return `@${payout.handle}`;
  if (payout.address !== null) return shortAddress(payout.address);
  return "Someone";
}

async function fetchFeed(): Promise<FeedResponse> {
  const res = await fetch("/api/social/feed");
  if (!res.ok) throw new Error(`feed responded ${res.status}`);
  return (await res.json()) as FeedResponse;
}

export function PayoutRow({ payout }: { payout: NamedPayout }) {
  return (
    <li className="flex items-center gap-3 border-t border-edge py-3.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-base text-foreground">
          <span className="font-semibold">{nameOf(payout)}</span>
          <span className="text-muted"> got paid</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-haze">
          {/* A photo-backed payout is tagged, so the tier never reads as
              verified. */}
          {payout.selfReported === true ? <Badge tone="warning">Self-reported</Badge> : null}
          <span>{relativeTime(payout.at)}</span>
          <a
            href={arcTxUrl(payout.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex min-h-11 items-center text-muted underline decoration-muted/35 underline-offset-4 hover:text-foreground ${FOCUS_RING}`}
          >
            Basescan
          </a>
        </span>
      </div>
      <span className="shrink-0">
        <Money usd={payout.amountUsd} size="md" />
      </span>
    </li>
  );
}

export type { NamedPayout };

export default function NamedPayoutFeed() {
  const query = useQuery({
    queryKey: ["social-feed"],
    queryFn: fetchFeed,
    refetchInterval: 30_000,
  });

  const payouts = query.data?.payouts ?? [];

  return (
    <Card as="section" aria-labelledby="payout-feed">
      <h2 id="payout-feed" className={CARD_TITLE}>
        Payout feed
      </h2>
      <p className="mt-1.5 flex items-center gap-1.5 text-[0.8125rem] text-haze">
        <ShieldLockIcon className="size-3.5 shrink-0" />
        <span>{PRIVACY_COPY}</span>
      </p>

      <div className="mt-4" aria-live="polite">
        {query.isLoading ? (
          <div role="status" className="[&>*+*]:mt-2">
            <span className="sr-only">Reading the payout feed</span>
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : query.isError ? (
          <ErrorNote
            title="Could not read the payout feed right now"
            detail="This is a read problem, not an empty feed."
            retryLabel="Read the feed again"
            onRetry={() => {
              void query.refetch();
            }}
          />
        ) : payouts.length === 0 ? (
          <PayoutFeedEmpty />
        ) : (
          <ul className="list-none">
            {payouts.map((payout, index) => (
              <PayoutRow key={`${payout.txHash}-${index}`} payout={payout} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/** Nobody paid yet: what lands here and the one action. */
export function PayoutFeedEmpty() {
  return (
    <div className="rounded-control bg-fill-quiet px-4 py-6 text-center shadow-[inset_0_0_0_1px_var(--border)]">
      <p className="type-heading text-[1.5rem]">Nobody paid yet</p>
      <p className="mx-auto mt-2 max-w-md text-[0.9375rem] text-muted">
        Runs pay when they settle, and the next one lands here.
      </p>
      <Link href="/pools" className={`mt-5 ${buttonClasses({ size: "sm" })}`}>
        Find a run
      </Link>
    </div>
  );
}
