// The words on the hold button in JoinPool (docs/DESIGN.md, "Hold to stake").
// Pure, so the copy for every join state is node-tested: the button must never
// read as holdable while a join is already in flight, and a failed join must
// say the stake did not move before it asks for another hold.

import { formatUsdc } from "@/lib/contract";

export type JoinCoinPhase =
  | "idle"
  | "wallet-loading"
  | "checking"
  | "joining"
  | "retry";

export interface JoinCoinCopy {
  /** The stake figure, e.g. "1.00", or "Free". */
  face: string;
  /** The button's words and accessible name, e.g. "Hold to stake 1.00 USDC". */
  label: string;
  /** The small line on the button while it can be held. */
  hint: string;
  /** The tap fallback's confirm button, e.g. "Stake 1.00 USDC". */
  confirmLabel: string;
  /** Shown once the hold lands, while the wallet does its part. */
  committedHint: string;
  /** Set when the button cannot be held right now, with the reason. */
  disabledReason: string | null;
}

export function joinCoinCopy(entryFee: bigint, phase: JoinCoinPhase): JoinCoinCopy {
  const free = entryFee === 0n;
  const amount = formatUsdc(entryFee);
  const face = free ? "Free" : amount;
  const label = free ? "Hold to join for free" : `Hold to stake ${amount} USDC`;
  const confirmLabel = free ? "Join for free" : `Stake ${amount} USDC`;
  const hint =
    phase === "retry"
      ? "Your stake did not move. Hold again to try."
      : free
        ? "About a second. This challenge costs nothing."
        : "About a second. Let go to cancel.";
  const disabledReason =
    phase === "wallet-loading"
      ? "Getting your wallet ready"
      : phase === "checking"
        ? "Checking your balance"
        : phase === "joining"
          ? "Sending your stake to Base Sepolia"
          : null;
  return {
    face,
    label,
    hint,
    confirmLabel,
    committedHint: free
      ? "Joining. Approve it in your wallet if it asks."
      : `Sending ${amount} USDC. Approve it in your wallet if it asks.`,
    disabledReason,
  };
}
