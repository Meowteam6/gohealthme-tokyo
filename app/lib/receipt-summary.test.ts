// SPOTTER's receipt, cut down to the latest check. Every ledger shape here is
// one the server writes (lib/server/agent/run.ts, wearable.ts, miss.ts,
// reason.ts); the wearable reason strings are the literal ones wearable.ts
// emits, and the pass and miss reasons come from the server functions
// themselves so a wording change there shows up here.

import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "@/lib/agent-receipt";
import { missVerdictReason, passVerdictReason } from "@/lib/server/agent/miss";
import { decisionNoteOf, shortReasonOf, summarizeReceipt } from "@/lib/receipt-summary";

const AT = "2026-09-27T08:12:00.000Z";
const LATER = "2026-09-27T08:41:00.000Z";
const REF = "wearable-1790400000";
const FIXED = "Checked by SPOTTER's fixed rule.";

const SYNCING =
  "Your wearable is connected but has not synced any workout data for this period yet. Give it a few minutes to sync, then run the check again.";
const WORKOUT_HIT = passVerdictReason({ threshold: 1, unit: "workout", goalDays: 1 }, 1);

const plan: LedgerEntry = {
  kind: "plan",
  at: AT,
  steps: [{ service: "junction-read", label: "wearable summary (Junction)", estUsd: "0.00" }],
  capUsd: "1.00",
};
const read: LedgerEntry = {
  kind: "spend",
  at: AT,
  service: "junction-read",
  label: "wearable summary (Junction)",
  amountUsd: "0.00",
  ref: REF,
  settlement: "prepaid",
};

function verdict(
  verified: boolean,
  reason: string,
  extra: Partial<Extract<LedgerEntry, { kind: "verdict" }>> = {},
): LedgerEntry {
  return {
    kind: "verdict",
    at: AT,
    verified,
    confidence: verified ? "high" : "low",
    reason,
    ref: REF,
    ...extra,
  };
}

function decide(decision: "pay" | "no-pay", note: string, at = AT): LedgerEntry {
  return { kind: "reason", at, decision, note, ref: REF } as LedgerEntry;
}

function approval(
  status: "requested" | "approved" | "declined" | "expired" | "cancelled",
  extra: Record<string, unknown> = {},
): LedgerEntry {
  return {
    kind: "approval",
    at: LATER,
    status,
    requestId: "req-1",
    action: "settle:0x01:1",
    provider: "world",
    ...extra,
  } as LedgerEntry;
}

// Andre's pool-2 ledger, 2026-09-27: a "still syncing" read, the fixed rule's
// no-pay that repeats it word for word, then the hit and the World ID ask.
const POOL_2: LedgerEntry[] = [
  plan,
  read,
  verdict(false, SYNCING),
  decide("no-pay", `${FIXED} not paying: ${SYNCING}`),
  verdict(true, WORKOUT_HIT, { at: LATER }),
  decide("pay", `${FIXED} verified, high confidence. paying.`, LATER),
  approval("requested"),
];

function allText(value: unknown): string {
  return JSON.stringify(value);
}

