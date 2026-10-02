import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import type { Address, Hex } from "viem";
import type { ArcReader, SpotterExecutor } from "@/lib/server/agent/spotter";

// The AUTHORIZE gate in run.ts (World ID for Agents, ETHGlobal Tokyo 2026).
// Pinned here: with WORLD_APPROVAL_MODE unset the loop is byte-for-byte the
// old one; with it set, a pay decision writes NO record and reports
// "awaiting-approval" with SPOTTER's ask on the ledger; an approval lets the
// record and settle happen; a decline or an expiry leaves the chain untouched
// and reports plainly; a settled pool withdraws the ask; a misconfigured
// world provider is an honest error row, never a silent pass.

const GOAL = ("0x" + "ab".repeat(32)) as Hex;
const USER = "0x1111111111111111111111111111111111111111" as Address;
const SPOTTER = "0xd0d23b4ade9f55ca10e9c8a4e5b1e135f72c824d" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;

const INPUT = {
  goalId: GOAL,
  poolId: 7n,
  address: USER,
  goalSpec: "got a flu shot this season",
  attesterId: "job-1",
  evidenceKind: "document" as const,
};

async function loadRun() {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "agent-run-approval-")));
  vi.stubEnv("CIRCLE_WALLET_ID", "w-1");
  vi.stubEnv("SPOTTER_WALLET_ADDRESS", SPOTTER);
  vi.stubEnv("HEALTH_POOLS_ADDRESS", "0xc4274eF2cBe28f77Af31b980055Cc1171818390C");
  vi.stubEnv("HEALTH_VERDICT_ADDRESS", "0x9bf5e4b54361DEAca4314c1d8de3aeB30111F042");
  vi.resetModules();
  const run = await import("@/lib/server/agent/run");
  const lock = await import("@/lib/server/agent/lock");
  const budget = await import("@/lib/server/agent/budget");
  const approval = await import("@/lib/server/agent/approval");
  const provider = await import("@/lib/server/agent/approval-provider");
  lock.resetLocalCoordinationState();
  budget.resetLocalBudgetState();
  return { ...run, ...approval, ...provider };
}

function fakeExecutor() {
  return {
    createContractExecutionTransaction: vi
      .fn()
      .mockResolvedValue({ data: { id: "cx-1", state: "INITIATED" } }),
    getTransaction: vi.fn().mockResolvedValue({
      data: { transaction: { id: "cx-1", state: "CONFIRMED", txHash: "0xfeed" } },
    }),
  } as unknown as SpotterExecutor;
}

function fakeReader(overrides: Partial<ArcReader> = {}): ArcReader {
  return {
    poolCount: vi.fn().mockResolvedValue(1n),
    getPoolState: vi.fn().mockResolvedValue({ settled: false, periodEnd: 1_000n }),
    canSettle: vi.fn().mockResolvedValue(true),
    // Registry pool keeps these tests on the path they were written against
    // (verdictRegistry() arrived with the foundation lane).
    verdictRegistry: vi
      .fn()
      .mockResolvedValue("0x9bf5e4b54361DEAca4314c1d8de3aeB30111F042"),
    oracleAddress: vi.fn().mockResolvedValue(OTHER),
    attesterAddress: vi.fn().mockResolvedValue(OTHER),
    participantRecorded: vi.fn().mockResolvedValue(false),
    verdictRecorded: vi.fn().mockResolvedValue(false),
    waitForInclusion: vi.fn().mockResolvedValue(undefined),
    settledPayout: vi.fn().mockResolvedValue(null),
    achieverPayouts: vi.fn().mockResolvedValue([{ participant: USER, amount: 50_000_000n }]),
    ...overrides,
  };
}

const verifiedPoll = vi.fn().mockResolvedValue({
  status: "completed",
  verdict: { verified: true, confidence: "high", reason: "flu shot on record" },
});

