import { describe, it, expect } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Log } from "viem";
import { FUNDS_SWEPT_ABI, REFUND_CREDITED_ABI } from "@/lib/contract";
import { fundsSweptAmount } from "@/lib/useSweepPool";

// sweep() transfers the leftover straight to the creator and emits FundsSwept;
// the hook reports success only from that event for this pool and this
// creator, never from a green receipt.
const POOL = 7n;
const CREATOR = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;

function log(topics: readonly `0x${string}`[], amount: bigint): Log {
  return {
    address: "0x66815e3AC541eB18d01D2aed25D0D9779583D832",
    topics: [...topics],
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    blockNumber: 1n,
    transactionHash: "0xfeed",
    transactionIndex: 0,
    blockHash: "0xbeef",
    logIndex: 0,
    removed: false,
  } as unknown as Log;
}

function sweptLog(poolId: bigint, creator: Address, amount: bigint): Log {
  const topics = encodeEventTopics({
    abi: FUNDS_SWEPT_ABI,
    eventName: "FundsSwept",
    args: { poolId, creator },
  });
  return log(topics as `0x${string}`[], amount);
}

describe("fundsSweptAmount", () => {
  it("finds the creator's sweep for this pool", () => {
    expect(fundsSweptAmount([sweptLog(POOL, CREATOR, 4_500_000n)], POOL, CREATOR)).toBe(
      4_500_000n,
    );
  });

  it("matches the creator case-insensitively", () => {
    const lower = CREATOR.toLowerCase() as Address;
    expect(fundsSweptAmount([sweptLog(POOL, CREATOR, 1n)], POOL, lower)).toBe(1n);
  });

  it("returns null for another pool, another wallet, or no event", () => {
    expect(fundsSweptAmount([sweptLog(99n, CREATOR, 5n)], POOL, CREATOR)).toBeNull();
    expect(fundsSweptAmount([sweptLog(POOL, OTHER, 5n)], POOL, CREATOR)).toBeNull();
    expect(fundsSweptAmount([], POOL, CREATOR)).toBeNull();
  });

  it("does not mistake a refund credit for a sweep", () => {
    const topics = encodeEventTopics({
      abi: REFUND_CREDITED_ABI,
      eventName: "RefundCredited",
      args: { poolId: POOL, participant: CREATOR },
    });
    expect(
      fundsSweptAmount([log(topics as `0x${string}`[], 5n)], POOL, CREATOR),
    ).toBeNull();
  });
});