describe("summarizeReceipt: the latest check only", () => {
  it("says the newest read, the decision and the World ID ask in plain words", () => {
    const summary = summarizeReceipt(POOL_2, "wearable");
    expect(summary).not.toBeNull();
    const latest = summary?.latest;
    expect(latest?.at).toBe(LATER);
    expect(latest?.result).toMatchObject({
      tone: "verified",
      text: "Verified: 1 day with a workout in the window",
    });
    expect(latest?.decision).toMatchObject({ tone: "pay", text: "Paying" });
    expect(latest?.approval?.kind === "approval" && latest.approval.status).toBe("requested");
  });

  it("folds the earlier read behind the disclosure, newest first, with its confidence", () => {
    const summary = summarizeReceipt(POOL_2, "wearable");
    expect(summary?.earlier).toHaveLength(1);
    const earlier = summary?.earlier[0];
    expect(earlier?.result).toMatchObject({
      tone: "not-verified",
      text: "Not verified yet: no workout synced yet",
      confidence: "low",
    });
    expect(earlier?.decision).toMatchObject({ tone: "no-pay", text: "Not paying yet" });
    // The fixed rule's note only repeated the read: nothing left to say.
    expect(earlier?.decision?.note).toBeNull();
  });

  it("never prints the fixed-rule label, and keeps confidence off the main line", () => {
    const summary = summarizeReceipt(POOL_2, "wearable");
    expect(allText(summary)).not.toMatch(/fixed rule/i);
    expect(summary?.latest.result?.text).not.toMatch(/confidence/);
  });

  it("keeps a check with no earlier ones to a single entry", () => {
    const summary = summarizeReceipt(
      [plan, read, verdict(true, WORKOUT_HIT), decide("pay", "paying.")],
      "wearable",
    );
    expect(summary?.earlier).toEqual([]);
  });

  it("returns nothing for an empty ledger", () => {
    expect(summarizeReceipt([], "wearable")).toBeNull();
  });

  it("is still reading when only the plan and the read have landed", () => {
    const summary = summarizeReceipt([plan, read], "wearable");
    expect(summary?.latest.result).toBeNull();
    expect(summary?.latest.decision).toBeNull();
    expect(summary?.latest.errors).toEqual([]);
  });

  it("says deciding when a verified read lands after a no-pay and nothing re-decided yet", () => {
    const summary = summarizeReceipt(
      [plan, read, verdict(false, SYNCING), decide("no-pay", `${FIXED} not paying: ${SYNCING}`), verdict(true, WORKOUT_HIT)],
      "wearable",
    );
    expect(summary?.latest.result?.tone).toBe("verified");
    expect(summary?.latest.decision).toMatchObject({ tone: "pending", text: "Deciding now" });
    expect(summary?.earlier).toHaveLength(1);
  });
});

describe("summarizeReceipt: after the result is on chain", () => {
  const recorded: LedgerEntry[] = [
    plan,
    read,
    verdict(true, WORKOUT_HIT),
    decide("pay", "paying."),
    approval("approved", { nullifierStub: "0x12ab34cd56", credential: "orb" }),
    { kind: "record", at: LATER, goalId: "0x01", resultTx: "0xabc", registryStatus: "skipped" } as LedgerEntry,
  ];

  it("a later transient read never replaces the recorded check", () => {
    const providerDown = verdict(
      false,
      "The wearable data provider could not be reached, so nothing was verified. Run the check again once it recovers.",
      { at: LATER },
    );
    const settled: LedgerEntry = {
      kind: "settle",
      at: LATER,
      status: "settled",
      paidUsd: "2.50",
      txHash: "0xfeed",
    };
    const summary = summarizeReceipt([...recorded, providerDown, settled], "wearable");
    expect(summary?.earlier).toEqual([]);
    expect(summary?.latest.result?.tone).toBe("verified");
    expect(summary?.latest.record).not.toBeNull();
    expect(summary?.latest.settle?.kind === "settle" && summary.latest.settle.status).toBe("settled");
  });

  it("says a recorded miss is not met, with the counts only", () => {
    const reason = missVerdictReason({
      spec: {
        metric: "sleep_hours",
        threshold: 7,
        unit: "hours of sleep",
        goalDays: 3,
        countsSessions: false,
      } as Parameters<typeof missVerdictReason>[0]["spec"],
      window: ["2026-09-25", "2026-09-26", "2026-09-27"],
      qualifyingDays: 1,
    });
    const summary = summarizeReceipt(
      [
        plan,
        read,
        verdict(false, reason, { confidence: "high" }),
        decide("no-pay", `${FIXED} not paying: ${reason}`),
        { kind: "record", at: LATER, goalId: "0x01", verdict: false, stakeUsd: "1.00", registryStatus: "skipped" } as LedgerEntry,
      ],
      "wearable",
    );
    expect(summary?.latest.result?.text).toBe(
      "Not met: 1 of 3 qualifying nights (7+ hours of sleep)",
    );
    expect(summary?.latest.decision?.text).toBe("Not paying");
  });
});

