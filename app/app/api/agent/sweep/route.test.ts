// The sweep route is what makes settlement autonomous: no browser polling,
// just SPOTTER's own pending-settlement queue plus the cron. Pinned here: the
// bearer auth gate (Vercel cron's exact header form), the eligibility filter (a
// record entry, no settled settle, a stored pool linkage, no terminal settle
// failure), the outcome counts, the single-flight guard that stops a manual run
// from racing the cron, the elapsed-time budget that stops the loop cleanly
// instead of being killed mid-settle, and the rule that a claim still inside
// its pool period costs no chain call at all.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";

const settleRecordedClaim = vi.fn();

vi.mock("@/lib/server/agent/run", () => ({
  settleRecordedClaim: (...args: unknown[]) => settleRecordedClaim(...args),
  livePoolSettleLock: vi.fn(() => ({
    acquire: vi.fn(async () => "token"),
    release: vi.fn(),
  })),
  SETTLE_UNPAYABLE_MESSAGE:
    "the challenge settled before this claim completed; a one-shot settle cannot pay it retroactively",
  LEGACY_SETTLE_UNPAYABLE_MESSAGE:
    "pool settled before this claim completed; a one-shot settle cannot pay it retroactively",
}));
vi.mock("@/lib/server/agent/wallet", () => ({
  getCircleClient: vi.fn(() => ({})),
  // The runSweep chain guard resolves the settler wallet before sweeping; the
  // fake reports Base so the guard passes and the sweep logic under test runs.
  getSpotterWallet: vi.fn(async () => ({
    id: "test-wallet",
    address: "0x5beca2bce03ef2d8d91091744b2cfd6d1a5cd483",
    blockchain: "BASE-SEPOLIA",
  })),
}));
const settleDuePoolAsSpotter = vi.fn();
let readerFake: Record<string, unknown> = {};
const settleTxWrite = vi.fn(async () => {});
vi.mock("@/lib/server/agent/spotter", () => ({
  arcReader: vi.fn(() => readerFake),
  settleDuePoolAsSpotter: (...args: unknown[]) => settleDuePoolAsSpotter(...args),
  storeSettleTxCache: vi.fn(() => ({ read: vi.fn(async () => null), write: settleTxWrite })),
}));
// The miss phase has its own tests (lib/server/agent/miss-record.test.ts);
// here only its place in the sweep and its report are pinned.
const EMPTY_MISS_REPORT = {
  missesRecorded: 0,
  missesClosed: 0,
  missSkips: [],
  missErrors: [],
  truncated: false,
};
const runMissPhase = vi.fn();
vi.mock("@/lib/server/agent/miss-record", () => ({
  runMissPhase: (...args: unknown[]) => runMissPhase(...args),
}));
vi.mock("@/lib/server/agent/x402", () => ({
  liveBuyDeps: vi.fn(() => ({})),
}));

const SECRET = "cron-secret-1";
const USER = "0x1111111111111111111111111111111111111111";

async function loadRoute() {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "agent-sweep-")));
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("HEALTH_POOLS_ADDRESS", "0xc4274eF2cBe28f77Af31b980055Cc1171818390C");
  vi.resetModules();
  const route = await import("@/app/api/agent/sweep/route");
  const ledger = await import("@/lib/server/agent/ledger");
  const lock = await import("@/lib/server/agent/lock");
  lock.resetLocalCoordinationState();
  return { ...route, ...ledger, ...lock };
}

function req(method: "GET" | "POST", auth?: string) {
  return new Request("http://localhost/api/agent/sweep", {
    method,
    headers: auth === undefined ? {} : { authorization: auth },
  });
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    kind: "plan" as const,
    steps: [
      {
        service: "attester-read",
        label: "document read (TEE attester)",
        estUsd: "0.02",
      },
    ],
    capUsd: "1.00",
    poolId: "7",
    participant: USER,
    ...overrides,
  };
}

function record(goalId: string) {
  return {
    kind: "record" as const,
    goalId,
    registryStatus: "recorded" as const,
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  readerFake = { poolCount: vi.fn(async () => 0n), getPoolState: vi.fn() };
  runMissPhase.mockResolvedValue(EMPTY_MISS_REPORT);
});

/** now - seconds, as a bigint periodEnd. */
function endedSecondsAgo(seconds: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) - seconds);
}

