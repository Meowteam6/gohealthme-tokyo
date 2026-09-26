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
import Spotter from "@/components/spotter/Spotter";
import { EmptyState, Money, TAP_TARGET, buttonClasses } from "@/components/ui";
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

function PayoutRow({ payout, index }: { payout: NamedPayout; index: number }) {
  return (
    <li
      className="ghm-rise-in flex items-center gap-3 rounded-[20px] border border-edge bg-surface p-4"
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
    >
      {/* A wearable-settled payout gets the verified pose; a photo-backed one
          gets the magnifier, so the tier never reads as verified. */}
      <Spotter
        state={payout.selfReported === true ? "history-other" : "history-verified"}
        decorative
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-base text-foreground">
          <span className="font-bold">{nameOf(payout)}</span>
          <span className="text-muted"> got paid</span>
        </span>
        <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {payout.selfReported === true ? (
            <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-bold text-warning">
              Self-reported
            </span>
          ) : null}
          <span>{relativeTime(payout.at)}</span>
          <span aria-hidden="true">&middot;</span>
          <a
            href={arcTxUrl(payout.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-accent-deep underline underline-offset-2"
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

export default function NamedPayoutFeed() {
  const query = useQuery({
    queryKey: ["social-feed"],
    queryFn: fetchFeed,
    refetchInterval: 30_000,
  });

  const payouts = query.data?.payouts ?? [];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-bold leading-display tracking-display">
          Payout feed
        </h2>
        <p className="flex items-center gap-1.5 text-sm text-accent-deep">
          <ShieldLockIcon className="h-3.5 w-3.5 shrink-0" />
          <span>{PRIVACY_COPY}</span>
        </p>
      </div>

      {query.isLoading ? (
        <div className="flex flex-col gap-3">
          <div className="h-16 animate-pulse rounded-2xl bg-surface-raised" />
          <div className="h-16 animate-pulse rounded-2xl bg-surface-raised" />
        </div>
      ) : query.isError ? (
        <div
          role="status"
          className="flex items-center gap-4 rounded-[20px] border border-warning/40 bg-surface p-5 text-base"
        >
          <Spotter state="error" size="xs" decorative />
          <div>
            <p>Could not read the payout feed right now.</p>
            <button
              type="button"
              onClick={() => {
                void query.refetch();
              }}
              className={`-ml-4 font-bold text-accent-deep underline underline-offset-4 ${TAP_TARGET}`}
            >
              Try again
            </button>
          </div>
        </div>
      ) : payouts.length === 0 ? (
        <EmptyState
          title="Nobody paid yet."
          detail="Runs pay when they settle, and the next one lands here."
          line="Nothing to hand out. I'm on break."
          action={
            <Link
              href="/pools"
              className={`${buttonClasses()}`}
            >
              Find a run
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {payouts.map((payout, index) => (
            <PayoutRow
              key={`${payout.txHash}-${index}`}
              payout={payout}
              index={index}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
