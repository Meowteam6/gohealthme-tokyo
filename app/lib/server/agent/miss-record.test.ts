import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import type { Address, Hex } from "viem";
import type { ArcReader, SpotterExecutor } from "@/lib/server/agent/spotter";

// The sweep's side of the miss rule: every joined player of every pool that
// can record a miss is judged once after the grace, whether or not they ever
// opened the app; a skip leaves no trace in the ledger; the pool is marked
// done only when every player is judged; and after settle each recorded miss
// gets a closing row asserted on the settle transaction's own events.

const POOLS = "0xc4274eF2cBe28f77Af31b980055Cc1171818390C" as Address;
const A = "0xaaaa00000000000000000000000000000000aaaa" as Address;
const B = "0xbbbb00000000000000000000000000000000bbbb" as Address;
const C = "0xcccc00000000000000000000000000000000cccc" as Address;
const GRACE = 6n * 3600n;
const POOL = {
  settled: false,
  cancelled: false,
  periodStart: 100n,
  periodEnd: 1_000n,
  bountyModel: 2,
  goalSpec: "Sleep 7 hours for 1 night",
  entryFee: 1_000_000n,
};
const AFTER_GRACE = POOL.periodEnd + GRACE;

async function load() {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "miss-record-")));
  vi.stubEnv("HEALTH_POOLS_ADDRESS", POOLS);
  vi.stubEnv("MISS_GRACE_HOURS", "6");
  vi.resetModules();
  const missRecord = await import("@/lib/server/agent/miss-record");
  const store = await import("@/lib/server/agent/miss-store");
  const ledger = await import("@/lib/server/agent/ledger");
  const lock = await import("@/lib/server/agent/lock");
  const gate = await import("@/lib/server/screening/gate");
  lock.resetLocalCoordinationState();
  const goalOf = (who: Address) => gate.goalIdFor(POOLS, 1n, who, POOL.periodStart);
  return { ...missRecord, ...store, ...ledger, goalOf };
}

type Result = { joined: boolean; resultRecorded: boolean; verdict: boolean };

/** A chain where each player's result can change after the write lands. */
function chain(initial: Record<string, Result>, pool = POOL) {
  const results = new Map(Object.entries(initial).map(([k, v]) => [k.toLowerCase(), v]));
  const reader = {
    poolCount: vi.fn(async () => 1n),
    getPoolState: vi.fn(async () => pool),
    participants: vi.fn(async () => Object.keys(initial) as Address[]),
    participantResult: vi.fn(async (_pool: bigint, who: Address) => {
      return results.get(who.toLowerCase()) ?? { joined: false, resultRecorded: false, verdict: false };
    }),
    oracleAddress: vi.fn(async () => "0x0000000000000000000000000000000000000001"),
    settleTxHash: vi.fn(async () => "0xsettle" as Hex),
    settleLogs: vi.fn(async () => ({ paid: [], refunded: [] })),
  } as unknown as ArcReader;
  const legacyRecordResult = vi.fn(async (_pool: bigint, who: Address, verdict: boolean) => {
    results.set(who.toLowerCase(), { joined: true, resultRecorded: true, verdict });
    return `0xmiss${who.slice(2, 6)}` as Hex;
  });
  return { reader, results, legacyRecordResult };
}

function provider(values: Record<string, number> = { "1970-01-01": 5 }) {
  return {
    id: "junction",
    label: "Junction",
    readService: "junction-read",
    readLabel: "wearable summary (Junction)",
    readEstUsd: "0.01",
    metrics: ["sleep_hours", "workouts"],
    isConnected: vi.fn(async () => true),
    getMissEvidence: vi.fn(async () => ({
      values,
      heartbeatDays: Object.keys(values),
      tzOffsetSec: 0,
    })),
  };
}

function deps(
  c: ReturnType<typeof chain>,
  opts: { now?: bigint; stored?: (who: string) => string | null; prov?: ReturnType<typeof provider> } = {},
) {
  const prov = opts.prov ?? provider();
  return {
    spotter: { circle: {} as SpotterExecutor, reader: c.reader },
    legacyRecordResult: c.legacyRecordResult,
    read: {
      storedProviderId: vi.fn(async (who: string) => (opts.stored ? opts.stored(who) : "junction")),
      providerConfigured: vi.fn(() => true),
      providerById: vi.fn(() => prov),
    },
    nowSeconds: () => opts.now ?? AFTER_GRACE,
    poolsAddress: POOLS,
  } as never;
}

