import { describe, it, expect } from "vitest";
import { resultLabel } from "@/lib/participant-status";

// The dashboard's per-pool status line. Pinned after a live pilot bug
// (2026-09-04): four pools had settled and refunded a participant who never
// uploaded proof, and every card still read "Pending verification" - the label
// only looked at the participant, never at the pool. The contract's B-2 refund
// path does not set `refunded` (that flag is claimRefund's, on cancelled pools),
// so the ONLY on-chain signal for "refunded at settlement" is
// pool.settled && !participant.resultRecorded.
describe("resultLabel", () => {
  const p = (over: Partial<{ resultRecorded: boolean; verdict: boolean; multiplierBps: number; refunded: boolean }>) => ({
    resultRecorded: false,
    verdict: false,
    multiplierBps: 10_000,
    refunded: false,
    ...over,
  });

  it("tells a joiner of a cancelled pool to claim their refund, then that it is claimed", () => {
    expect(resultLabel({ settled: true, cancelled: true }, p({}))).toEqual({
      text: "Pool cancelled - claim your refund",
      tone: "warning",
    });
    expect(resultLabel({ settled: true, cancelled: true }, p({ refunded: true }))).toEqual({
      text: "Pool cancelled - refund claimed",
      tone: "muted",
    });
  });

  it("reads Pending verification only while the pool is still open", () => {
    expect(resultLabel({ settled: false }, p({}))).toEqual({
      text: "Pending verification",
      tone: "warning",
    });
  });

  it("reads Refunded once the pool settled with no proof from this participant", () => {
    expect(resultLabel({ settled: true }, p({}))).toEqual({
      text: "Refunded - no proof was submitted",
      tone: "muted",
    });
  });

  it("never says 'no proof' when the proof passed and only the World ID OK was missing", () => {
    for (const approval of ["declined", "expired", "cancelled"] as const) {
      expect(resultLabel({ settled: true }, p({}), approval)).toEqual({
        text: "Refunded - payout not confirmed",
        tone: "muted",
      });
    }
    expect(resultLabel({ settled: true }, p({}), "approved").text).toBe(
      "Refunded - result not recorded before settle",
    );
    // No approval asked: the old label stands.
    expect(resultLabel({ settled: true }, p({}), null).text).toBe(
      "Refunded - no proof was submitted",
    );
  });

  it("reads Achieved with the multiplier when the verdict is true", () => {
    expect(resultLabel({ settled: true }, p({ resultRecorded: true, verdict: true, multiplierBps: 15_000 }))).toEqual({
      text: "Achieved at 1.50x",
      tone: "accent",
    });
  });

  it("says the stake was forfeited only once the miss has actually settled", () => {
    expect(resultLabel({ settled: false }, p({ resultRecorded: true }))).toEqual({
      text: "Goal missed",
      tone: "muted",
    });
    expect(resultLabel({ settled: true }, p({ resultRecorded: true }))).toEqual({
      text: "Goal missed - stake forfeited",
      tone: "muted",
    });
  });
});
