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
  joined: { dot: "bg-accent", line: (n) => `${n} staked on a goal` },
  funded: { dot: "bg-coral", line: (n) => `${n} put up a reward` },
  paid: { dot: "bg-gold", line: (n) => `SPOTTER paid ${n}` },
};

export default function HeroActivityTicker() {
  const { data } = useQuery({
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
    <div className="rounded-3xl border-2 border-edge bg-surface p-5 shadow-[var(--shadow-pop-edge)]">
      <div className="mb-3 flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
        </span>
        <p className="font-display text-xs font-semibold uppercase tracking-wide text-muted">
          Live activity
        </p>
      </div>

      {events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-edge bg-surface-raised px-4 py-6 text-center">
          <p className="text-sm font-bold text-foreground">Quiet right now.</p>
          <p className="mt-1 text-sm text-muted">
            Be the first. Join a pool or dare a friend and it shows up here the
            second it happens.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {events.map((e, i) => {
            const name = displayName(e.handle, e.address);
            const meta = META[e.type];
            const amt = amount(e.amountUsd);
            return (
              <li
                key={e.id}
                className="ghm-rise-in flex items-center gap-3 rounded-2xl border border-edge bg-surface-raised px-3 py-2.5"
                style={{ animationDelay: `${i * 60}ms` }}
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
                  <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-gold">
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