const notOut = { outOfTime: () => false };

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("runMissPhase", () => {
  it("records a miss for a player who never opened the app, skips a pass, then marks the pool done", async () => {
    const m = await load();
    const c = chain({
      [A]: { joined: true, resultRecorded: false, verdict: false },
      [B]: { joined: true, resultRecorded: true, verdict: true },
    });

    const report = await m.runMissPhase(deps(c), notOut);

    expect(report.missesRecorded).toBe(1);
    expect(report.missSkips).toEqual([{ poolId: "1", address: B, basis: "already-recorded" }]);
    expect(c.legacyRecordResult).toHaveBeenCalledTimes(1);
    expect(c.legacyRecordResult).toHaveBeenCalledWith(1n, A, false, 0n);
    expect(await m.missPhaseDone(1n)).toBe(true);

    const ledgerA = await m.readLedger(m.goalOf(A));
    expect(ledgerA.map((e) => e.kind)).toEqual(["plan", "spend", "verdict", "reason", "record"]);
    expect(ledgerA[0]).toMatchObject({ poolId: "1", participant: A });
    expect(ledgerA[1]).toMatchObject({ settlement: "prepaid", ref: "wearable-100", amountUsd: "0.01" });
    expect(ledgerA[2]).toMatchObject({ verified: false, confidence: "high" });
    expect(ledgerA[4]).toMatchObject({ verdict: false, stakeUsd: "1.00", resultTx: "0xmissaaaa" });
    // The pass never got a ledger from the miss phase.
    expect(await m.readLedger(m.goalOf(B))).toEqual([]);
    // And the public index lists only the miss.
    const indexed = (await m.listLedgerGoalIds(10)).map((e) => e.goalId);
    expect(indexed).toEqual([m.goalOf(A).toLowerCase()]);
  });

  it("does nothing before periodEnd + grace", async () => {
    const m = await load();
    const c = chain({ [A]: { joined: true, resultRecorded: false, verdict: false } });

    const report = await m.runMissPhase(deps(c, { now: AFTER_GRACE - 1n }), notOut);

    expect(report.missesRecorded).toBe(0);
    expect(c.reader.participants).not.toHaveBeenCalled();
    expect(await m.missPhaseDone(1n)).toBe(false);
  });

  it("a skip leaves no ledger row and still counts as judged", async () => {
    const m = await load();
    const c = chain({ [A]: { joined: true, resultRecorded: false, verdict: false } });

    const report = await m.runMissPhase(deps(c, { stored: () => null }), notOut);

    expect(report.missSkips).toEqual([{ poolId: "1", address: A, basis: "no-stored-provider" }]);
    expect(await m.readLedger(m.goalOf(A))).toEqual([]);
    expect(c.legacyRecordResult).not.toHaveBeenCalled();
    expect(await m.missPhaseDone(1n)).toBe(true);
  });

  it("partial data records nothing: the player is refunded at settle", async () => {
    const m = await load();
    const c = chain({ [A]: { joined: true, resultRecorded: false, verdict: false } });

    const report = await m.runMissPhase(deps(c, { prov: provider({}) }), notOut);

    expect(report.missSkips[0]).toMatchObject({ basis: "coverage-gap" });
    expect(c.legacyRecordResult).not.toHaveBeenCalled();
  });

  it("writes at most three misses per sweep and finishes the pool on the next", async () => {
    const m = await load();
    const players = Array.from({ length: 5 }, (_, i) =>
      `0x${String(i + 1).repeat(40)}` as Address,
    );
    const c = chain(
      Object.fromEntries(players.map((p) => [p, { joined: true, resultRecorded: false, verdict: false }])),
    );

    const first = await m.runMissPhase(deps(c), notOut);
    expect(first.missesRecorded).toBe(3);
    expect(first.truncated).toBe(true);
    expect(await m.missPhaseDone(1n)).toBe(false);

    const second = await m.runMissPhase(deps(c), notOut);
    expect(second.missesRecorded).toBe(2);
    expect(await m.missPhaseDone(1n)).toBe(true);
    expect(c.legacyRecordResult).toHaveBeenCalledTimes(5);
  });

  it("never records twice: a second pass over a done pool writes nothing", async () => {
    const m = await load();
    const c = chain({ [A]: { joined: true, resultRecorded: false, verdict: false } });
    await m.runMissPhase(deps(c), notOut);

    const again = await m.runMissPhase(deps(c), notOut);

    expect(again.missesRecorded).toBe(0);
    expect(c.legacyRecordResult).toHaveBeenCalledTimes(1);
    expect((await m.readLedger(m.goalOf(A))).filter((e) => e.kind === "record")).toHaveLength(1);
  });

  it("a chain read that fails is retried next pass, not taken as a decision", async () => {
    const m = await load();
    const c = chain({ [A]: { joined: true, resultRecorded: false, verdict: false } });
    (c.reader.participantResult as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("rpc 429"),
    );

    const report = await m.runMissPhase(deps(c), notOut);

    expect(report.missSkips).toEqual([]);
    expect(await m.missPhaseDone(1n)).toBe(false);
  });

  it("marks a pool that can never record a miss closed and never reads its players", async () => {
    const m = await load();
    const c = chain(
      { [A]: { joined: true, resultRecorded: false, verdict: false } },
      { ...POOL, bountyModel: 0 },
    );

    await m.runMissPhase(deps(c), notOut);

    expect(c.reader.participants).not.toHaveBeenCalled();
    expect((await m.readMissPool(1n)).closed).toBe(true);
  });
});

