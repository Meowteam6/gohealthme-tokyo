"use client";

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
 *    degradation, with the env var named so an operator can fix it).
 *  - plain EOA: nothing loud - paying your own gas is the normal EOA path, not
 *    a degradation worth a banner.
 */
export default function GaslessBadge({ status }: { status: GaslessStatus }) {
  if (status.willSponsor) {
    return (
      <p
        className="flex items-center gap-2 rounded-xl border border-accent/40 bg-accent-deep/30 px-3 py-2 text-xs font-medium text-accent"
        aria-live="polite"
      >
        <span aria-hidden="true">*</span>
        Gas-free: sponsored by the Base paymaster. You pay no ETH gas on this
        transaction.
      </p>
    );
  }

  if (status.smartWalletDetected && !status.paymasterConfigured) {
    return (
      <p
        className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-medium text-warning"
        aria-live="polite"
      >
        Smart account connected, but no paymaster is configured, so you pay
        network gas. Set NEXT_PUBLIC_CDP_PAYMASTER_URL to sponsor it.
      </p>
    );
  }

  return null;
}
