"use client";

// SPOTTER's wallet status as one header line, on every screen size, instead
// of a wall on every pool. SPOTTER buys each verification out of its own
// wallet, so an empty wallet stops checks for everyone; saying so once, up top,
// is where it belongs. An unconfigured agent renders nothing rather than a
// fabricated balance.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AGENT_WALLET_QUERY_KEY,
  agentIsBroke,
  fetchAgentWallet,
} from "@/lib/agent-budget";
import { toUsd2 } from "@/lib/agent-receipt";

export default function SpotterStatusLine() {
  const { data } = useQuery({
    queryKey: AGENT_WALLET_QUERY_KEY,
    queryFn: fetchAgentWallet,
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  if (data === null || data === undefined || data.balanceUsd === null) return null;
  const balance = toUsd2(data.balanceUsd);

  if (agentIsBroke(data.balanceUsd)) {
    return (
      <Link
        href="/agent"
        role="status"
        className="flex min-h-11 items-center gap-2 text-sm font-semibold text-warning hover:underline"
      >
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warning" />
        SPOTTER is out of check money. Checks wait until it is topped up; your
        stake is safe.
      </Link>
    );
  }

  return (
    <Link
      href="/agent"
      className="flex min-h-11 items-center gap-2 text-sm text-muted hover:text-foreground"
    >
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-otter" />
      SPOTTER is checking, with{" "}
      <span className="font-bold tabular-nums text-gold-deep">{balance} USDC</span>{" "}
      to spend on proof
    </Link>
  );
}
