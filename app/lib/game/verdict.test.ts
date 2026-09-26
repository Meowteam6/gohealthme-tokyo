import { describe, expect, it } from "vitest";
import { runStatusFromLedger, type LedgerEntry } from "@/lib/agent-receipt";
import {
  payDecidedOf,
  runApprovalLine,
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

  it("gives a player with a sync deadline the moment their last nights must land by", () => {
    const ledger = [spend, verdict(false), reason("no-pay")];
    expect(screenFor(ledger, { missDeadlineMs: 1_790_487_000_000 })).toEqual({
      kind: "not-yet",
      lastCheckMs: 1_790_487_000_000,
    });
  });

  it("shows a recorded miss as missed, pending until the pool settles", () => {
    const missRecord: LedgerEntry = {
      kind: "record",
      at: AT,
      goalId: "0x01",
      registryStatus: "skipped",
      verdict: false,
      stakeUsd: "1.00",
    };
    const ledger = [spend, verdict(false), reason("no-pay"), missRecord];
    expect(screenFor(ledger)).toEqual({ kind: "missed", outcome: "pending", stakeUsd: "1.00" });
    // Settled but not closed yet: still pending, never "lost" or "settled-final".
    expect(screenFor(ledger, { poolSettled: true, resultRecorded: true })).toEqual({
      kind: "missed",
      outcome: "pending",
      stakeUsd: "1.00",
    });
    const closed = (outcome: "forfeited" | "refunded"): LedgerEntry => ({
      kind: "settle",
      at: AT,
      status: "closed",
      outcome,
      txHash: "0xs",
    });
    expect(screenFor([...ledger, closed("forfeited")], { poolSettled: true })).toEqual({
      kind: "missed",
      outcome: "forfeited",
      stakeUsd: "1.00",
    });
    expect(screenFor([...ledger, closed("refunded")], { poolSettled: true })).toEqual({
      kind: "missed",
      outcome: "refunded",
      stakeUsd: "1.00",
    });
  });

  it("carries the claim tap only on a miss whose stake came back", () => {
    expect(verdictShowsClaim({ kind: "missed", outcome: "refunded", stakeUsd: "1.00" })).toBe(true);
    expect(verdictShowsClaim({ kind: "missed", outcome: "forfeited", stakeUsd: "1.00" })).toBe(false);
    expect(verdictShowsClaim({ kind: "missed", outcome: "pending", stakeUsd: "1.00" })).toBe(false);
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

describe("runApprovalLine", () => {
  const open = { settled: false, cancelled: false, resultRecorded: false };

  it("tells a player who left that SPOTTER is waiting on them", () => {
    const line = runApprovalLine("pending", open);
    expect(line?.openRun).toBe(true);
    expect(line?.text).toContain("waiting on your OK");
  });

  it("offers ask-again for a decline or an expiry while the run is open", () => {
    for (const status of ["declined", "expired"] as const) {
      const line = runApprovalLine(status, open);
      expect(line?.openRun).toBe(true);
      expect(line?.text).toMatch(/ask again/);
      expect(line?.text).toContain("nothing moved");
    }
  });

  it("says a confirmed payout is being recorded, with nothing to do", () => {
    expect(runApprovalLine("approved", open)).toMatchObject({ tone: "accent", openRun: false });
  });

  it("is never silent about a failed read", () => {
    expect(runApprovalLine("unknown", open)?.text).toContain("could not check");
  });

  it("F10: asks a player whose wearable shows the hit to open the run and confirm it, by when", () => {
    const line = runApprovalLine("none", open, { confirmByMs: 1_790_494_200_000 });
    expect(line?.openRun).toBe(true);
    expect(line?.text).toMatch(/shows the goal met/);
    expect(line?.text).toMatch(/confirm it with World ID/);
    expect(line?.text).toContain(
      new Date(1_790_494_200_000).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    );
    // A pending ask already says it; the hit adds nothing there.
    expect(runApprovalLine("pending", open, { confirmByMs: null })?.text).toContain(
      "waiting on your OK",
    );
  });

  it("says nothing once recorded, settled or cancelled, or when nobody asked", () => {
    expect(runApprovalLine("pending", { ...open, resultRecorded: true })).toBeNull();
    expect(runApprovalLine("pending", { ...open, settled: true })).toBeNull();
    expect(runApprovalLine("pending", { ...open, cancelled: true })).toBeNull();
    expect(runApprovalLine("none", open)).toBeNull();
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
    { kind: "not-yet", lastCheckMs: 1_790_487_000_000 },
    { kind: "missed", outcome: "pending", stakeUsd: "1.00" },
    { kind: "missed", outcome: "forfeited", stakeUsd: "1.00" },
    { kind: "missed", outcome: "refunded", stakeUsd: "1.00" },
    { kind: "missed", outcome: "pending", stakeUsd: null },
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

  it("calls it a challenge on every screen, never a run, a pool or a dare", () => {
    for (const screen of screens) {
      const copy = verdictCopy(screen);
      expect(`${copy?.headline} ${copy?.body}`).not.toMatch(/\b(runs?|pools?|dares?|sponsor pot)\b/i);
    }
    const open = { settled: false, cancelled: false, resultRecorded: false };
    for (const status of ["pending", "declined", "expired", "approved", "unknown"] as const) {
      expect(runApprovalLine(status, open)?.text).not.toMatch(/\b(runs?|pools?|dares?|sponsor pot)\b/i);
    }
    expect(runApprovalLine("none", open, { confirmByMs: null })?.text).not.toMatch(/\b(runs?|pools?|dares?|sponsor pot)\b/i);
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
    expect(verdictCopy({ kind: "lost", stakeBack: true })?.headline).toBe("Challenge lost");
    expect(verdictCopy({ kind: "lost", stakeBack: true })?.body).toContain(
      "credited your stake back",
    );
    expect(verdictCopy({ kind: "lost", stakeBack: false })?.body).toContain(
      "stake stayed in the pot",
    );
  });

  it("says a miss plainly: what it costs and where the stake goes, never a lost bet", () => {
    const pending = verdictCopy({ kind: "missed", outcome: "pending", stakeUsd: "1.00" });
    expect(pending?.headline).toBe("Missed");
    expect(pending?.body).toContain("At settle your 1.00 stake goes to who hits, or comes back if nobody does.");
    expect(pending?.body).toContain("cancels before it settles gives every stake back");
    const forfeited = verdictCopy({ kind: "missed", outcome: "forfeited", stakeUsd: "1.00" });
    expect(forfeited?.body).toContain("Your 1.00 stake went to the players who hit");
    const refunded = verdictCopy({ kind: "missed", outcome: "refunded", stakeUsd: "1.00" });
    expect(refunded?.body).toContain("nobody hit");
    expect(refunded?.body).toContain("came back");
    for (const copy of [pending, forfeited, refunded]) {
      expect(`${copy?.headline} ${copy?.body}`).not.toMatch(/\bbet\b|lost a|lose|wager/i);
    }
  });

  it("tells a player still short of the goal when their last nights must sync by", () => {
    const withDeadline = verdictCopy({ kind: "not-yet", lastCheckMs: 1_790_487_000_000 });
    expect(withDeadline?.body).toContain(
      new Date(1_790_487_000_000).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    );
    expect(withDeadline?.body).toMatch(/records a miss on its own/);
    // Without a deadline (a run that can never record a miss) it stays general.
    expect(verdictCopy({ kind: "not-yet" })?.body).toContain("before it settles");
  });

  it("uses the words the game loop promised", () => {
    expect(verdictCopy({ kind: "cancelled", refunded: false })?.headline).toBe(
      "Challenge cancelled, take your stake back",
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

// F10 (fix/record-misses review): SPOTTER records a miss on its own, but a
// hit only counts once the player opens the run and confirms it. The sweep
// writes the hit it read to the ledger; every screen must then say "confirm
// it", never "not met" or "no proof".
describe("F10: a hit the sweep read but the player has not confirmed", () => {
  const sweepHit = verdict(true, { reason: "Your wearable shows 1 qualifying days" });

  it("a verified read newer than an old no-pay is not a no-pay any more", () => {
    const ledger = [spend, verdict(false), reason("no-pay"), sweepHit];
    expect(runStatusFromLedger(ledger)).toBe("verifying");
    expect(screenFor(ledger).kind).not.toBe("not-yet");
  });

  it("after settle, says the hit was not confirmed, never that the goal was not met", () => {
    for (const ledger of [
      [spend, sweepHit],
      [spend, verdict(false), reason("no-pay"), sweepHit],
    ]) {
      const screen = screenFor(ledger, { poolSettled: true });
      expect(screen).toEqual({ kind: "hit-unconfirmed" });
      const copy = verdictCopy(screen);
      expect(`${copy?.headline} ${copy?.body}`).not.toMatch(/not met|no proof/i);
      expect(copy?.body).toMatch(/confirm/i);
    }
  });

  it("the not-yet screen says a hit must be confirmed, and by when", () => {
    const ledger = [spend, verdict(false), reason("no-pay")];
    const screen = screenFor(ledger, {
      missDeadlineMs: 1_790_487_000_000,
      missConfirmByMs: 1_790_494_200_000,
    });
    expect(screen).toEqual({
      kind: "not-yet",
      lastCheckMs: 1_790_487_000_000,
      confirmByMs: 1_790_494_200_000,
    });
    const body = verdictCopy(screen)?.body ?? "";
    expect(body).toMatch(/open the challenge and confirm/i);
    expect(body).toContain(
      new Date(1_790_494_200_000).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    );
    expect(body).not.toMatch(/SPOTTER records what your wearable shows\./);
  });

  it("the confirm screen names the deadline on a run that can record a miss", () => {
    const ledger = [
      spend,
      verdict(true),
      reason("pay"),
      { kind: "approval", at: AT, status: "requested", requestId: "r1" } as LedgerEntry,
    ];
    const screen = screenFor(ledger, { missConfirmByMs: 1_790_494_200_000 });
    expect(screen).toEqual({ kind: "confirm-human", confirmByMs: 1_790_494_200_000 });
    expect(verdictCopy(screen)?.body).toMatch(/Confirm with World ID by/);
  });
});

describe("pollWhileLive", () => {
  it("keeps polling while SPOTTER waits on the human, so the confirm button appears without a reload", async () => {
    const { pollWhileLive } = await import("@/lib/game/verdict");
    expect(pollWhileLive("awaiting-approval")).toBe(5_000);
    expect(pollWhileLive("recorded")).toBe(5_000);
    expect(pollWhileLive("verifying")).toBe(5_000);
    expect(pollWhileLive("no-pay")).toBe(false);
    expect(pollWhileLive(null)).toBe(false);
  });
});
