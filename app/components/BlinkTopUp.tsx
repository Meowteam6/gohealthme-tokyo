"use client";

import { useState } from "react";
import {
  BLINK_CONFIGURED,
  BLINK_USDC_DECIMALS,
  startBlinkTopUp,
  type BlinkDepositOutcome,
} from "@/lib/blink";
import { ErrorNote } from "@/components/ui";

/**
 * One-tap stablecoin top-up via Blink. Pulls USDC from the user's existing
 * funded wallet on Base Sepolia (84532) into the merchant address. This is a
 * DECOUPLED top-up: it does not touch Arc and does not call any pool contract.
 * On success it reports the deposit to the parent through onConfirmed; a
 * separate balance ledger credits the user, and pool actions draw on that
 * balance later.
 *
 * Status machine and styling mirror app/components/JoinPool.tsx.
 */

type TopUpStatus =
  | { kind: "idle" }
  | { kind: "opening" }
  | { kind: "confirming" }
  | { kind: "done"; txHash: string }
  | { kind: "error"; message: string };

/** Base Sepolia explorer link for the settled deposit (Blink is not on Arc). */
function baseSepoliaTxUrl(txHash: string): string {
  return `https://sepolia.basescan.org/tx/${txHash}`;
}

/** A txHash-shaped value links to the explorer; a transfer id renders as text. */
function looksLikeTxHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export default function BlinkTopUp({
  amountUsdc,
  address,
  onConfirmed,
}: {
  /** Preset top-up amount in human USDC. Defaults to 25 when omitted. */
  amountUsdc?: number;
  /** Signed-in wallet address, passed to Blink as the reconciliation reference. */
  address: string;
  /** Called once the deposit settles, with the on-chain reference and uusdc. */
  onConfirmed: (result: { txHash: string; amountUusdc: number }) => void;
}) {
  const [status, setStatus] = useState<TopUpStatus>({ kind: "idle" });

  if (!BLINK_CONFIGURED) {
    return (
      <ErrorNote
        title="Top-up is not configured"
        detail="Set NEXT_PUBLIC_BLINK_USDC_ADDRESS and NEXT_PUBLIC_BLINK_MERCHANT_ADDRESS to enable Blink top-ups."
      />
    );
  }

  const resolvedAmount = amountUsdc !== undefined && amountUsdc > 0 ? amountUsdc : 10;

  const startTopUp = async () => {
    // "opening" covers both the widget tap and the in-flight settlement: the
    // SDK exposes a single resolving promise, not an intermediate confirm
    // event, so the flow goes opening -> done (or error) on resolution.
    setStatus({ kind: "opening" });
    try {
      const outcome: BlinkDepositOutcome = await startBlinkTopUp({
        amountUsdc: resolvedAmount,
        reference: address,
      });
      setStatus({ kind: "done", txHash: outcome.txHash });
      onConfirmed({ txHash: outcome.txHash, amountUusdc: outcome.amountUusdc });
    } catch (err) {
      // DepositError extends Error, so the Error branch covers Blink cancels
      // and signer/settlement failures alike; the fallback handles non-Error
      // throws. Ordering Error first keeps narrowing correct.
      const message =
        err instanceof Error
          ? err.message
          : "The Blink top-up did not complete.";
      setStatus({ kind: "error", message });
    }
  };

  if (status.kind === "done") {
    return (
      <div className="rounded-xl border border-accent/40 bg-accent-deep/40 p-4">
        <p className="text-base font-semibold text-accent">
          Top-up confirmed. {resolvedAmount.toFixed(2)} USDC is on its way to
          your balance.
        </p>
        {looksLikeTxHash(status.txHash) ? (
          <a
            href={baseSepoliaTxUrl(status.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block break-all text-sm text-accent underline"
          >
            View deposit on BaseScan
          </a>
        ) : (
          <p className="mt-1 break-all text-sm text-muted">
            Transfer reference {status.txHash}
          </p>
        )}
      </div>
    );
  }

  const busy = status.kind === "opening" || status.kind === "confirming";

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void startTopUp();
        }}
        className="w-full rounded-xl bg-accent-strong px-5 py-3.5 text-base font-semibold text-background hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status.kind === "opening"
          ? "Opening Blink..."
          : status.kind === "confirming"
            ? "Confirming deposit..."
            : `Top up ${resolvedAmount.toFixed(2)} USDC with Blink`}
      </button>
      <p className="text-xs text-muted">
        Blink pulls USDC from your existing wallet on Base Sepolia in one tap.
        It credits your in-app balance, which you draw on to join and fund
        pools. No bridge step, {BLINK_USDC_DECIMALS}-decimal USDC.
      </p>
      {status.kind === "error" ? (
        <ErrorNote
          title="Could not complete the top-up"
          detail={status.message}
          onRetry={() => setStatus({ kind: "idle" })}
        />
      ) : null}
    </div>
  );
}
