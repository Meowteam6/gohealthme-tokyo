// ENS server modules against injected fakes: nothing here touches Sepolia.
// Pinned: resolution goes through the universal resolver and never invents a
// name, the resolve cache, the claim's refusal paths, the receipt's
// never-throw contract, log-asserted writes, and the permission matrix
// reporting a revert as a denial.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import {
  BaseError,
  encodeAbiParameters,
  encodeEventTopics,
  type Address,
  type Hex,
} from "viem";
import { RECEIPT_KEYS, encodeReceipt } from "@/lib/ens/names";
import { PERMISSIONED_RESOLVER_ABI } from "@/lib/server/ens/deployments";
import type { EnsNamespace } from "@/lib/server/ens/client";

const NS: EnsNamespace = {
  parentName: "gohealthme.eth",
  parentLabel: "gohealthme",
  registry: "0x00000000000000000000000000000000000000a0",
  resolver: "0x00000000000000000000000000000000000000b0",
};
const WALLET: Address = "0x00000000000000000000000000000000000000c1";
const OTHER: Address = "0x00000000000000000000000000000000000000c2";
const ZERO: Address = "0x0000000000000000000000000000000000000000";
const TX: Hex = `0x${"11".repeat(32)}`;

beforeEach(() => {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "ens-test-")));
  vi.resetModules();
});

function textUpdatedLog(key: string, value: string) {
  const topics = encodeEventTopics({
    abi: PERMISSIONED_RESOLVER_ABI,
    eventName: "TextUpdated",
    args: { recordId: 1n, keyHash: key },
  });
  return {
    address: NS.resolver,
    topics,
    data: encodeAbiParameters([{ type: "string" }, { type: "string" }], [key, value]),
  };
}

describe("resolveNameForAddress", () => {
  it("returns the ENS primary name when one is set", async () => {
    const { resolveNameForAddress } = await import("@/lib/server/ens/resolve");
    const client = { getEnsName: vi.fn(async () => "andre.eth") };
    const name = await resolveNameForAddress(WALLET, {
      client: client as never,
      namespace: async () => NS,
    });
    expect(name).toBe("andre.eth");
  });

  it("keeps a registry candidate only when addr(60) resolves back to the wallet", async () => {
    const { resolveNameForAddress } = await import("@/lib/server/ens/resolve");
    const client = {
      getEnsName: vi.fn(async () => null),
      getBlockNumber: vi.fn(async () => 100n),
      getLogs: vi.fn(async () => [
        { args: { label: "stale", owner: WALLET }, blockNumber: 1n },
        { args: { label: "ironhabit", owner: WALLET }, blockNumber: 2n },
        { args: { label: "spotter", owner: WALLET }, blockNumber: 3n },
      ]),
      getEnsAddress: vi.fn(async ({ name }: { name: string }) =>
        name === "ironhabit.gohealthme.eth" ? WALLET : OTHER,
      ),
    };
    const name = await resolveNameForAddress(WALLET, {
      client: client as never,
      namespace: async () => NS,
    });
    expect(name).toBe("ironhabit.gohealthme.eth");
    // The agent's own label is never offered as a participant name.
    expect(client.getEnsAddress).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "spotter.gohealthme.eth" }),
    );
  });

  it("returns null rather than guessing when nothing resolves back", async () => {
    const { resolveNameForAddress } = await import("@/lib/server/ens/resolve");
    const client = {
      getEnsName: vi.fn(async () => {
        throw new Error("no reverse");
      }),
      getBlockNumber: vi.fn(async () => 100n),
      getLogs: vi.fn(async () => [{ args: { label: "ironhabit", owner: WALLET }, blockNumber: 2n }]),
      getEnsAddress: vi.fn(async () => OTHER),
    };
    expect(
      await resolveNameForAddress(WALLET, { client: client as never, namespace: async () => NS }),
    ).toBeNull();
  });
});

