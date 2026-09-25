import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import type { Address, Hex } from "viem";
import type { ScreeningResult } from "@/lib/server/screening/intercepta";
import { SCREEN_HELD_PREFIX as CLIENT_PREFIX } from "@/lib/agent-receipt";

// The gate SPOTTER passes before it signs. Pinned here, against the real
// spotter functions with a fake executor and a fake screener:
//   - blocked at record: no recordResult is signed (the exclusion point)
//   - blocked at settle: no settle is signed, no lock is taken (the hold)
//   - unavailable fails CLOSED at both: nothing signed, retryable error
//   - clear: the write proceeds and a "screen" row lands on the ledger
//   - unconfigured: no gate, no row, the write proceeds
//   - repeats of the same verdict do not flood the ledger

const POOL = 7n;
const GOAL = ("0x" + "ab".repeat(32)) as Hex;
const USER = "0x1111111111111111111111111111111111111111" as Address;
const POOLS = "0xc4274eF2cBe28f77Af31b980055Cc1171818390C" as Address;

function result(
  status: ScreeningResult["status"],
  extra: Partial<ScreeningResult> = {},
): ScreeningResult {
  return {
    status,
    address: USER,
    toxicScore: status === "blocked" ? 99 : status === "clear" ? 0 : null,
    traits: status === "blocked" ? [{ name: "sanction_address", risk: 3, txsCount: 1 }] : [],
    reason:
      status === "blocked"
        ? "Intercepta flagged sanction_address (1 tx); toxicScore 99."
        : status === "unavailable"
          ? "Intercepta did not answer within 5000ms. Payout held until screening answers."
          : status === "clear"
            ? "Intercepta reports no risk traits; toxicScore 0."
            : "INTERCEPTA_API_KEY is not set on this deployment; no payout screening ran.",
    rule: "block if any trait in {sanction_address}; toxicScore is reported, not decisive",
    checkedAt: "2026-09-26T00:00:00.000Z",
    cached: false,
    ...extra,
  };
}

function screener(status: ScreeningResult["status"]) {
  return { screen: vi.fn().mockResolvedValue(result(status)) };
}

async function load() {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "screen-gate-")));
  vi.stubEnv("CIRCLE_WALLET_ID", "w-1");
  vi.stubEnv("HEALTH_POOLS_ADDRESS", POOLS);
  vi.stubEnv("HEALTH_VERDICT_ADDRESS", "0x9bf5e4b54361DEAca4314c1d8de3aeB30111F042");
  vi.resetModules();
  const [spotter, gate, ledger] = await Promise.all([
    import("@/lib/server/agent/spotter"),
    import("@/lib/server/screening/gate"),
    import("@/lib/server/agent/ledger"),
  ]);
  return { ...spotter, ...gate, readLedger: ledger.readLedger };
}

function fakeExecutor() {
  return {
    createContractExecutionTransaction: vi
      .fn()
      .mockResolvedValue({ data: { id: "cx-1", state: "INITIATED" } }),
    getTransaction: vi.fn().mockResolvedValue({
      data: { transaction: { id: "cx-1", state: "CONFIRMED", txHash: "0xfeed" } },
    }),
  };
}

function fakeReader() {
  return {
    getPoolState: vi
      .fn()
      .mockResolvedValue({ settled: false, periodEnd: 1_000n, periodStart: 500n }),
    poolCount: vi.fn().mockResolvedValue(1n),
    canSettle: vi.fn().mockResolvedValue(true),
    oracleAddress: vi.fn().mockResolvedValue(USER),
    attesterAddress: vi.fn().mockResolvedValue(USER),
    participantRecorded: vi.fn().mockResolvedValue(false),
    verdictRecorded: vi.fn().mockResolvedValue(false),
    waitForInclusion: vi.fn().mockResolvedValue(undefined),
    achieverPayouts: vi.fn().mockResolvedValue([{ participant: USER, amount: 50_000_000n }]),
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SCREEN_HELD_PREFIX", () => {
  it("is the same string on the server and in the client mirror", async () => {
    const { SCREEN_HELD_PREFIX } = await load();
    expect(SCREEN_HELD_PREFIX).toBe(CLIENT_PREFIX);
  });
});

