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

import type { SpotterPose } from "@/lib/spotter-poses";
import {
  currentAttesterIdOf,
  currentReasonEntry,
  failureModeOf,
  noPayOverturned,
  unconfirmedHitOf,
  type LedgerEntry,
  type RunStatus,
} from "@/lib/agent-receipt";
import type { MissOutcome } from "@/lib/agent-history";
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
  /** SPOTTER decided to pay and is waiting on the player's World ID OK.
   *  confirmByMs: on a run that can record a miss, the latest moment the run
   *  can settle (lib/miss-grace.ts missConfirmByMs); a hit not confirmed by
   *  then gets its stake back without a share. */
  | { kind: "confirm-human"; confirmByMs?: number }
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
  /** Read fine, goal not met yet, and later nights can still count.
   *  lastCheckMs: on a run that can record a miss, the moment SPOTTER takes
   *  its last look (periodEnd + MISS_GRACE_HOURS); nights synced after it no
   *  longer count. Absent on runs that can never record a miss. */
  | { kind: "not-yet"; lastCheckMs?: number; confirmByMs?: number }
  /** The run is over, the wearable covered it, the goal was not met, and the
   *  miss is on chain. pending until the pool settles; then forfeited (the
   *  stake went to the players who hit), refunded (nobody hit) or cancelled
   *  (the creator cancelled before settle; the stake can be claimed back). */
  | {
      kind: "missed";
      outcome: MissOutcome;
      stakeUsd: string | null;
    }
  /** The pool settled with a hit SPOTTER read but the player never
   *  confirmed: no result was recorded, so settle() credited the stake back
   *  (B-2) without a share. Never "not met", never "no proof". */
  | { kind: "hit-unconfirmed" }
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
  /** On a run that can record a miss: periodEnd + MISS_GRACE_HOURS, in epoch
   *  ms (lib/miss-grace.ts). Null or absent on every other run. */
  missDeadlineMs?: number | null;
  /** On a run that can record a miss: the latest moment it settles, by which
   *  a hit must be confirmed (lib/miss-grace.ts missConfirmByMs). */
  missConfirmByMs?: number | null;
}

/** The miss screen a ledger encodes, or null when it holds no recorded miss.
 *  Shared with the wearable check so both say the same thing. */