describe("sweep auth", () => {
  it("rejects a request with no authorization header", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req("POST"));
    expect(res.status).toBe(401);
    expect(settleRecordedClaim).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer token", async () => {
    const { POST } = await loadRoute();
    const res = await POST(req("POST", "Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("accepts Vercel cron's GET with the bearer header", async () => {
    const { GET } = await loadRoute();
    const res = await GET(req("GET", `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      swept: [],
      settled: 0,
      deferred: 0,
      errors: 0,
      recorded: 0,
      truncated: false,
      poolsSettled: 0,
      poolErrors: [],
      missesRecorded: 0,
      missesClosed: 0,
      missSkips: [],
      missErrors: [],
    });
  });
});

describe("sweep eligibility", () => {
  it("settles only recorded, unsettled claims with a stored pool linkage", async () => {
    const { POST, appendLedger } = await loadRoute();

    const eligible = "0x" + "aa".repeat(32);
    const alreadyPaid = "0x" + "bb".repeat(32);
    const unrecorded = "0x" + "cc".repeat(32);
    const noLinkage = "0x" + "dd".repeat(32);
    const terminal = "0x" + "ee".repeat(32);
    const terminalLegacy = "0x" + "ef".repeat(32);

    await appendLedger(eligible, plan());
    await appendLedger(eligible, record(eligible));

    await appendLedger(alreadyPaid, plan());
    await appendLedger(alreadyPaid, record(alreadyPaid));
    await appendLedger(alreadyPaid, {
      kind: "settle",
      status: "settled",
      txHash: "0xfeed",
      paidUsd: "50.00",
    });

    await appendLedger(unrecorded, plan());

    await appendLedger(noLinkage, plan({ poolId: undefined, participant: undefined }));
    await appendLedger(noLinkage, record(noLinkage));

    await appendLedger(terminal, plan());
    await appendLedger(terminal, record(terminal));
    await appendLedger(terminal, {
      kind: "error",
      stage: "settle",
      message:
        "the challenge settled before this claim completed; a one-shot settle cannot pay it retroactively",
    });

    // A ledger stored before the 2026-09-30 wording pass is just as terminal.
    await appendLedger(terminalLegacy, plan());
    await appendLedger(terminalLegacy, record(terminalLegacy));
    await appendLedger(terminalLegacy, {
      kind: "error",
      stage: "settle",
      message:
        "pool settled before this claim completed; a one-shot settle cannot pay it retroactively",
    });

    settleRecordedClaim.mockResolvedValue({ status: "settled", ledger: [] });

    const res = await POST(req("POST", `Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      swept: [eligible],
      settled: 1,
      deferred: 0,
      errors: 0,
      recorded: 0,
      truncated: false,
      poolsSettled: 0,
      poolErrors: [],
      missesRecorded: 0,
      missesClosed: 0,
      missSkips: [],
      missErrors: [],
    });
    expect(settleRecordedClaim).toHaveBeenCalledTimes(1);
    const [, input] = settleRecordedClaim.mock.calls[0] as [
      unknown,
      { goalId: string; poolId: bigint; participant: string },
    ];
    expect(input.goalId).toBe(eligible);
    expect(input.poolId).toBe(7n);
    expect(input.participant).toBe(USER);
  });

  it("counts settled, deferred and error outcomes separately", async () => {
    const { POST, appendLedger } = await loadRoute();

    const goals = ["0x" + "1a".repeat(32), "0x" + "2b".repeat(32), "0x" + "3c".repeat(32)];
    for (const goalId of goals) {
      await appendLedger(goalId, plan());
      await appendLedger(goalId, record(goalId));
    }
    const outcomes: Record<string, string> = {
      [goals[0]]: "settled",
      [goals[1]]: "deferred",
      [goals[2]]: "error",
    };
    settleRecordedClaim.mockImplementation(
      async (_deps: unknown, input: { goalId: string }) => ({
        status: outcomes[input.goalId],
        ledger: [],
      }),
    );

    const res = await POST(req("POST", `Bearer ${SECRET}`));
    const body = (await res.json()) as {
      swept: string[];
      settled: number;
      deferred: number;
      errors: number;
    };

    expect(body.swept.sort()).toEqual([...goals].sort());
    expect(body.settled).toBe(1);
    expect(body.deferred).toBe(1);
    expect(body.errors).toBe(1);
  });

  it("leaves a claim still inside its pool period alone, without a chain call", async () => {
    const { POST, appendLedger, listDuePendingSettlements } = await loadRoute();
    const goalId = "0x" + "7f".repeat(32);
    const periodEnd = new Date(Date.now() + 3_600_000);

    await appendLedger(goalId, plan());
    await appendLedger(goalId, record(goalId));
    await appendLedger(goalId, {
      kind: "settle",
      status: "deferred",
      periodEndIso: periodEnd.toISOString(),
    });

    const res = await POST(req("POST", `Bearer ${SECRET}`));

    expect(await res.json()).toMatchObject({ swept: [], settled: 0 });
    expect(settleRecordedClaim).not.toHaveBeenCalled();
    // It is queued for the moment it becomes settleable, so later sweeps find
    // it without walking the whole index.
    expect(await listDuePendingSettlements(Date.now() / 1000, 10)).toEqual([]);
    expect(
      await listDuePendingSettlements(periodEnd.getTime() / 1000, 10),
    ).toEqual([goalId.toLowerCase()]);
  });

  it("drops a settled claim from the pending queue", async () => {
    const { POST, appendLedger, addPendingSettlement, listDuePendingSettlements } =
      await loadRoute();
    const goalId = "0x" + "5e".repeat(32);

    await appendLedger(goalId, plan());
    await appendLedger(goalId, record(goalId));
    await appendLedger(goalId, {
      kind: "settle",
      status: "settled",
      txHash: "0xfeed",
      paidUsd: "50.00",
    });
    await addPendingSettlement(goalId, 1);

    await POST(req("POST", `Bearer ${SECRET}`));

    expect(await listDuePendingSettlements(Date.now() / 1000, 10)).toEqual([]);
  });
});