function fakeBuy() {
  return {
    quoteAttesterRead: vi.fn().mockResolvedValue({
      service: "attester-read",
      label: "document read (TEE attester)",
      estUsd: "0.02",
      url: null,
    }),
    quoteVisionJudge: vi.fn().mockResolvedValue({
      service: "vision-judge",
      label: "vision judge (Gemini)",
      estUsd: "0.35",
      url: null,
    }),
    quoteChainRead: vi.fn().mockResolvedValue({
      service: "chain-read",
      label: "chain verification read (QuickNode, x402)",
      estUsd: "0.01",
      url: null,
    }),
    buy: vi.fn().mockImplementation(async (quote: { estUsd: string }) => ({
      amountUsd: quote.estUsd,
      settlement: "prepaid",
      gatewayTx: null,
      data: null,
    })),
  };
}

function fakeReason() {
  return vi.fn().mockImplementation(
    async (ctx: {
      attesterStatus: string;
      verdict: { verified: boolean; confidence: string; reason: string };
    }) => {
      const pay =
        ctx.attesterStatus === "completed" &&
        ctx.verdict.verified &&
        ctx.verdict.confidence !== "low";
      return {
        decision: pay ? "pay" : "no-pay",
        note: pay ? "paying." : `not paying: ${ctx.verdict.reason}`,
      };
    },
  );
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    spotter: { circle: fakeExecutor(), reader: fakeReader(), nowSeconds: () => 2_000n },
    buy: fakeBuy(),
    reason: fakeReason(),
    poll: verifiedPoll,
    legacyRecordResult: vi.fn().mockResolvedValue("0xbeef" as Hex),
    legacyRecordVerdict: vi
      .fn()
      .mockResolvedValue({ status: "recorded", txHash: "0xcafe", goalId: GOAL }),
    ...overrides,
  };
}

