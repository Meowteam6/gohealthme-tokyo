import { describe, it, expect, vi, beforeEach } from "vitest";

// recordApprovedClaim on a challenge that already settled. settle() is
// one-shot and already refunded every claim nobody recorded, so a record
// write now can only revert. With the payout confirmation on, the run loop's
// gate catches that before any write ("unpayable"). With it off (the World ID
// kill switch) the gate answers "off" and nothing stands between the sweep
// and a doomed chain write, retried every tick for the whole hold window. The
// pool read recordApprovedClaim already does is the check.

const runAgentForGoal = vi.fn();
const loadClaimPool = vi.fn();
const readLedger = vi.fn(async () => []);

vi.mock("@/lib/server/agent/run", () => ({ runAgentForGoal }));
vi.mock("@/lib/server/evidence", () => ({ loadClaimPool }));
vi.mock("@/lib/server/agent/ledger", () => ({ readLedger }));
vi.mock("@/lib/server/agent/spotter", () => ({ arcReader: () => ({}) }));
vi.mock("@/lib/server/agent/wallet", () => ({ getCircleClient: () => ({}) }));
vi.mock("@/lib/server/agent/x402", () => ({ liveBuyDeps: () => ({}) }));
vi.mock("@/lib/server/agent/reason", () => ({ geminiReason: vi.fn() }));
vi.mock("@/lib/server/agent/wearable", () => ({ wearableEvidenceSource: () => vi.fn() }));
vi.mock("@/lib/server/judge", () => ({ pollInference: vi.fn() }));
vi.mock("@/lib/server/oracle", () => ({ recordResult: vi.fn() }));
vi.mock("@/lib/server/verdict", () => ({ recordVerdict: vi.fn(), VERDICT_FACETS: {} }));

const GOAL = ("0x" + "ab".repeat(32)) as `0x${string}`;
const USER = "0x1111111111111111111111111111111111111111" as const;

function pool(settled: boolean) {
  return {
    id: 7n,
    creator: USER,
    bountyModel: 2,
    settled,
    cancelled: false,
    periodStart: 100n,
    periodEnd: 200n,
    entryFee: 1_000_000n,
    balance: 1_000_000n,
    initiative: "sleep",
    goalSpec: "Sleep at least 7 hours for 1 night",
  };
}

const target = {
  poolId: 7n,
  participant: USER,
  attesterId: "wearable-100",
  evidenceKind: "wearable" as const,
  approvedAtMs: Date.now(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordApprovedClaim", () => {
  it("never drives a record write on a challenge that already settled", async () => {
    loadClaimPool.mockResolvedValue(pool(true));
    const { recordApprovedClaim } = await import("@/lib/server/agent/approved-record");
    const result = await recordApprovedClaim(GOAL, target);
    expect(runAgentForGoal).not.toHaveBeenCalled();
    expect(result.status).toBe("error");
  });

  it("drives the run loop on a challenge still open to settle (regression)", async () => {
    loadClaimPool.mockResolvedValue(pool(false));
    runAgentForGoal.mockResolvedValue({ status: "paid", ledger: [] });
    const { recordApprovedClaim } = await import("@/lib/server/agent/approved-record");
    const result = await recordApprovedClaim(GOAL, target);
    expect(runAgentForGoal).toHaveBeenCalledTimes(1);
    expect(runAgentForGoal.mock.calls[0][1]).toMatchObject({
      goalId: GOAL,
      poolId: 7n,
      address: USER,
      attesterId: "wearable-100",
      evidenceKind: "wearable",
    });
    expect(result.status).toBe("paid");
  });
});
