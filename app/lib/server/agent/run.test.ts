import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import type { Address, Hex } from "viem";
import type { ArcReader, SpotterExecutor } from "@/lib/server/agent/spotter";

// The run loop is SPOTTER's whole job: plan, buy, read the attester, decide,
// record, settle when settleable. Pinned here: the plan lands before any
// spend, a re-poll never double-buys, the cap aborts the run before money
// leaves, record dispatches to the Circle wallet only when the on-chain roles
// actually point at it, and "paid" is only ever reported off a real payout.

const GOAL = ("0x" + "ab".repeat(32)) as Hex;
const USER = "0x1111111111111111111111111111111111111111" as Address;
const SPOTTER = "0xd0d23b4ade9f55ca10e9c8a4e5b1e135f72c824d" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;
/** The registry the fake pool reports from its own healthVerdict(). */
const REGISTRY = "0x9bf5e4b54361DEAca4314c1d8de3aeB30111F042" as Address;

const INPUT = {
  goalId: GOAL,
  poolId: 7n,
  address: USER,
  goalSpec: "got a flu shot this season",
  attesterId: "job-1",
  evidenceKind: "document" as const,
};

async function loadRun() {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "agent-run-")));
  vi.stubEnv("CIRCLE_WALLET_ID", "w-1");
  vi.stubEnv("SPOTTER_WALLET_ADDRESS", SPOTTER);
  vi.stubEnv(
    "HEALTH_POOLS_ADDRESS",
    "0xc4274eF2cBe28f77Af31b980055Cc1171818390C",
  );
  vi.stubEnv(
    "HEALTH_VERDICT_ADDRESS",
    "0x9bf5e4b54361DEAca4314c1d8de3aeB30111F042",
  );
  vi.resetModules();
  const run = await import("@/lib/server/agent/run");
  // The same module instances run.ts is holding, so a test can stand in for a
  // sibling lambda by taking a lock or spending budget out from under it.
  const lock = await import("@/lib/server/agent/lock");
  const budget = await import("@/lib/server/agent/budget");
  const missRecord = await import("@/lib/server/agent/miss-record");
  lock.resetLocalCoordinationState();
  budget.resetLocalBudgetState();
  return { ...run, lock, budget, missRecord };
}

function fakeExecutor() {
  return {
    createContractExecutionTransaction: vi
      .fn()
      .mockResolvedValue({ data: { id: "cx-1", state: "INITIATED" } }),
    getTransaction: vi.fn().mockResolvedValue({
      data: {
        transaction: { id: "cx-1", state: "CONFIRMED", txHash: "0xfeed" },
      },
    }),
  } as unknown as SpotterExecutor;
}

function fakeReader(overrides: Partial<ArcReader> = {}): ArcReader {
  return {
    poolCount: vi.fn().mockResolvedValue(1n),
    getPoolState: vi
      .fn()
      .mockResolvedValue({ settled: false, periodEnd: 1_000n }),
    canSettle: vi.fn().mockResolvedValue(true),
    // Registry latched on the pool by default: every pre-existing case here
    // was written against the registry branch and must keep meaning that.
    verdictRegistry: vi.fn().mockResolvedValue(REGISTRY),
    oracleAddress: vi.fn().mockResolvedValue(OTHER),
    attesterAddress: vi.fn().mockResolvedValue(OTHER),
    participantRecorded: vi.fn().mockResolvedValue(false),
    verdictRecorded: vi.fn().mockResolvedValue(false),
    waitForInclusion: vi.fn().mockResolvedValue(undefined),
    settledPayout: vi.fn().mockResolvedValue(null),
    achieverPayouts: vi
      .fn()
      .mockResolvedValue([{ participant: USER, amount: 50_000_000n }]),
    ...overrides,
  };
}

const verifiedPoll = vi.fn().mockResolvedValue({
  status: "completed",
  verdict: { verified: true, confidence: "high", reason: "flu shot on record" },
});

// Prepaid-settling buy fakes mirroring liveBuyDeps with no env configured.
function fakeBuy(overrides: Record<string, unknown> = {}) {
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
    buy: vi
      .fn()
      .mockImplementation(async (quote: { estUsd: string }) => ({
        amountUsd: quote.estUsd,
        settlement: "prepaid",
        gatewayTx: null,
        data: null,
      })),
    ...overrides,
  };
}

