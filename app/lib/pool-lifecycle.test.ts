import { describe, it, expect } from "vitest";
import {
  groupPoolsByPhase,
  isEconomicallyDeadConfig,
  poolCanPay,
  poolPhase,
} from "@/lib/pool-lifecycle";

const NOW = 1_000_000n;

function pool(id: number, settled: boolean, periodEnd: bigint) {
  return { id: BigInt(id), settled, periodEnd };
}

describe("poolPhase", () => {
  it("is live only while the period end is strictly in the future", () => {
    expect(poolPhase(pool(1, false, NOW + 1n), NOW)).toBe("live");
    // Mirrors /api/goals/match: periodEnd === now is no longer live.
    expect(poolPhase(pool(1, false, NOW), NOW)).toBe("expired");
    expect(poolPhase(pool(1, false, NOW - 1n), NOW)).toBe("expired");
  });

  it("settled wins over any period state", () => {
    expect(poolPhase(pool(1, true, NOW + 100n), NOW)).toBe("settled");
    expect(poolPhase(pool(1, true, NOW - 100n), NOW)).toBe("settled");
  });
});

describe("isEconomicallyDeadConfig (V3 H-1: zero entry fee is dead for every model)", () => {
  it("is true for a zero entry fee under every bounty model", () => {
    // HealthPoolsV3 createPool reverts DEAD_CONFIG on entryFee 0 regardless
    // of model - the client predicate must mirror the deployed contract, or
    // the form sends a transaction that is guaranteed to fail on-chain.
    expect(isEconomicallyDeadConfig(0, 0n)).toBe(true);
    expect(isEconomicallyDeadConfig(1, 0n)).toBe(true);
    expect(isEconomicallyDeadConfig(2, 0n)).toBe(true);
  });

  it("is false for every config with a real entry fee", () => {
    expect(isEconomicallyDeadConfig(0, 1n)).toBe(false);
    expect(isEconomicallyDeadConfig(1, 1n)).toBe(false);
    expect(isEconomicallyDeadConfig(2, 1n)).toBe(false);
  });

  it("is exactly the negation of poolCanPay", () => {
    for (const bountyModel of [0, 1, 2]) {
      for (const entryFee of [0n, 5_000_000n]) {
        expect(poolCanPay({ bountyModel, entryFee })).toBe(
          !isEconomicallyDeadConfig(bountyModel, entryFee),
        );
      }
    }
  });
});

describe("create-time guards reject the dead config", () => {
  // runUsdcDeposit guards the createPool args tuple
  // [initiative, goalSpec, entryFee, periodStart, periodEnd, bountyModel, funding],
  // reading entryFee at index 2 and bountyModel at index 5. This pins that
  // index mapping so a reorder cannot silently defeat the funnel guard.
  const createPoolArgs = (
    entryFee: bigint,
    bountyModel: number,
  ): readonly [string, string, bigint, bigint, bigint, number, bigint] => [
    "sleep",
    "goal",
    entryFee,
    0n,
    1n,
    bountyModel,
    100_000_000n,
  ];

  const funnelRejects = (
    args: readonly [string, string, bigint, bigint, bigint, number, bigint],
  ): boolean => isEconomicallyDeadConfig(args[5], args[2]);

  it("the deposit funnel rejects a zero entry fee under every model", () => {
    // This is the regression that shipped: the Arc-era predicate passed a
    // fee-zero split-pot create (and the fee-zero challenge create) straight
    // to a contract that reverts DEAD_CONFIG on it.
    expect(funnelRejects(createPoolArgs(0n, 0))).toBe(true);
    expect(funnelRejects(createPoolArgs(0n, 1))).toBe(true);
    expect(funnelRejects(createPoolArgs(0n, 2))).toBe(true);
  });

  it("the deposit funnel accepts every payable config", () => {
    expect(funnelRejects(createPoolArgs(5_000_000n, 0))).toBe(false);
    expect(funnelRejects(createPoolArgs(5_000_000n, 1))).toBe(false);
    expect(funnelRejects(createPoolArgs(5_000_000n, 2))).toBe(false);
  });
});

describe("groupPoolsByPhase", () => {
  it("splits pools into live, expired, and settled", () => {
    const grouped = groupPoolsByPhase(
      [
        pool(1, false, NOW + 50n),
        pool(2, false, NOW - 50n),
        pool(3, true, NOW - 200n),
      ],
      NOW,
    );
    expect(grouped.live.map((p) => p.id)).toEqual([1n]);
    expect(grouped.expired.map((p) => p.id)).toEqual([2n]);
    expect(grouped.settled.map((p) => p.id)).toEqual([3n]);
  });

  it("orders live pools soonest-ending first", () => {
    const grouped = groupPoolsByPhase(
      [
        pool(1, false, NOW + 300n),
        pool(2, false, NOW + 100n),
        pool(3, false, NOW + 200n),
      ],
      NOW,
    );
    expect(grouped.live.map((p) => p.id)).toEqual([2n, 3n, 1n]);
  });

  it("orders expired and settled pools most recently ended first", () => {
    const grouped = groupPoolsByPhase(
      [
        pool(1, false, NOW - 300n),
        pool(2, false, NOW - 100n),
        pool(3, true, NOW - 400n),
        pool(4, true, NOW - 200n),
      ],
      NOW,
    );
    expect(grouped.expired.map((p) => p.id)).toEqual([2n, 1n]);
    expect(grouped.settled.map((p) => p.id)).toEqual([4n, 3n]);
  });

  it("keeps input order on period-end ties", () => {
    const grouped = groupPoolsByPhase(
      [pool(1, false, NOW + 100n), pool(2, false, NOW + 100n)],
      NOW,
    );
    expect(grouped.live.map((p) => p.id)).toEqual([1n, 2n]);
  });

  it("keeps input order on ties in the reversed expired and settled sorts", () => {
    const grouped = groupPoolsByPhase(
      [
        pool(1, false, NOW - 100n),
        pool(2, false, NOW - 100n),
        pool(3, true, NOW - 100n),
        pool(4, true, NOW - 100n),
      ],
      NOW,
    );
    expect(grouped.expired.map((p) => p.id)).toEqual([1n, 2n]);
    expect(grouped.settled.map((p) => p.id)).toEqual([3n, 4n]);
  });

  it("does not mutate the input array", () => {
    const input = [
      pool(1, false, NOW + 300n),
      pool(2, true, NOW - 100n),
      pool(3, false, NOW - 200n),
    ];
    const snapshot = input.map((p) => p.id);
    groupPoolsByPhase(input, NOW);
    expect(input.map((p) => p.id)).toEqual(snapshot);
  });

  it("handles an empty list", () => {
    const grouped = groupPoolsByPhase([], NOW);
    expect(grouped.live).toEqual([]);
    expect(grouped.expired).toEqual([]);
    expect(grouped.settled).toEqual([]);
  });
});