function kinds(ledger: { kind: string; status?: string }[]): string[] {
  return ledger.map((e) => (e.kind === "approval" ? `approval:${e.status}` : e.kind));
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("run.ts AUTHORIZE gate", () => {
  it("mode unset: a pay decision records and settles exactly as before, with no approval rows", async () => {
    const { runAgentForGoal } = await loadRun();
    const deps = makeDeps();
    const result = await runAgentForGoal(deps, INPUT);
    expect(result.status).toBe("paid");
    expect(deps.legacyRecordResult).toHaveBeenCalledTimes(1);
    expect(result.ledger.some((e) => e.kind === "approval")).toBe(false);
    expect(result.ledger.map((e) => e.kind)).toEqual([
      "plan",
      "spend",
      "verdict",
      "reason",
      "record",
      "settle",
    ]);
  });

  it("mock mode: a pay decision writes no record, opens SPOTTER's ask, and reports awaiting-approval", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const { runAgentForGoal, readApproval } = await loadRun();
    const deps = makeDeps();

    const first = await runAgentForGoal(deps, INPUT);
    expect(first.status).toBe("awaiting-approval");
    expect(deps.legacyRecordResult).not.toHaveBeenCalled();
    expect(deps.legacyRecordVerdict).not.toHaveBeenCalled();
    expect(
      (deps.spotter as { circle: SpotterExecutor }).circle.createContractExecutionTransaction,
    ).not.toHaveBeenCalled();
    expect(kinds(first.ledger)).toEqual([
      "plan",
      "spend",
      "verdict",
      "reason",
      "approval:requested",
    ]);
    const record = await readApproval(GOAL);
    expect(record).toMatchObject({ status: "pending", attempt: 1, address: USER, poolId: "7" });
    expect(first.ledger[4]).toMatchObject({ requestId: record?.requestId, provider: "mock" });

    // A re-poll keeps waiting and asks nothing new.
    const second = await runAgentForGoal(deps, INPUT);
    expect(second.status).toBe("awaiting-approval");
    expect(second.ledger.filter((e) => e.kind === "approval")).toHaveLength(1);
    expect(deps.legacyRecordResult).not.toHaveBeenCalled();
  });

  it("mock mode: once the human approves, the next poll records and settles, asserting on the payout", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const { runAgentForGoal, readApproval, completeApproval, mockApprovalProvider, MOCK_PROOF_KIND } =
      await loadRun();
    const deps = makeDeps();
    await runAgentForGoal(deps, INPUT);
    const record = await readApproval(GOAL);
    if (record === null) throw new Error("expected a request");
    const done = await completeApproval({
      requestId: record.requestId,
      address: USER,
      decision: {
        decision: "approve",
        proof: { kind: MOCK_PROOF_KIND, action: record.action, signal: record.signal, approve: true },
      },
      provider: mockApprovalProvider(),
    });
    expect(done.status).toBe("approved");

    const result = await runAgentForGoal(deps, INPUT);
    expect(result.status).toBe("paid");
    expect(deps.legacyRecordResult).toHaveBeenCalledWith(7n, USER, true, 20_000n);
    expect(result.ledger.find((e) => e.kind === "settle")).toMatchObject({
      status: "settled",
      txHash: "0xfeed",
      paidUsd: "50",
    });
    expect(kinds(result.ledger)).toEqual([
      "plan",
      "spend",
      "verdict",
      "reason",
      "approval:requested",
      "approval:approved",
      "record",
      "settle",
    ]);
  });

  it("mock mode: a decline leaves the chain untouched and reports approval-declined on every later poll", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const { runAgentForGoal, readApproval, completeApproval, mockApprovalProvider } = await loadRun();
    const deps = makeDeps();
    await runAgentForGoal(deps, INPUT);
    const record = await readApproval(GOAL);
    if (record === null) throw new Error("expected a request");
    await completeApproval({
      requestId: record.requestId,
      address: USER,
      decision: { decision: "decline" },
      provider: mockApprovalProvider(),
    });

    const result = await runAgentForGoal(deps, INPUT);
    expect(result.status).toBe("approval-declined");
    expect(deps.legacyRecordResult).not.toHaveBeenCalled();
    expect(result.ledger.some((e) => e.kind === "record")).toBe(false);
    expect(result.ledger.some((e) => e.kind === "settle")).toBe(false);
    const again = await runAgentForGoal(deps, INPUT);
    expect(again.status).toBe("approval-declined");
    expect(again.ledger.filter((e) => e.kind === "approval")).toHaveLength(2);
  });

  it("mock mode: an unanswered request expires; nothing is recorded and the run says so", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    vi.stubEnv("WORLD_APPROVAL_TTL_S", "10");
    const { runAgentForGoal } = await loadRun();
    const deps = makeDeps();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.parse("2026-09-26T03:00:00.000Z"));
      const first = await runAgentForGoal(deps, INPUT);
      expect(first.status).toBe("awaiting-approval");
      vi.setSystemTime(Date.parse("2026-09-26T03:00:11.000Z"));
      const late = await runAgentForGoal(deps, INPUT);
      expect(late.status).toBe("approval-expired");
      expect(kinds(late.ledger).slice(-2)).toEqual(["approval:requested", "approval:expired"]);
      expect(deps.legacyRecordResult).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("mock mode: a pool that settled while the ask was open withdraws it; no record, no settle attempt", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const { runAgentForGoal } = await loadRun();
    const reader = fakeReader();
    const deps = makeDeps({ spotter: { circle: fakeExecutor(), reader, nowSeconds: () => 2_000n } });
    await runAgentForGoal(deps, INPUT);
    (reader.getPoolState as ReturnType<typeof vi.fn>).mockResolvedValue({
      settled: true,
      periodEnd: 1_000n,
    });
    const result = await runAgentForGoal(deps, INPUT);
    expect(result.status).toBe("approval-cancelled");
    expect(kinds(result.ledger).slice(-2)).toEqual(["approval:requested", "approval:cancelled"]);
    expect(deps.legacyRecordResult).not.toHaveBeenCalled();
  });

  it("world mode without env: an honest error row, nothing recorded, nothing paid", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "world");
    const { runAgentForGoal } = await loadRun();
    const deps = makeDeps();
    const result = await runAgentForGoal(deps, INPUT);
    expect(result.status).toBe("error");
    expect(result.ledger[result.ledger.length - 1]).toMatchObject({
      kind: "error",
      stage: "approval",
      message: expect.stringContaining("WORLD_APP_ID"),
    });
    expect(deps.legacyRecordResult).not.toHaveBeenCalled();
  });

  it("no-pay decisions never ask a human", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const { runAgentForGoal, readApproval } = await loadRun();
    const poll = vi.fn().mockResolvedValue({
      status: "failed",
      verdict: { verified: false, confidence: "low", reason: "unreadable" },
    });
    const result = await runAgentForGoal(makeDeps({ poll }), INPUT);
    expect(result.status).toBe("no-pay");
    expect(await readApproval(GOAL)).toBeNull();
  });
});

