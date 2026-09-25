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
/** What the approval card reported in this session. It is fresher than the
 *  ledger read it came from, and only until the ledger moves on. */
export interface LocalApproval {
  outcome: "approved" | "declined" | "expired" | "cancelled";
  /** Ledger length when the card reported. Once the ledger grows (a new
   *  request row, the record row) the ledger is the truth again. */
  ledgerLength: number;
}

export type StopReason = "budget" | "not-in-run" | "service" | "error";

export type VerdictScreen =
  /** No claim yet. The run is still being played. */
  | { kind: "none" }
  /** SPOTTER is reading the data. */
  | { kind: "checking" }
  /** SPOTTER decided to pay and is waiting on the player's World ID OK. */
  | { kind: "confirm-human" }
  /** The player confirmed; SPOTTER is recording the result. */
  | { kind: "confirmed" }
  /** The goal was met but the human confirmation did not happen. `settled`
   *  is true once the pool settled underneath it: nothing can be asked again
   *  and the stake came back through the settle's refund. */
  | {
      kind: "approval-failed";
      outcome: "declined" | "expired" | "cancelled";
      settled: boolean;
    }
  /** Verified, and the payout waits on the period end or on settlement. */
  | { kind: "banked"; selfReported: boolean }
  | { kind: "won"; paidUsd: string; txHash: string | null; selfReported: boolean }
  /** Read fine, goal not met yet, and later nights can still count. */
  | { kind: "not-yet" }
  /** Read fine, goal not met, and the run is over. `stakeBack` is true when no
   *  miss was recorded on chain, so settle() credited the stake back (B-2). */
  | { kind: "lost"; stakeBack: boolean }
  /** The pool settled and this claim has no win row to show: every result is
   *  final, and whatever settle() credited is claimable below. Never "won". */
  | { kind: "settled-final" }
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
  localApproval: LocalApproval | null;
  /** The participant's on-chain resultRecorded flag, when read. Decides
   *  whether a settled loss got its stake back (unrecorded, B-2). */
  resultRecorded?: boolean;
}

/** True when SPOTTER's current attempt decided to pay. */
export function payDecidedOf(ledger: LedgerEntry[] | null): boolean {
  if (ledger === null || ledger.length === 0) return false;
  return currentReasonEntry(ledger, currentAttesterIdOf(ledger))?.decision === "pay";
}

function selfReportedOf(ledger: LedgerEntry[] | null): boolean {
  return ledger?.some((e) => e.kind === "verdict" && e.selfReported === true) === true;
}

/** The card's report, while the ledger has not moved past it. */
function freshLocal(input: VerdictInput): LocalApproval["outcome"] | null {
  if (input.localApproval === null) return null;
  const length = input.ledger?.length ?? 0;
  return length <= input.localApproval.ledgerLength ? input.localApproval.outcome : null;
}

