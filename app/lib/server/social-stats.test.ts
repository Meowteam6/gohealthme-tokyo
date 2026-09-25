// The on-chain stat math. Pinned here: counts, USDC sums, win streak, and
// recent payout rows are derived correctly from HealthPools events, and nothing
// but addresses/amounts/tx hashes is ever read.

import { describe, it, expect, vi, beforeEach } from "vitest";

const ADDRESS = "0x00000000000000000000000000000000000000a1";

// A fake Arc client whose getLogs returns canned logs per event + arg key, and
// whose getBlock returns a fixed timestamp. The module passes real event
// objects and indexed-arg filters; the fake keys off the event name we assign.
function fakeLog(args: Record<string, unknown>, block: number, tx: string) {
  return {
    args,
    blockNumber: BigInt(block),
    logIndex: 0,
    transactionHash: tx,
  };
}

const fakeClient = {
  getLogs: vi.fn(async ({ event }: { event: { name: string } }) => {
    switch (event.name) {
      case "AchieverPaid":
        return [
          fakeLog({ amount: 40_000_000n }, 10, "0xa1"),
          fakeLog({ amount: 60_000_000n }, 12, "0xa2"),
        ];
      case "PoolJoined":
        return [
          fakeLog({}, 3, "0xj1"),
          fakeLog({}, 4, "0xj2"),
          fakeLog({}, 5, "0xj3"),
        ];
      case "ResultRecorded":
        return [
          fakeLog({ verdict: true }, 5, "0xr1"),
          fakeLog({ verdict: false }, 6, "0xr2"),
          fakeLog({ verdict: true }, 7, "0xr3"),
          fakeLog({ verdict: true }, 8, "0xr4"),
        ];
      default:
        return [];
    }
  }),
  getBlock: vi.fn(async () => ({ timestamp: 1_790_000_000n })),
  // One window covers the whole pinned range below, so each event query is a
  // single getLogs call and the canned logs are not repeated across windows.
  getBlockNumber: vi.fn(async () => 50n),
};

vi.mock("@/lib/contract", () => ({
  getHealthPoolsAddress: () => "0x0000000000000000000000000000000000009999",
  getArcPublicClient: () => fakeClient,
  formatUsdc: (amount: bigint) => (Number(amount) / 1e6).toFixed(2),
  achieverPaidEvent: { name: "AchieverPaid" },
  poolJoinedEvent: { name: "PoolJoined" },
  resultRecordedEvent: { name: "ResultRecorded" },
  healthPoolsAbi: [],
  healthVerdictReadAbi: [],
}));

// V4 pools are oracle-only (healthVerdict() == 0x0): the tier comes from
// SPOTTER's ledger, never from a HEALTH_VERDICT_ADDRESS env var.
const poolVerdictRegistry = vi.fn<(pools: string) => Promise<string | null>>(async () => null);
vi.mock("@/lib/server/verdict", () => ({
  poolVerdictRegistry: (pools: string) => poolVerdictRegistry(pools),
}));
const readLedger = vi.fn<(goalId: string) => Promise<unknown[]>>(async () => []);
vi.mock("@/lib/server/agent/ledger", () => ({
  readLedger: (goalId: string) => readLedger(goalId),
}));

const { getSocialStats, clearSocialStatsCache, tierFromLedger } = await import(
  "@/lib/server/social-stats"
);

beforeEach(() => {
  // Pin the scan start so [start, getBlockNumber()] is a single 90k window.
  process.env.HEALTH_POOLS_FROM_BLOCK = "0";
  clearSocialStatsCache();
  vi.clearAllMocks();
});

