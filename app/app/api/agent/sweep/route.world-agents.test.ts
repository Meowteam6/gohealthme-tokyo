// The settlement sweep must never pay a PASS the human has not confirmed.
// World ID for Agents, ETHGlobal Tokyo 2026. The sweep settles only claims
// that carry a record row, and run.ts writes no record while an approval is
// pending, declined, expired or cancelled; this file pins that end to end
// through the sweep route itself, with the same fakes the sweep suite uses.

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
    "pool settled before this claim completed; a one-shot settle cannot pay it retroactively",
}));
vi.mock("@/lib/server/agent/wallet", () => ({
  getCircleClient: vi.fn(() => ({})),
  getSpotterWallet: vi.fn(async () => ({
    id: "test-wallet",
    address: "0x5beca2bce03ef2d8d91091744b2cfd6d1a5cd483",
    blockchain: "BASE-SEPOLIA",
  })),
}));
// Pool phase fakes: tests that need a due, unsettled pool set poolCount to 1.
const poolCount = vi.fn(async () => 0n);
const getPoolState = vi.fn(async () => ({ settled: false, periodEnd: 1n, periodStart: 0n }));
const settleDuePoolAsSpotter = vi.fn(async () => ({ status: "settled", txHash: "0xabc" }));
vi.mock("@/lib/server/agent/spotter", () => ({
  arcReader: vi.fn(() => ({
    poolCount,
    getPoolState,
    achieverPayouts: vi.fn(async () => []),
  })),
  settleDuePoolAsSpotter: (...args: unknown[]) =>
    (settleDuePoolAsSpotter as (...a: unknown[]) => unknown)(...args),
  storeSettleTxCache: vi.fn(() => ({ read: vi.fn(async () => null) })),
}));

// The record write is the run loop's job; the sweep's job is to drive it for
// an approved, unrecorded claim. The pure selectors stay real.
const recordApprovedClaim = vi.fn();
vi.mock("@/lib/server/agent/approved-record", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/agent/approved-record")>();
  return {
    ...actual,
    recordApprovedClaim: (...args: unknown[]) => recordApprovedClaim(...args),
  };
});
vi.mock("@/lib/server/agent/x402", () => ({
  liveBuyDeps: vi.fn(() => ({})),
}));

const SECRET = "cron-secret-1";
const USER = "0x1111111111111111111111111111111111111111";
const GOAL = "0x" + "ab".repeat(32);

async function loadRoute() {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "agent-sweep-wa-")));
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
  vi.resetModules();
  const route = await import("@/app/api/agent/sweep/route");
  const ledger = await import("@/lib/server/agent/ledger");
  const lock = await import("@/lib/server/agent/lock");
  lock.resetLocalCoordinationState();
  return { ...route, ...ledger, ...lock };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  poolCount.mockResolvedValue(0n);
});

async function seedApprovedUnrecorded(
  appendLedger: Awaited<ReturnType<typeof loadRoute>>["appendLedger"],
) {
  await appendLedger(GOAL, {
    kind: "plan",
    steps: [{ service: "attester-read", label: "read", estUsd: "0.02" }],
    capUsd: "1.00",
    poolId: "1",
    participant: USER,
  });
  await appendLedger(GOAL, {
    kind: "verdict",
    verified: true,
    confidence: "high",
    reason: "7 of 7 nights",
    ref: "wearable-100",
  });
  await appendLedger(GOAL, { kind: "reason", decision: "pay", note: "paying.", ref: "wearable-100" });
  await appendLedger(GOAL, {
    kind: "approval",
    status: "requested",
    requestId: "apr_00000000-0000-0000-0000-000000000000",
    action: `settle:${GOAL}:1`,
    provider: "mock",
  });
  await appendLedger(GOAL, {
    kind: "approval",
    status: "approved",
    requestId: "apr_00000000-0000-0000-0000-000000000000",
    action: `settle:${GOAL}:1`,
    provider: "mock",
    nullifierStub: "0xdeadbeef",
  });
}