export function verdictScreenOf(input: VerdictInput): VerdictScreen {
  if (!input.joined) return { kind: "none" };
  if (input.poolCancelled) return { kind: "cancelled", refunded: input.refunded };

  const ledger = input.ledger;
  const selfReported = selfReportedOf(ledger);
  const local = freshLocal(input);

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
    return input.poolSettled ? { kind: "settled-final" } : { kind: "banked", selfReported };
  }

  if (input.poolSettled) return settledScreenOf(input, ledger, local);

  switch (input.runStatus) {
    case null:
      return { kind: "none" };
    case "verifying":
      // An approved row falls through to "verifying" while the record lands.
      if (local === "approved" || approvedOnLedger(ledger)) return { kind: "confirmed" };
      return { kind: "checking" };
    // World ID for Agents: SPOTTER asked the player to confirm (ledger rows
    // written by the world-agents lane, read by lib/agent-receipt.ts).
    case "awaiting-approval":
      if (local === "approved") return { kind: "confirmed" };
      if (local === "declined" || local === "expired" || local === "cancelled") {
        return { kind: "approval-failed", outcome: local, settled: false };
      }
      return { kind: "confirm-human" };
    case "approval-declined":
      return { kind: "approval-failed", outcome: "declined", settled: false };
    case "approval-expired":
      return { kind: "approval-failed", outcome: "expired", settled: false };
    case "approval-cancelled":
      return { kind: "approval-failed", outcome: "cancelled", settled: false };
    case "recorded":
      return { kind: "banked", selfReported };
    case "no-pay": {
      const mode = ledger !== null ? failureModeOf(ledger) : null;
      if (mode === "attester-offline") return { kind: "stopped", reason: "service" };
      if (mode === "evidence") return { kind: "bad-read" };
      return { kind: "not-yet" };
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

/**
 * The screen once the pool settled (not cancelled) and the ledger holds no
 * paid win. Nothing can be checked, confirmed or asked again from here: a
 * settle is one-shot. A declined or expired confirmation stays its own screen
 * so the player learns why no prize came; a no-pay read is a loss; a bad read
 * or a down verifier is still not the player's fault; everything else (no
 * claim, still checking, waiting on the human, banked without a settle row)
 * is final and shows what settle() credited.
 */
function settledScreenOf(
  input: VerdictInput,
  ledger: LedgerEntry[] | null,
  local: LocalApproval["outcome"] | null,
): VerdictScreen {
  const stakeBack = input.resultRecorded !== true;
  switch (input.runStatus) {
    case "approval-declined":
      return { kind: "approval-failed", outcome: "declined", settled: true };
    case "approval-expired":
      return { kind: "approval-failed", outcome: "expired", settled: true };
    case "approval-cancelled":
      return { kind: "approval-failed", outcome: "cancelled", settled: true };
    case "awaiting-approval":
      if (local === "declined" || local === "expired") {
        return { kind: "approval-failed", outcome: local, settled: true };
      }
      return { kind: "approval-failed", outcome: "cancelled", settled: true };
    case "no-pay": {
      const mode = ledger !== null ? failureModeOf(ledger) : null;
      if (mode === "attester-offline") return { kind: "stopped", reason: "service" };
      if (mode === "evidence") return { kind: "bad-read" };
      return { kind: "lost", stakeBack };
    }
    default:
      return { kind: "settled-final" };
  }
}

/** Which screens carry the claim tap (ClaimPayout) inside the Verdict, so the
 *  page does not render a second one above it. */
export function verdictShowsClaim(screen: VerdictScreen): boolean {
  switch (screen.kind) {
    case "won":
    case "cancelled":
    case "settled-final":
    case "lost":
      return true;
    case "approval-failed":
      return screen.settled;
    default:
      return false;
  }
}

function approvedOnLedger(ledger: LedgerEntry[] | null): boolean {
  if (ledger === null) return false;
  for (let i = ledger.length - 1; i >= 0; i--) {
    const e = ledger[i];
    if (e.kind === "record") return false;
    if (e.kind === "approval") return e.status === "approved";
  }
  return false;
}

/** The approval status as GET /api/agent/approval/status reports it, or
 *  "unknown" when that read failed. */
export type RunApprovalStatus =
  | "none"
  | "pending"
  | "approved"
  | "declined"
  | "expired"
  | "cancelled"
  | "unknown";

export interface RunApprovalLine {
  text: string;
  tone: "accent" | "warning" | "muted";
  /** True when opening the run is the player's next action. */
  openRun: boolean;
}

/**
 * The dashboard line for a run whose payout waits on the player's World ID
 * OK. Without it, a player who ran the check and left saw an ordinary run
 * board while SPOTTER waited on them, and later a refund that read as "no
 * proof was submitted". Null when there is nothing to say: no ask, already
 * recorded, or a finished run (the result label covers that).
 */
export function runApprovalLine(
  status: RunApprovalStatus,
  run: { settled: boolean; cancelled: boolean; resultRecorded: boolean },
): RunApprovalLine | null {
  if (run.settled || run.cancelled || run.resultRecorded) return null;
  switch (status) {
    case "pending":
      return {
        text: "SPOTTER decided to pay this run and is waiting on your OK. Open it and confirm before the window closes.",
        tone: "warning",
        openRun: true,
      };
    case "declined":
      return {
        text: "You said no to this payout, so nothing moved. Open the run to ask again before it settles.",
        tone: "warning",
        openRun: true,
      };
    case "expired":
      return {
        text: "Your payout confirmation timed out, so nothing moved. Open the run to ask again before it settles.",
        tone: "warning",
        openRun: true,
      };
    case "approved":
      return {
        text: "You confirmed the payout. SPOTTER is writing your result on chain.",
        tone: "accent",
        openRun: false,
      };
    case "unknown":
      return {
        text: "I could not check whether this run is waiting on your OK. Open it to see.",
        tone: "muted",
        openRun: true,
      };
    default:
      return null;
  }
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
        body: "The numbers check out. Before any USDC moves, confirm with World ID that the person collecting is the person who played. No confirmation, no payout.",
        pose: "watching",
      };
    case "confirmed":
      return {
        headline: "Confirmed",
        body: "You confirmed it is you. SPOTTER is recording your result on chain now, and the payout follows when the run allows.",
        pose: "thumbsup",
      };
    case "approval-failed":
      // The goal was met; only the human confirmation is missing. Never
      // "run failed": that reads as a loss to someone who hit the goal.
      return {
        headline: "Payout not confirmed",
        body: screen.settled
          ? screen.outcome === "declined"
            ? "You hit the goal, then said no to the payout, and the run settled after that. No prize went out. The settle credited your stake back to you; claim it below."
            : "You hit the goal, but the run settled before you confirmed the payout. No prize went out and there is nothing left to ask. The settle credited your stake back to you; claim it below."
          : screen.outcome === "expired"
            ? "You hit the goal. The confirmation window closed before you answered, so nothing moved yet. Ask again below and finish it before the run settles."
            : screen.outcome === "declined"
              ? "You hit the goal and said no to the payout, so nothing moved. If that was a mistake, ask again below before the run settles."
              : "The confirmation was withdrawn before you answered, so nothing moved.",
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
      // HealthPoolsV3 B-2: a participant with no recorded result is refunded
      // at settle. SPOTTER never records a miss, so that is the normal case.
      return {
        headline: "Run lost",
        body: screen.stakeBack
          ? "The goal was not met, so this run pays no prize. No miss was written on chain, so the settle credited your stake back to you; claim it below."
          : "The goal was not met and the miss was recorded on chain, so this run pays you no prize and your stake stayed in the pool.",
        pose: "standing",
      };
    case "settled-final":
      return {
        headline: "Run settled",
        body: "Every result on this run is final on chain. Whatever the settle credited to you is below, ready to pull into your wallet.",
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
            body: "The creator called this run off before it settled, so nobody was paid a prize. Your stake is yours; one tap credits it back.",
            pose: "standing",
          };
  }
}