// "Pay on the verdict" (Andre, 2026-10-02): with the confirmation on, an admin
// or an approved list player is recorded and paid on the verdict, like V3,
// with no approval request; the result is recorded for, and paid to, the
// staker's own wallet. A World-verified player still waits on World ID.
describe("run.ts AUTHORIZE gate, paid on the verdict", () => {
  const ADMIN = "0x3333333333333333333333333333333333333333";

  async function listed(mode: string) {
    vi.stubEnv("WORLD_APPROVAL_MODE", mode);
    vi.stubEnv("WORLD_VERIFY_MODE", "mock");
    vi.stubEnv("ADMIN_ADDRESSES", ADMIN);
    const mod = await loadRun();
    const access = await import("@/lib/server/access");
    await access.requestAccess({ address: USER });
    await access.decideAccess({ address: USER, decision: "approve", adminAddress: ADMIN });
    return mod;
  }

  for (const mode of ["mock", "world"]) {
    it(`${mode} mode: an approved list player is recorded and paid on the verdict, to their own wallet, with no approval rows`, async () => {
      const { runAgentForGoal, readApproval } = await listed(mode);
      const deps = makeDeps();
      const result = await runAgentForGoal(deps, INPUT);
      expect(result.status).toBe("paid");
      expect(deps.legacyRecordResult).toHaveBeenCalledWith(7n, USER, true, 20_000n);
      expect(result.ledger.find((e) => e.kind === "settle")).toMatchObject({
        status: "settled",
        paidUsd: "50",
      });
      expect(kinds(result.ledger)).toEqual(["plan", "spend", "verdict", "reason", "record", "settle"]);
      expect(await readApproval(GOAL)).toBeNull();
    });
  }

  it("mock mode: an admin is recorded and paid on the verdict", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    vi.stubEnv("ADMIN_ADDRESSES", USER);
    const { runAgentForGoal } = await loadRun();
    const deps = makeDeps();
    const result = await runAgentForGoal(deps, INPUT);
    expect(result.status).toBe("paid");
    expect(result.ledger.some((e) => e.kind === "approval")).toBe(false);
  });

  it("mock mode: a World-verified player still waits on their World ID confirm", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    vi.stubEnv("WORLD_VERIFY_MODE", "mock");
    const { runAgentForGoal } = await loadRun();
    const human = await import("@/lib/server/world/human");
    await human.bindHuman({
      address: USER,
      nullifierHash: `0x${"7".padStart(64, "0")}`,
      mode: "mock",
      protocolVersion: "4.0",
    });
    const deps = makeDeps();
    const result = await runAgentForGoal(deps, INPUT);
    expect(result.status).toBe("awaiting-approval");
    expect(deps.legacyRecordResult).not.toHaveBeenCalled();
  });
});