// Phase 2. The claim phase can only reach a pool some participant submitted
// proof for; a participant who joins and uploads nothing leaves no ledger entry
// at all, so nothing ever settles their pool and the contract's refund path
// never runs. Measured on Base Sepolia 2026-09-02: pools 2, 3 and 4 each held
// a participant's 0.50 USDC, 11-22h past periodEnd, unsettled, with no claim
// pointing at them. These pin the pool-driven phase that frees those stakes -
// and pin the two things it must NOT do: settle underneath a claim that is
// mid-verification, and swallow a pool it could not settle.
describe("sweep pool phase", () => {
  it("settles an abandoned pool that no claim points at", async () => {
    const { POST } = await loadRoute();
    readerFake = {
      poolCount: vi.fn(async () => 2n),
      getPoolState: vi.fn(async (poolId: bigint) =>
        poolId === 1n
          ? { settled: true, periodEnd: endedSecondsAgo(90_000) }
          : { settled: false, periodEnd: endedSecondsAgo(80_000) },
      ),
    };
    settleDuePoolAsSpotter.mockResolvedValue({
      status: "settled",
      txHash: "0xabc",
    });

    const res = await POST(req("POST", `Bearer ${SECRET}`));

    expect(await res.json()).toMatchObject({ poolsSettled: 1, poolErrors: [] });
    expect(settleDuePoolAsSpotter).toHaveBeenCalledTimes(1);
    const [, input] = settleDuePoolAsSpotter.mock.calls[0] as [
      unknown,
      { poolId: bigint },
    ];
    expect(input.poolId).toBe(2n);
  });

  it("leaves a pool inside the settle margin alone, so a verification in flight can land", async () => {
    const { POST } = await loadRoute();
    readerFake = {
      poolCount: vi.fn(async () => 1n),
      // Ended five minutes ago: past periodEnd, inside the margin.
      getPoolState: vi.fn(async () => ({
        settled: false,
        periodEnd: endedSecondsAgo(300),
      })),
    };

    const res = await POST(req("POST", `Bearer ${SECRET}`));

    expect(await res.json()).toMatchObject({ poolsSettled: 0 });
    expect(settleDuePoolAsSpotter).not.toHaveBeenCalled();
  });

  it("leaves a pool the claim phase owns alone, even when it is long past due", async () => {
    const { POST, appendLedger } = await loadRoute();
    const pending = "0x" + "a1".repeat(32);
    await appendLedger(pending, plan({ poolId: "3" }));
    await appendLedger(pending, record(pending));
    // A deferred claim whose re-poll moment is still ahead: the claim path owns
    // pool 3 and will pay this participant properly.
    await appendLedger(pending, {
      kind: "settle",
      status: "deferred",
      periodEndIso: new Date(Date.now() + 60_000).toISOString(),
    });

    readerFake = {
      poolCount: vi.fn(async () => 3n),
      getPoolState: vi.fn(async () => ({
        settled: false,
        periodEnd: endedSecondsAgo(80_000),
      })),
    };
    settleDuePoolAsSpotter.mockResolvedValue({
      status: "settled",
      txHash: "0xabc",
    });

    const res = await POST(req("POST", `Bearer ${SECRET}`));

    const settled = settleDuePoolAsSpotter.mock.calls.map(
      (c) => (c[1] as { poolId: bigint }).poolId,
    );
    expect(settled).toEqual([1n, 2n]);
    expect(settled).not.toContain(3n);
    expect(await res.json()).toMatchObject({ poolsSettled: 2 });
  });

  it("never settles a pool that is already settled", async () => {
    const { POST } = await loadRoute();
    readerFake = {
      poolCount: vi.fn(async () => 2n),
      getPoolState: vi.fn(async () => ({
        settled: true,
        periodEnd: endedSecondsAgo(80_000),
      })),
    };

    const res = await POST(req("POST", `Bearer ${SECRET}`));

    expect(await res.json()).toMatchObject({ poolsSettled: 0 });
    expect(settleDuePoolAsSpotter).not.toHaveBeenCalled();
  });

  it("reports a pool it could not settle instead of swallowing it", async () => {
    const { POST } = await loadRoute();
    readerFake = {
      poolCount: vi.fn(async () => 1n),
      getPoolState: vi.fn(async () => ({
        settled: false,
        periodEnd: endedSecondsAgo(80_000),
      })),
    };
    settleDuePoolAsSpotter.mockRejectedValue(new Error("NOT_SETTLER"));

    const res = await POST(req("POST", `Bearer ${SECRET}`));

    expect(await res.json()).toMatchObject({
      poolsSettled: 0,
      poolErrors: ["pool 1: NOT_SETTLER"],
    });
  });
});

