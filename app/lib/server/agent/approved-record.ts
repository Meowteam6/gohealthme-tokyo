// Approved, not yet recorded: the claims the settlement sweep must finish.
// World ID for Agents, ETHGlobal Tokyo 2026 (QA punch list item 8).
//
// THE GAP. POST /api/agent/approval/complete flips the approval to approved
// and nothing else; the record write (the PASS that lets settle() pay) runs on
// the browser's next poll of the run loop. A player who confirms and closes
// the tab has no next poll. The sweep settled only claims with a record row,
// so it skipped this one, the pool phase settled its pool 30 minutes after
// period end, and settle() refunded the achiever as unadjudicated (B-2). A
// confirmed win became a refund.
//
// THE FIX. completeApproval queues the claim (approval.ts). The sweep reads
// it here and drives the SAME run loop the browser would have
// (runAgentForGoal) under the same per-goal lock, rebuilt from the ledger and
// the chain: pool linkage from the plan row, the attester ref from the
// current pay decision, the evidence kind from that decision's verdict, and
// the goal spec and period from the pool on chain. Nothing here decides money;
// the run loop's gate re-checks the approval and the pool state before any
// write, exactly as it does for the browser.
//
// CONFIRMATION OFF (the World ID kill switch, Andre, 2026-09-30). When the payout
// confirmation is switched off, a hit whose request was still open when the
// switch flipped has nothing left to wait for: the run loop's gate answers
// "off" and records it on the verdict. The sweep picks those up too
// (`confirmationRequired: false`), so a verified hit is paid rather than
// refunded for want of an open tab. That includes a lapsed ask (expired):
// reading the approval status materializes expiry, and the dashboard reads it
// for every open challenge, so a request that was open at the flip turns
// "expired" the first time the player looks after its ten minutes, and the
// run route would record it on the next poll anyway. A human no (declined)
// and a settled pool (cancelled) are never picked.
//
// SETTLED FIRST. recordApprovedClaim reads the pool before driving the run
// loop and stops on a settled one: settle() is one-shot and already refunded
// the claim, and with the confirmation off no gate stands between the sweep
// and a record write that can only revert, every tick of the hold window.

import { isAddress, type Address, type Hex } from "viem";
import type { LedgerEntry } from "@/lib/server/agent/ledger";
import type { RunResult } from "@/lib/server/agent/run";
import type { VERDICT_FACETS } from "@/lib/server/verdict";

export type EvidenceKind = keyof typeof VERDICT_FACETS;

export interface ApprovedRecordTarget {
  poolId: bigint;
  participant: Address;
  attesterId: string;
  evidenceKind: EvidenceKind;
  /** When the human approved (or, with the confirmation off, when SPOTTER
   *  asked), from the ledger row; null if unreadable. */
  approvedAtMs: number | null;
}

/**
 * How long the sweep keeps an approved-but-unrecorded claim's pool away from
 * the pool phase while it retries the record write. Past this, a claim whose
 * record keeps failing no longer blocks every other stake in the pool from
 * being refunded; the pool settles and the failure stays on the receipt.
 */
export const APPROVED_RECORD_HOLD_MS = 6 * 60 * 60 * 1000;

function evidenceKindOf(
  attesterId: string,
  verdict: Extract<LedgerEntry, { kind: "verdict" }> | undefined,
): EvidenceKind {
  if (verdict?.selfReported === true) return "self-reported";
  // The run route keys every wearable claim `wearable-<periodStart>`.
  if (attesterId.startsWith("wearable-")) return "wearable";
  return "document";
}

/**
 * The claim to record, or null. A claim qualifies only when ALL hold: no
 * record row yet, no settle row, SPOTTER's newest decision is pay, the newest
 * approval row is approved (or, with the confirmation switched off, still an
 * open request), and the plan row carries the pool linkage.
 */
