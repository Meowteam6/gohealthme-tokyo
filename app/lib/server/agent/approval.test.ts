import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";

// The approval record is the state SPOTTER's payout waits on. Pinned here:
// one active request per goal (a second ask hands back the first), a decline
// and an approval are terminal and idempotent, expiry is materialized lazily
// and exactly once, a re-ask after decline or expiry opens attempt+1 with a
// new action, a proof for the wrong action or the wrong wallet never
// approves, a proof cannot be reused, and every transition leaves exactly one
// ledger row the receipt can render.

const GOAL = "0x" + "ab".repeat(32);
const USER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

async function load() {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "agent-approval-")));
  vi.resetModules();
  const approval = await import("@/lib/server/agent/approval");
  const provider = await import("@/lib/server/agent/approval-provider");
  const ledger = await import("@/lib/server/agent/ledger");
  return { ...approval, ...provider, ...ledger };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const T0 = Date.parse("2026-09-26T03:00:00.000Z");

describe("requestApproval", () => {
  it("opens attempt 1 with a 90s window and one 'requested' ledger row", async () => {
    const { requestApproval, mockApprovalProvider, readLedger, approvalAction } = await load();
    const result = await requestApproval({
      goalId: GOAL,
      poolId: 7n,
      address: USER,
      provider: mockApprovalProvider(),
      askedBy: "spotter",
      nowMs: T0,
    });
    expect(result.created).toBe(true);
    expect(result.record).toMatchObject({
      goalId: GOAL,
      poolId: "7",
      address: USER,
      attempt: 1,
      action: approvalAction(GOAL, 1),
      provider: "mock",
      status: "pending",
    });
    expect(Date.parse(result.record.expiresAt) - T0).toBe(90_000);
    expect(result.challenge).toEqual({ provider: "mock", mocked: true });
    const rows = await readLedger(GOAL);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "approval",
      status: "requested",
      requestId: result.record.requestId,
    });
  });

  it("is idempotent while a request is pending: the same one comes back, no second row", async () => {
    const { requestApproval, mockApprovalProvider, readLedger } = await load();
    const provider = mockApprovalProvider();
    const first = await requestApproval({ goalId: GOAL, poolId: 7n, address: USER, provider, askedBy: "spotter", nowMs: T0 });
    const second = await requestApproval({ goalId: GOAL, poolId: 7n, address: USER, provider, askedBy: "human", nowMs: T0 + 5_000 });
    expect(second.created).toBe(false);
    expect(second.record.requestId).toBe(first.record.requestId);
    expect(await readLedger(GOAL)).toHaveLength(1);
  });

  it("honours WORLD_APPROVAL_TTL_S within bounds", async () => {
    vi.stubEnv("WORLD_APPROVAL_TTL_S", "5");
    const { approvalTtlMs } = await load();
    expect(approvalTtlMs()).toBe(10_000);
    vi.stubEnv("WORLD_APPROVAL_TTL_S", "120");
    expect(approvalTtlMs()).toBe(120_000);
    vi.stubEnv("WORLD_APPROVAL_TTL_S", "banana");
    expect(approvalTtlMs()).toBe(90_000);
  });
});

