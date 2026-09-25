// The Verdict: which screen a run's end shows, mapped from the states the
// server already reports (the claim ledger via lib/agent-receipt.ts, the pool
// and participant from the chain, the World approval status). Nothing on the
// server changes; this is the receipt-to-screen mapping. Pure and node-tested.
//
// The load-bearing rules, inherited from the claim rail and kept here:
//   - "won" is reached ONLY through a settle entry the ledger marked settled,
//     with a paid amount. A deferred verdict is "banked", never won.
//   - A run that failed for a reason that is not the player's (SPOTTER out of
//     budget, the verification service down) never reads as a loss.
//   - A declined, expired or cancelled human approval is its own screen with a
//     retry, and nothing is paid from it.

import {
  currentAttesterIdOf,
  currentReasonEntry,
  failureModeOf,
  type LedgerEntry,
  type RunStatus,
} from "@/lib/agent-receipt";
import type { ApprovalStatus } from "@/lib/game/lanes";

/** What the World ID for Agents step reported, as the Verdict reads it.
 *  "unavailable" means the lane is not on this build: the step is skipped. */
export type ApprovalState = ApprovalStatus | "unavailable" | "cancelled";

export type StopReason = "budget" | "not-in-run" | "service" | "error";

export type VerdictScreen =
  /** No claim yet. The run is still being played. */
  | { kind: "none" }
  /** SPOTTER is reading the data. */
  | { kind: "checking" }
  /** SPOTTER decided to pay and needs the player to confirm it is them. */
  | { kind: "confirm-human" }
  | { kind: "approval-failed"; outcome: "declined" | "expired" | "cancelled" }
  /** Verified, and the payout waits on the period end or on settlement. */
  | { kind: "banked"; selfReported: boolean }
  | { kind: "won"; paidUsd: string; txHash: string | null; selfReported: boolean }
  /** Read fine, goal not met yet, and later nights can still count. */
  | { kind: "not-yet" }
  /** Read fine, goal not met, and the run is over. */
  | { kind: "lost" }
  /** SPOTTER could not get a clean read. Not the player's fault; retry. */
  | { kind: "bad-read" }
  | { kind: "stopped"; reason: StopReason }
  | { kind: "cancelled"; refunded: boolean };

export interface VerdictInput {
  joined: boolean;
  poolCancelled: boolean;
  /** Settled on chain: no later night can change the outcome. */
  poolSettled: boolean;
  refunded: boolean;
  runStatus: RunStatus | null;
  ledger: LedgerEntry[] | null;
  approval: ApprovalState;
  /** What the approval card reported in this session, newer than the poll. */
  localApproval: "approved" | "declined" | "expired" | "cancelled" | null;
}

/** True when SPOTTER's current attempt decided to pay. */
export function payDecidedOf(ledger: LedgerEntry[] | null): boolean {
  if (ledger === null || ledger.length === 0) return false;
  return currentReasonEntry(ledger, currentAttesterIdOf(ledger))?.decision === "pay";
}

function selfReportedOf(ledger: LedgerEntry[] | null): boolean {
  return ledger?.some((e) => e.kind === "verdict" && e.selfReported === true) === true;
}

function effectiveApproval(input: VerdictInput): ApprovalState {
  if (input.approval === "unavailable") return "unavailable";
  // The card's own callback is fresher than the poll it came from; a new
  // pending request from the server supersedes a stale local failure.
  if (input.localApproval !== null && input.approval !== "pending") {
    return input.localApproval;
  }
  return input.approval;
}

export function verdictScreenOf(input: VerdictInput): VerdictScreen {
  if (!input.joined) return { kind: "none" };
  if (input.poolCancelled) return { kind: "cancelled", refunded: input.refunded };

  const ledger = input.ledger;
  const selfReported = selfReportedOf(ledger);

  if (input.runStatus === "paid" && ledger !== null) {
    const settled = ledger.find(
      (e) => e.kind === "settle" && e.status === "settled" && e.paidUsd !== undefined,
    );
    if (settled !== undefined && settled.kind === "settle" && settled.paidUsd !== undefined) {
      return {
        kind: "won",
        paidUsd: settled.paidUsd,
        txHash: settled.txHash ?? null,
        selfReported,
      };
    }
    // Paid status without a figure: never fabricate one.
    return { kind: "banked", selfReported };
  }

  switch (input.runStatus) {
    case null:
      return { kind: "none" };
    case "verifying": {
      if (!payDecidedOf(ledger)) return { kind: "checking" };
      const approval = effectiveApproval(input);
      switch (approval) {
        case "unavailable":
        case "approved":
          return { kind: "banked", selfReported };
        case "declined":
        case "expired":
        case "cancelled":
          return { kind: "approval-failed", outcome: approval };
        case "none":
        case "pending":
          return { kind: "confirm-human" };
      }
      break;
    }
    case "recorded":
      return { kind: "banked", selfReported };
    case "no-pay": {
      const mode = ledger !== null ? failureModeOf(ledger) : null;
      if (mode === "attester-offline") return { kind: "stopped", reason: "service" };
      if (mode === "evidence") return { kind: "bad-read" };
      return input.poolSettled ? { kind: "lost" } : { kind: "not-yet" };
    }
    case "cap-exceeded":
      return { kind: "stopped", reason: "budget" };
    case "blocked":
      return { kind: "stopped", reason: "not-in-run" };
    case "error":
      return { kind: "stopped", reason: "error" };
  }
  return { kind: "checking" };
}