describe("sweep miss phase", () => {
  it("never sends a recorded miss to the claim settle, which would throw on 'no payout'", async () => {
    const { POST, appendLedger, addPendingSettlement } = await loadRoute();
    const missed = "0x" + "4d".repeat(32);
    await appendLedger(missed, plan());
    await appendLedger(missed, {
      kind: "record",
      goalId: missed,
      registryStatus: "skipped",
      verdict: false,
      stakeUsd: "1.00",
    });
    await addPendingSettlement(missed, 1);
    readerFake = {
      poolCount: vi.fn(async () => 7n),
      getPoolState: vi.fn(async () => ({ settled: false, periodEnd: endedSecondsAgo(80_000) })),
    };
    settleDuePoolAsSpotter.mockResolvedValue({ status: "settled", txHash: "0xabc" });

    const res = await POST(req("POST", `Bearer ${SECRET}`));

    expect(settleRecordedClaim).not.toHaveBeenCalled();
    // Its pool is NOT claimed by the claim phase: the pool phase settles it.
    const settledPools = settleDuePoolAsSpotter.mock.calls.map(
      (c) => (c[1] as { poolId: bigint }).poolId,
    );
    expect(settledPools).toContain(7n);
    expect((await res.json()).swept).toEqual([]);
  });

  it("runs between the claim phase and the pool phase, and reports what it did", async () => {
    const { POST } = await loadRoute();
    const order: string[] = [];
    runMissPhase.mockImplementation(async () => {
      order.push("miss");
      return {
        missesRecorded: 1,
        missesClosed: 2,
        missSkips: [{ poolId: "5", address: USER, basis: "coverage-gap" }],
        missErrors: ["pool 4: rpc 429"],
        truncated: false,
      };
    });
    readerFake = {
      poolCount: vi.fn(async () => 1n),
      getPoolState: vi.fn(async () => ({ settled: false, periodEnd: endedSecondsAgo(80_000) })),
    };
    settleDuePoolAsSpotter.mockImplementation(async () => {
      order.push("pool");
      return { status: "held", dueAt: 1n };
    });

    const res = await POST(req("POST", `Bearer ${SECRET}`));

    expect(order).toEqual(["miss", "pool"]);
    expect(await res.json()).toMatchObject({
      missesRecorded: 1,
      missesClosed: 2,
      missSkips: [{ poolId: "5", address: USER, basis: "coverage-gap" }],
      missErrors: ["pool 4: rpc 429"],
      poolsSettled: 0,
      poolErrors: [],
    });
    const [missDeps, missOpts] = runMissPhase.mock.calls[0] as [
      { spotter: { reader: unknown }; legacyRecordResult: unknown; read: unknown },
      { outOfTime: () => boolean },
    ];
    expect(missDeps.spotter.reader).toBe(readerFake);
    expect(typeof missDeps.legacyRecordResult).toBe("function");
    expect(typeof missOpts.outOfTime).toBe("function");
  });

  it("stops the miss phase early enough that the pool phase still gets its turn", async () => {
    const { POST } = await loadRoute();
    const realNow = Date.now;
    let clock = realNow();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    let missOutOfTime: boolean | null = null;
    runMissPhase.mockImplementation(async (_deps: unknown, opts: { outOfTime: () => boolean }) => {
      // A slow provider read eats 31s of the 45s window.
      clock += 31_000;
      missOutOfTime = opts.outOfTime();
      return EMPTY_MISS_REPORT;
    });
    readerFake = {
      poolCount: vi.fn(async () => 1n),
      getPoolState: vi.fn(async () => ({ settled: false, periodEnd: endedSecondsAgo(80_000) })),
    };
    settleDuePoolAsSpotter.mockResolvedValue({ status: "settled", txHash: "0xabc" });

    const res = await POST(req("POST", `Bearer ${SECRET}`));

    expect(missOutOfTime).toBe(true);
    expect(await res.json()).toMatchObject({ poolsSettled: 1 });
    vi.mocked(Date.now).mockRestore();
  });

  it("a miss phase that throws is reported, and the pool phase still runs", async () => {
    const { POST } = await loadRoute();
    runMissPhase.mockRejectedValue(new Error("store down"));
    readerFake = {
      poolCount: vi.fn(async () => 1n),
      getPoolState: vi.fn(async () => ({ settled: false, periodEnd: endedSecondsAgo(80_000) })),
    };
    settleDuePoolAsSpotter.mockResolvedValue({ status: "settled", txHash: "0xabc" });

    const res = await POST(req("POST", `Bearer ${SECRET}`));

    expect(await res.json()).toMatchObject({
      missErrors: ["miss phase: store down"],
      poolsSettled: 1,
    });
  });

  it("the pool phase settles only through the miss-phase marker, and remembers the settle tx", async () => {
    const { POST } = await loadRoute();
    readerFake = {
      poolCount: vi.fn(async () => 1n),
      getPoolState: vi.fn(async () => ({ settled: false, periodEnd: endedSecondsAgo(80_000) })),
    };
    settleDuePoolAsSpotter.mockResolvedValue({ status: "settled", txHash: "0xabc" });

    await POST(req("POST", `Bearer ${SECRET}`));

    const [deps] = settleDuePoolAsSpotter.mock.calls[0] as [{ missPhaseDone?: unknown }];
    expect(typeof deps.missPhaseDone).toBe("function");
    expect(settleTxWrite).toHaveBeenCalledWith(1n, "0xabc");
  });
});

