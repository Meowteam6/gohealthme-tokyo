"use client";

// Live activity ticker for the landing hero's right column. Reads the whole
// system's REAL on-chain activity from /api/activity - people joining pools,
// sponsors putting up rewards, and SPOTTER paying out winners - newest first,
// polled so it stays alive. Never invented rows: an empty testnet shows an
// honest "be the first" state and fills in as real activity lands.
//
// PRIVACY: the API returns only actor handle (or truncated address), event
// type, amount (rewards/payouts), and time. No goalSpec, no health category,
// and private friend-challenges are filtered out server-side - so nothing here
// can leak what anyone's goal actually is.

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui";

type ActivityType = "joined" | "funded" | "paid";

interface ActivityItem {
  type: ActivityType;
  handle: string | null;
  address: string | null;
  amountUsd: string | null;
  at: string;
  id: string;
}

function displayName(handle: string | null, address: string | null): string {
  if (handle) return handle.startsWith("@") ? handle : `@${handle}`;
  if (address) return `${address.slice(0, 6)}…${address.slice(-4)}`;
  return "someone";
}

function relativeTime(at: string): string {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t) || t <= 0) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

function amount(usd: string | null): string {
  if (usd === null) return "";
  const n = Number(usd);
  return Number.isFinite(n) ? n.toFixed(2) : usd;
}

// Each event type gets a colored status dot and a one-line verb. Colors carry
// the app's own meaning: emerald = a person acting on their goal, coral = the
// human dare/reward, gold = money actually landing.
const META: Record<
  ActivityType,
  { dot: string; line: (name: string) => string }
> = {
  joined: { dot: "bg-accent", line: (n) => `${n} entered a run` },
  funded: { dot: "bg-coral", line: (n) => `${n} put up a reward` },
  paid: { dot: "bg-gold", line: (n) => `SPOTTER paid ${n}` },
};

export default function HeroActivityTicker() {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["hero-activity"],
    queryFn: async () => {
      const res = await fetch("/api/activity");
      if (!res.ok) throw new Error(`activity ${res.status}`);
      return (await res.json()) as { events?: ActivityItem[] };
    },
    refetchInterval: 20_000,
    staleTime: 10_000,
    retry: false,
  });

  const events = (data?.events ?? []).slice(0, 5);

  return (
    <div className="rounded-xl border-2 border-foreground/15 bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true" />
        <p className="text-sm font-semibold text-muted">What just happened on chain</p>
      </div>

      {/* Loading and a failed read each get their own state: an RPC outage
          must never read as a quiet, empty testnet. "Quiet" is only for a
          confirmed empty answer. */}
      {isPending ? (
        <div className="space-y-2" aria-busy="true">
          <p className="sr-only" aria-live="polite">
            Reading the chain
          </p>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : isError && events.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-warning/40 px-4 py-6" role="status">
          <p className="text-sm font-bold text-foreground">
            Could not read the chain right now.
          </p>
          <p className="mt-1 text-sm text-muted">
            This is a read problem, not an empty chain. It tries again on its own.
          </p>
          <button
            type="button"
            onClick={() => {
              void refetch();
            }}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-accent-deep underline underline-offset-4"
          >
            Try again
          </button>
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-edge px-4 py-6">
          <p className="text-sm font-bold text-foreground">Quiet right now.</p>
          <p className="mt-1 text-sm text-muted">
            Be the first. Enter a run or dare a friend and it shows up here
            once it lands on chain.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => {
            const name = displayName(e.handle, e.address);
            const meta = META[e.type];
            const amt = amount(e.amountUsd);
            return (
              <li
                key={e.id}
                className="flex items-center gap-3 rounded-lg border border-edge bg-surface-raised px-3 py-2.5"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">
                    {meta.line(name)}
                  </p>
                  <p className="text-xs text-muted">{relativeTime(e.at)}</p>
                </div>
                {amt !== "" ? (
                  <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-gold-deep">
                    +{amt} USDC
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-center text-xs text-muted">
        Real on-chain activity, testnet USDC.
      </p>
    </div>
  );
}
