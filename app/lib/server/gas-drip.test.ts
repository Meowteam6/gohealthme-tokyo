// The gas drip: the treasury sends a sliver of Base Sepolia ETH to a wallet
// that cannot pay its own gas (a Dynamic email wallet is a plain EOA with 0
// ETH and is not sponsored). Chain access is faked; the spend windows are the
// real file-backed ones, so the caps are exercised through the same atomic
// reservation the faucet and the withdrawal use.

import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import type { Address, Hex } from "viem";
import {
  releaseFromWindow,
  spendFromWindow,
} from "@/app/api/_money/rate-limit";
import {
  DEFAULT_GAS_DRIP_CONFIG,
  gasDripConfig,
  runGasDrip,
  type GasDripConfig,
  type GasDripDeps,
} from "@/lib/server/gas-drip";

const NOW = 1_800_000_000_000;
const DRIP = DEFAULT_GAS_DRIP_CONFIG.dripWei;
const MIN = DEFAULT_GAS_DRIP_CONFIG.minWei;
const ONE_ETH = 1_000_000_000_000_000_000n;

let counter = 0;
function freshAddress(): Address {
  counter += 1;
  const hex = (counter + Math.floor(Math.random() * 1e9)).toString(16);
  return `0x${hex.padStart(40, "0")}` as Address;
}

interface FakeChain {
  balances: Map<string, bigint>;
  treasuryWei: bigint;
  sends: { to: Address; value: bigint }[];
  receiptStatus: "success" | "reverted";
  /** When false the send "lands" but the recipient balance never moves. */
  credit: boolean;
}

function fakeDeps(chain: FakeChain, nowMs = NOW): GasDripDeps {
  let active = 0;
  let maxActive = 0;
  const deps: GasDripDeps & { maxConcurrentSends: () => number } = {
    getBalance: async (address) => chain.balances.get(address.toLowerCase()) ?? 0n,
    treasuryBalance: async () => chain.treasuryWei,
    send: async (to, value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      chain.sends.push({ to, value });
      await new Promise((r) => setTimeout(r, 5));
      if (chain.credit && chain.receiptStatus === "success") {
        const key = to.toLowerCase();
        chain.balances.set(key, (chain.balances.get(key) ?? 0n) + value);
        chain.treasuryWei -= value;
      }
      active -= 1;
      return `0x${chain.sends.length.toString(16).padStart(64, "0")}` as Hex;
    },
    waitForReceipt: async () => ({ status: chain.receiptStatus }),
    spend: spendFromWindow,
    release: releaseFromWindow,
    lock: async (_name, fn) => fn(),
    now: () => nowMs,
    sleep: async () => undefined,
    maxConcurrentSends: () => maxActive,
  };
  return deps;
}

function newChain(overrides: Partial<FakeChain> = {}): FakeChain {
  return {
    balances: new Map(),
    treasuryWei: ONE_ETH / 10n,
    sends: [],
    receiptStatus: "success",
    credit: true,
    ...overrides,
  };
}

async function resetStore(): Promise<void> {
  const dir = process.env.DATA_DIR;
  if (dir === undefined) throw new Error("DATA_DIR must be set for this test");
  await fs.rm(path.join(dir, "spend-windows.json"), { force: true });
}

