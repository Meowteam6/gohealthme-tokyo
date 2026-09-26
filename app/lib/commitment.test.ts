// The commitment model (HealthPoolsV3 bountyModel 2), stated once so every
// screen shows the numbers the contract will pay. Mirrors _settleCommitment:
// nobody hits -> every stake refunded; otherwise (pot - fee) split equally
// among achievers, fee only on forfeited stakes, dust stays in the pool.

import { describe, it, expect } from "vitest";
import { commitmentOutcome, commitmentRange } from "@/lib/commitment";

const USDC = 1_000_000n;

describe("commitmentOutcome", () => {
  it("refunds every stake when nobody hits", () => {
    const o = commitmentOutcome({ entryFee: USDC, players: 3, achievers: 0, sponsorPot: 2n * USDC });
    expect(o).toEqual({ kind: "refund-all", refundEach: USDC });
  });

  it("splits stakes plus the sponsor pot equally among achievers", () => {
    const o = commitmentOutcome({ entryFee: USDC, players: 3, achievers: 1, sponsorPot: 2n * USDC });
    expect(o).toEqual({ kind: "paid", perAchiever: 5n * USDC, stakeBack: USDC, fromOthers: 4n * USDC, fee: 0n });
  });

  it("takes the fee from forfeited stakes only", () => {
    const o = commitmentOutcome({ entryFee: USDC, players: 3, achievers: 1, sponsorPot: 0n, feeBps: 1000 });
    // forfeited 2 USDC, fee 0.2, pot 3 - 0.2 = 2.8 to the one achiever
    expect(o).toEqual({ kind: "paid", perAchiever: 2_800_000n, stakeBack: USDC, fromOthers: 1_800_000n, fee: 200_000n });
  });

  it("leaves integer dust in the pool", () => {
    const o = commitmentOutcome({ entryFee: USDC, players: 3, achievers: 3, sponsorPot: 1n });
    expect(o.kind === "paid" && o.perAchiever).toBe(USDC);
  });
});

describe("commitmentRange", () => {
  it("gives the most and least a player who hits can receive", () => {
    expect(commitmentRange({ entryFee: USDC, players: 4, sponsorPot: 2n * USDC })).toEqual({ ifOnlyYou: 6n * USDC, ifEveryone: 1_500_000n });
  });

  it("counts the player about to join", () => {
    expect(commitmentRange({ entryFee: USDC, players: 0, sponsorPot: 2n * USDC, includeJoiner: true })).toEqual({ ifOnlyYou: 3n * USDC, ifEveryone: 3n * USDC });
  });

  it("on a run that cannot record a miss, a miss is refunded before the split", () => {
    // Four players, 2.00 sponsor pot: the three who miss have no recorded
    // result, so settle refunds them first and only your stake and the pot
    // are split (HealthPoolsV3 B-2).
    expect(
      commitmentRange({ entryFee: USDC, players: 4, sponsorPot: 2n * USDC, recordsMisses: false }),
    ).toEqual({ ifOnlyYou: 3n * USDC, ifEveryone: 1_500_000n });
    // No sponsor pot: a hit is your stake back, whoever else hits.
    expect(
      commitmentRange({ entryFee: USDC, players: 2, sponsorPot: 0n, includeJoiner: true, recordsMisses: false }),
    ).toEqual({ ifOnlyYou: USDC, ifEveryone: USDC });
  });
});