describe("completeApproval", () => {
  async function opened() {
    const mod = await load();
    const provider = mod.mockApprovalProvider();
    const { record } = await mod.requestApproval({
      goalId: GOAL,
      poolId: 7n,
      address: USER,
      provider,
      askedBy: "spotter",
      nowMs: T0,
    });
    const proof = { kind: mod.MOCK_PROOF_KIND, action: record.action, approve: true };
    return { ...mod, provider, record, proof };
  }

  it("approves on a valid proof, stores the nullifier server-side and puts only a stub on the ledger", async () => {
    const { completeApproval, provider, record, proof, readLedger, readApproval, mockNullifier } = await opened();
    const outcome = await completeApproval({
      requestId: record.requestId,
      address: USER,
      decision: { decision: "approve", proof },
      provider,
      nowMs: T0 + 10_000,
    });
    expect(outcome.status).toBe("approved");
    const stored = await readApproval(GOAL, T0 + 11_000);
    expect(stored?.nullifier).toBe(mockNullifier(USER, record.action));
    const rows = await readLedger(GOAL);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      kind: "approval",
      status: "approved",
      nullifierStub: mockNullifier(USER, record.action).slice(0, 10),
    });
    expect(JSON.stringify(rows)).not.toContain(mockNullifier(USER, record.action));
  });

  it("queues an approved claim for the settlement sweep, due now, so a closed tab cannot strand it", async () => {
    const { completeApproval, provider, record, proof } = await opened();
    const lock = await import("@/lib/server/agent/lock");
    const nowS = Math.floor((T0 + 10_000) / 1000);
    expect(await lock.listDuePendingSettlements(nowS, 10)).toEqual([]);
    await completeApproval({
      requestId: record.requestId,
      address: USER,
      decision: { decision: "approve", proof },
      provider,
      nowMs: T0 + 10_000,
    });
    expect(await lock.listDuePendingSettlements(nowS, 10)).toEqual([GOAL]);
  });

  it("does not queue a declined claim for the sweep", async () => {
    const { completeApproval, provider, record } = await opened();
    const lock = await import("@/lib/server/agent/lock");
    await completeApproval({
      requestId: record.requestId,
      address: USER,
      decision: { decision: "decline" },
      provider,
      nowMs: T0 + 10_000,
    });
    expect(await lock.listDuePendingSettlements(Math.floor(T0 / 1000) + 3600, 10)).toEqual([]);
  });

  it("declines without a proof and is idempotent afterwards", async () => {
    const { completeApproval, provider, record, proof, readLedger } = await opened();
    const declined = await completeApproval({
      requestId: record.requestId,
      address: USER,
      decision: { decision: "decline" },
      provider,
      nowMs: T0 + 1_000,
    });
    expect(declined.status).toBe("declined");
    // A late approve on a declined request changes nothing.
    const late = await completeApproval({
      requestId: record.requestId,
      address: USER,
      decision: { decision: "approve", proof },
      provider,
      nowMs: T0 + 2_000,
    });
    expect(late.status).toBe("declined");
    const rows = await readLedger(GOAL);
    expect(rows.map((r) => (r.kind === "approval" ? r.status : r.kind))).toEqual([
      "requested",
      "declined",
    ]);
  });

  it("refuses a proof bound to another action and leaves the request pending for a retry", async () => {
    const { completeApproval, provider, record, proof, readApproval } = await opened();
    const outcome = await completeApproval({
      requestId: record.requestId,
      address: USER,
      decision: { decision: "approve", proof: { ...proof, action: "settle:x:9" } },
      provider,
      nowMs: T0 + 1_000,
    });
    expect(outcome).toMatchObject({ status: "rejected", reason: /different request/ });
    expect((await readApproval(GOAL, T0 + 1_000))?.status).toBe("pending");
  });

  it("refuses a signer who is not the achiever", async () => {
    const { completeApproval, provider, record, proof } = await opened();
    const outcome = await completeApproval({
      requestId: record.requestId,
      address: OTHER,
      decision: { decision: "approve", proof },
      provider,
      nowMs: T0 + 1_000,
    });
    expect(outcome.status).toBe("forbidden");
  });

  it("reports an unknown request id, and a superseded one after a re-ask", async () => {
    const { completeApproval, requestApproval, provider, record, proof } = await opened();
    expect(
      (await completeApproval({ requestId: "apr_nope", address: USER, decision: { decision: "decline" }, provider })).status,
    ).toBe("unknown");
    await completeApproval({ requestId: record.requestId, address: USER, decision: { decision: "decline" }, provider, nowMs: T0 + 1_000 });
    const again = await requestApproval({ goalId: GOAL, poolId: 7n, address: USER, provider, askedBy: "human", nowMs: T0 + 2_000 });
    expect(again.created).toBe(true);
    expect(again.record.attempt).toBe(2);
    const stale = await completeApproval({
      requestId: record.requestId,
      address: USER,
      decision: { decision: "approve", proof },
      provider,
      nowMs: T0 + 3_000,
    });
    expect(stale).toMatchObject({ status: "superseded", record: { requestId: again.record.requestId } });
  });

  it("consumes a nullifier once: a proof whose nullifier was already spent is refused", async () => {
    const { completeApproval, provider, record, proof, mockNullifier, readApproval } = await opened();
    const store = await import("@/lib/server/store");
    // Somebody already spent this human's consent for this action (say, a
    // replayed request on a sibling lambda that won the race).
    await store.setNx(
      `agent-approval-nullifier:${record.action}:${mockNullifier(USER, record.action)}`,
      "apr_elsewhere",
    );
    const reuse = await completeApproval({
      requestId: record.requestId,
      address: USER,
      decision: { decision: "approve", proof },
      provider,
      nowMs: T0 + 1_000,
    });
    expect(reuse).toMatchObject({ status: "rejected", reason: /already used/ });
    expect((await readApproval(GOAL, T0 + 1_000))?.status).toBe("pending");
  });

  it("approved is terminal: a re-ask hands the approved record back without a new attempt", async () => {
    const { completeApproval, requestApproval, provider, record, proof, readLedger } = await opened();
    await completeApproval({ requestId: record.requestId, address: USER, decision: { decision: "approve", proof }, provider, nowMs: T0 + 1_000 });
    const again = await requestApproval({ goalId: GOAL, poolId: 7n, address: USER, provider, askedBy: "human", nowMs: T0 + 2_000 });
    expect(again.created).toBe(false);
    expect(again.record.status).toBe("approved");
    expect(again.record.attempt).toBe(1);
    expect(await readLedger(GOAL)).toHaveLength(2);
  });
});