// Mirrors deterministicReason so existing flow expectations keep holding.
function fakeReason() {
  return vi
    .fn()
    .mockImplementation(
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
    spotter: {
      circle: fakeExecutor(),
      reader: fakeReader(),
      nowSeconds: () => 2_000n,
    },
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

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("runAgentForGoal", () => {
  it("emits the plan before the spend and reports verifying without duplicating buys", async () => {
    const { runAgentForGoal } = await loadRun();
    const poll = vi.fn().mockResolvedValue({ status: "verifying", verdict: null });
    const deps = makeDeps({ poll });

    const first = await runAgentForGoal(deps, INPUT);
    expect(first.status).toBe("verifying");
    expect(first.ledger[0].kind).toBe("plan");
    expect(first.ledger[1].kind).toBe("spend");

    const second = await runAgentForGoal(deps, INPUT);
    expect(
      second.ledger.filter((e) => e.kind === "spend"),
    ).toHaveLength(1);
  });

  it("decides no-pay on a failed inference and never touches the chain", async () => {
    const { runAgentForGoal } = await loadRun();
    const poll = vi.fn().mockResolvedValue({
      status: "failed",
      verdict: { verified: false, confidence: "low", reason: "unreadable" },
    });
    const deps = makeDeps({ poll });

    const result = await runAgentForGoal(deps, INPUT);

    expect(result.status).toBe("no-pay");
    expect(result.ledger.some((e) => e.kind === "reason")).toBe(true);
    expect(deps.legacyRecordResult).not.toHaveBeenCalled();
    expect(
      (deps.spotter as { circle: SpotterExecutor }).circle
        .createContractExecutionTransaction,
    ).not.toHaveBeenCalled();
  });

  it("records via the legacy signer while the on-chain roles still point at it, deferring settlement", async () => {
    const { runAgentForGoal, SETTLE_REPOLL_JITTER_MS } = await loadRun();
    const deps = makeDeps();
    (deps.spotter as { nowSeconds: () => bigint }).nowSeconds = () => 500n;

    const result = await runAgentForGoal(deps, INPUT);

    expect(result.status).toBe("recorded");
    expect(deps.legacyRecordResult).toHaveBeenCalledWith(
      7n,
      USER,
      true,
      20_000n,
    );
    expect(deps.legacyRecordVerdict).toHaveBeenCalled();
    expect(
      (deps.spotter as { circle: SpotterExecutor }).circle
        .createContractExecutionTransaction,
    ).not.toHaveBeenCalled();
    const settle = result.ledger.find((e) => e.kind === "settle");
    expect(settle).toMatchObject({ status: "deferred" });
    // periodEndIso carries the pool's periodEnd plus a small per-claim jitter,
    // so a pool full of open tabs does not fire every settle re-poll in the
    // same instant. Never earlier than the real period end.
    const deferredAt = Date.parse(
      (settle as { periodEndIso: string }).periodEndIso,
    );
    expect(deferredAt).toBeGreaterThanOrEqual(1_000_000);
    expect(deferredAt).toBeLessThan(1_000_000 + SETTLE_REPOLL_JITTER_MS);
    // Plain prose only - the raw epoch lives in periodEndIso, not the note.
    expect((settle as { note: string }).note).not.toMatch(/1000/);
    // The plan carries the pool linkage the sweep route needs.
    expect(result.ledger[0]).toMatchObject({
      kind: "plan",
      poolId: "7",
      participant: USER,
    });
  });

  it("records a self-reported claim honestly: 1x multiplier, clamped confidence, bitmap 0, and a flagged ledger", async () => {
    const { runAgentForGoal } = await loadRun();
    const deps = makeDeps();
    (deps.spotter as { nowSeconds: () => bigint }).nowSeconds = () => 500n;

    // The attester read comes back verified at HIGH confidence, exactly as a
    // document claim would — the difference is the TIER, not the read.
    const result = await runAgentForGoal(deps, {
      ...INPUT,
      evidenceKind: "self-reported",
    });

    expect(result.status).toBe("recorded");
    // Multiplier forced to 1x (10000 bps), never the 2x a "high" verdict earns
    // on a verified tier.
    expect(deps.legacyRecordResult).toHaveBeenCalledWith(
      7n,
      USER,
      true,
      10_000n,
    );
    // Confidence clamped to at most medium, and the on-chain bitmap is 0 — a
    // self-reported verdict must NEVER assert FACET_AI_ATTESTED.
    expect(deps.legacyRecordVerdict).toHaveBeenCalledWith(
      7n,
      USER,
      true,
      "medium",
      "job-1",
      0,
    );
    // The ledger verdict is flagged self-reported so every downstream reader
    // (receipt, feed, rail) tells it apart from the verified tier.
    const verdict = result.ledger.find((e) => e.kind === "verdict");
    expect(verdict).toMatchObject({ selfReported: true });
    // It is never presented as verified: no wearable/AI facet on chain.
    expect(deps.legacyRecordVerdict).not.toHaveBeenCalledWith(
      7n,
      USER,
      true,
      expect.anything(),
      "job-1",
      4,
    );
  });

  it("records and settles through the Circle wallet once the roles point at SPOTTER", async () => {
    const { runAgentForGoal } = await loadRun();
    const reader = fakeReader({
      oracleAddress: vi.fn().mockResolvedValue(SPOTTER),
      attesterAddress: vi.fn().mockResolvedValue(SPOTTER),
    });
    const executor = fakeExecutor();
    const deps = makeDeps({
      spotter: { circle: executor, reader, nowSeconds: () => 2_000n },
    });

    const result = await runAgentForGoal(deps, INPUT);

    expect(result.status).toBe("paid");
    expect(deps.legacyRecordResult).not.toHaveBeenCalled();
    expect(deps.legacyRecordVerdict).not.toHaveBeenCalled();
    const settle = result.ledger.find((e) => e.kind === "settle");
    expect(settle).toMatchObject({
      status: "settled",
      txHash: "0xfeed",
      paidUsd: "50",
    });
  });

  it("aborts before buying when the claim cap cannot cover the spend", async () => {
    vi.stubEnv("AGENT_CLAIM_CAP_USD", "0.01");
    const { runAgentForGoal } = await loadRun();
    const poll = vi.fn();
    const deps = makeDeps({ poll });

    const result = await runAgentForGoal(deps, INPUT);

    expect(result.status).toBe("cap-exceeded");
    expect(poll).not.toHaveBeenCalled();
    expect(
      result.ledger.find((e) => e.kind === "error"),
    ).toMatchObject({ stage: "buy" });
  });

  it("surfaces a settle that paid the participant nothing as an error, never as paid", async () => {
    const { runAgentForGoal } = await loadRun();
    const reader = fakeReader({
      achieverPayouts: vi.fn().mockResolvedValue([]),
    });
    const deps = makeDeps({
      spotter: { circle: fakeExecutor(), reader, nowSeconds: () => 2_000n },
    });

    const result = await runAgentForGoal(deps, INPUT);

    expect(result.status).toBe("error");
    expect(
      result.ledger.find((e) => e.kind === "error"),
    ).toMatchObject({ stage: "settle" });
  });

  it("reports blocked when the participant never joined the pool", async () => {
    const { runAgentForGoal } = await loadRun();
    const deps = makeDeps({
      legacyRecordResult: vi
        .fn()
        .mockRejectedValue(new Error("execution reverted: NOT_PARTICIPANT")),
    });

    const result = await runAgentForGoal(deps, INPUT);

    expect(result.status).toBe("blocked");
    expect(
      result.ledger.find((e) => e.kind === "error"),
    ).toMatchObject({ stage: "record" });
  });

  it("escalates a low-confidence read: buys the vision judge unplanned, under the cap", async () => {
    const { runAgentForGoal } = await loadRun();
    const poll = vi.fn().mockResolvedValue({
      status: "completed",
      verdict: { verified: false, confidence: "low", reason: "no readable text" },
    });
    const buy = fakeBuy();
    const deps = makeDeps({ poll, buy });

    const result = await runAgentForGoal(deps, INPUT);

    expect(buy.quoteVisionJudge).toHaveBeenCalled();
    const spends = result.ledger.filter((e) => e.kind === "spend");
    expect(spends).toHaveLength(2);
    expect(spends[1]).toMatchObject({ service: "vision-judge", amountUsd: "0.35" });
    expect(spends[1].note).toMatch(/^escalating\./);
    // The plan still lists only the cheap read; the escalation is unplanned.
    const plan = result.ledger.find((e) => e.kind === "plan");
    expect(plan).toMatchObject({ steps: [{ service: "attester-read" }] });
    // Unverified after escalation stays a no-pay.
    expect(result.status).toBe("no-pay");
  });

  it("adopts a verified second opinion from the escalation service and pays", async () => {
    const { runAgentForGoal } = await loadRun();
    const poll = vi.fn().mockResolvedValue({
      status: "completed",
      verdict: { verified: false, confidence: "low", reason: "no readable text" },
    });
    const buy = fakeBuy({
      buy: vi.fn().mockImplementation(async (quote: { service: string; estUsd: string }) => ({
        amountUsd: quote.estUsd,
        settlement: "x402",
        gatewayTx: "gw-1",
        data:
          quote.service === "vision-judge"
            ? { verified: true, confidence: "medium", reason: "scale reads 78.2kg" }
            : null,
      })),
    });
    const reader = fakeReader({
      oracleAddress: vi.fn().mockResolvedValue(SPOTTER),
      attesterAddress: vi.fn().mockResolvedValue(SPOTTER),
    });
    const deps = makeDeps({
      poll,
      buy,
      spotter: { circle: fakeExecutor(), reader, nowSeconds: () => 2_000n },
    });

    const result = await runAgentForGoal(deps, INPUT);

    expect(result.status).toBe("paid");
    const verdicts = result.ledger.filter((e) => e.kind === "verdict");
    expect(verdicts).toHaveLength(2);
    expect(verdicts[1]).toMatchObject({ verified: true, confidence: "medium" });
  });

  it("skips an escalation the cap cannot cover and decides with what it has", async () => {
    vi.stubEnv("AGENT_CLAIM_CAP_USD", "0.10");
    const { runAgentForGoal } = await loadRun();
    const poll = vi.fn().mockResolvedValue({
      status: "completed",
      verdict: { verified: false, confidence: "low", reason: "no readable text" },
    });
    const reason = vi.fn().mockImplementation(
      async (ctx: { escalation: { kind: string } }) => {
        expect(ctx.escalation.kind).toBe("skipped");
        return { decision: "no-pay", note: "cannot afford a second opinion." };
      },
    );
    const deps = makeDeps({ poll, reason });

    const result = await runAgentForGoal(deps, INPUT);

    expect(result.status).toBe("no-pay");
    expect(result.ledger.filter((e) => e.kind === "spend")).toHaveLength(1);
    expect(reason).toHaveBeenCalled();
  });

  it("overrules a pay decision that no verified verdict backs", async () => {
    const { runAgentForGoal } = await loadRun();
    const poll = vi.fn().mockResolvedValue({
      status: "completed",
      verdict: { verified: false, confidence: "high", reason: "wrong document" },
    });
    const reason = vi
      .fn()
      .mockResolvedValue({ decision: "pay", note: "seems fine to me." });
    const deps = makeDeps({ poll, reason });

    const result = await runAgentForGoal(deps, INPUT);

    expect(result.status).toBe("no-pay");
    const entry = result.ledger.find((e) => e.kind === "reason");
    expect(entry).toMatchObject({ decision: "no-pay" });
    expect((entry as { note: string }).note).toMatch(/overruled/);
    expect(deps.legacyRecordResult).not.toHaveBeenCalled();
  });

  it("re-keys a retry: a fresh attesterId buys a fresh read and gets a fresh decision", async () => {
    const { runAgentForGoal } = await loadRun();
    const failingPoll = vi.fn().mockResolvedValue({
      status: "failed",
      verdict: { verified: false, confidence: "low", reason: "unreadable" },
    });
    const deps = makeDeps({ poll: failingPoll });

    const first = await runAgentForGoal(deps, INPUT);
    expect(first.status).toBe("no-pay");

    // The user re-submits: a new attester job, a passing verdict this time.
    const passingPoll = vi.fn().mockResolvedValue({
      status: "completed",
      verdict: { verified: true, confidence: "high", reason: "flu shot on record" },
    });
    const retryDeps = makeDeps({ poll: passingPoll });
    (retryDeps.spotter as { nowSeconds: () => bigint }).nowSeconds = () => 500n;

    const second = await runAgentForGoal(retryDeps, {
      ...INPUT,
      attesterId: "job-2",
    });

    // The retry is NOT short-circuited by job-1's stale verdict and reason.
    expect(second.status).toBe("recorded");
    const spends = second.ledger.filter((e) => e.kind === "spend");
    expect(spends.map((s) => s.ref)).toEqual(["job-1", "job-2"]);
    const verdicts = second.ledger.filter((e) => e.kind === "verdict");
    expect(verdicts.map((v) => v.ref)).toEqual(["job-1", "job-2"]);
    const reasons = second.ledger.filter((e) => e.kind === "reason");
    expect(reasons.map((r) => r.ref)).toEqual(["job-1", "job-2"]);
    expect(reasons[1].decision).toBe("pay");
  });

  it("never buys a read of a fail-closed attester job, recording the skip once", async () => {
    const { runAgentForGoal } = await loadRun();
    const poll = vi.fn().mockResolvedValue({
      status: "failed",
      verdict: {
        verified: false,
        confidence: "low",
        reason: "Verification could not be performed.",
      },
    });
    const buy = fakeBuy();
    const deps = makeDeps({ poll, buy });
    const input = { ...INPUT, attesterId: "fail-abc123" };

    const first = await runAgentForGoal(deps, input);
    expect(first.status).toBe("no-pay");
    expect(buy.buy).not.toHaveBeenCalled();
    expect(first.ledger.filter((e) => e.kind === "spend")).toHaveLength(0);
    const errors = first.ledger.filter(
      (e) => e.kind === "error" && e.stage === "attester",
    );
    expect(errors).toHaveLength(1);
    expect((errors[0] as { message: string }).message).toContain("fail-abc123");

    // A re-poll must not duplicate the skip record.
    const second = await runAgentForGoal(deps, input);
    expect(
      second.ledger.filter((e) => e.kind === "error" && e.stage === "attester"),
    ).toHaveLength(1);
  });

  it("buys one paid chain read to verify the settlement when the endpoint exists", async () => {
    const { runAgentForGoal } = await loadRun();
    const { ACHIEVER_PAID_ABI } = await import("@/lib/server/agent/spotter");
    const { encodeEventTopics, encodeAbiParameters } = await import("viem");
    const paidLog = {
      address: "0xc4274eF2cBe28f77Af31b980055Cc1171818390C",
      topics: encodeEventTopics({
        abi: ACHIEVER_PAID_ABI,
        eventName: "AchieverPaid",
        args: { poolId: 7n, participant: USER },
      }),
      data: encodeAbiParameters([{ type: "uint256" }], [50_000_000n]),
    };
    const buy = fakeBuy({
      quoteChainRead: vi.fn().mockResolvedValue({
        service: "chain-read",
        label: "chain verification read (QuickNode, x402)",
        estUsd: "0.01",
        url: "https://x402.quicknode.com/arc-testnet/",
      }),
      buy: vi
        .fn()
        .mockImplementation(
          async (quote: { service: string; estUsd: string }) => ({
            amountUsd: quote.estUsd,
            settlement: quote.service === "chain-read" ? "x402" : "prepaid",
            gatewayTx: quote.service === "chain-read" ? "gw-9" : null,
            data:
              quote.service === "chain-read"
                ? {
                    jsonrpc: "2.0",
                    id: 1,
                    result: { status: "0x1", logs: [paidLog] },
                  }
                : null,
          }),
        ),
    });
    const reader = fakeReader({
      oracleAddress: vi.fn().mockResolvedValue(SPOTTER),
      attesterAddress: vi.fn().mockResolvedValue(SPOTTER),
    });
    const deps = makeDeps({
      buy,
      spotter: { circle: fakeExecutor(), reader, nowSeconds: () => 2_000n },
    });

    const result = await runAgentForGoal(deps, INPUT);

    expect(result.status).toBe("paid");
    const chainSpend = result.ledger.find(
      (e) => e.kind === "spend" && e.service === "chain-read",
    );
    expect(chainSpend).toMatchObject({
      ref: "0xfeed",
      settlement: "x402",
      amountUsd: "0.01",
    });
    expect((chainSpend as { note: string }).note).toContain("gateway tx gw-9");
    const settle = result.ledger.find(
      (e) => e.kind === "settle" && e.status === "settled",
    );
    expect((settle as { note: string }).note).toMatch(
      /independently confirmed/,
    );
    // The JSON-RPC body carried the settle tx, never document data.
    const chainCall = (buy.buy as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[0] as { service: string }).service === "chain-read",
    );
    expect(chainCall?.[1]).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionReceipt",
      params: ["0xfeed"],
    });
  });

  it("falls back to the free verification path when the chain-read purchase fails", async () => {
    const { runAgentForGoal } = await loadRun();
    const buy = fakeBuy({
      quoteChainRead: vi.fn().mockResolvedValue({
        service: "chain-read",
        label: "chain verification read (QuickNode, x402)",
        estUsd: "0.01",
        url: "https://x402.quicknode.com/arc-testnet/",
      }),
      buy: vi
        .fn()
        .mockImplementation(
          async (quote: { service: string; estUsd: string }) => {
            if (quote.service === "chain-read") {
              throw new Error("gateway 502");
            }
            return {
              amountUsd: quote.estUsd,
              settlement: "prepaid",
              gatewayTx: null,
              data: null,
            };
          },
        ),
    });
    const reader = fakeReader({
      oracleAddress: vi.fn().mockResolvedValue(SPOTTER),
      attesterAddress: vi.fn().mockResolvedValue(SPOTTER),
    });
    const deps = makeDeps({
      buy,
      spotter: { circle: fakeExecutor(), reader, nowSeconds: () => 2_000n },
    });

    const result = await runAgentForGoal(deps, INPUT);

    // Settlement is never blocked by the verification purchase.
    expect(result.status).toBe("paid");
    expect(
      result.ledger.some((e) => e.kind === "spend" && e.service === "chain-read"),
    ).toBe(false);
    const settle = result.ledger.find(
      (e) => e.kind === "settle" && e.status === "settled",
    );
    expect((settle as { note: string }).note).toMatch(
      /chain-read purchase failed/,
    );
  });

  it("runs a wearable claim on the junction read with wearable provenance", async () => {
    const { runAgentForGoal } = await loadRun();
    const poll = vi.fn().mockResolvedValue({
      status: "completed",
      verdict: {
        verified: true,
        confidence: "high",
        reason: "Junction reports 7 qualifying days.",
      },
    });
    const buy = fakeBuy();
    const deps = makeDeps({ poll, buy });
    (deps.spotter as { nowSeconds: () => bigint }).nowSeconds = () => 500n;

    const result = await runAgentForGoal(deps, {
      ...INPUT,
      attesterId: "wearable-111",
      evidenceKind: "wearable" as const,
      goalSpec: "sleep score 75+ for 7 days",
    });

    expect(result.status).toBe("recorded");
    expect(buy.quoteAttesterRead).not.toHaveBeenCalled();
    const spends = result.ledger.filter((e) => e.kind === "spend");
    expect(spends).toHaveLength(1);
    expect(spends[0]).toMatchObject({
      service: "junction-read",
      label: "wearable summary (Junction)",
      amountUsd: "0.01",
      ref: "wearable-111",
      settlement: "prepaid",
    });
    const plan = result.ledger.find((e) => e.kind === "plan");
    expect(plan).toMatchObject({ steps: [{ service: "junction-read" }] });
    // Provenance: recorded as wearable-verified, never as AI-attested.
    const verdictCall = (
      deps.legacyRecordVerdict as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(verdictCall[5]).toBe(1);
  });

  it("re-decides a wearable claim when fresh data changes the verdict, without re-buying", async () => {
    const { runAgentForGoal } = await loadRun();
    const input = {
      ...INPUT,
      attesterId: "wearable-111",
      evidenceKind: "wearable" as const,
    };
    const poll = vi.fn().mockResolvedValue({
      status: "completed",
      verdict: {
        verified: false,
        confidence: "high",
        reason: "Junction reports 3 of 7 qualifying days.",
      },
    });
    const deps = makeDeps({ poll });
    (deps.spotter as { nowSeconds: () => bigint }).nowSeconds = () => 500n;

    const first = await runAgentForGoal(deps, input);
    expect(first.status).toBe("no-pay");

    // Four days later the streak completes; same ref, fresh data.
    poll.mockResolvedValue({
      status: "completed",
      verdict: {
        verified: true,
        confidence: "high",
        reason: "Junction reports 7 qualifying days.",
      },
    });

    const second = await runAgentForGoal(deps, input);
    expect(second.status).toBe("recorded");
    // One junction read for the whole period; two verdicts, two decisions.
    expect(second.ledger.filter((e) => e.kind === "spend")).toHaveLength(1);
    expect(second.ledger.filter((e) => e.kind === "verdict")).toHaveLength(2);
    const reasons = second.ledger.filter((e) => e.kind === "reason");
    expect(reasons.map((r) => r.decision)).toEqual(["no-pay", "pay"]);
  });

  it("F10: re-decides when the sweep wrote the hit after the last decision, even with the same words", async () => {
    // The sweep reads a hit the player has not opened and writes the pass
    // path's own verdict row. When the player opens the run, the poll returns
    // that same verdict; the old no-pay must not stand in front of it.
    const { runAgentForGoal } = await loadRun();
    const ledgerMod = await import("@/lib/server/agent/ledger");
    const input = {
      ...INPUT,
      attesterId: "wearable-111",
      evidenceKind: "wearable" as const,
    };
    const notMet = {
      verified: false,
      confidence: "high",
      reason: "Junction reports 3 of 7 qualifying days.",
    };
    const met = {
      verified: true,
      confidence: "high",
      reason: "Junction reports 7 qualifying days.",
    };
    const poll = vi.fn().mockResolvedValue({ status: "completed", verdict: notMet });
    const deps = makeDeps({ poll });
    (deps.spotter as { nowSeconds: () => bigint }).nowSeconds = () => 500n;
    expect((await runAgentForGoal(deps, input)).status).toBe("no-pay");

    await ledgerMod.appendLedger(GOAL, {
      kind: "verdict",
      ...met,
      confidence: "high",
      ref: "wearable-111",
      selfReported: false,
    });
    poll.mockResolvedValue({ status: "completed", verdict: met });

    const second = await runAgentForGoal(deps, input);
    expect(second.status).toBe("recorded");
    const reasons = second.ledger.filter((e) => e.kind === "reason");
    expect(reasons.map((r) => r.decision)).toEqual(["no-pay", "pay"]);
  });

  it("reconciles an already-settled pool against AchieverPaid instead of declaring it unpayable", async () => {
    // Multi-achiever pools settle everyone in ONE transaction: the second
    // claim swept finds the pool already settled and must recover its own
    // payout from the log, never stamp a false terminal failure.
    const { settleRecordedClaim } = await loadRun();
    const reader = fakeReader({
      getPoolState: vi
        .fn()
        .mockResolvedValue({ settled: true, periodEnd: 1_000n }),
      settledPayout: vi
        .fn()
        .mockResolvedValue({ txHash: "0xabc1", amount: 25_000_000n }),
    });
    const deps = {
      spotter: { circle: fakeExecutor(), reader, nowSeconds: () => 2_000n },
      buy: fakeBuy(),
    };

    const outcome = await settleRecordedClaim(deps, {
      goalId: GOAL,
      poolId: 7n,
      participant: USER,
    });

    expect(outcome.status).toBe("settled");
    expect(reader.settledPayout).toHaveBeenCalledWith(7n, USER);
    const settle = outcome.ledger.find(
      (e) => e.kind === "settle" && e.status === "settled",
    );
    expect(settle).toMatchObject({ txHash: "0xabc1", paidUsd: "25" });
    expect(outcome.ledger.some((e) => e.kind === "error")).toBe(false);
  });

  it("declares an already-settled pool unpayable only when AchieverPaid has no payout", async () => {
    const { settleRecordedClaim, SETTLE_UNPAYABLE_MESSAGE } = await loadRun();
    const reader = fakeReader({
      getPoolState: vi
        .fn()
        .mockResolvedValue({ settled: true, periodEnd: 1_000n }),
      settledPayout: vi.fn().mockResolvedValue(null),
    });
    const deps = {
      spotter: { circle: fakeExecutor(), reader, nowSeconds: () => 2_000n },
      buy: fakeBuy(),
    };

    const outcome = await settleRecordedClaim(deps, {
      goalId: GOAL,
      poolId: 7n,
      participant: USER,
    });

    expect(outcome.status).toBe("error");
    const errors = outcome.ledger.filter(
      (e) => e.kind === "error" && e.stage === "settle",
    );
    expect(errors).toHaveLength(1);
    expect((errors[0] as { message: string }).message).toBe(
      SETTLE_UNPAYABLE_MESSAGE,
    );

    // A second sweep pass must not duplicate the terminal entry.
    const again = await settleRecordedClaim(deps, {
      goalId: GOAL,
      poolId: 7n,
      participant: USER,
    });
    expect(
      again.ledger.filter((e) => e.kind === "error" && e.stage === "settle"),
    ).toHaveLength(1);
  });

  it("keeps the claim retryable when the AchieverPaid reconciliation read fails", async () => {
    const { settleRecordedClaim, SETTLE_UNPAYABLE_MESSAGE } = await loadRun();
    const reader = fakeReader({
      getPoolState: vi
        .fn()
        .mockResolvedValue({ settled: true, periodEnd: 1_000n }),
      settledPayout: vi.fn().mockRejectedValue(new Error("rpc down")),
    });
    const deps = {
      spotter: { circle: fakeExecutor(), reader, nowSeconds: () => 2_000n },
      buy: fakeBuy(),
    };

    const outcome = await settleRecordedClaim(deps, {
      goalId: GOAL,
      poolId: 7n,
      participant: USER,
    });

    expect(outcome.status).toBe("error");
    const error = outcome.ledger.find(
      (e) => e.kind === "error" && e.stage === "settle",
    ) as { message: string };
    expect(error.message).toContain("reconciliation read failed");
    // Not the terminal message, so the sweep filter keeps retrying it.
    expect(error.message).not.toBe(SETTLE_UNPAYABLE_MESSAGE);
  });

  it("holds the claim under one lock: a second concurrent poll never re-buys", async () => {
    // Two open tabs, or a tab and the cron sweep. Without the lock both polls
    // read the same empty ledger, both pass the cap check, and both pay the
    // attester read - real USDC, twice, for one claim.
    const { runAgentForGoal } = await loadRun();
    let releasePoll: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      releasePoll = resolve;
    });
    let pollEntered: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      pollEntered = resolve;
    });
    const poll = vi.fn().mockImplementation(async () => {
      pollEntered();
      await held;
      return { status: "verifying", verdict: null };
    });
    const deps = makeDeps({ poll });

    const first = runAgentForGoal(deps, INPUT);
    await entered;

    const second = await runAgentForGoal(deps, INPUT);

    // The sibling reports what the ledger already says rather than an error.
    expect(second.status).toBe("verifying");
    expect(deps.buy.buy).toHaveBeenCalledTimes(1);

    releasePoll();
    const firstResult = await first;
    expect(firstResult.status).toBe("verifying");
    expect(deps.buy.buy).toHaveBeenCalledTimes(1);
    expect(firstResult.ledger.filter((e) => e.kind === "spend")).toHaveLength(1);
  });

  it("halts on the global daily cap and says why, in the ledger", async () => {
    // The per-claim cap is scoped to one goalId, so a fresh goalId is a fresh
    // budget. This ceiling is what makes the wallet un-drainable by volume.
    vi.stubEnv("AGENT_DAILY_CAP_USD", "0.01");
    const { runAgentForGoal } = await loadRun();
    const poll = vi.fn();
    const deps = makeDeps({ poll });

    const result = await runAgentForGoal(deps, INPUT);

    expect(result.status).toBe("cap-exceeded");
    expect(deps.buy.buy).not.toHaveBeenCalled();
    expect(poll).not.toHaveBeenCalled();
    const error = result.ledger.find((e) => e.kind === "error") as {
      stage: string;
      message: string;
    };
    expect(error.stage).toBe("buy");
    expect(error.message).toContain("daily spend cap of 0.01 USDC");
    expect(error.message).toContain("nobody is paid");
  });

  it("halts on the per-wallet daily cap when one wallet keeps opening claims", async () => {
    vi.stubEnv("AGENT_WALLET_DAILY_CAP_USD", "0.02");
    const { runAgentForGoal } = await loadRun();
    const poll = vi.fn().mockResolvedValue({ status: "verifying", verdict: null });
    const deps = makeDeps({ poll });

    // First claim spends this wallet's whole daily allowance.
    const first = await runAgentForGoal(deps, INPUT);
    expect(first.status).toBe("verifying");

    // A brand new goalId - a fresh per-claim cap, but not a fresh wallet.
    const second = await runAgentForGoal(deps, {
      ...INPUT,
      goalId: ("0x" + "cd".repeat(32)) as Hex,
      attesterId: "job-2",
    });

    expect(second.status).toBe("cap-exceeded");
    const error = second.ledger.find((e) => e.kind === "error") as {
      stage: string;
      message: string;
    };
    expect(error.stage).toBe("buy");
    expect(error.message).toContain("per-wallet daily spend cap of 0.02 USDC");
  });

  it("refuses to re-buy a read whose spend intent is still outstanding", async () => {
    // A run that died between the gateway settling and the ledger append
    // leaves the marker behind. The money may already be gone; buying again
    // would spend twice for one read.
    const { runAgentForGoal, spendIntentName, lock } = await loadRun();
    const held = await lock.acquireLock(
      spendIntentName(GOAL, "attester-read", "job-1"),
      60_000,
    );
    expect(held).not.toBeNull();
    const deps = makeDeps({ poll: vi.fn() });

    const result = await runAgentForGoal(deps, INPUT);

    expect(result.status).toBe("cap-exceeded");
    expect(deps.buy.buy).not.toHaveBeenCalled();
    const error = result.ledger.find((e) => e.kind === "error") as {
      stage: string;
      message: string;
    };
    expect(error.stage).toBe("buy");
    expect(error.message).toContain("will not buy the same read twice");
  });

  it("records a purchase that threw, instead of failing with an empty ledger", async () => {
    // The worst case on this path: the gateway may have taken the money and
    // there is no spend row for it. A bare 500 with nothing written down is
    // the silent failure the money rule forbids.
    const { runAgentForGoal } = await loadRun();
    const buy = fakeBuy({
      buy: vi.fn().mockRejectedValue(new Error("gateway timeout after 30s")),
    });
    const deps = makeDeps({ buy, poll: vi.fn() });

    const result = await runAgentForGoal(deps, INPUT);

    // Not "cap-exceeded": no guardrail refused this, the purchase blew up.
    expect(result.status).toBe("error");
    const error = result.ledger.find((e) => e.kind === "error") as {
      stage: string;
      message: string;
    };
    expect(error.stage).toBe("buy");
    expect(error.message).toContain("gateway timeout after 30s");
    expect(error.message).toContain("cannot tell whether the payment settled");
    // And the marker keeps the next poll from buying the same read again.
    const second = await runAgentForGoal(deps, INPUT);
    expect(buy.buy).toHaveBeenCalledTimes(1);
    expect(
      second.ledger.filter((e) => e.kind === "error" && e.stage === "buy"),
    ).toHaveLength(2);
  });

  it("defers the losers of a pool settle race without gas or an error row", async () => {
    const { settleRecordedClaim, poolSettleLockName, lock } = await loadRun();
    const executor = fakeExecutor();
    const deps = {
      spotter: { circle: executor, reader: fakeReader(), nowSeconds: () => 2_000n },
      buy: fakeBuy(),
    };
    // Stand in for the claim that won the race and is mid-settlement.
    expect(await lock.acquireLock(poolSettleLockName(7n), 60_000)).not.toBeNull();

    const outcome = await settleRecordedClaim(deps, {
      goalId: GOAL,
      poolId: 7n,
      participant: USER,
    });

    expect(outcome.status).toBe("deferred");
    expect(executor.createContractExecutionTransaction).not.toHaveBeenCalled();
    expect(outcome.ledger.some((e) => e.kind === "error")).toBe(false);
    expect(outcome.ledger.some((e) => e.kind === "settle")).toBe(false);
  });

  it("reconciles a lost settle race in-request instead of two minutes later", async () => {
    // The settle went out and reverted because another claim landed first.
    // The old path wrote a red "reverted on Arc testnet" row on a claim the
    // winning transaction had just paid, and self-healed only on the next cron.
    const { settleRecordedClaim } = await loadRun();
    const reader = fakeReader({
      getPoolState: vi
        .fn()
        .mockResolvedValueOnce({ settled: false, periodEnd: 1_000n })
        .mockResolvedValue({ settled: true, periodEnd: 1_000n }),
      achieverPayouts: vi
        .fn()
        .mockRejectedValue(new Error("tx 0xfeed reverted on Arc testnet")),
      settledPayout: vi
        .fn()
        .mockResolvedValue({ txHash: "0xwinner", amount: 25_000_000n }),
    });
    const deps = {
      spotter: { circle: fakeExecutor(), reader, nowSeconds: () => 2_000n },
      buy: fakeBuy(),
    };

    const outcome = await settleRecordedClaim(deps, {
      goalId: GOAL,
      poolId: 7n,
      participant: USER,
    });

    expect(outcome.status).toBe("settled");
    expect(outcome.ledger.some((e) => e.kind === "error")).toBe(false);
    expect(
      outcome.ledger.find((e) => e.kind === "settle"),
    ).toMatchObject({ status: "settled", txHash: "0xwinner", paidUsd: "25" });
  });

  it("queues a deferred claim for the sweep and dequeues it once it is paid", async () => {
    const { runAgentForGoal, settleRecordedClaim, lock } = await loadRun();
    const reader = fakeReader({
      oracleAddress: vi.fn().mockResolvedValue(SPOTTER),
      attesterAddress: vi.fn().mockResolvedValue(SPOTTER),
    });
    const deps = makeDeps({
      spotter: { circle: fakeExecutor(), reader, nowSeconds: () => 500n },
    });

    const recorded = await runAgentForGoal(deps, INPUT);
    expect(recorded.status).toBe("recorded");
    // Scored by the pool's periodEnd, so the cron reads it only when due.
    expect(await lock.listDuePendingSettlements(999, 10)).toEqual([]);
    expect(await lock.listDuePendingSettlements(1_000, 10)).toEqual([
      GOAL.toLowerCase(),
    ]);

    const paid = await settleRecordedClaim(
      {
        spotter: { circle: fakeExecutor(), reader, nowSeconds: () => 2_000n },
        buy: fakeBuy(),
      },
      { goalId: GOAL, poolId: 7n, participant: USER },
    );
    expect(paid.status).toBe("settled");
    expect(await lock.listDuePendingSettlements(9_999, 10)).toEqual([]);
  });

  it("returns paid from the ledger fast path without re-running anything", async () => {
    const { runAgentForGoal } = await loadRun();
    const reader = fakeReader({
      oracleAddress: vi.fn().mockResolvedValue(SPOTTER),
      attesterAddress: vi.fn().mockResolvedValue(SPOTTER),
    });
    const poll = verifiedPoll;
    const deps = makeDeps({
      spotter: { circle: fakeExecutor(), reader, nowSeconds: () => 2_000n },
      poll,
    });

    const first = await runAgentForGoal(deps, INPUT);
    expect(first.status).toBe("paid");
    const pollCalls = poll.mock.calls.length;

    const second = await runAgentForGoal(deps, INPUT);
    expect(second.status).toBe("paid");
    expect(poll.mock.calls.length).toBe(pollCalls);
  });
});