describe("closing a miss after settle", () => {
  async function missedThenSettled(logs: { paid: unknown[]; refunded: unknown[] }) {
    const m = await load();
    const c = chain({
      [A]: { joined: true, resultRecorded: false, verdict: false },
      [C]: { joined: true, resultRecorded: true, verdict: true },
    });
    await m.runMissPhase(deps(c), notOut);
    (c.reader.getPoolState as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...POOL,
      settled: true,
    });
    (c.reader.settleLogs as ReturnType<typeof vi.fn>).mockResolvedValue(logs);
    const report = await m.runMissPhase(deps(c), notOut);
    return { m, c, report, ledger: await m.readLedger(m.goalOf(A)) };
  }

  it("forfeited: the settle paid the players who hit and refunded this one nothing", async () => {
    const { m, report, ledger } = await missedThenSettled({
      paid: [{ participant: C, amount: 2_000_000n }],
      refunded: [],
    });

    expect(report.missesClosed).toBe(1);
    expect(ledger[ledger.length - 1]).toMatchObject({
      kind: "settle",
      status: "closed",
      outcome: "forfeited",
      txHash: "0xsettle",
    });
    expect((await m.readMissPool(1n)).closed).toBe(true);
  });

  it("refunded: nobody hit, so the settle credited this stake back", async () => {
    const { ledger } = await missedThenSettled({
      paid: [],
      refunded: [{ participant: A, amount: 1_000_000n }],
    });

    expect(ledger[ledger.length - 1]).toMatchObject({ status: "closed", outcome: "refunded" });
  });

  it("says nothing when the events do not say what happened to the stake", async () => {
    const { m, report, ledger } = await missedThenSettled({ paid: [], refunded: [] });

    expect(ledger.some((e) => e.kind === "settle")).toBe(false);
    expect(report.missErrors[0]).toMatch(/no refund/);
    expect((await m.readMissPool(1n)).closed).toBe(false);
  });

  it("waits when the settle transaction cannot be found yet", async () => {
    const m = await load();
    const c = chain({ [A]: { joined: true, resultRecorded: false, verdict: false } });
    await m.runMissPhase(deps(c), notOut);
    (c.reader.getPoolState as ReturnType<typeof vi.fn>).mockResolvedValue({ ...POOL, settled: true });
    (c.reader.settleTxHash as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const report = await m.runMissPhase(deps(c), notOut);

    expect(report.missesClosed).toBe(0);
    expect((await m.readMissPool(1n)).closed).toBe(false);
  });
});

describe("adjudicateMissUnlocked reconciliation", () => {
  it("writes the receipt for a miss already on chain whose ledger row never landed", async () => {
    const m = await load();
    const c = chain({ [A]: { joined: true, resultRecorded: true, verdict: false } });

    const out = await m.adjudicateMissUnlocked(deps(c), {
      goalId: m.goalOf(A),
      poolId: 1n,
      address: A,
    });

    expect(out.status).toBe("recorded");
    expect(c.legacyRecordResult).not.toHaveBeenCalled();
    const ledger = await m.readLedger(m.goalOf(A));
    expect(ledger.map((e) => e.kind)).toEqual(["plan", "record"]);
    expect(ledger[1]).toMatchObject({ verdict: false, stakeUsd: "1.00" });
  });
});

describe("usdcToUsd2", () => {
  it("truncates 6-decimal USDC to two decimals", () => {
    return load().then((m) => {
      expect(m.usdcToUsd2(1_000_000n)).toBe("1.00");
      expect(m.usdcToUsd2(2_509_999n)).toBe("2.50");
      expect(m.usdcToUsd2(500_000n)).toBe("0.50");
    });
  });
});
