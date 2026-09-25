import { describe, expect, it } from "vitest";
import { runStatusFromLedger, type LedgerEntry } from "@/lib/agent-receipt";
import {
  payDecidedOf,
  verdictCopy,
  verdictScreenOf,
  type VerdictInput,
  type VerdictScreen,
} from "@/lib/game/verdict";

// The receipt-to-screen mapping. The ledger shapes here are the ones the server
// writes (lib/server/agent/ledger.ts); runStatus is derived from them with the
// same function the pool page uses, so the mapping is tested end to end over
// real ledger shapes, not hand-picked statuses.

const AT = "2026-09-26T00:00:00.000Z";

const spend: LedgerEntry = {
  kind: "spend",
  at: AT,
  service: "attester-read",
  label: "wearable summary read",
  amountUsd: "0.02",
  ref: "job-1",
  settlement: "prepaid",
};

function verdict(verified: boolean, extra: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    kind: "verdict",
    at: AT,
    verified,
    confidence: "high",
    reason: "summary read",
    ref: "job-1",
    ...extra,
  } as LedgerEntry;
}

function reason(decision: "pay" | "no-pay"): LedgerEntry {
  return { kind: "reason", at: AT, decision, note: "n", ref: "job-1" };
}

const recordEntry: LedgerEntry = {
  kind: "record",
  at: AT,
  goalId: "0x01",
  registryStatus: "skipped",
};

const deferred: LedgerEntry = { kind: "settle", at: AT, status: "deferred" };
const settled: LedgerEntry = {
  kind: "settle",
  at: AT,
  status: "settled",
  paidUsd: "12.50",
  txHash: "0xfeed",
};

function screenFor(
  ledger: LedgerEntry[] | null,
  overrides: Partial<VerdictInput> = {},
): VerdictScreen {
  return verdictScreenOf({
    joined: true,
    poolCancelled: false,
    poolSettled: false,
    refunded: false,
    runStatus: ledger === null ? null : runStatusFromLedger(ledger),
    ledger,
    localApproval: null,
    ...overrides,
  });
}

describe("verdictScreenOf", () => {
  it("shows nothing for a player who is not in the run", () => {
    expect(screenFor([spend], { joined: false })).toEqual({ kind: "none" });
  });

  it("shows nothing before a claim exists", () => {
    expect(screenFor(null)).toEqual({ kind: "none" });
    expect(screenFor([])).toEqual({ kind: "none" });
  });

  it("is checking while SPOTTER reads and has not decided", () => {
    expect(screenFor([spend])).toEqual({ kind: "checking" });
    expect(payDecidedOf([spend])).toBe(false);
  });

  function approval(
    status: "requested" | "approved" | "declined" | "expired" | "cancelled",
  ): LedgerEntry {
    return {
      kind: "approval",
      at: AT,
      status,
      requestId: "req-1",
      action: "settle:0x01:1",
      provider: "mock",
    } as LedgerEntry;
  }
  const decided = [spend, verdict(true), reason("pay")];

  it("keeps checking after a pay decision until SPOTTER asks", () => {
    expect(payDecidedOf(decided)).toBe(true);
    expect(screenFor(decided)).toEqual({ kind: "checking" });
  });

  it("asks the player to confirm it is them when the run awaits approval", () => {
    const ledger = [...decided, approval("requested")];
    expect(runStatusFromLedger(ledger)).toBe("awaiting-approval");
    expect(screenFor(ledger)).toEqual({ kind: "confirm-human" });
  });

  it("maps declined, expired and cancelled approvals to their own screens", () => {
    expect(screenFor([...decided, approval("requested"), approval("declined")])).toEqual({
      kind: "approval-failed",
      outcome: "declined",
    });
    expect(screenFor([...decided, approval("requested"), approval("expired")])).toEqual({
      kind: "approval-failed",
      outcome: "expired",
    });
    expect(screenFor([...decided, approval("requested"), approval("cancelled")])).toEqual({
      kind: "approval-failed",
      outcome: "cancelled",
    });
  });

  it("shows confirmed while the record lands after an approval", () => {
    const ledger = [...decided, approval("requested"), approval("approved")];
    expect(runStatusFromLedger(ledger)).toBe("verifying");
    expect(screenFor(ledger)).toEqual({ kind: "confirmed" });
  });

  it("trusts the card's report only until the ledger moves on (ask again)", () => {
    const asked = [...decided, approval("requested")];
    expect(
      screenFor(asked, { localApproval: { outcome: "declined", ledgerLength: asked.length } }),
    ).toEqual({ kind: "approval-failed", outcome: "declined" });
    // A new request row after "ask again": the ledger is the truth again.
    const again = [...asked, approval("declined"), approval("requested")];
    expect(
      screenFor(again, { localApproval: { outcome: "declined", ledgerLength: asked.length } }),
    ).toEqual({ kind: "confirm-human" });
  });

  it("never pays or banks on an approval alone", () => {
    for (const status of ["requested", "declined", "expired", "cancelled"] as const) {
      const kind = screenFor([...decided, approval(status)]).kind;
      expect(kind).not.toBe("won");
      expect(kind).not.toBe("banked");
    }
  });

  it("banks a verified, deferred result and never calls it won", () => {
    const ledger = [spend, verdict(true), reason("pay"), recordEntry, deferred];
    expect(screenFor(ledger)).toEqual({ kind: "banked", selfReported: false });
  });

  it("wins only on a settled entry with a paid figure", () => {
    const ledger = [spend, verdict(true), reason("pay"), recordEntry, settled];
    expect(screenFor(ledger)).toEqual({
      kind: "won",
      paidUsd: "12.50",
      txHash: "0xfeed",
      selfReported: false,
    });
    const noFigure: LedgerEntry = { kind: "settle", at: AT, status: "settled" };
    expect(screenFor([spend, verdict(true), reason("pay"), noFigure]).kind).toBe("banked");
  });

  it("carries the self-reported tier into the win and the bank", () => {
    const ledger = [
      spend,
      verdict(true, { selfReported: true } as Partial<LedgerEntry>),
      reason("pay"),
      settled,
    ];
    expect(screenFor(ledger)).toMatchObject({ kind: "won", selfReported: true });
  });

  it("says not yet while later nights can still count, and lost once settled", () => {
    const ledger = [spend, verdict(false), reason("no-pay")];
    expect(screenFor(ledger)).toEqual({ kind: "not-yet" });
    expect(screenFor(ledger, { poolSettled: true })).toEqual({ kind: "lost" });
  });

  it("never calls a bad read or a down verifier a loss", () => {
    const lowConfidence = [
      spend,
      verdict(false, { confidence: "low" } as Partial<LedgerEntry>),
      reason("no-pay"),
    ];
    expect(screenFor(lowConfidence, { poolSettled: true })).toEqual({ kind: "bad-read" });
    const offline = [
      spend,
      verdict(false, { ref: "fail-job-1" } as Partial<LedgerEntry>),
      reason("no-pay"),
    ];
    const offlineSpend: LedgerEntry = { ...spend, ref: "fail-job-1" } as LedgerEntry;
    expect(
      screenFor([offlineSpend, ...offline.slice(1)], { poolSettled: true }),
    ).toEqual({ kind: "stopped", reason: "service" });
  });

  it("maps the stop states to reasons that are not the player's fault", () => {
    const buyError: LedgerEntry = { kind: "error", at: AT, stage: "buy", message: "cap" };
    const notIn: LedgerEntry = {
      kind: "error",
      at: AT,
      stage: "record",
      message: "reverted NOT_PARTICIPANT",
    };
    const other: LedgerEntry = { kind: "error", at: AT, stage: "settle", message: "rpc" };
    expect(screenFor([spend, buyError])).toEqual({ kind: "stopped", reason: "budget" });
    expect(screenFor([spend, notIn])).toEqual({ kind: "stopped", reason: "not-in-run" });
    expect(screenFor([spend, other])).toEqual({ kind: "stopped", reason: "error" });
  });

  it("shows the cancelled screen with or without the refund taken", () => {
    expect(screenFor(null, { poolCancelled: true })).toEqual({
      kind: "cancelled",
      refunded: false,
    });
    expect(screenFor(null, { poolCancelled: true, refunded: true })).toEqual({
      kind: "cancelled",
      refunded: true,
    });
  });
});