// The pool's own healthVerdict() decides whether a registry exists. On an
// oracle-only pool (0x0, which is what HealthPoolsV3 on Base Sepolia reports)
// there is no attester role to read and no registry to write: settle() pays
// on recordResult alone. V3 read the attester role unconditionally whenever
// SPOTTER_WALLET_ADDRESS was set, so the run errored right after recordResult
// landed and the first achiever was never settled (P19).
describe("runAgentForGoal on an oracle-only pool (healthVerdict() = 0x0)", () => {
  /** The live reader throws here on V3; a fake that throws proves the role
   *  read is never reached rather than merely tolerated. */
  function attesterReadThatMustNotHappen() {
    return vi
      .fn()
      .mockRejectedValue(
        new Error("attester role read on an oracle-only pool"),
      );
  }

  it("records, skips the registry write, never reads the attester role, and pays through SPOTTER", async () => {
    const { runAgentForGoal } = await loadRun();
    vi.stubEnv("HEALTH_VERDICT_ADDRESS", ""); // not required any more
    const reader = fakeReader({
      verdictRegistry: vi.fn().mockResolvedValue(null),
      oracleAddress: vi.fn().mockResolvedValue(SPOTTER),
      attesterAddress: attesterReadThatMustNotHappen(),
      // recordResult's preflight sees it unrecorded; the settle preflight,
      // after the inclusion wait, sees it on chain.
      participantRecorded: vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true),
    });
    const executor = fakeExecutor();
    const deps = makeDeps({
      spotter: { circle: executor, reader, nowSeconds: () => 2_000n },
    });

    const result = await runAgentForGoal(deps, INPUT);

    expect(result.status).toBe("paid");
    expect(reader.attesterAddress).not.toHaveBeenCalled();
    expect(reader.canSettle).not.toHaveBeenCalled();
    expect(deps.legacyRecordVerdict).not.toHaveBeenCalled();
    const signatures = (
      executor.createContractExecutionTransaction as ReturnType<typeof vi.fn>
    ).mock.calls.map(
      (c) => (c[0] as { abiFunctionSignature: string }).abiFunctionSignature,
    );
    expect(signatures).toEqual([
      "recordResult(uint256,address,bool,uint16)",
      "settle(uint256)",
    ]);
    expect(result.ledger.find((e) => e.kind === "record")).toMatchObject({
      resultTx: "0xfeed",
      registryStatus: "skipped",
    });
    // Paid is still derived from the AchieverPaid payout, never from the tx.
    expect(result.ledger.find((e) => e.kind === "settle")).toMatchObject({
      status: "settled",
      paidUsd: "50",
    });
  });

  it("skips the registry write on the legacy signer path as well", async () => {
    const { runAgentForGoal } = await loadRun();
    vi.stubEnv("HEALTH_VERDICT_ADDRESS", "");
    const reader = fakeReader({
      verdictRegistry: vi.fn().mockResolvedValue(null),
      attesterAddress: attesterReadThatMustNotHappen(),
      participantRecorded: vi.fn().mockResolvedValue(true),
    });
    const deps = makeDeps({
      spotter: { circle: fakeExecutor(), reader, nowSeconds: () => 2_000n },
    });

    const result = await runAgentForGoal(deps, INPUT);

    expect(result.status).toBe("paid");
    expect(deps.legacyRecordResult).toHaveBeenCalled();
    expect(deps.legacyRecordVerdict).not.toHaveBeenCalled();
    expect(reader.attesterAddress).not.toHaveBeenCalled();
    expect(result.ledger.find((e) => e.kind === "record")).toMatchObject({
      registryStatus: "skipped",
    });
  });

  it("keeps the registry write when the pool has a registry, with HEALTH_VERDICT_ADDRESS unset", async () => {
    const { runAgentForGoal } = await loadRun();
    vi.stubEnv("HEALTH_VERDICT_ADDRESS", "");
    const reader = fakeReader({
      verdictRegistry: vi.fn().mockResolvedValue(REGISTRY),
      oracleAddress: vi.fn().mockResolvedValue(SPOTTER),
      attesterAddress: vi.fn().mockResolvedValue(SPOTTER),
    });
    const executor = fakeExecutor();
    const deps = makeDeps({
      spotter: { circle: executor, reader, nowSeconds: () => 2_000n },
    });

    const result = await runAgentForGoal(deps, INPUT);

    expect(result.status).toBe("paid");
    expect(reader.attesterAddress).toHaveBeenCalled();
    expect(reader.canSettle).toHaveBeenCalledWith(GOAL);
    expect(executor.createContractExecutionTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        contractAddress: REGISTRY,
        abiFunctionSignature: "recordVerdict(bytes32,bool,uint8,bytes32,uint16)",
      }),
    );
    expect(result.ledger.find((e) => e.kind === "record")).toMatchObject({
      registryStatus: "recorded",
      registryTx: "0xfeed",
    });
  });

  it("lets the sweep settle a recorded oracle-only claim after the browser is gone", async () => {
    const { settleRecordedClaim } = await loadRun();
    vi.stubEnv("HEALTH_VERDICT_ADDRESS", "");
    const reader = fakeReader({
      verdictRegistry: vi.fn().mockResolvedValue(null),
      attesterAddress: attesterReadThatMustNotHappen(),
      participantRecorded: vi.fn().mockResolvedValue(true),
    });

    const outcome = await settleRecordedClaim(
      {
        spotter: { circle: fakeExecutor(), reader, nowSeconds: () => 2_000n },
        buy: fakeBuy(),
      },
      { goalId: GOAL, poolId: 7n, participant: USER },
    );

    expect(outcome.status).toBe("settled");
    expect(reader.canSettle).not.toHaveBeenCalled();
    expect(outcome.ledger.find((e) => e.kind === "settle")).toMatchObject({
      status: "settled",
      paidUsd: "50",
    });
  });
});