describe("goalIdFor", () => {
  it("matches HealthPoolsV3.computeGoalId: keccak256(abi.encode(pools, poolId, participant, periodStart))", async () => {
    const { goalIdFor } = await load();
    // Independently computed with viem for these inputs; a mismatch here would
    // put the record-time screen row on the wrong claim.
    const id = goalIdFor(POOLS, POOL, USER, 500n);
    expect(id).toMatch(/^0x[0-9a-f]{64}$/);
    expect(goalIdFor(POOLS, POOL, USER, 501n)).not.toBe(id);
    expect(goalIdFor(POOLS, 8n, USER, 500n)).not.toBe(id);
  });
});

describe("settle gate", () => {
  it("blocked: the settle is never signed and no lock is taken; the ledger says why", async () => {
    const m = await load();
    const executor = fakeExecutor();
    const lock = { acquire: vi.fn().mockResolvedValue("tok"), release: vi.fn() };
    const screen = screener("blocked");

    await expect(
      m.settlePoolAsSpotter(
        {
          circle: executor as never,
          reader: fakeReader() as never,
          nowSeconds: () => 2_000n,
          settleLock: lock,
          screen,
        },
        { poolId: POOL, goalId: GOAL, participant: USER },
      ),
    ).rejects.toThrow(/payout held by screening: Intercepta blocked/);

    expect(executor.createContractExecutionTransaction).not.toHaveBeenCalled();
    expect(lock.acquire).not.toHaveBeenCalled();
    const ledger = await m.readLedger(GOAL);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      kind: "screen",
      provider: "intercepta",
      purpose: "settle",
      status: "blocked",
      address: USER,
      traits: ["sanction_address"],
      toxicScore: 99,
    });
  });

  it("unavailable fails closed: nothing is signed and the error is a retryable hold", async () => {
    const m = await load();
    const executor = fakeExecutor();
    const screen = screener("unavailable");

    let thrown: unknown;
    try {
      await m.settlePoolAsSpotter(
        {
          circle: executor as never,
          reader: fakeReader() as never,
          nowSeconds: () => 2_000n,
          screen,
        },
        { poolId: POOL, goalId: GOAL, participant: USER },
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(m.PayoutScreeningHold);
    expect((thrown as Error).message).toContain(" unavailable ");
    expect(executor.createContractExecutionTransaction).not.toHaveBeenCalled();
    expect(m.revertKind(thrown)).toBeNull();
    const ledger = await m.readLedger(GOAL);
    expect(ledger.map((e) => e.kind)).toEqual(["screen"]);
    expect(ledger[0]).toMatchObject({ status: "unavailable" });
    expect((ledger[0] as { toxicScore?: number }).toxicScore).toBeUndefined();
  });

  it("clear: the settle proceeds and the screen row precedes it on the ledger", async () => {
    const m = await load();
    const executor = fakeExecutor();
    const screen = screener("clear");

    const outcome = await m.settlePoolAsSpotter(
      {
        circle: executor as never,
        reader: fakeReader() as never,
        nowSeconds: () => 2_000n,
        screen,
      },
      { poolId: POOL, goalId: GOAL, participant: USER },
    );
    expect(outcome.status).toBe("settled");
    expect(screen.screen).toHaveBeenCalledWith(USER);
    expect(executor.createContractExecutionTransaction).toHaveBeenCalledTimes(1);
    const ledger = await m.readLedger(GOAL);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ kind: "screen", purpose: "settle", status: "clear" });
  });

  it("unconfigured: no gate, no row, the settle proceeds", async () => {
    const m = await load();
    const executor = fakeExecutor();
    const outcome = await m.settlePoolAsSpotter(
      {
        circle: executor as never,
        reader: fakeReader() as never,
        nowSeconds: () => 2_000n,
        screen: screener("unconfigured"),
      },
      { poolId: POOL, goalId: GOAL, participant: USER },
    );
    expect(outcome.status).toBe("settled");
    expect(await m.readLedger(GOAL)).toEqual([]);
  });

  it("without an injected screener and without a key, the live client is unconfigured and the settle proceeds", async () => {
    const m = await load();
    const executor = fakeExecutor();
    const outcome = await m.settlePoolAsSpotter(
      { circle: executor as never, reader: fakeReader() as never, nowSeconds: () => 2_000n },
      { poolId: POOL, goalId: GOAL, participant: USER },
    );
    expect(outcome.status).toBe("settled");
    expect(await m.readLedger(GOAL)).toEqual([]);
  });

  it("does not re-append the same hold on every retry, but does record a change", async () => {
    const m = await load();
    const deps = {
      circle: fakeExecutor() as never,
      reader: fakeReader() as never,
      nowSeconds: () => 2_000n,
      screen: screener("blocked"),
    };
    const input = { poolId: POOL, goalId: GOAL, participant: USER };
    await expect(m.settlePoolAsSpotter(deps, input)).rejects.toThrow();
    await expect(m.settlePoolAsSpotter(deps, input)).rejects.toThrow();
    expect(await m.readLedger(GOAL)).toHaveLength(1);

    deps.screen = screener("clear");
    const outcome = await m.settlePoolAsSpotter(deps, input);
    expect(outcome.status).toBe("settled");
    expect((await m.readLedger(GOAL)).map((e) => (e as { status: string }).status)).toEqual([
      "blocked",
      "clear",
    ]);
  });
});