describe("verdictCopy", () => {
  const screens: VerdictScreen[] = [
    { kind: "checking" },
    { kind: "confirm-human" },
    { kind: "confirmed" },
    { kind: "approval-failed", outcome: "declined" },
    { kind: "approval-failed", outcome: "expired" },
    { kind: "approval-failed", outcome: "cancelled" },
    { kind: "banked", selfReported: false },
    { kind: "banked", selfReported: true },
    { kind: "won", paidUsd: "1.00", txHash: null, selfReported: false },
    { kind: "not-yet" },
    { kind: "lost" },
    { kind: "bad-read" },
    { kind: "stopped", reason: "budget" },
    { kind: "stopped", reason: "not-in-run" },
    { kind: "stopped", reason: "service" },
    { kind: "stopped", reason: "error" },
    { kind: "cancelled", refunded: false },
    { kind: "cancelled", refunded: true },
  ];

  it("has copy for every screen with no plumbing, wagering or exclamation", () => {
    for (const screen of screens) {
      const copy = verdictCopy(screen);
      expect(copy).not.toBeNull();
      const text = `${copy?.headline} ${copy?.body}`;
      expect(text).not.toMatch(
        /NEXT_PUBLIC|unexpected response|Stopped before payout|odds|wager|bet\b|!/,
      );
    }
  });

  it("offers no retry once the run settled before the confirmation", () => {
    const copy = verdictCopy({ kind: "approval-failed", outcome: "cancelled" });
    expect(copy?.headline).toBe("Run closed before you confirmed");
    expect(copy?.body).not.toMatch(/ask again/i);
  });

  it("uses the words the game loop promised", () => {
    expect(verdictCopy({ kind: "approval-failed", outcome: "expired" })?.headline).toBe(
      "Run failed, ask again",
    );
    expect(verdictCopy({ kind: "lost" })?.headline).toBe("Run lost");
    expect(verdictCopy({ kind: "lost" })?.body).toContain("pays nothing");
    expect(verdictCopy({ kind: "cancelled", refunded: false })?.headline).toBe(
      "Run cancelled, take your stake back",
    );
  });

  it("never says a self-reported result is verified", () => {
    expect(verdictCopy({ kind: "banked", selfReported: true })?.body).not.toMatch(
      /\bVerified\b/,
    );
    expect(verdictCopy({ kind: "banked", selfReported: true })?.body).toContain(
      "not verified",
    );
  });

  it("never says the money is in the wallet before the claim tap", () => {
    const won = verdictCopy({ kind: "won", paidUsd: "1.00", txHash: null, selfReported: false });
    expect(won?.body).not.toMatch(/in your wallet now/);
    expect(won?.body).toContain("one tap pulls it into your wallet");
  });
});