// The miss rule inside the run loop: a player who opens the run page after it
// ended, with a wearable that covered the whole run and shows the goal not
// met, gets a recorded miss (verdict=false) instead of a silent refund. Only
// ever after periodEnd + MISS_GRACE_HOURS, only once, never over a pass.
describe("runAgentForGoal: recording a miss", () => {
  const GRACE = 6n * 3600n;
  const MISS_POOL = {
    settled: false,
    cancelled: false,
    periodStart: 100n,
    periodEnd: 1_000n,
    bountyModel: 2,
    goalSpec: "Sleep 7 hours for 1 night",
    entryFee: 1_000_000n,
  };
  const MISS_INPUT = {
    ...INPUT,
    attesterId: "wearable-100",
    evidenceKind: "wearable" as const,
    goalSpec: MISS_POOL.goalSpec,
  };
  const notMetPoll = () =>
    vi.fn().mockResolvedValue({
      status: "completed",
      verdict: {
        verified: false,
        confidence: "high",
        reason: "Your wearable shows 0 of 1 qualifying days. The goal is not met yet.",
      },
    });

  /** One night inside the run, synced, short of the 7 hours. */
  function missProvider(values: Record<string, number> = { "1970-01-01": 5 }) {
    return {
      id: "junction",
      label: "Junction",
      readService: "junction-read",
      readLabel: "wearable summary (Junction)",
      readEstUsd: "0.01",
      linkKind: "oauth",
      metrics: ["sleep_score", "sleep_efficiency", "sleep_hours", "workouts"],
      isConnected: vi.fn().mockResolvedValue(true),
      getMissEvidence: vi.fn().mockResolvedValue({
        values,
        heartbeatDays: Object.keys(values),
        tzOffsetSec: 0,
      }),
    };
  }

  function missSetup(
    opts: {
      now?: bigint;
      after?: { resultRecorded: boolean; verdict: boolean };
      provider?: ReturnType<typeof missProvider>;
      readerOverrides?: Partial<ArcReader>;
      legacyRecordResult?: ReturnType<typeof vi.fn>;
      poll?: ReturnType<typeof vi.fn>;
    } = {},
  ) {
    const participantResult = vi
      .fn()
      .mockResolvedValueOnce({ joined: true, resultRecorded: false, verdict: false })
      .mockResolvedValue({
        joined: true,
        ...(opts.after ?? { resultRecorded: true, verdict: false }),
      });
    const reader = fakeReader({
      getPoolState: vi.fn().mockResolvedValue(MISS_POOL),
      participantResult,
      ...opts.readerOverrides,
    });
    const provider = opts.provider ?? missProvider();
    const now = opts.now ?? MISS_POOL.periodEnd + GRACE;
    const legacyRecordResult =
      opts.legacyRecordResult ?? vi.fn().mockResolvedValue("0xmiss" as Hex);
    return { reader, provider, now, legacyRecordResult, poll: opts.poll ?? notMetPoll() };
  }

  async function missDeps(setup: ReturnType<typeof missSetup>) {
    const loaded = await loadRun();
    vi.stubEnv("MISS_GRACE_HOURS", "6");
    const spotter = {
      circle: fakeExecutor(),
      reader: setup.reader,
      nowSeconds: () => setup.now,
    };
    const missDepsValue = {
      spotter,
      legacyRecordResult: setup.legacyRecordResult,
      read: {
        pinnedProviderId: vi.fn().mockResolvedValue("junction"),
        storedProviderId: vi.fn().mockResolvedValue("junction"),
        providerConfigured: vi.fn().mockReturnValue(true),
        providerById: vi.fn().mockReturnValue(setup.provider),
      },
      nowSeconds: () => setup.now,
    };
    const adjudicateMiss = vi.fn((input: { goalId: Hex; poolId: bigint; address: Address }) =>
      loaded.missRecord.adjudicateMissUnlocked(
        missDepsValue as unknown as Parameters<typeof loaded.missRecord.adjudicateMissUnlocked>[0],
        input,
      ),
    );
    const deps = makeDeps({
      poll: setup.poll,
      legacyRecordResult: setup.legacyRecordResult,
      adjudicateMiss,
    });
    (deps as { spotter: unknown }).spotter = spotter;
    return { ...loaded, deps, adjudicateMiss };
  }

  it("after the grace: writes exactly one false result and reports missed", async () => {
    const setup = missSetup();
    const { runAgentForGoal, deps } = await missDeps(setup);

    const result = await runAgentForGoal(deps, MISS_INPUT);

    expect(result.status).toBe("missed");
    expect(setup.legacyRecordResult).toHaveBeenCalledTimes(1);
    expect(setup.legacyRecordResult).toHaveBeenCalledWith(7n, USER, false, 0n);
    const records = result.ledger.filter((e) => e.kind === "record");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      verdict: false,
      resultTx: "0xmiss",
      registryStatus: "skipped",
      stakeUsd: "1.00",
    });
    // No registry write, no payout screen, no settle for a miss.
    expect(deps.legacyRecordVerdict).not.toHaveBeenCalled();
    expect(result.ledger.some((e) => e.kind === "settle")).toBe(false);
  });

  it("before the grace: records nothing and reports no-pay", async () => {
    const setup = missSetup({ now: MISS_POOL.periodEnd + GRACE - 1n });
    const { runAgentForGoal, deps } = await missDeps(setup);

    const result = await runAgentForGoal(deps, MISS_INPUT);

    expect(result.status).toBe("no-pay");
    expect(setup.legacyRecordResult).not.toHaveBeenCalled();
    expect(setup.provider.getMissEvidence).not.toHaveBeenCalled();
  });

  it("a re-poll after the miss with late passing data writes nothing and stays missed", async () => {
    const setup = missSetup();
    const { runAgentForGoal, deps } = await missDeps(setup);
    const first = await runAgentForGoal(deps, MISS_INPUT);
    expect(first.status).toBe("missed");

    setup.poll.mockResolvedValue({
      status: "completed",
      verdict: { verified: true, confidence: "high", reason: "late sync: 8 hours" },
    });
    const second = await runAgentForGoal(deps, MISS_INPUT);

    expect(second.status).toBe("missed");
    expect(second.ledger).toHaveLength(first.ledger.length);
    expect(setup.legacyRecordResult).toHaveBeenCalledTimes(1);
  });

  it("dispatches the miss through SPOTTER's wallet with verdict false and multiplier 0 when it holds the oracle role", async () => {
    const setup = missSetup({
      readerOverrides: { oracleAddress: vi.fn().mockResolvedValue(SPOTTER) },
    });
    const { runAgentForGoal, deps } = await missDeps(setup);

    const result = await runAgentForGoal(deps, MISS_INPUT);

    expect(result.status).toBe("missed");
    expect(setup.legacyRecordResult).not.toHaveBeenCalled();
    expect(deps.spotter.circle.createContractExecutionTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        abiFunctionSignature: "recordResult(uint256,address,bool,uint16)",
        abiParameters: ["7", USER, false, 0],
      }),
    );
    expect(result.ledger.find((e) => e.kind === "record")).toMatchObject({
      verdict: false,
      resultTx: "0xfeed",
    });
  });

  it("ALREADY_RECORDED with a pass on chain never writes a false row", async () => {
    const setup = missSetup({
      after: { resultRecorded: true, verdict: true },
      legacyRecordResult: vi
        .fn()
        .mockRejectedValue(new Error("execution reverted: ALREADY_RECORDED")),
    });
    const { runAgentForGoal, deps } = await missDeps(setup);

    const result = await runAgentForGoal(deps, MISS_INPUT);

    expect(result.status).toBe("no-pay");
    expect(result.ledger.some((e) => e.kind === "record")).toBe(false);
  });

  it("a pool that settled under the write is terminal: no record row, no error loop", async () => {
    const setup = missSetup({
      legacyRecordResult: vi.fn().mockRejectedValue(new Error("execution reverted: SETTLED")),
    });
    const { runAgentForGoal, deps } = await missDeps(setup);

    const result = await runAgentForGoal(deps, MISS_INPUT);

    expect(result.status).toBe("no-pay");
    expect(result.ledger.some((e) => e.kind === "record")).toBe(false);
    expect(result.ledger.some((e) => e.kind === "error")).toBe(false);
  });

  it("a write the chain does not show as a recorded miss is an error, never a record row", async () => {
    const setup = missSetup({ after: { resultRecorded: false, verdict: false } });
    const { runAgentForGoal, deps } = await missDeps(setup);

    const result = await runAgentForGoal(deps, MISS_INPUT);

    expect(result.status).toBe("error");
    expect(result.ledger.some((e) => e.kind === "record")).toBe(false);
    expect(result.ledger.find((e) => e.kind === "error")).toMatchObject({ stage: "record" });
  });

  it("a partial read records nothing", async () => {
    const setup = missSetup({ provider: missProvider({}) });
    const { runAgentForGoal, deps } = await missDeps(setup);

    const result = await runAgentForGoal(deps, MISS_INPUT);

    expect(result.status).toBe("no-pay");
    expect(setup.legacyRecordResult).not.toHaveBeenCalled();
  });

  it("an unreadable read (low confidence) never asks for a miss at all", async () => {
    const setup = missSetup({
      poll: vi.fn().mockResolvedValue({
        status: "failed",
        verdict: { verified: false, confidence: "low", reason: "provider down" },
      }),
    });
    const { runAgentForGoal, deps, adjudicateMiss } = await missDeps(setup);

    const result = await runAgentForGoal(deps, MISS_INPUT);

    expect(result.status).toBe("no-pay");
    expect(adjudicateMiss).not.toHaveBeenCalled();
  });

  it("a pass is unchanged: recorded true through the approval-free path, no miss asked", async () => {
    const setup = missSetup({
      poll: vi.fn().mockResolvedValue({
        status: "completed",
        verdict: { verified: true, confidence: "high", reason: "8 hours" },
      }),
      readerOverrides: { verdictRegistry: vi.fn().mockResolvedValue(null) },
    });
    const { runAgentForGoal, deps, adjudicateMiss } = await missDeps(setup);

    const result = await runAgentForGoal(deps, MISS_INPUT);

    expect(adjudicateMiss).not.toHaveBeenCalled();
    expect(setup.legacyRecordResult).toHaveBeenCalledWith(7n, USER, true, expect.any(BigInt));
    expect(result.ledger.find((e) => e.kind === "record")).not.toHaveProperty("verdict", false);
  });
});