describe("getSocialStats", () => {
  it("counts wins, sums USDC, and derives the win streak", async () => {
    const stats = await getSocialStats(ADDRESS);
    expect(stats.goalsHit).toBe(2);
    expect(stats.poolsJoined).toBe(3);
    // 40 + 60 (achiever) = 100 USDC in base units.
    expect(stats.usdcEarned).toBe(100_000_000n);
    // Trailing run of verdict==true after the last false: blocks 7 and 8.
    expect(stats.winStreak).toBe(2);
  });

  it("returns recent payout rows newest first with amounts and tx hashes", async () => {
    const stats = await getSocialStats(ADDRESS);
    expect(stats.recentWins).toHaveLength(2);
    // block 12 is newest: the 60 USDC achiever payout.
    expect(stats.recentWins[0]).toMatchObject({
      amountUsd: "60.00",
      txHash: "0xa2",
      role: "achiever",
    });
    expect(stats.recentWins[1]).toMatchObject({
      amountUsd: "40.00",
      txHash: "0xa1",
      role: "achiever",
    });
    // Block time resolved to an ISO string.
    expect(stats.recentWins[0].at).toBe(
      new Date(1_790_000_000 * 1000).toISOString(),
    );
  });

  it("returns zeroed stats for a malformed address without hitting the chain", async () => {
    const stats = await getSocialStats("not-an-address");
    expect(stats.goalsHit).toBe(0);
    expect(stats.usdcEarned).toBe(0n);
    expect(stats.readable).toBe(false);
    expect(fakeClient.getLogs).not.toHaveBeenCalled();
  });

  it("marks a successful read readable", async () => {
    expect((await getSocialStats(ADDRESS)).readable).toBe(true);
  });

  it("marks a failed scan unreadable instead of presenting zeros as fact", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fakeClient.getBlockNumber.mockRejectedValueOnce(new Error("rpc down"));
    const stats = await getSocialStats(ADDRESS);
    expect(stats.readable).toBe(false);
    expect(stats.goalsHit).toBe(0);
    // Not cached: the next view retries and reads the real numbers.
    expect((await getSocialStats(ADDRESS)).readable).toBe(true);
  });

  it("takes an oracle-only pool's tier from SPOTTER's ledger verdict", async () => {
    const withPool = fakeClient.getLogs.getMockImplementation();
    fakeClient.getLogs.mockImplementation(async (arg: { event: { name: string } }) => {
      if (arg.event.name === "AchieverPaid") {
        return [
          fakeLog({ amount: 1n, poolId: 1n }, 10, "0xp1"),
          fakeLog({ amount: 1n, poolId: 2n }, 11, "0xp2"),
          fakeLog({ amount: 1n, poolId: 3n }, 12, "0xp3"),
        ];
      }
      return withPool!(arg);
    });
    (fakeClient as unknown as { readContract: unknown }).readContract = vi.fn(
      async ({ args }: { args: [bigint, string] }) => `0xgoal${args[0].toString()}`,
    );
    readLedger.mockImplementation(async (goalId: string) => {
      if (goalId === "0xgoal1") return [{ kind: "verdict", verified: true }];
      if (goalId === "0xgoal2") return [{ kind: "verdict", verified: true, selfReported: true }];
      return [];
    });
    const stats = await getSocialStats(ADDRESS);
    expect(poolVerdictRegistry).toHaveBeenCalled();
    expect(stats.verifiedWins).toBe(1);
    expect(stats.selfReportedWins).toBe(1);
    // Pool 3 has no passing ledger verdict: unknown, never counted verified.
    expect(stats.goalsHit).toBe(3);
    fakeClient.getLogs.mockImplementation(withPool!);
  });
});

describe("tierFromLedger", () => {
  it("reads the newest passing verdict and never promotes a self-reported one", () => {
    expect(tierFromLedger([])).toBeNull();
    expect(
      tierFromLedger([
        { kind: "verdict", at: "", verified: false, confidence: "low", reason: "", ref: "a" },
      ]),
    ).toBeNull();
    expect(
      tierFromLedger([
        { kind: "verdict", at: "", verified: true, confidence: "high", reason: "", ref: "a" },
        { kind: "verdict", at: "", verified: true, confidence: "high", reason: "", ref: "b", selfReported: true },
      ]),
    ).toBe("self-reported");
  });
});