describe("sweep concurrency", () => {
  it("refuses to run while another sweep holds the lock", async () => {
    const { POST, appendLedger, acquireLock } = await loadRoute();
    const goalId = "0x" + "9a".repeat(32);
    await appendLedger(goalId, plan());
    await appendLedger(goalId, record(goalId));
    settleRecordedClaim.mockResolvedValue({ status: "settled", ledger: [] });

    // Stand in for a cron tick that is already mid-sweep on another instance.
    const held = await acquireLock("agent:sweep", 30_000);
    expect(held).not.toBeNull();

    const res = await POST(req("POST", `Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      swept: [],
      skipped: "a sweep is already running",
    });
    expect(settleRecordedClaim).not.toHaveBeenCalled();
  });

  it("stops on its time budget and reports the sweep truncated", async () => {
    const { POST, appendLedger } = await loadRoute();
    for (let i = 0; i < 4; i += 1) {
      const goalId = "0x" + String(i).repeat(2).padStart(2, "0").repeat(32);
      await appendLedger(goalId, plan());
      await appendLedger(goalId, record(goalId));
    }
    // Each settle burns most of the window; the loop must stop cleanly rather
    // than be killed mid-claim with no checkpoint.
    const realNow = Date.now;
    let clock = realNow();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    settleRecordedClaim.mockImplementation(async () => {
      clock += 30_000;
      return { status: "settled", ledger: [] };
    });

    const res = await POST(req("POST", `Bearer ${SECRET}`));
    const body = (await res.json()) as { settled: number; truncated: boolean };

    expect(body.truncated).toBe(true);
    expect(body.settled).toBe(2);
    expect(settleRecordedClaim).toHaveBeenCalledTimes(2);
    vi.mocked(Date.now).mockRestore();
  });
});