describe("resolve cache", () => {
  it("serves a hit from memory and invalidates on demand", async () => {
    const { cachedResolvedName, invalidateResolvedName } = await import("@/lib/server/ens/cache");
    const resolver = vi.fn(async () => "a.gohealthme.eth");
    expect(await cachedResolvedName(WALLET, resolver, 1_000)).toBe("a.gohealthme.eth");
    expect(await cachedResolvedName(WALLET.toUpperCase(), resolver, 2_000)).toBe("a.gohealthme.eth");
    expect(resolver).toHaveBeenCalledTimes(1);
    await invalidateResolvedName(WALLET);
    await cachedResolvedName(WALLET, resolver, 3_000);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("expires misses quickly so a fresh claim shows up", async () => {
    const { cachedResolvedName, RESOLVE_MISS_TTL_MS } = await import("@/lib/server/ens/cache");
    const resolver = vi.fn(async () => null);
    await cachedResolvedName(WALLET, resolver, 0);
    await cachedResolvedName(WALLET, resolver, RESOLVE_MISS_TTL_MS + 1);
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});

describe("labelAvailability", () => {
  it("refuses reserved and malformed labels without touching the chain", async () => {
    const { labelAvailability } = await import("@/lib/server/ens/resolve");
    const client = { readContract: vi.fn() };
    const deps = { client: client as never, namespace: async () => NS };
    expect((await labelAvailability("spotter", deps)).available).toBe(false);
    expect((await labelAvailability("iron_habit", deps)).available).toBe(false);
    expect(client.readContract).not.toHaveBeenCalled();
  });

  it("asks the registry and reports a taken name", async () => {
    const { labelAvailability } = await import("@/lib/server/ens/resolve");
    const client = { readContract: vi.fn(async () => OTHER) };
    expect(
      await labelAvailability("ironhabit", { client: client as never, namespace: async () => NS }),
    ).toEqual({ available: false, reason: "That name is already taken.", name: "ironhabit.gohealthme.eth" });
  });

  it("says names are not enabled when the parent is not bootstrapped", async () => {
    const { labelAvailability } = await import("@/lib/server/ens/resolve");
    const out = await labelAvailability("ironhabit", {
      client: { readContract: vi.fn() } as never,
      namespace: async () => null,
    });
    expect(out).toEqual({ available: false, reason: "Names are not enabled on this deployment yet." });
  });
});

describe("assertTextUpdated", () => {
  it("passes only when every key has a TextUpdated log from the resolver", async () => {
    const { assertTextUpdated, EnsWriteAssertionError } = await import("@/lib/server/ens/write");
    const logs = [textUpdatedLog(RECEIPT_KEYS.txHash, TX)];
    expect(() =>
      assertTextUpdated({ status: "success", logs } as never, NS.resolver, [RECEIPT_KEYS.txHash], TX),
    ).not.toThrow();
    expect(() =>
      assertTextUpdated(
        { status: "success", logs } as never,
        NS.resolver,
        [RECEIPT_KEYS.txHash, RECEIPT_KEYS.settledAt],
        TX,
      ),
    ).toThrow(EnsWriteAssertionError);
  });

  it("treats a green transaction with no logs as not written", async () => {
    const { assertTextUpdated } = await import("@/lib/server/ens/write");
    expect(() =>
      assertTextUpdated({ status: "success", logs: [] } as never, NS.resolver, [RECEIPT_KEYS.txHash], TX),
    ).toThrow(/emitted no TextUpdated/);
  });
});

describe("writeSettlementReceipt", () => {
  const baseDeps = {
    namespace: async () => NS,
    resolve: { client: {} as never, namespace: async () => NS },
    ownerWrite: async () => null,
    poolsContract: () => null,
    now: () => new Date("2026-09-27T01:14:00.000Z"),
  };

  it("skips with a reason and never throws when the agent key is absent", async () => {
    const { writeSettlementReceipt } = await import("@/lib/server/ens/receipt");
    const out = await writeSettlementReceipt(
      { poolId: 1n, settleTxHash: TX, achieverCount: 1 },
      {},
      { ...baseDeps, agentConfigured: () => false, agentWrite: async () => null },
    );
    expect(out.status).toBe("skipped");
  });

  it("writes exactly the four receipt keys from the agent key", async () => {
    const { writeSettlementReceipt, readStoredReceipt } = await import("@/lib/server/ens/receipt");
    const writeContract = vi.fn(async () => TX);
    const agent = {
      client: {
        waitForTransactionReceipt: vi.fn(async () => ({
          status: "success",
          logs: encodeReceipt({
            txHash: TX,
            settledAt: "x",
            settledBy: WALLET,
            achieverCount: 2,
          }).map((r) => textUpdatedLog(r.key, r.value)),
        })),
      },
      wallet: { writeContract },
      account: { address: WALLET },
      namespace: NS,
    };
    const out = await writeSettlementReceipt(
      { poolId: 7n, settleTxHash: TX, achieverCount: 2 },
      { wait: true },
      { ...baseDeps, agentConfigured: () => true, agentWrite: async () => agent as never },
    );
    expect(out).toEqual({ status: "written", name: "pool-7.gohealthme.eth", txHash: TX });
    const call = (writeContract.mock.calls[0] as unknown as [{ functionName: string; args: [Hex[]] }])[0];
    expect(call.functionName).toBe("multicall");
    expect(call.args[0]).toHaveLength(4);
    expect((await readStoredReceipt(7n))?.status).toBe("written");
  });

  it("reports failed, stores the reason and does not throw when the write reverts", async () => {
    const { writeSettlementReceipt, readStoredReceipt } = await import("@/lib/server/ens/receipt");
    const agent = {
      client: {},
      wallet: {
        writeContract: vi.fn(async () => {
          throw new Error("EACUnauthorizedAccountRoles");
        }),
      },
      account: { address: WALLET },
      namespace: NS,
    };
    const out = await writeSettlementReceipt(
      { poolId: 8n, settleTxHash: TX, achieverCount: 1 },
      {},
      { ...baseDeps, agentConfigured: () => true, agentWrite: async () => agent as never },
    );
    expect(out.status).toBe("failed");
    expect((await readStoredReceipt(8n))?.reason).toMatch(/EACUnauthorizedAccountRoles/);
  });
});

describe("claimEnsName", () => {
  const deps = (overrides: Record<string, unknown> = {}) => ({
    ownerConfigured: () => true,
    namespace: async () => NS,
    ownerWrite: () => ({}) as never,
    resolve: {
      client: { readContract: vi.fn(async () => ZERO) } as never,
      namespace: async () => NS,
    },
    invalidate: vi.fn(async () => undefined),
    ...overrides,
  });

  it("refuses an invalid label before touching the chain", async () => {
    const { claimEnsName } = await import("@/lib/server/ens/claim");
    const d = deps();
    expect(await claimEnsName({ address: WALLET, rawLabel: "iron_habit" }, d)).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("is an honest 503 when the owner key is not configured", async () => {
    const { claimEnsName } = await import("@/lib/server/ens/claim");
    expect(
      await claimEnsName({ address: WALLET, rawLabel: "ironhabit" }, deps({ ownerConfigured: () => false })),
    ).toMatchObject({ ok: false, status: 503 });
  });

  it("refuses a name another wallet owns", async () => {
    const { claimEnsName } = await import("@/lib/server/ens/claim");
    const d = deps({
      resolve: { client: { readContract: vi.fn(async () => OTHER) } as never, namespace: async () => NS },
    });
    expect(await claimEnsName({ address: WALLET, rawLabel: "ironhabit" }, d)).toEqual({
      ok: false,
      status: 409,
      reason: "That name is already taken.",
    });
  });
});

describe("permissionMatrix", () => {
  it("reports a revert as a denial with the error name, and a clean call as allowed", async () => {
    const { permissionMatrix } = await import("@/lib/server/ens/resolve");
    const simulateContract = vi.fn(
      async ({ account, functionName, args }: { account: Address; functionName: string; args: unknown[] }) => {
        const allowed =
          account === WALLET && functionName === "setText" && args[1] === RECEIPT_KEYS.txHash;
        const ownerAllowed = account === OTHER;
        if (allowed || ownerAllowed) return {};
        throw new BaseError("EACUnauthorizedAccountRoles");
      },
    );
    const rows = await permissionMatrix(
      { client: { simulateContract } as never, namespace: async () => NS },
      { agent: WALLET, owner: OTHER },
    );
    const agentRows = rows.filter((r) => r.actor === "agent");
    expect(agentRows.filter((r) => r.allowed)).toHaveLength(1);
    expect(agentRows[0].action).toMatch(RECEIPT_KEYS.txHash);
    expect(agentRows.slice(1).every((r) => !r.allowed)).toBe(true);
    expect(rows.find((r) => r.actor === "stranger")?.allowed).toBe(false);
    expect(rows.find((r) => r.actor === "owner")?.allowed).toBe(true);
  });
});