export function missedScreenOf(
  ledger: LedgerEntry[] | null,
): Extract<VerdictScreen, { kind: "missed" }> | null {
  if (ledger === null) return null;
  const record = ledger.find((e) => e.kind === "record" && e.verdict === false);
  if (record === undefined || record.kind !== "record") return null;
  const closed = ledger.find((e) => e.kind === "settle" && e.status === "closed");
  const outcome =
    closed !== undefined && closed.kind === "settle" && closed.outcome !== undefined
      ? closed.outcome
      : "pending";
  return { kind: "missed", outcome, stakeUsd: record.stakeUsd ?? null };
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

export function verdictScreenOf(raw: VerdictInput): VerdictScreen {
  // A no-pay status that lags its own ledger (a verified read landed after
  // the no-pay) follows the newest read: SPOTTER is re-deciding it.
  const input: VerdictInput =
    raw.runStatus === "no-pay" && raw.ledger !== null && noPayOverturned(raw.ledger)
      ? { ...raw, runStatus: "verifying" }
      : raw;
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

  // A recorded miss is final whether or not the pool has settled yet.
  if (input.runStatus === "missed") {
    return (
      missedScreenOf(ledger) ?? { kind: "missed", outcome: "pending", stakeUsd: null }
    );
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
      return typeof input.missConfirmByMs === "number"
        ? { kind: "confirm-human", confirmByMs: input.missConfirmByMs }
        : { kind: "confirm-human" };
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
      if (typeof input.missDeadlineMs !== "number") return { kind: "not-yet" };
      return typeof input.missConfirmByMs === "number"
        ? {
            kind: "not-yet",
            lastCheckMs: input.missDeadlineMs,
            confirmByMs: input.missConfirmByMs,
          }
        : { kind: "not-yet", lastCheckMs: input.missDeadlineMs };
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
      // The last read showed the goal met and nothing was recorded: the hit
      // was never confirmed. Say that, not "settled" with no reason.
      return unconfirmedHitOf(ledger) && !approvedOnLedger(ledger)
        ? { kind: "hit-unconfirmed" }
        : { kind: "settled-final" };
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
    case "hit-unconfirmed":
      return true;
    case "missed":
      // Only a refunded miss has anything to claim.
      return screen.outcome === "refunded";
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
  /** Set when SPOTTER read a hit on this run that is not confirmed yet (the
   *  status route's hit flag). confirmByMs is the latest the run settles on
   *  a run that can record a miss, null when it has no such deadline. */
  hit?: { confirmByMs: number | null },
): RunApprovalLine | null {
  if (run.settled || run.cancelled || run.resultRecorded) return null;
  if (hit !== undefined && (status === "none" || status === "unknown")) {
    // SPOTTER records a miss on its own; a hit only counts once the player
    // opens the run and confirms it, so a hit nobody confirmed must say so.
    return {
      text:
        hit.confirmByMs !== null
          ? `Your wearable shows the goal met. Open the run and confirm it with World ID before ${formatMoment(hit.confirmByMs)}, or your stake comes back without a share.`
          : "Your wearable shows the goal met. Open the run and confirm it with World ID before it settles, or your stake comes back without a share.",
      tone: "warning",
      openRun: true,
    };
  }
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

/** A local moment for the not-yet deadline, date and time. */
function formatMoment(ms: number): string {
  return new Date(ms).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface VerdictCopy {
  headline: string;
  body: string;
  /** SPOTTER pose for the stage (lib/spotter-poses.ts). */
  pose: SpotterPose;
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
        body:
          screen.confirmByMs !== undefined
            ? `You hit it. Confirm with World ID by ${formatMoment(screen.confirmByMs)} to get paid; unconfirmed, only your stake comes back.`
            : "You hit it. Confirm with World ID to get paid; unconfirmed, only your stake comes back.",
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
            body: "Verified and recorded on chain. The contract pays out when the run settles. Nothing for you to do but come back.",
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
        body:
          screen.lastCheckMs !== undefined
            ? `Your data read fine and the goal is not met so far. Nights inside the run still count if your wearable syncs them by ${formatMoment(screen.lastCheckMs)}. After that, SPOTTER records a miss on its own when your wearable covered the whole run and shows it; if it did not sync the whole run, nothing is recorded and your stake comes back. A hit is different: it only counts once you open the run and confirm it${screen.confirmByMs !== undefined ? `, by ${formatMoment(screen.confirmByMs)} at the latest` : " before it settles"}.`
            : "Your data read fine and the goal is not met so far. Nights inside the run still count if they sync before it settles.",
        pose: "flex",
      };
    case "missed": {
      const stake = screen.stakeUsd !== null ? `Your ${screen.stakeUsd} stake` : "Your stake";
      return {
        headline: "Missed",
        body:
          screen.outcome === "forfeited"
            ? `Your wearable covered the whole run and shows the goal was not met. ${stake} went to the players who hit.`
            : screen.outcome === "refunded"
              ? "Your wearable shows the goal was not met, but nobody hit, so every stake came back, yours included. Claim it below."
              : screen.outcome === "cancelled"
                ? "Your wearable shows the goal was not met, but the creator cancelled the run before it settled, so every stake can be claimed back, yours included."
                : // Pending until settle, so conditional (docs/MONEY-FLOWS.md section 3).
                  `Your wearable covered the whole run and shows the goal was not met, so the miss is recorded on chain. At settle ${stake.charAt(0).toLowerCase()}${stake.slice(1)} goes to who hits, or comes back if nobody does. A run the creator cancels before it settles gives every stake back too.`,
        pose: "standing",
      };
    }
    case "hit-unconfirmed":
      return {
        headline: "Hit, not confirmed",
        body: "Your wearable showed the goal met, but the hit was not confirmed with World ID before the run settled, so nothing was recorded. The settle credited your stake back to you without a share; claim it below.",
        pose: "facepalm",
      };
    case "lost":
      // HealthPoolsV3 B-2: a participant with no recorded result is refunded
      // at settle. SPOTTER records a miss only when the wearable covered the
      // whole run (lib/server/agent/miss.ts); a recorded miss shows as
      // "missed", so "lost" with a recorded result is a legacy chain state.
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
        body: "That is the data, not you. Make sure your wearable synced the run, then have me check again.",
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

/**
 * How often the verdict stage re-reads server state. While SPOTTER is
 * writing, or waiting on the human (the World ID window is minutes, not
 * hours), the page polls so the confirm button appears without a reload.
 */
export function pollWhileLive(status: RunStatus | null): number | false {
  return status === "recorded" || status === "verifying" || status === "awaiting-approval"
    ? 5_000
    : false;
}