describe("runGasDrip", () => {
  beforeEach(resetStore);

  it("sends the drip to a wallet below the minimum and asserts the balance delta", async () => {
    const chain = newChain();
    const address = freshAddress();
    const outcome = await runGasDrip(address, DEFAULT_GAS_DRIP_CONFIG, fakeDeps(chain));

    expect(outcome.kind).toBe("dripped");
    if (outcome.kind !== "dripped") return;
    expect(chain.sends).toEqual([{ to: address, value: DRIP }]);
    // The answer carries the balance read back AFTER the send, and it moved by
    // the drip: success is the delta, not the receipt.
    expect(outcome.balanceWei).toBe(DRIP);
    expect(outcome.balanceWei - 0n).toBe(DRIP);
    expect(outcome.tx).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("sends nothing to a wallet that already holds enough gas", async () => {
    const address = freshAddress();
    const chain = newChain();
    chain.balances.set(address.toLowerCase(), MIN);
    const outcome = await runGasDrip(address, DEFAULT_GAS_DRIP_CONFIG, fakeDeps(chain));
    expect(outcome).toEqual({ kind: "funded", balanceWei: MIN, minWei: MIN });
    expect(chain.sends).toHaveLength(0);
  });

  it("caps one address at three drips per day", async () => {
    const address = freshAddress();
    const chain = newChain();
    const deps = fakeDeps(chain);
    for (let i = 0; i < 3; i += 1) {
      // The wallet spends its gas between drips, so it is below the minimum again.
      chain.balances.set(address.toLowerCase(), 0n);
      expect((await runGasDrip(address, DEFAULT_GAS_DRIP_CONFIG, deps)).kind).toBe("dripped");
    }
    chain.balances.set(address.toLowerCase(), 0n);
    const fourth = await runGasDrip(address, DEFAULT_GAS_DRIP_CONFIG, deps);
    expect(fourth.kind).toBe("address-cap");
    if (fourth.kind !== "address-cap") return;
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
    expect(fourth.message).toMatch(/3 gas top-ups today/);
    expect(fourth.message).toMatch(/faucet/i);
    expect(chain.sends).toHaveLength(3);
  });

  it("stops at the global daily budget and hands back the address reservation", async () => {
    const chain = newChain();
    const deps = fakeDeps(chain);
    const config: GasDripConfig = { ...DEFAULT_GAS_DRIP_CONFIG, dailyBudgetWei: DRIP * 2n };
    expect((await runGasDrip(freshAddress(), config, deps)).kind).toBe("dripped");
    expect((await runGasDrip(freshAddress(), config, deps)).kind).toBe("dripped");

    const refused = freshAddress();
    const third = await runGasDrip(refused, config, deps);
    expect(third.kind).toBe("budget");
    if (third.kind === "budget") expect(third.message).toMatch(/tomorrow/i);
    expect(chain.sends).toHaveLength(2);

    // The refused address kept its own allowance: with budget restored it can
    // still take three drips today.
    const roomy: GasDripConfig = { ...DEFAULT_GAS_DRIP_CONFIG, dailyBudgetWei: ONE_ETH };
    for (let i = 0; i < 3; i += 1) {
      chain.balances.set(refused.toLowerCase(), 0n);
      expect((await runGasDrip(refused, roomy, deps)).kind).toBe("dripped");
    }
  });

  it("refuses below the treasury floor without reserving or sending", async () => {
    const chain = newChain({
      treasuryWei: DEFAULT_GAS_DRIP_CONFIG.treasuryFloorWei + DRIP - 1n,
    });
    const address = freshAddress();
    const outcome = await runGasDrip(address, DEFAULT_GAS_DRIP_CONFIG, fakeDeps(chain));
    expect(outcome.kind).toBe("treasury-low");
    if (outcome.kind === "treasury-low") expect(outcome.message).toMatch(/faucet/i);
    expect(chain.sends).toHaveLength(0);

    // Nothing was reserved, so the address still has all three drips.
    chain.treasuryWei = ONE_ETH;
    const deps = fakeDeps(chain);
    for (let i = 0; i < 3; i += 1) {
      chain.balances.set(address.toLowerCase(), 0n);
      expect((await runGasDrip(address, DEFAULT_GAS_DRIP_CONFIG, deps)).kind).toBe("dripped");
    }
  });

  it("releases both reservations when the send reverts", async () => {
    const chain = newChain({ receiptStatus: "reverted" });
    const address = freshAddress();
    const deps = fakeDeps(chain);
    const outcome = await runGasDrip(address, DEFAULT_GAS_DRIP_CONFIG, deps);
    expect(outcome.kind).toBe("failed");

    chain.receiptStatus = "success";
    for (let i = 0; i < 3; i += 1) {
      chain.balances.set(address.toLowerCase(), 0n);
      expect((await runGasDrip(address, DEFAULT_GAS_DRIP_CONFIG, deps)).kind).toBe("dripped");
    }
  });

  it("does not report success when the balance never moved", async () => {
    const chain = newChain({ credit: false });
    const outcome = await runGasDrip(freshAddress(), DEFAULT_GAS_DRIP_CONFIG, fakeDeps(chain));
    expect(outcome.kind).toBe("failed");
  });

  it("serialises sends from the treasury key through the lock", async () => {
    const chain = newChain();
    const deps = fakeDeps(chain) as GasDripDeps & { maxConcurrentSends: () => number };
    const names: string[] = [];
    let held = false;
    deps.lock = async (name, fn) => {
      names.push(name);
      while (held) await new Promise((r) => setTimeout(r, 1));
      held = true;
      try {
        return await fn();
      } finally {
        held = false;
      }
    };
    const results = await Promise.all(
      [freshAddress(), freshAddress(), freshAddress()].map((a) =>
        runGasDrip(a, DEFAULT_GAS_DRIP_CONFIG, deps),
      ),
    );
    expect(results.map((r) => r.kind)).toEqual(["dripped", "dripped", "dripped"]);
    expect(deps.maxConcurrentSends()).toBe(1);
    expect(new Set(names).size).toBe(1);
  });

  it("re-checks the balance under the lock so a double tap drips once", async () => {
    const chain = newChain();
    const address = freshAddress();
    const deps = fakeDeps(chain);
    let held = false;
    deps.lock = async (_name, fn) => {
      while (held) await new Promise((r) => setTimeout(r, 1));
      held = true;
      try {
        return await fn();
      } finally {
        held = false;
      }
    };
    const [a, b] = await Promise.all([
      runGasDrip(address, DEFAULT_GAS_DRIP_CONFIG, deps),
      runGasDrip(address, DEFAULT_GAS_DRIP_CONFIG, deps),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(["dripped", "funded"]);
    expect(chain.sends).toHaveLength(1);
  });
});

describe("gasDripConfig", () => {
  it("defaults to 0.0005 ETH drips below 0.0002 ETH, 0.03 ETH a day, 0.01 ETH floor", () => {
    const config = gasDripConfig({});
    expect(config.dripWei).toBe(500_000_000_000_000n);
    expect(config.minWei).toBe(200_000_000_000_000n);
    expect(config.dailyBudgetWei).toBe(30_000_000_000_000_000n);
    expect(config.treasuryFloorWei).toBe(10_000_000_000_000_000n);
    expect(config.maxPerAddress).toBe(3);
  });

  it("reads wei overrides and ignores junk", () => {
    const config = gasDripConfig({
      GAS_DRIP_WEI: "1000000000000000",
      GAS_DRIP_MIN_WEI: "not-a-number",
      GAS_DRIP_DAILY_BUDGET_WEI: "-5",
      GAS_DRIP_TREASURY_FLOOR_WEI: "20000000000000000",
    });
    expect(config.dripWei).toBe(1_000_000_000_000_000n);
    expect(config.minWei).toBe(DEFAULT_GAS_DRIP_CONFIG.minWei);
    expect(config.dailyBudgetWei).toBe(DEFAULT_GAS_DRIP_CONFIG.dailyBudgetWei);
    expect(config.treasuryFloorWei).toBe(20_000_000_000_000_000n);
  });
});