export function approvedUnrecordedOf(
  ledger: readonly LedgerEntry[],
  options: {
    /** False when the payout confirmation is off on this deployment
     *  (approvalMode() === "off"). Defaults to true: only a human yes. */
    confirmationRequired?: boolean;
  } = {},
): ApprovedRecordTarget | null {
  const confirmationRequired = options.confirmationRequired ?? true;
  if (ledger.some((e) => e.kind === "record" || e.kind === "settle")) return null;

  const reasons = ledger.filter(
    (e): e is Extract<LedgerEntry, { kind: "reason" }> => e.kind === "reason",
  );
  const reason = reasons[reasons.length - 1];
  if (reason === undefined || reason.decision !== "pay" || reason.ref === undefined) {
    return null;
  }

  const approvals = ledger.filter(
    (e): e is Extract<LedgerEntry, { kind: "approval" }> => e.kind === "approval",
  );
  const approval = approvals[approvals.length - 1];
  if (approval === undefined) return null;
  const qualifies =
    approval.status === "approved" ||
    (!confirmationRequired &&
      (approval.status === "requested" || approval.status === "expired"));
  if (!qualifies) return null;

  const plan = ledger.find(
    (e): e is Extract<LedgerEntry, { kind: "plan" }> => e.kind === "plan",
  );
  if (
    plan?.poolId === undefined ||
    !/^\d+$/.test(plan.poolId) ||
    plan.participant === undefined ||
    !isAddress(plan.participant)
  ) {
    return null;
  }

  const attesterId = reason.ref;
  const verdict = [...ledger]
    .reverse()
    .find(
      (e): e is Extract<LedgerEntry, { kind: "verdict" }> =>
        e.kind === "verdict" && e.ref === attesterId,
    );
  const approvedAtMs = Date.parse(approval.at);
  return {
    poolId: BigInt(plan.poolId),
    participant: plan.participant as Address,
    attesterId,
    evidenceKind: evidenceKindOf(attesterId, verdict),
    approvedAtMs: Number.isFinite(approvedAtMs) ? approvedAtMs : null,
  };
}

/** True while the sweep should keep the pool phase off this claim's pool. */
export function withinRecordHold(target: ApprovedRecordTarget, nowMs: number): boolean {
  if (target.approvedAtMs === null) return true;
  return nowMs - target.approvedAtMs < APPROVED_RECORD_HOLD_MS;
}

/**
 * Drive the run loop for one approved claim, as the browser's next poll
 * would. Live dependencies are imported lazily so the sweep's tests can
 * replace this whole function with one mock.
 */
export async function recordApprovedClaim(
  goalId: Hex,
  target: ApprovedRecordTarget,
): Promise<RunResult> {
  const [
    { runAgentForGoal },
    { loadClaimPool },
    { arcReader },
    { getCircleClient },
    { liveBuyDeps },
    { geminiReason },
    { wearableEvidenceSource },
    { pollInference },
    { recordResult },
    { recordVerdict },
    { readLedger },
  ] = await Promise.all([
    import("@/lib/server/agent/run"),
    import("@/lib/server/evidence"),
    import("@/lib/server/agent/spotter"),
    import("@/lib/server/agent/wallet"),
    import("@/lib/server/agent/x402"),
    import("@/lib/server/agent/reason"),
    import("@/lib/server/agent/wearable"),
    import("@/lib/server/judge"),
    import("@/lib/server/oracle"),
    import("@/lib/server/verdict"),
    import("@/lib/server/agent/ledger"),
  ]);

  const pool = await loadClaimPool(target.poolId);
  if (pool === null) {
    throw new Error(`pool ${target.poolId} does not exist on chain`);
  }
  // Settled first (header): settle() is one-shot and already refunded this
  // claim, so a record write now can only revert. Nothing is written; the
  // sweep logs the miss and releases the claim when its hold window ends.
  if (pool.settled) {
    return { status: "error", ledger: await readLedger(goalId) };
  }
  const poll =
    target.evidenceKind === "wearable"
      ? wearableEvidenceSource({
          address: target.participant,
          periodStart: pool.periodStart,
          periodEnd: pool.periodEnd,
        })
      : (aid: string, spec: string) => pollInference(aid, spec, goalId);

  return runAgentForGoal(
    {
      spotter: { circle: getCircleClient(), reader: arcReader() },
      buy: liveBuyDeps(),
      reason: geminiReason,
      poll,
      legacyRecordResult: recordResult,
      legacyRecordVerdict: recordVerdict,
    },
    {
      goalId,
      poolId: target.poolId,
      address: target.participant,
      goalSpec: pool.goalSpec,
      attesterId: target.attesterId,
      evidenceKind: target.evidenceKind,
    },
  );
}
