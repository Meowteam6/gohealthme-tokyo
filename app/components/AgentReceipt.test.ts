// The receipt's display rules, pinned as pure functions: calm labels map to the real
// messages run.ts and spotter.ts emit, gateway refs round-trip out of spend
// notes, and a deferred settle row never renders a raw epoch.

import { describe, it, expect } from "vitest";
import {
  approvalLine,
  deferredSettleCopy,
  errorPresentation,
  formatSettleMoment,
  gatewayRefOf,
  noteWithoutGatewayRef,
  recordRowLabel,
  settleMomentLine,
} from "@/components/AgentReceipt";
import type { LedgerEntry } from "@/lib/agent-receipt";

const SETTLE_PREFLIGHT =
  "canSettle(0x9f3a) is false - settling now would pay this participant nothing. Record the verdict first.";

describe("errorPresentation", () => {
  it("reads a settle preflight as calm waiting, not failure", () => {
    expect(errorPresentation("settle", SETTLE_PREFLIGHT)).toEqual({
      label: "settlement is waiting on the chain",
      transient: true,
    });
  });

  it("names the challenge-settled-first dead end", () => {
    const p = errorPresentation(
      "settle",
      "the challenge settled before this claim completed; a one-shot settle cannot pay it retroactively",
    );
    expect(p.transient).toBe(false);
    expect(p.label).toContain("challenge settled before this claim finished");
  });

  it("still names the dead end in the wording ledgers stored before 2026-09-30", () => {
    const p = errorPresentation(
      "settle",
      "pool settled before this claim completed; a one-shot settle cannot pay it retroactively",
    );
    expect(p.transient).toBe(false);
    expect(p.label).toContain("challenge settled before this claim finished");
  });

  it("does not call a post-settlement cap break a clean stop", () => {
    const p = errorPresentation(
      "buy",
      "vision-judge purchase of 0.90 USDC exceeded the estimate and broke the claim cap AFTER settlement (gateway tx 0xgw): over cap",
    );
    expect(p.label).toBe(
      "a purchase cost more than estimated after it was paid",
    );
    const clean = errorPresentation(
      "buy",
      "buying vision-judge at 0.90 USDC would break the 1.00 USDC cap for this claim (already spent 0.20)",
    );
    expect(clean.label).toBe("stopped at the spend cap for this claim");
  });

  it("treats the attester stage as transient and unknown stages as generic", () => {
    expect(errorPresentation("attester", "socket hang up").transient).toBe(
      true,
    );
    expect(errorPresentation("telemetry", "whatever")).toEqual({
      label: "this step did not complete",
      transient: false,
    });
  });
});

describe("gateway ref parsing", () => {
  const NOTE =
    "escalating. i can't read this and i'm not paying out 50 USDC on something i can't read. gateway tx 0xdeadbeef01";

  it("round-trips the run.ts note format", () => {
    expect(gatewayRefOf(NOTE)).toBe("0xdeadbeef01");
    expect(noteWithoutGatewayRef(NOTE)).toBe(
      "escalating. i can't read this and i'm not paying out 50 USDC on something i can't read.",
    );
  });

  it("collapses a gateway-only note to nothing", () => {
    expect(gatewayRefOf("gateway tx 0xabc")).toBe("0xabc");
    expect(noteWithoutGatewayRef("gateway tx 0xabc")).toBeNull();
  });

  it("leaves notes without a gateway ref alone", () => {
    expect(gatewayRefOf("plain note")).toBeNull();
    expect(noteWithoutGatewayRef("plain note")).toBe("plain note");
    expect(gatewayRefOf(null)).toBeNull();
    expect(noteWithoutGatewayRef(null)).toBeNull();
  });
});

describe("deferred settle copy", () => {
  const FUTURE_ISO = new Date(Date.now() + 3_600_000).toISOString();
  const PAST_ISO = new Date(Date.now() - 3_600_000).toISOString();
  const EPOCH_NOTE_TEXT =
    "pool period ends at 1791000000; settling the moment it does";

  it("renders a future periodEndIso as a promise with a local time", () => {
    const copy = deferredSettleCopy(FUTURE_ISO, null);
    expect(copy).toMatch(/^SPOTTER settles this automatically at /);
  });

  it("does not promise a future settle for a past periodEndIso", () => {
    const copy = deferredSettleCopy(PAST_ISO, null);
    expect(copy).toContain("SPOTTER settles this on its next pass");
    expect(copy).not.toContain("settles this automatically at");
  });

  it("never calls the settle moment the end of the pool period: on a run that can record a miss they differ by the sync grace", () => {
    const copy = deferredSettleCopy(PAST_ISO, null);
    expect(copy).not.toContain("pool period ended");
    expect(copy).toMatch(/^settling opened at /);
  });

  it("converts a recognizable epoch note and never renders the raw epoch", () => {
    const copy = deferredSettleCopy(undefined, EPOCH_NOTE_TEXT);
    expect(copy).not.toContain("1791000000");
    expect(copy).toMatch(/SPOTTER settles this/);
  });

  it("falls back to generic copy on an out-of-range epoch, still no raw epoch", () => {
    const copy = deferredSettleCopy(
      undefined,
      "pool period ends at 12345; settling the moment it does",
    );
    expect(copy).toBe(
      "SPOTTER settles this automatically the moment the challenge ends",
    );
  });

  it("survives a runtime null periodEndIso without rendering Jan 1 1970", () => {
    const copy = deferredSettleCopy(
      null as unknown as undefined,
      EPOCH_NOTE_TEXT,
    );
    expect(copy).not.toContain("1970");
    expect(copy).not.toContain("1791000000");
  });

  it("renders epoch-free notes verbatim and pends without any note", () => {
    expect(deferredSettleCopy(undefined, "waiting on the pool")).toBe(
      "waiting on the pool",
    );
    expect(deferredSettleCopy(undefined, null)).toBe("settlement pending");
  });
});

describe("settle moments", () => {
  it("returns null for invalid dates end to end", () => {
    expect(formatSettleMoment(new Date("not-a-date"))).toBeNull();
    expect(settleMomentLine(new Date("not-a-date"))).toBeNull();
  });
});

describe("a recorded miss on the receipt", () => {
  it("labels a miss row as a miss, never as a plain recorded result", () => {
    expect(
      recordRowLabel({
        kind: "record",
        resultTx: "0xmiss",
        registryTx: null,
        verdict: false,
        stakeUsd: "1.00",
      }),
    ).toBe("Miss recorded on chain");
    expect(
      recordRowLabel({
        kind: "record",
        resultTx: "0xr",
        registryTx: null,
        verdict: true,
        stakeUsd: null,
      }),
    ).toBe("Recorded on chain");
  });
});

describe("the World ID line", () => {
  function approval(status: Extract<LedgerEntry, { kind: "approval" }>["status"]) {
    return {
      kind: "approval",
      at: "2026-09-27T08:41:00.000Z",
      status,
      requestId: "req-1",
      action: "settle:0x01:1",
      provider: "world",
    } as Extract<LedgerEntry, { kind: "approval" }>;
  }

  it("says where the confirmation stands in the player's words, one line each", () => {
    expect(approvalLine(approval("requested"))).toBe("Asked you to confirm with World ID");
    expect(approvalLine(approval("approved"))).toBe("You confirmed with World ID");
    expect(approvalLine(approval("declined"))).toBe("You declined the World ID confirmation");
    expect(approvalLine(approval("expired"))).toBe("The World ID request expired");
    expect(approvalLine(approval("cancelled"))).toBe("The World ID request was withdrawn");
  });
});