describe("summarizeReceipt: the document path", () => {
  const JOB = "job-7";
  const cheap: LedgerEntry = {
    kind: "spend",
    at: AT,
    service: "attester-read",
    label: "document read (TEE attester)",
    amountUsd: "0.02",
    ref: JOB,
    settlement: "prepaid",
  };
  const judge: LedgerEntry = {
    kind: "spend",
    at: AT,
    service: "vision-judge",
    label: "second opinion (vision judge)",
    amountUsd: "0.39",
    ref: JOB,
    settlement: "x402",
    note: "escalating. gateway tx 0x9f3a0c2a7e61d4a5",
  };

  it("an escalation is the same check as the read it corrects", () => {
    const summary = summarizeReceipt(
      [
        cheap,
        verdict(false, "The photo is too blurry to read.", { ref: JOB }),
        judge,
        verdict(true, "The lab report shows an A1C of 5.4 dated this month. It meets the goal.", {
          ref: `${JOB}:vision-judge`,
        }),
        decide("pay", "second opinion reads it fine. paying."),
      ],
      "document",
    );
    expect(summary?.earlier).toEqual([]);
    expect(summary?.latest.result?.text).toBe(
      "Verified on a second opinion: The lab report shows an A1C of 5.4 dated this month",
    );
    expect(summary?.latest.decision?.note).toBe("second opinion reads it fine. paying.");
  });

  it("never calls a self-reported read verified", () => {
    const summary = summarizeReceipt(
      [cheap, verdict(true, "A photo of a finished run.", { ref: JOB, selfReported: true }), decide("pay", "paying.")],
      "self-reported",
    );
    expect(summary?.latest.result?.tone).toBe("self-reported");
    expect(summary?.latest.result?.text).not.toMatch(/^Verified/);
  });

  it("a confident miss on a document is not paying, without a yet", () => {
    const summary = summarizeReceipt(
      [cheap, verdict(false, "The report is from last year.", { ref: JOB, confidence: "high" }), decide("no-pay", "not paying.")],
      "document",
    );
    expect(summary?.latest.result?.text).toBe("Not verified: The report is from last year");
    expect(summary?.latest.decision?.text).toBe("Not paying");
  });
});

describe("summarizeReceipt: errors", () => {
  const preflight = "canSettle(0x9f3a) is false - settling now would pay this participant nothing.";

  it("collapses repeats of one error into a count", () => {
    const err: LedgerEntry = { kind: "error", at: LATER, stage: "settle", message: preflight };
    const summary = summarizeReceipt(
      [plan, read, verdict(true, WORKOUT_HIT), decide("pay", "paying."), err, err, err],
      "wearable",
    );
    expect(summary?.latest.errors).toEqual([
      { stage: "settle", message: preflight, count: 3, current: true },
    ]);
  });

  it("never merges errors that differ in stage or message", () => {
    const summary = summarizeReceipt(
      [
        plan,
        read,
        { kind: "error", at: AT, stage: "settle", message: preflight },
        { kind: "error", at: AT, stage: "settle", message: "rpc timeout" },
        { kind: "error", at: AT, stage: "record", message: "rpc timeout" },
      ],
      "wearable",
    );
    expect(summary?.latest.errors.map((e) => e.count)).toEqual([1, 1, 1]);
  });

  it("marks an error the claim moved past as not current", () => {
    const err: LedgerEntry = { kind: "error", at: AT, stage: "attester", message: "attester down" };
    const summary = summarizeReceipt(
      [plan, read, err, verdict(true, WORKOUT_HIT), decide("pay", "paying.")],
      "wearable",
    );
    expect(summary?.latest.errors).toEqual([
      { stage: "attester", message: "attester down", count: 1, current: false },
    ]);
  });
});

