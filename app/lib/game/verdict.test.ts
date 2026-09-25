import { describe, expect, it } from "vitest";
import { runStatusFromLedger, type LedgerEntry } from "@/lib/agent-receipt";
import {
  payDecidedOf,
  verdictCopy,
  verdictScreenOf,
  verdictShowsClaim,
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
      settled: false,
    });
    expect(screenFor([...decided, approval("requested"), approval("expired")])).toEqual({
      kind: "approval-failed",
      outcome: "expired",
      settled: false,
    });
    expect(screenFor([...decided, approval("requested"), approval("cancelled")])).toEqual({
      kind: "approval-failed",
      outcome: "cancelled",
      settled: false,
    });
  });

  it("marks a missed confirmation as settled once the pool settled under it", () => {
    expect(
      screenFor([...decided, approval("requested"), approval("expired")], { poolSettled: true }),
    ).toEqual({ kind: "approval-failed", outcome: "expired", settled: true });
    // Still waiting on the human when the settle landed: nothing left to ask.
    expect(
      screenFor([...decided, approval("requested")], { poolSettled: true }),
    ).toEqual({ kind: "approval-failed", outcome: "cancelled", settled: true });
  });

  it("never asks for a confirmation or shows checking on a settled pool", () => {
    // Joined, never claimed; still checking; banked without a settle row;
    // approved but not recorded: all final once the pool settled.
    const cases: (LedgerEntry[] | null)[] = [
      null,
      [spend],
      [spend, verdict(true), reason("pay"), recordEntry, deferred],
      [...decided, approval("requested"), approval("approved")],
    ];
    for (const ledger of cases) {
      expect(screenFor(ledger, { poolSettled: true })).toEqual({ kind: "settled-final" });
    }
  });

  it("carries the claim inside the Verdict on every settled or cancelled screen", () => {
    expect(verdictShowsClaim({ kind: "settled-final" })).toBe(true);
    expect(verdictShowsClaim({ kind: "lost", stakeBack: true })).toBe(true);
    expect(verdictShowsClaim({ kind: "cancelled", refunded: false })).toBe(true);
    expect(
      verdictShowsClaim({ kind: "won", paidUsd: "1.00", txHash: null, selfReported: false }),
    ).toBe(true);
    expect(
      verdictShowsClaim({ kind: "approval-failed", outcome: "expired", settled: true }),
    ).toBe(true);
    expect(
      verdictShowsClaim({ kind: "approval-failed", outcome: "expired", settled: false }),
    ).toBe(false);
    expect(verdictShowsClaim({ kind: "banked", selfReported: false })).toBe(false);
    expect(verdictShowsClaim({ kind: "none" })).toBe(false);
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
    ).toEqual({ kind: "approval-failed", outcome: "declined", settled: false });
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
    // No miss is recorded on chain (SPOTTER never writes one), so B-2
    // refunded the stake at settle.
    expect(screenFor(ledger, { poolSettled: true })).toEqual({ kind: "lost", stakeBack: true });
    expect(
      screenFor(ledger, { poolSettled: true, resultRecorded: true }),
    ).toEqual({ kind: "lost", stakeBack: false });
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
    { kind: "approval-failed", outcome: "declined", settled: false },
    { kind: "approval-failed", outcome: "expired", settled: false },
    { kind: "approval-failed", outcome: "cancelled", settled: false },
    { kind: "approval-failed", outcome: "declined", settled: true },
    { kind: "approval-failed", outcome: "expired", settled: true },
    { kind: "approval-failed", outcome: "cancelled", settled: true },
    { kind: "banked", selfReported: false },
    { kind: "banked", selfReported: true },
    { kind: "won", paidUsd: "1.00", txHash: null, selfReported: false },
    { kind: "not-yet" },
    { kind: "lost", stakeBack: true },
    { kind: "lost", stakeBack: false },
    { kind: "settled-final" },
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
    for (const outcome of ["declined", "expired", "cancelled"] as const) {
      const copy = verdictCopy({ kind: "approval-failed", outcome, settled: true });
      expect(copy?.headline).toBe("Payout not confirmed");
      expect(copy?.body).not.toMatch(/ask again/i);
      expect(copy?.body).toContain("credited your stake back");
    }
  });

  it("never calls a met goal with a missing confirmation a failed run", () => {
    for (const outcome of ["declined", "expired", "cancelled"] as const) {
      for (const settled of [false, true]) {
        const copy = verdictCopy({ kind: "approval-failed", outcome, settled });
        expect(copy?.headline).toBe("Payout not confirmed");
        expect(`${copy?.headline} ${copy?.body}`).not.toMatch(/run failed/i);
      }
    }
    expect(
      verdictCopy({ kind: "approval-failed", outcome: "expired", settled: false })?.body,
    ).toMatch(/ask again/i);
  });

  it("says a settled loss got the stake back unless a miss was recorded", () => {
    expect(verdictCopy({ kind: "lost", stakeBack: true })?.headline).toBe("Run lost");
    expect(verdictCopy({ kind: "lost", stakeBack: true })?.body).toContain(
      "credited your stake back",
    );
    expect(verdictCopy({ kind: "lost", stakeBack: false })?.body).toContain(
      "stake stayed in the pool",
    );
  });

  it("uses the words the game loop promised", () => {
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
