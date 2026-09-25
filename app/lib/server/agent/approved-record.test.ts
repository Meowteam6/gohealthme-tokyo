import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "@/lib/server/agent/ledger";
import {
  APPROVED_RECORD_HOLD_MS,
  approvedUnrecordedOf,
  withinRecordHold,
} from "@/lib/server/agent/approved-record";

// Which claims the settlement sweep must record on the human's behalf: pay
// decided, human approved, nothing on chain yet. Anything else stays out.

const AT = "2026-09-26T03:00:00.000Z";
const USER = "0x1111111111111111111111111111111111111111";
const GOAL = "0x" + "ab".repeat(32);

const plan: LedgerEntry = {
  kind: "plan",
  at: AT,
  steps: [{ service: "attester-read", label: "read", estUsd: "0.02" }],
  capUsd: "1.00",
  poolId: "7",
  participant: USER,
};

function verdict(ref: string, selfReported = false): LedgerEntry {
  return {
    kind: "verdict",
    at: AT,
    verified: true,
    confidence: "high",
    reason: "ok",
    ref,
    selfReported,
  };
}

function reason(decision: "pay" | "no-pay", ref: string): LedgerEntry {
  return { kind: "reason", at: AT, decision, note: "n", ref };
}

function approval(
  status: "requested" | "approved" | "declined" | "expired" | "cancelled",
  at = AT,
): LedgerEntry {
  return {
    kind: "approval",
    at,
    status,
    requestId: "apr_00000000-0000-0000-0000-000000000000",
    action: `settle:${GOAL}:1`,
    provider: "mock",
  };
}

const record: LedgerEntry = { kind: "record", at: AT, goalId: GOAL, registryStatus: "skipped" };

describe("approvedUnrecordedOf", () => {
  it("picks a wearable claim that was approved and never recorded", () => {
    const ledger = [plan, verdict("wearable-100"), reason("pay", "wearable-100"), approval("requested"), approval("approved")];
    expect(approvedUnrecordedOf(ledger)).toEqual({
      poolId: 7n,
      participant: USER,
      attesterId: "wearable-100",
      evidenceKind: "wearable",
      approvedAtMs: Date.parse(AT),
    });
  });

  it("names document and self-reported claims from the decision's own verdict", () => {
    expect(
      approvedUnrecordedOf([plan, verdict("job-1"), reason("pay", "job-1"), approval("approved")])
        ?.evidenceKind,
    ).toBe("document");
    expect(
      approvedUnrecordedOf([plan, verdict("job-2", true), reason("pay", "job-2"), approval("approved")])
        ?.evidenceKind,
    ).toBe("self-reported");
  });

  it("leaves out anything already recorded or settled", () => {
    const base = [plan, verdict("job-1"), reason("pay", "job-1"), approval("approved")];
    expect(approvedUnrecordedOf([...base, record])).toBeNull();
    expect(
      approvedUnrecordedOf([...base, { kind: "settle", at: AT, status: "settled" } as LedgerEntry]),
    ).toBeNull();
  });

  it("never records without a human yes or without a pay decision", () => {
    for (const status of ["requested", "declined", "expired", "cancelled"] as const) {
      expect(
        approvedUnrecordedOf([plan, verdict("job-1"), reason("pay", "job-1"), approval(status)]),
      ).toBeNull();
    }
    expect(approvedUnrecordedOf([plan, verdict("job-1"), reason("pay", "job-1")])).toBeNull();
    // The newest decision flipped to no-pay after the approval.
    expect(
      approvedUnrecordedOf([
        plan,
        verdict("job-1"),
        reason("pay", "job-1"),
        approval("approved"),
        reason("no-pay", "job-1"),
      ]),
    ).toBeNull();
  });

  it("needs the plan's pool linkage", () => {
    const noLink = { ...plan, poolId: undefined, participant: undefined } as LedgerEntry;
    expect(
      approvedUnrecordedOf([noLink, verdict("job-1"), reason("pay", "job-1"), approval("approved")]),
    ).toBeNull();
  });
});

describe("withinRecordHold", () => {
  const target = {
    poolId: 7n,
    participant: USER as `0x${string}`,
    attesterId: "job-1",
    evidenceKind: "document" as const,
    approvedAtMs: Date.parse(AT),
  };

  it("holds the pool for the window after the approval, then releases it", () => {
    expect(withinRecordHold(target, Date.parse(AT) + 60_000)).toBe(true);
    expect(withinRecordHold(target, Date.parse(AT) + APPROVED_RECORD_HOLD_MS)).toBe(false);
  });

  it("holds when the approval time is unreadable rather than refund a confirmed win", () => {
    expect(withinRecordHold({ ...target, approvedAtMs: null }, Date.now())).toBe(true);
  });
});