describe("expiry", () => {
  it("is materialized lazily on read, exactly once, with one ledger row", async () => {
    const { requestApproval, readApproval, mockApprovalProvider, readLedger } = await load();
    const provider = mockApprovalProvider();
    await requestApproval({ goalId: GOAL, poolId: 7n, address: USER, provider, askedBy: "spotter", nowMs: T0 });
    expect((await readApproval(GOAL, T0 + 89_999))?.status).toBe("pending");
    expect((await readApproval(GOAL, T0 + 90_000))?.status).toBe("expired");
    expect((await readApproval(GOAL, T0 + 95_000))?.status).toBe("expired");
    const rows = await readLedger(GOAL);
    expect(rows.map((r) => (r.kind === "approval" ? r.status : r.kind))).toEqual([
      "requested",
      "expired",
    ]);
  });

  it("an approve that lands after expiry is reported expired, never approved", async () => {
    const mod = await load();
    const provider = mod.mockApprovalProvider();
    const { record } = await mod.requestApproval({ goalId: GOAL, poolId: 7n, address: USER, provider, askedBy: "spotter", nowMs: T0 });
    const outcome = await mod.completeApproval({
      requestId: record.requestId,
      address: USER,
      decision: { decision: "approve", proof: { kind: mod.MOCK_PROOF_KIND, action: record.action, approve: true } },
      provider,
      nowMs: T0 + 100_000,
    });
    expect(outcome.status).toBe("expired");
  });

  it("a re-ask after expiry opens attempt 2 with a new action", async () => {
    const mod = await load();
    const provider = mod.mockApprovalProvider();
    const first = await mod.requestApproval({ goalId: GOAL, poolId: 7n, address: USER, provider, askedBy: "spotter", nowMs: T0 });
    const second = await mod.requestApproval({ goalId: GOAL, poolId: 7n, address: USER, provider, askedBy: "human", nowMs: T0 + 100_000 });
    expect(second.created).toBe(true);
    expect(second.record.attempt).toBe(2);
    expect(second.record.action).not.toBe(first.record.action);
    const rows = await mod.readLedger(GOAL);
    expect(rows.map((r) => (r.kind === "approval" ? r.status : r.kind))).toEqual([
      "requested",
      "expired",
      "requested",
    ]);
  });
});

describe("cancelApproval", () => {
  it("cancels only a pending request and leaves finished ones alone", async () => {
    const mod = await load();
    const provider = mod.mockApprovalProvider();
    const { record } = await mod.requestApproval({ goalId: GOAL, poolId: 7n, address: USER, provider, askedBy: "spotter", nowMs: T0 });
    const cancelled = await mod.cancelApproval(GOAL, "pool settled first", T0 + 1_000);
    expect(cancelled?.status).toBe("cancelled");
    const again = await mod.cancelApproval(GOAL, "pool settled first", T0 + 2_000);
    expect(again?.status).toBe("cancelled");
    const rows = await mod.readLedger(GOAL);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ kind: "approval", status: "cancelled", requestId: record.requestId });
  });
});