export interface VerdictCopy {
  headline: string;
  body: string;
  /** SPOTTER pose for the stage (a real /spotter/spotter-<pose>.png). */
  pose: string;
}

/**
 * The words on each Verdict screen. Money and verdict copy is plain: a loss
 * says it is a loss, a stop that is not the player's fault says so, and the
 * payout copy never says the money is in the wallet before the claim lands.
 */
export function verdictCopy(screen: VerdictScreen): VerdictCopy | null {
  switch (screen.kind) {
    case "none":
      return null;
    case "checking":
      return {
        headline: "SPOTTER is checking",
        body: "I am reading your synced summary against the goal. Raw data stays on my server and never goes on chain. Only the verdict does.",
        pose: "detective",
      };
    case "confirm-human":
      return {
        headline: "Confirm it is you",
        body: "The numbers check out. Before any USDC moves, prove the person collecting is the person who played.",
        pose: "watching",
      };
    case "approval-failed":
      return {
        headline: "Run failed, ask again",
        body:
          screen.outcome === "expired"
            ? "The confirmation timed out, so nothing was paid. Your verified result is still here. Ask again and finish it this time."
            : screen.outcome === "declined"
              ? "The confirmation did not go through, so nothing was paid. Your verified result is still here. Ask again when you are ready."
              : "You closed the confirmation, so nothing was paid. Your verified result is still here. Ask again when you are ready.",
        pose: "facepalm",
      };
    case "banked":
      return screen.selfReported
        ? {
            headline: "Logged on your word",
            body: "This rests on a self-reported photo, so it is not verified. It pays when the run closes, and the receipt says self-reported.",
            pose: "standing",
          }
        : {
            headline: "Banked",
            body: "Verified and recorded on chain. I pay out when the run closes. Nothing for you to do but come back.",
            pose: "cheer",
          };
    case "won":
      return {
        headline: "You won the run",
        body: screen.selfReported
          ? "Settled on a self-reported claim. It is credited to you on chain; one tap pulls it into your wallet."
          : "Settled. It is credited to you on chain; one tap pulls it into your wallet.",
        pose: "payday",
      };
    case "not-yet":
      return {
        headline: "Not there yet",
        body: "Your data read fine and the goal is not met so far. Nights inside the run still count if they sync before it settles.",
        pose: "flex",
      };
    case "lost":
      return {
        headline: "Run lost",
        body: "The goal was not met, so this run pays nothing and your stake stays in the pool.",
        pose: "standing",
      };
    case "bad-read":
      return {
        headline: "I could not get a clean read",
        body: "That is the data, not you. Make sure your sensor synced the run, then have me check again.",
        pose: "facepalm",
      };
    case "stopped":
      return {
        headline:
          screen.reason === "budget"
            ? "I ran out of check money"
            : screen.reason === "not-in-run"
              ? "This wallet is not in the run"
              : screen.reason === "service"
                ? "The verifier is down"
                : "The check hit a problem",
        body:
          screen.reason === "budget"
            ? "Every claim runs under a hard budget and this one hit it before a verdict. Nothing was paid that the receipt does not show. Not your fault."
            : screen.reason === "not-in-run"
              ? "The chain does not have this wallet as a player, so nothing can be recorded for it. Enter the run first."
              : screen.reason === "service"
                ? "The verification service never answered, so nothing was judged and nothing was paid. Not your fault. Try again later."
                : "The receipt shows where it stopped. Nothing was paid that the receipt does not show.",
        pose: "facepalm",
      };
    case "cancelled":
      return screen.refunded
        ? {
            headline: "Run cancelled, stake returned",
            body: "Your stake is credited back. Claim it into your wallet from your run board.",
            pose: "standing",
          }
        : {
            headline: "Run cancelled, take your stake back",
            body: "This run was called off before it could settle. Your stake is yours; one tap credits it back.",
            pose: "standing",
          };
  }
}
