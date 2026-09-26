// The words on the stake coin in JoinPool (docs/DESIGN.md, "Hold to commit").
// Pure, so the copy for every join state is node-tested: the coin must never
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
  /** The figure on the coin. */
  face: string;
  /** Accessible name of the coin. */
  label: string;
  /** The line under the coin while it can be held. */
  hint: string;
  /** Shown once the hold lands, while the wallet does its part. */
  committedHint: string;
  /** Set when the coin cannot be held right now, with the reason. */
  disabledReason: string | null;
}

export function joinCoinCopy(entryFee: bigint, phase: JoinCoinPhase): JoinCoinCopy {
  const free = entryFee === 0n;
  const amount = formatUsdc(entryFee);
  const face = free ? "Free" : amount;
  const label = free
    ? "Join this run for free"
    : `Put ${amount} USDC on yourself`;
  const hint =
    phase === "retry"
      ? "Your stake did not move. Hold the coin to try again."
      : free
        ? "Press and hold the coin to join. This run costs nothing."
        : `Press and hold the coin to stake ${amount} USDC on this run.`;
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
    committedHint: "Pocketed. Approve it in your wallet if it asks.",
    disabledReason,
  };
}
