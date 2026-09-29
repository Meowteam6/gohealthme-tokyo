"use client";

// Persistent "where's my test money" affordance for signed-in users. It sits in
// the header note row and answers two things at a glance: how much spendable
// USDC the wallet holds, and how to get more in one tap. The balance shown is
// the ON-CHAIN Base Sepolia USDC (what pays entry fees), not the in-app
// ledger, because that is the number that decides whether an action can run.
//
// Tapping "Get test USDC" runs the same grant-and-deliver chain the funding
// screen uses: it reuses the guarded /api/blink/topup and /api/balance/withdraw
// endpoints, adds no new money path, and honours their caps. On success the
// on-chain balance query is invalidated so the number visibly climbs.
//
// Honesty: the copy and the tooltip both state this is test USDC with no real
// value. Renders nothing for signed-out users rather than showing a zero.

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatUsdc } from "@/lib/contract";
import { useEmbeddedWallet } from "@/lib/wallet";
import {
  fetchWalletUsdc,
  reconcileWalletUsdc,
  useTestUsdcFunding,
} from "@/lib/faucet-funding";
import { buttonClasses } from "@/components/ui";

/** What the last tap actually did. `fallback` keeps its dashboard link for
 *  real failures; `enough` and `capped` are not failures and get no link. */
type ChipState =
  | { kind: "idle" }
  | { kind: "done" }
  | { kind: "enough" }
  | { kind: "capped"; message: string }
  | { kind: "fallback"; message: string };

export default function TestUsdcChip() {
  const { authenticated, address } = useEmbeddedWallet();
  const queryClient = useQueryClient();
  const { phase, funding, fund } = useTestUsdcFunding();
  const [state, setState] = useState<ChipState>({ kind: "idle" });

  const balanceQuery = useQuery({
    queryKey: ["wallet-usdc", address],
    queryFn: () => fetchWalletUsdc(address as `0x${string}`),
    enabled: authenticated && address !== null,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false,
  });

  // Only for signed-in wallets. A signed-out visitor gets the sign-in note next
  // to this, not a misleading zero balance.
  if (!authenticated || address === null) return null;

  const run = async () => {
    setState({ kind: "idle" });
    // The balance the chip is showing right now, so the reconcile target is the
    // expected total after delivery rather than the delivered amount alone.
    const baseline = balanceQuery.data ?? 0n;
    const result = await fund(address);
    if (result.kind === "funded") {
      setState({ kind: "done" });
      // Existing invalidation: one immediate refetch. On its own this often
      // reads the pre-fund figure, because the RPC read replica lags the tx.
      await queryClient.invalidateQueries({
        queryKey: ["wallet-usdc", address],
      });
      // Reconcile against real reads: poll balanceOf on a short interval and
      // write each genuine read into the cache, so the chip climbs to the true
      // balance within a few seconds instead of waiting for the 30s interval or
      // a re-login. Every value shown is a live chain read, never a fake bump.
      void reconcileWalletUsdc(
        address as `0x${string}`,
        baseline + result.movedUusdc,
        {
          onRead: (value) => {
            queryClient.setQueryData(["wallet-usdc", address], value);
          },
        },
      );
    } else if (result.kind === "enough") {
      setState({ kind: "enough" });
    } else if (result.kind === "budget-exhausted") {
      setState({ kind: "capped", message: result.message });
    } else {
      setState({
        kind: "fallback",
        message:
          result.kind === "error"
            ? result.message
            : "Nothing was added and nothing was waiting to be delivered.",
      });
    }
  };

  const balance = balanceQuery.data;
  const label = funding
    ? phase === "moving"
      ? "Delivering..."
      : "Adding..."
    : "Add practice money";

  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <span
        title="Not real money. For trying things out, never charged."
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-edge bg-surface px-3 text-xs text-muted"
      >
        <span className="font-semibold">Practice money</span>
        <span className="font-display text-sm font-extrabold tabular-nums text-gold-deep">
          {balance !== undefined ? `${formatUsdc(balance)} USDC` : "--"}
        </span>
      </span>
      <button
        type="button"
        disabled={funding}
        onClick={() => {
          void run();
        }}
        title="Add practice money to your account. Not real money, never charged."
        className={`${buttonClasses({ variant: "secondary", size: "sm" })} px-3`}
      >
        {label}
      </button>
      {state.kind === "done" ? (
        <span className="text-[11px] text-accent-deep sm:text-xs" aria-live="polite">
          Added
        </span>
      ) : null}
      {state.kind === "enough" ? (
        <span className="text-[11px] text-muted sm:text-xs" aria-live="polite">
          you already have enough to play - the faucet only tops up wallets
          that are low
        </span>
      ) : null}
      {state.kind === "capped" ? (
        <span className="text-[11px] text-warning sm:text-xs" aria-live="polite">
          {state.message}
        </span>
      ) : null}
      {state.kind === "fallback" ? (
        <span className="text-[11px] text-warning sm:text-xs" aria-live="polite">
          {state.message}{" "}
          <Link href="/dashboard" className="underline">
            open My challenges
          </Link>
        </span>
      ) : null}
    </div>
  );
}
