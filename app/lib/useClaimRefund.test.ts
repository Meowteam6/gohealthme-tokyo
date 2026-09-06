import { describe, it, expect } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Log } from "viem";
import { REFUND_CREDITED_ABI } from "@/lib/contract";
import { refundCreditedAmount } from "@/lib/useClaimRefund";

// claimRefund() on a cancelled pool credits owed[] and emits RefundCredited;
// the hook reports success only from that event for this participant and this
// pool - never from a green receipt (P18, 2026-09-06).
const POOL = 13n;
const ME = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;

function refundLog(poolId: bigint, participant: Address, amount: bigint): Log {
  const topics = encodeEventTopics({
    abi: REFUND_CREDITED_ABI,
    eventName: "RefundCredited",
    args: { poolId, participant },
  });
  return {
    address: "0x66815e3AC541eB18d01D2aed25D0D9779583D832",
    topics,
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    blockNumber: 1n,
    transactionHash: "0xfeed",
    transactionIndex: 0,
    blockHash: "0xbeef",
    logIndex: 0,
    removed: false,
  } as unknown as Log;
}

describe("refundCreditedAmount", () => {
  it("finds this participant's refund for this pool", () => {
    const logs = [refundLog(POOL, OTHER, 5n), refundLog(POOL, ME, 1_000_000n)];
    expect(refundCreditedAmount(logs, POOL, ME)).toBe(1_000_000n);
  });

  it("returns null when the receipt credited someone else or another pool", () => {
    expect(refundCreditedAmount([refundLog(POOL, OTHER, 5n)], POOL, ME)).toBeNull();
    expect(refundCreditedAmount([refundLog(99n, ME, 5n)], POOL, ME)).toBeNull();
    expect(refundCreditedAmount([], POOL, ME)).toBeNull();
  });
});
