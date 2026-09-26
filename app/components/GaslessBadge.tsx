"use client";

import { useEffect } from "react";
import type { GaslessStatus } from "@/lib/useGasSponsorship";

/**
 * Honest, one-line indicator of how the next money-path transaction pays for
 * gas. It NEVER claims gasless unless the connected wallet actually advertises
 * the paymaster capability AND a paymaster URL is configured, so a degraded
 * path (EOA, or missing paymaster URL) is always visible rather than faked.
 *
 * Three states:
 *  - willSponsor: green - gas is sponsored by the Base paymaster.
 *  - smartWalletDetected but no paymaster URL: amber - a Base Account is
 *    connected but sponsorship is off, so the user still pays gas (visible
 *    degradation, in plain language; the operator-facing fix is logged to the
 *    console, never rendered into the page).
 *  - plain EOA: nothing loud - paying your own gas is the normal EOA path, not
 *    a degradation worth a banner.
 */

// Module-scoped so the operator hint is logged once per session, not on every
// render of the badge.
let paymasterHintLogged = false;

function PaymasterMissingNote() {
  useEffect(() => {
    if (paymasterHintLogged) return;
    paymasterHintLogged = true;
    console.warn(
      "[gasless] Smart account connected but no paymaster is configured; " +
        "set NEXT_PUBLIC_CDP_PAYMASTER_URL to sponsor gas.",
    );
  }, []);

  return (
    <p
      className="m-0 rounded-lg bg-fill-quiet px-3 py-2 text-[0.8125rem] text-muted shadow-[inset_0_0_0_1px_var(--border-strong)]"
      aria-live="polite"
    >
      There may be a small network fee for this one.
    </p>
  );
}

export default function GaslessBadge({ status }: { status: GaslessStatus }) {
  // An unsponsored wallet being sent test ETH for gas before its first write.
  // One plain line in place, no modal.
  if (status.dripLine !== undefined && status.dripLine !== null) {
    return (
      <p
        className="m-0 rounded-lg bg-fill-quiet px-3 py-2 text-[0.8125rem] text-muted shadow-[inset_0_0_0_1px_var(--border)]"
        role="status"
        aria-live="polite"
      >
        {status.dripLine}
      </p>
    );
  }

  if (status.willSponsor) {
    return (
      <p
        className="m-0 text-[0.8125rem] leading-[1.45] text-haze"
        aria-live="polite"
      >
        Gas-free: the Base paymaster covers the network fee, so you pay no ETH.
      </p>
    );
  }

  if (status.smartWalletDetected && !status.paymasterConfigured) {
    return <PaymasterMissingNote />;
  }

  return null;
}