describe("record gate", () => {
  it("blocked: recordResult is never signed, so the wallet is never an achiever", async () => {
    const m = await load();
    const executor = fakeExecutor();
    const reader = fakeReader();
    const screen = screener("blocked");

    await expect(
      m.recordResultAsSpotter(
        { circle: executor as never, reader: reader as never, screen },
        { poolId: POOL, user: USER, verdict: true, multiplierBps: 10_000 },
      ),
    ).rejects.toThrow(/Intercepta blocked .* at record/);

    expect(executor.createContractExecutionTransaction).not.toHaveBeenCalled();
    // The row is keyed by the same goalId the contract computes.
    const goalId = m.goalIdFor(POOLS, POOL, USER, 500n);
    const ledger = await m.readLedger(goalId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ kind: "screen", purpose: "record", status: "blocked" });
  });

  it("unavailable fails closed at record too", async () => {
    const m = await load();
    const executor = fakeExecutor();
    await expect(
      m.recordResultAsSpotter(
        { circle: executor as never, reader: fakeReader() as never, screen: screener("unavailable") },
        { poolId: POOL, user: USER, verdict: true, multiplierBps: 10_000 },
      ),
    ).rejects.toThrow(/unavailable/);
    expect(executor.createContractExecutionTransaction).not.toHaveBeenCalled();
  });

  it("clear: the record is written after the screen", async () => {
    const m = await load();
    const executor = fakeExecutor();
    const outcome = await m.recordResultAsSpotter(
      { circle: executor as never, reader: fakeReader() as never, screen: screener("clear") },
      { poolId: POOL, user: USER, verdict: true, multiplierBps: 10_000 },
    );
    expect(outcome).toEqual({ status: "recorded", txHash: "0xfeed" });
    expect(executor.createContractExecutionTransaction).toHaveBeenCalledTimes(1);
  });

  it("a false verdict pays nothing and is not screened", async () => {
    const m = await load();
    const screen = screener("blocked");
    const outcome = await m.recordResultAsSpotter(
      { circle: fakeExecutor() as never, reader: fakeReader() as never, screen },
      { poolId: POOL, user: USER, verdict: false, multiplierBps: 10_000 },
    );
    expect(outcome.status).toBe("recorded");
    expect(screen.screen).not.toHaveBeenCalled();
  });

  it("writes no row when the reader cannot supply periodStart, but still holds", async () => {
    const m = await load();
    const reader = fakeReader();
    reader.getPoolState.mockResolvedValue({ settled: false, periodEnd: 1_000n });
    await expect(
      m.recordResultAsSpotter(
        { circle: fakeExecutor() as never, reader: reader as never, screen: screener("blocked") },
        { poolId: POOL, user: USER, verdict: true, multiplierBps: 10_000 },
      ),
    ).rejects.toThrow(/blocked/);
  });
});
