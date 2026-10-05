// A hit waiting on its World ID confirm must be found by the settlement sweep
// through the pending queue, not by luck in the fallback scan (117bb64 review,
// follow-up 1). approvalGate and requestApproval run for real here, exactly
// as run.ts drives them; only the chain, Circle and the record write are
// faked. The fallback scan of the newest 100 ledgers is emptied on purpose, so
// a claim older than that window is found by the queue or not at all.
//
// Pinned: a request is queued the moment SPOTTER asks; after KILL_WORLD_ID
// flips, the waiting hit is recorded and paid and its pool is held from the
// pool phase. With the confirmation on, nothing queued on request is ever
// paid without a human yes: not a waiting one, not a declined, expired or
// cancelled one. With it off, a human no (declined) and a settled pool
// (cancelled) are still never paid, and leave the queue. A lapsed ask
// (expired) is paid once the switch is off, as the run route's gate pays it
// on the next poll (approved-record.ts, CONFIRMATION OFF).

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
  getSpotterWallet: vi.fn(async () => ({
    id: "test-wallet",
    address: "0x5beca2bce03ef2d8d91091744b2cfd6d1a5cd483",
    blockchain: "BASE-SEPOLIA",
  })),
}));
// One due, unsettled pool: the pool phase would settle (and refund) it unless
// the claim phase holds it.
const poolCount = vi.fn(async () => 1n);
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
  storeSettleTxCache: vi.fn(() => ({
    read: vi.fn(async () => null),
    write: vi.fn(async () => {}),
  })),
}));
vi.mock("@/lib/server/agent/miss-record", () => ({
  runMissPhase: vi.fn(async () => ({
    missesRecorded: 0,
    missesClosed: 0,
    missSkips: [],
    missErrors: [],
    truncated: false,
  })),
}));
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
// The claim is older than the fallback's newest-100 window. A partial mock
// outlives vi.resetModules, so the ledger's store does too: every test uses a
// goal of its own.
vi.mock("@/lib/server/agent/ledger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/agent/ledger")>();
  return { ...actual, listLedgerGoalIds: vi.fn(async () => []) };
});
// Every dequeue is observed (and still performed), so a test can pin which
// claims the sweep writes to the queue for.
const dequeued = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/agent/lock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/agent/lock")>();
  return {
    ...actual,
    removePendingSettlement: async (goalId: string) => {
      dequeued(goalId.toLowerCase());
      await actual.removePendingSettlement(goalId);
    },
  };
});

const SECRET = "cron-secret-1";
const USER = "0x1111111111111111111111111111111111111111";
let goalSeq = 0;
let GOAL = "";

async function load() {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "approval-sweep-")));
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
  vi.stubEnv("KILL_WORLD_ID", "");
  vi.stubEnv("HEALTH_POOLS_ADDRESS", "0xc4274eF2cBe28f77Af31b980055Cc1171818390C");
  vi.resetModules();
  const route = await import("@/app/api/agent/sweep/route");
  const ledger = await import("@/lib/server/agent/ledger");
  const lock = await import("@/lib/server/agent/lock");
  const approval = await import("@/lib/server/agent/approval");
  const provider = await import("@/lib/server/agent/approval-provider");
  lock.resetLocalCoordinationState();
  return { ...route, ...ledger, ...lock, ...approval, ...provider };
}

type Loaded = Awaited<ReturnType<typeof load>>;

/** What run.ts has written by the time it reaches the approval gate. */
async function seedHit(mod: Loaded) {
  await mod.appendLedger(GOAL, {
    kind: "plan",
    steps: [{ service: "attester-read", label: "read", estUsd: "0.02" }],
    capUsd: "1.00",
    poolId: "1",
    participant: USER,
  });
  await mod.appendLedger(GOAL, {
    kind: "verdict",
    verified: true,
    confidence: "high",
    reason: "7 of 7 nights",
    ref: "wearable-100",
  });
  await mod.appendLedger(GOAL, { kind: "reason", decision: "pay", note: "paying.", ref: "wearable-100" });
}

/** SPOTTER asks, as run.ts does right before the record write. */
async function spotterAsks(mod: Loaded, nowMs: number = Date.now()) {
  const gate = await mod.approvalGate({
    goalId: GOAL,
    poolId: 1n,
    address: USER,
    poolSettled: async () => false,
    nowMs,
  });
  if (gate.status !== "awaiting") throw new Error(`expected awaiting, got ${gate.status}`);
  return gate.record;
}