function cron() {
  return new Request("http://localhost/api/agent/sweep", {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

describe("sweep and approved claims nobody recorded (tab closed after confirming)", () => {
  it("records the approved claim and keeps the pool phase off its pool", async () => {
    const { GET, appendLedger, addPendingSettlement } = await loadRoute();
    await seedApprovedUnrecorded(appendLedger);
    await addPendingSettlement(GOAL, Math.floor(Date.now() / 1000));
    // Pool 1 is past its period end and unsettled: without the hold, the pool
    // phase would settle it and refund the confirmed achiever (B-2).
    poolCount.mockResolvedValue(1n);
    recordApprovedClaim.mockResolvedValue({ status: "paid", ledger: [] });

    const body = (await (await GET(cron())).json()) as {
      swept: string[];
      recorded: number;
      settled: number;
      poolsSettled: number;
    };
    expect(recordApprovedClaim).toHaveBeenCalledTimes(1);
    const [goalId, target] = recordApprovedClaim.mock.calls[0] as [
      string,
      { poolId: bigint; participant: string; attesterId: string; evidenceKind: string },
    ];
    expect(goalId).toBe(GOAL);
    expect(target).toMatchObject({
      poolId: 1n,
      participant: USER,
      attesterId: "wearable-100",
      evidenceKind: "wearable",
    });
    expect(body.swept).toEqual([GOAL]);
    expect(body.recorded).toBe(1);
    expect(body.settled).toBe(1);
    expect(settleDuePoolAsSpotter).not.toHaveBeenCalled();
    expect(body.poolsSettled).toBe(0);
    // Never settled through the recorded-claim path: nothing was recorded yet.
    expect(settleRecordedClaim).not.toHaveBeenCalled();
  });

  it("keeps holding the pool and reports the error when the record write fails", async () => {
    const { GET, appendLedger, addPendingSettlement, listDuePendingSettlements } =
      await loadRoute();
    await seedApprovedUnrecorded(appendLedger);
    await addPendingSettlement(GOAL, Math.floor(Date.now() / 1000));
    poolCount.mockResolvedValue(1n);
    recordApprovedClaim.mockResolvedValue({ status: "error", ledger: [] });

    const body = (await (await GET(cron())).json()) as { errors: number; recorded: number };
    expect(body.errors).toBe(1);
    expect(body.recorded).toBe(0);
    expect(settleDuePoolAsSpotter).not.toHaveBeenCalled();
    // Still queued, so the next tick retries it.
    expect(await listDuePendingSettlements(Math.floor(Date.now() / 1000) + 1, 10)).toContain(GOAL);
  });

  it("counts a recorded claim still inside its period as deferred, not settled", async () => {
    const { GET, appendLedger, addPendingSettlement } = await loadRoute();
    await seedApprovedUnrecorded(appendLedger);
    await addPendingSettlement(GOAL, Math.floor(Date.now() / 1000));
    recordApprovedClaim.mockResolvedValue({ status: "recorded", ledger: [] });

    const body = (await (await GET(cron())).json()) as {
      recorded: number;
      deferred: number;
      settled: number;
    };
    expect(body).toMatchObject({ recorded: 1, deferred: 1, settled: 0 });
  });
});

describe("sweep and unapproved PASS decisions", () => {
  for (const status of ["requested", "declined", "expired", "cancelled"] as const) {
    it(`never settles a claim whose approval is ${status} (no record row exists)`, async () => {
      const { GET, appendLedger, addPendingSettlement } = await loadRoute();
      await appendLedger(GOAL, {
        kind: "plan",
        steps: [{ service: "attester-read", label: "read", estUsd: "0.02" }],
        capUsd: "1.00",
        poolId: "7",
        participant: USER,
      });
      await appendLedger(GOAL, { kind: "reason", decision: "pay", note: "paying.", ref: "job-1" });
      await appendLedger(GOAL, {
        kind: "approval",
        status,
        requestId: "apr_00000000-0000-0000-0000-000000000000",
        action: `settle:${GOAL}:1`,
        provider: "mock",
      });
      // Even if something queued it as due, the ledger is the authority.
      await addPendingSettlement(GOAL, Math.floor(Date.now() / 1000) - 60);

      const response = await GET(
        new Request("http://localhost/api/agent/sweep", {
          headers: { authorization: `Bearer ${SECRET}` },
        }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { swept: string[]; settled: number };
      expect(body.swept).toEqual([]);
      expect(body.settled).toBe(0);
      expect(settleRecordedClaim).not.toHaveBeenCalled();
    });
  }

  it("still settles a claim that was approved and then recorded", async () => {
    const { GET, appendLedger, addPendingSettlement } = await loadRoute();
    settleRecordedClaim.mockResolvedValue({ status: "settled", ledger: [] });
    await appendLedger(GOAL, {
      kind: "plan",
      steps: [{ service: "attester-read", label: "read", estUsd: "0.02" }],
      capUsd: "1.00",
      poolId: "7",
      participant: USER,
    });
    await appendLedger(GOAL, { kind: "reason", decision: "pay", note: "paying.", ref: "job-1" });
    await appendLedger(GOAL, {
      kind: "approval",
      status: "approved",
      requestId: "apr_00000000-0000-0000-0000-000000000000",
      action: `settle:${GOAL}:1`,
      provider: "mock",
      nullifierStub: "0xdeadbeef",
    });
    await appendLedger(GOAL, { kind: "record", goalId: GOAL, registryStatus: "recorded" });
    await addPendingSettlement(GOAL, Math.floor(Date.now() / 1000) - 60);

    const response = await GET(
      new Request("http://localhost/api/agent/sweep", {
        headers: { authorization: `Bearer ${SECRET}` },
      }),
    );
    const body = (await response.json()) as { swept: string[]; settled: number };
    expect(body.swept).toEqual([GOAL]);
    expect(body.settled).toBe(1);
    expect(settleRecordedClaim).toHaveBeenCalledTimes(1);
  });
});