describe("approvalGate", () => {
  const settledNo = async () => false;

  it("is off, touching nothing, when WORLD_APPROVAL_MODE is unset", async () => {
    const { approvalGate, readApproval, readLedger } = await load();
    const gate = await approvalGate({ goalId: GOAL, poolId: 7n, address: USER, poolSettled: settledNo });
    expect(gate).toEqual({ status: "off" });
    expect(await readApproval(GOAL)).toBeNull();
    expect(await readLedger(GOAL)).toEqual([]);
  });

  it("asks once in mock mode, then keeps reporting awaiting without asking again", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const { approvalGate, readLedger } = await load();
    const first = await approvalGate({ goalId: GOAL, poolId: 7n, address: USER, poolSettled: settledNo, nowMs: T0 });
    expect(first.status).toBe("awaiting");
    const second = await approvalGate({ goalId: GOAL, poolId: 7n, address: USER, poolSettled: settledNo, nowMs: T0 + 1_000 });
    expect(second.status).toBe("awaiting");
    expect(await readLedger(GOAL)).toHaveLength(1);
  });

  it("reports approved once the human confirmed, and declined or expired without re-asking", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const mod = await load();
    const provider = mod.mockApprovalProvider();
    const asked = await mod.approvalGate({ goalId: GOAL, poolId: 7n, address: USER, poolSettled: settledNo, nowMs: T0 });
    if (asked.status !== "awaiting") throw new Error("expected awaiting");
    await mod.completeApproval({ requestId: asked.record.requestId, address: USER, decision: { decision: "decline" }, provider, nowMs: T0 + 1_000 });
    const declined = await mod.approvalGate({ goalId: GOAL, poolId: 7n, address: USER, poolSettled: settledNo, nowMs: T0 + 2_000 });
    expect(declined.status).toBe("declined");
    // Still declined on the next poll: SPOTTER does not nag.
    expect((await mod.approvalGate({ goalId: GOAL, poolId: 7n, address: USER, poolSettled: settledNo, nowMs: T0 + 3_000 })).status).toBe("declined");

    const again = await mod.requestApproval({ goalId: GOAL, poolId: 7n, address: USER, provider, askedBy: "human", nowMs: T0 + 4_000 });
    await mod.completeApproval({
      requestId: again.record.requestId,
      address: USER,
      decision: { decision: "approve", proof: { kind: mod.MOCK_PROOF_KIND, action: again.record.action, approve: true } },
      provider,
      nowMs: T0 + 5_000,
    });
    expect((await mod.approvalGate({ goalId: GOAL, poolId: 7n, address: USER, poolSettled: settledNo, nowMs: T0 + 6_000 })).status).toBe("approved");
  });

  it("reports expired when the window passed with no answer", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const { approvalGate } = await load();
    await approvalGate({ goalId: GOAL, poolId: 7n, address: USER, poolSettled: settledNo, nowMs: T0 });
    const late = await approvalGate({ goalId: GOAL, poolId: 7n, address: USER, poolSettled: settledNo, nowMs: T0 + 91_000 });
    expect(late.status).toBe("expired");
  });

  it("cancels a pending request when the pool settled first, and never asks on a settled pool", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const { approvalGate, readLedger } = await load();
    await approvalGate({ goalId: GOAL, poolId: 7n, address: USER, poolSettled: settledNo, nowMs: T0 });
    const cancelled = await approvalGate({ goalId: GOAL, poolId: 7n, address: USER, poolSettled: async () => true, nowMs: T0 + 1_000 });
    expect(cancelled.status).toBe("cancelled");
    expect((await readLedger(GOAL)).map((r) => (r.kind === "approval" ? r.status : r.kind))).toEqual([
      "requested",
      "cancelled",
    ]);

    const other = "0x" + "cd".repeat(32);
    const never = await approvalGate({ goalId: other, poolId: 8n, address: USER, poolSettled: async () => true, nowMs: T0 });
    expect(never).toEqual({ status: "unpayable" });
    expect(await readLedger(other)).toEqual([]);
  });

  it("reports an approval on a settled pool as unpayable, never approved (the record would revert SETTLED)", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const mod = await load();
    const provider = mod.mockApprovalProvider();
    const asked = await mod.approvalGate({ goalId: GOAL, poolId: 7n, address: USER, poolSettled: settledNo, nowMs: T0 });
    if (asked.status !== "awaiting") throw new Error("expected awaiting");
    await mod.completeApproval({
      requestId: asked.record.requestId,
      address: USER,
      decision: { decision: "approve", proof: { kind: mod.MOCK_PROOF_KIND, action: asked.record.action, approve: true } },
      provider,
      nowMs: T0 + 1_000,
    });
    // Unsettled: approved, the record write may proceed.
    expect(
      (await mod.approvalGate({ goalId: GOAL, poolId: 7n, address: USER, poolSettled: settledNo, nowMs: T0 + 2_000 })).status,
    ).toBe("approved");
    // Settled underneath it: no record write, no "confirmed" that reverts.
    expect(
      await mod.approvalGate({ goalId: GOAL, poolId: 7n, address: USER, poolSettled: async () => true, nowMs: T0 + 3_000 }),
    ).toEqual({ status: "unpayable" });
  });

  it("in world mode with no env, throws with the variable name instead of falling back to mock", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "world");
    const { approvalGate, readLedger } = await load();
    await expect(
      approvalGate({ goalId: GOAL, poolId: 7n, address: USER, poolSettled: settledNo }),
    ).rejects.toThrow(/WORLD_APP_ID/);
    expect(await readLedger(GOAL)).toEqual([]);
  });
});
