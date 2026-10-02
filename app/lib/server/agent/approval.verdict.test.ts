import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";

// "Pay on the verdict" (Andre, 2026-10-02). Who confirms a payout with World
// ID is decided per wallet, not per build:
//   - a World-bound wallet keeps the World ID confirm (World ID for Agents);
//   - an admin, or an approved list player, is paid on the wearable verdict
//     with no approval request at all, like V3;
//   - a wallet that is neither is never paid on the verdict: the gate keeps
//     the confirm (fail closed), and requireHuman refuses it before any
//     verdict is read.
// The payout itself always goes to the staker's own wallet (run.ts records the
// result for input.address); nothing here picks a recipient.

const GOAL = "0x" + "cd".repeat(32);
const WORLD = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";
const LIST = "0x1111111111111111111111111111111111111111";
const ADMIN = "0x3333333333333333333333333333333333333333";
const NOBODY = "0x4444444444444444444444444444444444444444";
const BOTH = "0x5555555555555555555555555555555555555555";
const T0 = Date.parse("2026-10-02T03:00:00.000Z");
const settledNo = async () => false;

let nullifierSeq = 0;

async function load(env: Record<string, string> = {}) {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "approval-verdict-")));
  vi.stubEnv("WORLD_VERIFY_MODE", "mock");
  vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
  vi.stubEnv("ADMIN_ADDRESSES", ADMIN);
  vi.stubEnv("KILL_WORLD_ID", "");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.resetModules();
  const approval = await import("@/lib/server/agent/approval");
  const provider = await import("@/lib/server/agent/approval-provider");
  const ledger = await import("@/lib/server/agent/ledger");
  const lock = await import("@/lib/server/agent/lock");
  const access = await import("@/lib/server/access");
  const human = await import("@/lib/server/world/human");
  const req = await import("@/lib/server/world/require-human");
  lock.resetLocalCoordinationState();
  return { ...approval, ...provider, ...ledger, lock, access, human, req };
}

type Loaded = Awaited<ReturnType<typeof load>>;

async function onTheList(mod: Loaded, address: string) {
  await mod.access.requestAccess({ address });
  await mod.access.decideAccess({ address, decision: "approve", adminAddress: ADMIN });
}