describe("shortReasonOf: the wearable reasons SPOTTER writes", () => {
  it("shortens a hit to what counted, in the window", () => {
    expect(shortReasonOf(WORKOUT_HIT).detail).toBe("1 day with a workout in the window");
    expect(
      shortReasonOf(passVerdictReason({ threshold: 7, unit: "hours of sleep", goalDays: 3 }, 3)).detail,
    ).toBe("3 nights at 7+ hours of sleep in the window");
  });

  it("still reads receipts written before the challenge wording pass", () => {
    expect(
      shortReasonOf(
        "Your wearable shows 1 qualifying days (1+ workout) inside this pool period, meeting the 1-day goal.",
      ).detail,
    ).toBe("1 day with a workout in the window");
    expect(
      shortReasonOf(
        "Your wearable synced every night of the run (2026-09-25 to 2026-09-27, your time) and shows 1 of 3 qualifying nights (7+ hours of sleep). The run is over, so the miss is recorded.",
      ).detail,
    ).toBe("1 of 3 qualifying nights (7+ hours of sleep)");
  });

  it("shortens a not-met-so-far read to the count", () => {
    expect(
      shortReasonOf(
        "Your wearable shows 1 of 3 qualifying days (10000+ steps) inside this pool period. The goal is not met yet.",
      ).detail,
    ).toBe("1 of 3 days at 10000+ steps so far");
    expect(
      shortReasonOf(
        "Your wearable shows 0 of 2 qualifying days (1+ workout) inside this pool period. The goal is not met yet.",
      ).detail,
    ).toBe("0 of 2 days with a workout so far");
    expect(
      shortReasonOf(
        "Your wearable shows 1 of 1 qualifying days (80+ sleep score) inside this pool period. The goal is not met yet.",
      ).detail,
    ).toBe("1 of 1 night at 80+ sleep score so far");
  });

  it("says syncing plainly, and names what the device cannot measure as final", () => {
    expect(shortReasonOf(SYNCING)).toEqual({ detail: "no workout synced yet", blocked: false });
    expect(
      shortReasonOf(
        "Your wearable is syncing, but it does not report sleep for this goal, so there is nothing for SPOTTER to check and nothing was paid. Connect a device that tracks it from the dashboard.",
      ),
    ).toEqual({ detail: "your device does not report sleep", blocked: true });
    expect(
      shortReasonOf(
        "This goal is measured in steps, which WHOOP does not report, so it could not be checked and nothing was paid. Connect a device that tracks it from the dashboard.",
      ),
    ).toEqual({ detail: "WHOOP does not report steps", blocked: true });
    expect(
      shortReasonOf(
        "SPOTTER could not tell which wearable metric this goal maps to (steps, sleep, workouts, distance, or calories), so it was not checked and nothing was paid. Reword the goal around one of those.",
      ).blocked,
    ).toBe(true);
    expect(
      shortReasonOf("No wearable is connected for this wallet. Connect one from the dashboard and run the check again.").detail,
    ).toBe("no wearable connected");
    expect(
      shortReasonOf(
        "The wearable data provider could not be reached, so nothing was verified. Run the check again once it recovers.",
      ).detail,
    ).toBe("the wearable provider did not answer");
  });

  it("falls back to the first sentence of anything else", () => {
    expect(shortReasonOf("Blurry. Retake it in daylight.").detail).toBe("Blurry");
    expect(shortReasonOf("  ").detail).toBe("");
  });
});

describe("decisionNoteOf", () => {
  it("drops the fixed-rule label and a note that only repeats the read", () => {
    expect(decisionNoteOf(`${FIXED} not paying: ${SYNCING}`, SYNCING)).toBeNull();
    expect(decisionNoteOf(`${FIXED} verified, high confidence. paying.`, WORKOUT_HIT)).toBeNull();
  });

  it("keeps what SPOTTER actually added", () => {
    expect(decisionNoteOf("the data is clean. paying.", WORKOUT_HIT)).toBe("the data is clean. paying.");
    expect(
      decisionNoteOf(`overruled to no-pay: no verified verdict backs this claim. ${FIXED} not paying: ${SYNCING}`, SYNCING),
    ).toBe("overruled to no-pay: no verified verdict backs this claim.");
  });
});
