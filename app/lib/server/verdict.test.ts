import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Address, Hex } from "viem";

// The registry HealthPools.settle() gates on is the pool's own healthVerdict(),
// read from chain. These cases pin that decision at its source: address(0) is
// oracle-only (no registry read, no registry write, no env var required), a
// latched registry is written to at ITS address, and HEALTH_VERDICT_ADDRESS is
// never trusted over the chain. Every chain call is a fake; nothing here
// touches an RPC.

const POOLS = "0xc4274eF2cBe28f77Af31b980055Cc1171818390C" as Address;
const OTHER_POOLS = "0x5555555555555555555555555555555555555555" as Address;
const REGISTRY = "0x9bf5e4b54361DEAca4314c1d8de3aeB30111F042" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const USER = "0x1111111111111111111111111111111111111111" as Address;
const GOAL = ("0x" + "ab".repeat(32)) as Hex;
// Throwaway test key (all ones); never a real signer.
const TEST_SIGNER_KEY = "0x" + "11".repeat(32);

const chain = vi.hoisted(() => ({
  readContract: vi.fn(),
  simulateContract: vi.fn(),
  writeContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

vi.mock("@/lib/server/arc-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/arc-client")>();
  return {
    ...actual,
    arcPublicClient: () => ({
      readContract: chain.readContract,
      simulateContract: chain.simulateContract,
      waitForTransactionReceipt: chain.waitForTransactionReceipt,
    }),
    arcWalletClient: () => ({ writeContract: chain.writeContract }),
  };
});

/** Answer healthVerdict() with `registry` and computeGoalId with GOAL. */
function chainSays(registry: Address) {
  chain.readContract.mockImplementation(
    async (args: { functionName: string }) => {
      if (args.functionName === "healthVerdict") return registry;
      if (args.functionName === "computeGoalId") return GOAL;
      throw new Error(`unexpected read ${args.functionName}`);
    },
  );
}

async function loadVerdict() {
  vi.resetModules();
  return import("@/lib/server/verdict");
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.stubEnv("HEALTH_POOLS_ADDRESS", POOLS);
  chain.simulateContract.mockResolvedValue({ request: { fake: true } });
  chain.writeContract.mockResolvedValue("0xfeed");
  chain.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
});

describe("poolVerdictRegistry", () => {
  it("reads the pool's own healthVerdict() and reports 0x0 as oracle-only", async () => {
    chainSays(ZERO);
    const { poolVerdictRegistry } = await loadVerdict();

    expect(await poolVerdictRegistry()).toBeNull();
    expect(chain.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: POOLS, functionName: "healthVerdict" }),
    );
  });

  it("returns the latched registry address when the pool has one", async () => {
    chainSays(REGISTRY);
    const { poolVerdictRegistry } = await loadVerdict();

    expect(await poolVerdictRegistry()).toBe(REGISTRY);
  });

  it("caches per pool address: one read per pool, a different pool reads again", async () => {
    chainSays(ZERO);
    const { poolVerdictRegistry } = await loadVerdict();

    await poolVerdictRegistry();
    await poolVerdictRegistry();
    await poolVerdictRegistry(POOLS);
    expect(chain.readContract).toHaveBeenCalledTimes(1);

    await poolVerdictRegistry(OTHER_POOLS);
    expect(chain.readContract).toHaveBeenCalledTimes(2);
    expect(chain.readContract).toHaveBeenLastCalledWith(
      expect.objectContaining({ address: OTHER_POOLS }),
    );
  });

  it("does not require HEALTH_VERDICT_ADDRESS, and warns when it disagrees with the chain", async () => {
    chainSays(ZERO);
    vi.stubEnv("HEALTH_VERDICT_ADDRESS", REGISTRY);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { poolVerdictRegistry } = await loadVerdict();

    expect(await poolVerdictRegistry()).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/HEALTH_VERDICT_ADDRESS.*disagrees.*chain wins/),
    );
    warn.mockRestore();
  });

  it("never caches a failed read", async () => {
    chain.readContract
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(ZERO);
    const { poolVerdictRegistry } = await loadVerdict();

    await expect(poolVerdictRegistry()).rejects.toThrow(/boom/);
    expect(await poolVerdictRegistry()).toBeNull();
  });
});

describe("recordVerdict", () => {
  it("skips the registry write on an oracle-only pool without needing a signer or env var", async () => {
    chainSays(ZERO);
    // No ORACLE_SIGNER_PRIVATE_KEY and no HEALTH_VERDICT_ADDRESS: reaching
    // the write path would throw on the missing key, so a skip here proves
    // neither is required.
    const { recordVerdict } = await loadVerdict();

    const outcome = await recordVerdict(7n, USER, true, "high", "job-1");

    expect(outcome).toEqual({
      status: "skipped",
      reason: expect.stringMatching(/oracle-only.*healthVerdict\(\) is 0x0/),
    });
    expect(chain.simulateContract).not.toHaveBeenCalled();
    expect(chain.writeContract).not.toHaveBeenCalled();
  });

  it("writes to the registry the pool names, not the one in HEALTH_VERDICT_ADDRESS", async () => {
    chainSays(REGISTRY);
    vi.stubEnv("HEALTH_VERDICT_ADDRESS", "0x7777777777777777777777777777777777777777");
    vi.stubEnv("ORACLE_SIGNER_PRIVATE_KEY", TEST_SIGNER_KEY);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { recordVerdict } = await loadVerdict();

    const outcome = await recordVerdict(7n, USER, true, "high", "job-1");

    expect(outcome).toEqual({ status: "recorded", txHash: "0xfeed", goalId: GOAL });
    expect(chain.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: REGISTRY,
        functionName: "recordVerdict",
        args: [GOAL, true, 2, expect.any(String), expect.any(Number)],
      }),
    );
  });

  it("writes with HEALTH_VERDICT_ADDRESS unset when the pool has a registry", async () => {
    chainSays(REGISTRY);
    vi.stubEnv("ORACLE_SIGNER_PRIVATE_KEY", TEST_SIGNER_KEY);
    const { recordVerdict } = await loadVerdict();

    const outcome = await recordVerdict(7n, USER, true, "medium", "job-1");

    expect(outcome).toMatchObject({ status: "recorded", txHash: "0xfeed" });
    expect(chain.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: REGISTRY }),
    );
  });

  it("treats ALREADY_RECORDED on a registry pool as the end state it wanted", async () => {
    chainSays(REGISTRY);
    vi.stubEnv("ORACLE_SIGNER_PRIVATE_KEY", TEST_SIGNER_KEY);
    chain.simulateContract.mockRejectedValue(
      new Error("execution reverted: ALREADY_RECORDED"),
    );
    const { recordVerdict } = await loadVerdict();

    const outcome = await recordVerdict(7n, USER, true, "high", "job-1");

    expect(outcome).toEqual({ status: "already-recorded", goalId: GOAL });
    expect(chain.writeContract).not.toHaveBeenCalled();
  });
});
