"use client";

// What just happened on chain: people joining runs, sponsors funding them,
// SPOTTER paying out, newest first, from /api/activity. Never invented rows.
//
// It stays off the page until at least five different players show up in the
// feed (docs/DESIGN.md): a ticker of two names on a quiet testnet reads as a
// ghost town, and the landing's run card already says "Nobody's in yet" when
// that is the truth. A failed read also renders nothing; this is garnish, and
// the run card owns the page's honest error state.
//
// PRIVACY: the API returns only actor handle (or truncated address), event
// type, amount (rewards and payouts) and time. No goalSpec, no health
// category, and private challenges are filtered out server-side.

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

/** The feed shows once this many different players appear in it. */
export const TICKER_MIN_PLAYERS = 5;

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

/** Distinct players in the feed, by address, else by handle. */
export function distinctPlayers(events: readonly ActivityItem[]): number {
  const seen = new Set<string>();
  for (const e of events) {
    const key = (e.address ?? e.handle ?? "").toLowerCase();
    if (key !== "") seen.add(key);
  }
  return seen.size;
}

const LINE: Record<ActivityType, (name: string) => string> = {
  joined: (n) => `${n} joined a run`,
  funded: (n) => `${n} added to a pot`,
  paid: (n) => `SPOTTER paid ${n}`,
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

  const all = data?.events ?? [];
  if (distinctPlayers(all) < TICKER_MIN_PLAYERS) return null;
  const events = all.slice(0, 5);

  return (
    <section aria-labelledby="happening-h" className="mt-8">
      <h3 id="happening-h" className="m-0 text-[0.9375rem] font-semibold">
        Happening on chain
      </h3>
      <ul className="m-0 mt-2.5 grid list-none gap-2 p-0 min-[900px]:grid-cols-2">
        {events.map((e) => {
          const amt = amount(e.amountUsd);
          return (
            <li
              key={e.id}
              className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-2.5 shadow-[inset_0_0_0_1px_var(--border)]"
            >
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-sm text-foreground">{LINE[e.type](displayName(e.handle, e.address))}</p>
                <p className="m-0 text-xs text-haze">{relativeTime(e.at)}</p>
              </div>
              {amt !== "" ? (
                <span className="num flex-none text-[0.9375rem] font-semibold text-gold">
                  +{amt} <span className="text-xs font-medium text-haze">USDC</span>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="m-0 mt-2 text-[0.8125rem] text-haze">Real on-chain activity, test USDC.</p>
    </section>
  );
}