async function worldBound(mod: Loaded, address: string) {
  nullifierSeq += 1;
  const bound = await mod.human.bindHuman({
    address,
    nullifierHash: `0x${nullifierSeq.toString(16).padStart(64, "0")}`,
    mode: "mock",
    protocolVersion: "4.0",
  });
  expect(bound.ok).toBe(true);
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("payoutConfirmFor", () => {
  it("answers world for a World-bound wallet and verdict for an admin or an approved list player", async () => {
    const mod = await load();
    await worldBound(mod, WORLD);
    await onTheList(mod, LIST);
    expect(await mod.payoutConfirmFor(WORLD)).toBe("world");
    expect(await mod.payoutConfirmFor(LIST)).toBe("verdict");
    expect(await mod.payoutConfirmFor(LIST.toUpperCase().replace("0X", "0x"))).toBe("verdict");
    expect(await mod.payoutConfirmFor(ADMIN)).toBe("verdict");
  });

  it("keeps the World ID confirm for a World-bound wallet that is also on the list", async () => {
    const mod = await load();
    await onTheList(mod, BOTH);
    await worldBound(mod, BOTH);
    expect(await mod.payoutConfirmFor(BOTH)).toBe("world");
  });

  it("fails closed to world for a wallet that is neither, a pending or denied request, and garbage", async () => {
    const mod = await load();
    expect(await mod.payoutConfirmFor(NOBODY)).toBe("world");
    await mod.access.requestAccess({ address: NOBODY });
    expect(await mod.payoutConfirmFor(NOBODY)).toBe("world");
    await mod.access.decideAccess({ address: NOBODY, decision: "deny", adminAddress: ADMIN });
    expect(await mod.payoutConfirmFor(NOBODY)).toBe("world");
    expect(await mod.payoutConfirmFor("garbage")).toBe("world");
  });
});

describe("approvalGate, per wallet", () => {
  it("pays an approved list player on the verdict: no request, no ledger row, nothing queued", async () => {
    const mod = await load();
    await onTheList(mod, LIST);
    const gate = await mod.approvalGate({ goalId: GOAL, poolId: 7n, address: LIST, poolSettled: settledNo, nowMs: T0 });
    expect(gate).toEqual({ status: "verdict" });
    expect(await mod.readApproval(GOAL)).toBeNull();
    expect(await mod.readLedger(GOAL)).toEqual([]);
    expect(await mod.lock.listDuePendingSettlements(Math.floor(T0 / 1000) + 10, 10)).toEqual([]);
  });

  it("pays an admin on the verdict", async () => {
    const mod = await load();
    const gate = await mod.approvalGate({ goalId: GOAL, poolId: 7n, address: ADMIN, poolSettled: settledNo, nowMs: T0 });
    expect(gate).toEqual({ status: "verdict" });
    expect(await mod.readLedger(GOAL)).toEqual([]);
  });

  it("still asks a World-verified player to confirm with World ID", async () => {
    const mod = await load();
    await worldBound(mod, WORLD);
    const gate = await mod.approvalGate({ goalId: GOAL, poolId: 7n, address: WORLD, poolSettled: settledNo, nowMs: T0 });
    expect(gate.status).toBe("awaiting");
    expect(await mod.readLedger(GOAL)).toHaveLength(1);
  });

  it("never pays a wallet that is neither on the verdict: the gate asks, and requireHuman refuses it first", async () => {
    const mod = await load();
    const gate = await mod.approvalGate({ goalId: GOAL, poolId: 7n, address: NOBODY, poolSettled: settledNo, nowMs: T0 });
    expect(gate.status).toBe("awaiting");
    // The run route calls requireHuman before any verdict is read.
    expect(await mod.req.requireHuman(NOBODY)).toMatchObject({ ok: false, status: 403 });
    expect(await mod.req.requireHuman(LIST)).toMatchObject({ ok: false, status: 403 });
    await onTheList(mod, LIST);
    expect(await mod.req.requireHuman(LIST)).toEqual({ ok: true, enforced: true });
  });

  it("pays a list player whose ask predates the change, rather than leaving it waiting", async () => {
    const mod = await load();
    await mod.requestApproval({
      goalId: GOAL,
      poolId: 7n,
      address: LIST,
      provider: mod.mockApprovalProvider(),
      askedBy: "spotter",
      nowMs: T0,
    });
    await onTheList(mod, LIST);
    const gate = await mod.approvalGate({ goalId: GOAL, poolId: 7n, address: LIST, poolSettled: settledNo, nowMs: T0 + 1_000 });
    expect(gate).toEqual({ status: "verdict" });
  });

  it("pays a list player on the verdict even where the World ID confirm is misconfigured; anyone else stays held", async () => {
    // world mode with its credentials missing, and a value that does not parse.
    for (const mode of ["world", "bogus"]) {
      const mod = await load({ WORLD_APPROVAL_MODE: mode });
      await onTheList(mod, LIST);
      expect(await mod.approvalGate({ goalId: GOAL, poolId: 7n, address: LIST, poolSettled: settledNo, nowMs: T0 })).toEqual({
        status: "verdict",
      });
      await expect(
        mod.approvalGate({ goalId: GOAL, poolId: 7n, address: NOBODY, poolSettled: settledNo, nowMs: T0 }),
      ).rejects.toThrow();
    }
  });

  it("is off for everyone while KILL_WORLD_ID is thrown, World binding or not", async () => {
    const mod = await load({ KILL_WORLD_ID: "1" });
    await worldBound(mod, WORLD);
    expect(await mod.approvalGate({ goalId: GOAL, poolId: 7n, address: WORLD, poolSettled: settledNo, nowMs: T0 })).toEqual({
      status: "off",
    });
    expect(await mod.approvalGate({ goalId: GOAL, poolId: 7n, address: LIST, poolSettled: settledNo, nowMs: T0 })).toEqual({
      status: "off",
    });
  });

  it("is off, touching nothing, when the confirmation is not switched on", async () => {
    const mod = await load({ WORLD_APPROVAL_MODE: "" });
    await onTheList(mod, LIST);
    expect(await mod.approvalGate({ goalId: GOAL, poolId: 7n, address: LIST, poolSettled: settledNo, nowMs: T0 })).toEqual({
      status: "off",
    });
  });
});