function cron() {
  return new Request("http://localhost/api/agent/sweep", {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

interface SweepBody {
  swept: string[];
  recorded: number;
  settled: number;
  poolsSettled: number;
}

async function sweep(mod: Loaded): Promise<SweepBody> {
  return (await (await mod.GET(cron())).json()) as SweepBody;
}

beforeEach(() => {
  goalSeq += 1;
  GOAL = "0x" + goalSeq.toString(16).padStart(64, "a");
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  poolCount.mockResolvedValue(1n);
  recordApprovedClaim.mockResolvedValue({ status: "paid", ledger: [] });
});

describe("a hit waiting on its World ID confirm when KILL_WORLD_ID flips", () => {
  it("is queued for the sweep the moment SPOTTER asks", async () => {
    const mod = await load();
    await seedHit(mod);
    await spotterAsks(mod);
    expect(await mod.listDuePendingSettlements(Math.floor(Date.now() / 1000), 10)).toEqual([GOAL]);
  });

  it("is recorded and paid by the sweep after the switch flips, and its pool is held", async () => {
    const mod = await load();
    await seedHit(mod);
    await spotterAsks(mod);
    vi.stubEnv("KILL_WORLD_ID", "1");

    const body = await sweep(mod);
    expect(recordApprovedClaim).toHaveBeenCalledTimes(1);
    expect(recordApprovedClaim.mock.calls[0][0]).toBe(GOAL);
    expect(recordApprovedClaim.mock.calls[0][1]).toMatchObject({
      poolId: 1n,
      participant: USER,
      attesterId: "wearable-100",
      evidenceKind: "wearable",
    });
    expect(body).toMatchObject({ swept: [GOAL], recorded: 1, settled: 1, poolsSettled: 0 });
    // The pool phase never refunded the pool underneath the hit.
    expect(settleDuePoolAsSpotter).not.toHaveBeenCalled();
  });

  it("is left alone while the confirmation is on: queued, never paid without a yes", async () => {
    const mod = await load();
    await seedHit(mod);
    await spotterAsks(mod);
    await sweep(mod);
    expect(recordApprovedClaim).not.toHaveBeenCalled();
    expect(settleRecordedClaim).not.toHaveBeenCalled();
  });
});

describe("claims the human did not confirm are never paid by the sweep", () => {
  async function declined(mod: Loaded) {
    const record = await spotterAsks(mod);
    const out = await mod.completeApproval({
      requestId: record.requestId,
      address: USER,
      decision: { decision: "decline" },
      provider: mod.mockApprovalProvider(),
    });
    expect(out.status).toBe("declined");
  }

  async function expired(mod: Loaded) {
    // Asked eleven minutes ago; the first read after the window lapses it.
    await spotterAsks(mod, Date.now() - 660_000);
    expect((await mod.readApproval(GOAL))?.status).toBe("expired");
  }

  async function cancelled(mod: Loaded) {
    await spotterAsks(mod);
    const gate = await mod.approvalGate({
      goalId: GOAL,
      poolId: 1n,
      address: USER,
      poolSettled: async () => true,
    });
    expect(gate.status).toBe("cancelled");
  }

  const cases = { declined, expired, cancelled } as const;

  for (const [name, reach] of Object.entries(cases)) {
    it(`never pays a ${name} claim while the confirmation is on`, async () => {
      const mod = await load();
      await seedHit(mod);
      await reach(mod);
      await sweep(mod);
      expect(recordApprovedClaim).not.toHaveBeenCalled();
      expect(settleRecordedClaim).not.toHaveBeenCalled();
    });
  }

  for (const [name, reach] of Object.entries({ declined, cancelled })) {
    it(`never pays a ${name} claim after the switch flips, and drops it from the queue`, async () => {
      const mod = await load();
      await seedHit(mod);
      await reach(mod);
      expect(await mod.listDuePendingSettlements(Math.floor(Date.now() / 1000), 10)).toEqual([]);
      vi.stubEnv("KILL_WORLD_ID", "1");
      await sweep(mod);
      expect(recordApprovedClaim).not.toHaveBeenCalled();
      expect(settleRecordedClaim).not.toHaveBeenCalled();
    });
  }

  it("pays a lapsed ask (expired) once the switch is off, as the run route would on its next poll", async () => {
    const mod = await load();
    await seedHit(mod);
    await expired(mod);
    vi.stubEnv("KILL_WORLD_ID", "1");
    const body = await sweep(mod);
    expect(recordApprovedClaim).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ recorded: 1 });
  });
});

// "Pay on the verdict" (Andre, 2026-10-02): the confirm is per wallet. An
// admin or an approved list player is never asked any more, but an ask opened
// for one before the change must not strand their hit: the sweep records it
// like a hit with the confirmation off. A World-bound player's ask still
// waits on their yes.
describe("the sweep, per wallet", () => {
  const ADMIN = "0x3333333333333333333333333333333333333333";

  /** Puts `address` on the closed-beta list, in the modules load() imported. */
  async function listed(address: string) {
    vi.stubEnv("ADMIN_ADDRESSES", ADMIN);
    const access = await import("@/lib/server/access");
    await access.requestAccess({ address });
    await access.decideAccess({ address, decision: "approve", adminAddress: ADMIN });
  }

  /** An ask opened before the change, as the old gate opened it for anyone. */
  async function legacyAsk(mod: Loaded, nowMs: number = Date.now()) {
    await mod.requestApproval({
      goalId: GOAL,
      poolId: 1n,
      address: USER,
      provider: mod.mockApprovalProvider(),
      askedBy: "spotter",
      nowMs,
    });
  }

  it("records and pays a list player's ask from before the change, with the confirmation on", async () => {
    const mod = await load();
    await seedHit(mod);
    await legacyAsk(mod);
    await listed(USER);
    const body = await sweep(mod);
    expect(recordApprovedClaim).toHaveBeenCalledTimes(1);
    expect(recordApprovedClaim.mock.calls[0][1]).toMatchObject({ participant: USER });
    expect(body).toMatchObject({ recorded: 1, poolsSettled: 0 });
  });

  it("never pays a list player's declined ask: a human no stays a no", async () => {
    const mod = await load();
    await seedHit(mod);
    const record = await spotterAsks(mod);
    await mod.completeApproval({
      requestId: record.requestId,
      address: USER,
      decision: { decision: "decline" },
      provider: mod.mockApprovalProvider(),
    });
    await listed(USER);
    await sweep(mod);
    expect(recordApprovedClaim).not.toHaveBeenCalled();
  });

  it("leaves a World-bound player's ask waiting on their yes", async () => {
    vi.stubEnv("WORLD_VERIFY_MODE", "mock");
    const mod = await load();
    const human = await import("@/lib/server/world/human");
    await human.bindHuman({
      address: USER,
      nullifierHash: `0x${"9".padStart(64, "0")}`,
      mode: "mock",
      protocolVersion: "4.0",
    });
    await listed(USER);
    await seedHit(mod);
    await spotterAsks(mod);
    await sweep(mod);
    expect(recordApprovedClaim).not.toHaveBeenCalled();
  });
});

// Only an ask puts a claim with no record in the queue (requestApproval,
// completeApproval). The fallback scan walks the newest 100 claims every tick,
// most of them still being played (no decision yet, or not met so far); the
// sweep must not spend a queue write on each of those, every two minutes.
describe("the sweep and claims SPOTTER never asked about", () => {
  for (const [name, decision] of [
    ["a hit with no ask", "pay"],
    ["a claim not met so far", "no-pay"],
  ] as const) {
    it(`writes nothing to the queue for ${name}, and pays nothing`, async () => {
      const mod = await load();
      await mod.appendLedger(GOAL, {
        kind: "plan",
        steps: [{ service: "attester-read", label: "read", estUsd: "0.02" }],
        capUsd: "1.00",
        poolId: "1",
        participant: USER,
      });
      await mod.appendLedger(GOAL, { kind: "reason", decision, note: "read.", ref: "wearable-100" });
      vi.mocked(mod.listLedgerGoalIds).mockResolvedValueOnce([{ goalId: GOAL, score: 0 }] as never);
      await sweep(mod);
      expect(dequeued).not.toHaveBeenCalledWith(GOAL);
      expect(recordApprovedClaim).not.toHaveBeenCalled();
      expect(settleRecordedClaim).not.toHaveBeenCalled();
    });
  }
});

// The queue is bounded. An ask that is not payable now (waiting on a human,
// or lapsed with the confirmation on) stays queued only while its ask is
// inside the record hold window; past it, it leaves, so lapsed asks nobody
// revisits cannot pile up at the head of the queue and crowd out due settles.
describe("the queue stays bounded", () => {
  it("keeps a fresh ask queued while it waits on the human", async () => {
    const mod = await load();
    await seedHit(mod);
    await spotterAsks(mod);
    await sweep(mod);
    expect(await mod.listDuePendingSettlements(Math.floor(Date.now() / 1000), 10)).toEqual([GOAL]);
  });

  it("drops an ask older than the hold window, unpaid, while the confirmation is on", async () => {
    const mod = await load();
    const { APPROVED_RECORD_HOLD_MS } = await import("@/lib/server/agent/approved-record");
    await seedHit(mod);
    // The ledger stamps each row with the wall clock, so the ask is made in
    // the past rather than merely dated there.
    const askedAt = Date.now() - APPROVED_RECORD_HOLD_MS - 60_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(askedAt);
    try {
      await spotterAsks(mod, askedAt);
    } finally {
      vi.useRealTimers();
    }
    expect(await mod.listDuePendingSettlements(Math.floor(Date.now() / 1000), 10)).toEqual([GOAL]);
    await sweep(mod);
    expect(recordApprovedClaim).not.toHaveBeenCalled();
    expect(await mod.listDuePendingSettlements(Math.floor(Date.now() / 1000), 10)).toEqual([]);
  });
});
