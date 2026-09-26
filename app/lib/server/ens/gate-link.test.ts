// Names need a human, and a name you already own can stand in for one.
//
// Pinned here: a gohealthme.eth claim is refused (403, nothing minted) for a
// wallet that has not proven it is one human while World is on, goes through
// for a verified one, behaves as before when World is off, and a second
// wallet of the same human cannot take a second name. Linking an existing
// ENS name is accepted only when the name resolves to the wallet on mainnet
// or Sepolia, and the display name prefers the link until it stops resolving.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import type { Address } from "viem";
import type { EnsNamespace } from "@/lib/server/ens/client";

vi.mock("@/lib/server/ens/write", () => ({
  liveWriteDeps: () => ({}),
  mintParticipantName: vi.fn(async (_deps: unknown, input: { label: string }) => ({
    name: `${input.label}.gohealthme.eth`,
    registerTx: `0x${"33".repeat(32)}`,
    recordTx: null,
  })),
}));

const NS: EnsNamespace = {
  parentName: "gohealthme.eth",
  parentLabel: "gohealthme",
  registry: "0x00000000000000000000000000000000000000a0",
  resolver: "0x00000000000000000000000000000000000000b0",
};
const WALLET: Address = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";
const SECOND: Address = "0x2222222222222222222222222222222222222222";
const OTHER: Address = "0x00000000000000000000000000000000000000c2";
const ZERO: Address = "0x0000000000000000000000000000000000000000";
const NULLIFIER = `0x${"1".padStart(64, "0")}`;

beforeEach(() => {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "ens-gate-")));
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function claimDeps(overrides: Record<string, unknown> = {}) {
  const { liveNameHumanDeps } = await import("@/lib/server/ens/human-gate");
  return {
    ownerConfigured: () => true,
    namespace: async () => NS,
    ownerWrite: vi.fn(() => ({}) as never),
    resolve: {
      client: { readContract: vi.fn(async () => ZERO) } as never,
      namespace: async () => NS,
    },
    invalidate: vi.fn(async () => undefined),
    human: liveNameHumanDeps(),
    clearLink: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("claimEnsName behind the human check", () => {
  it("refuses an unverified wallet with a plain 403 and mints nothing when World is on", async () => {
    vi.stubEnv("WORLD_VERIFY_MODE", "mock");
    const { claimEnsName } = await import("@/lib/server/ens/claim");
    const { NAME_HUMAN_REQUIRED } = await import("@/lib/server/ens/human-gate");
    const { mintParticipantName } = await import("@/lib/server/ens/write");
    const d = await claimDeps();
    expect(await claimEnsName({ address: WALLET, rawLabel: "ironhabit" }, d)).toEqual({
      ok: false,
      status: 403,
      reason: NAME_HUMAN_REQUIRED,
    });
    expect(NAME_HUMAN_REQUIRED).toBe("Prove you are one human first, then pick your name.");
    expect(d.ownerWrite).not.toHaveBeenCalled();
    expect(mintParticipantName).not.toHaveBeenCalled();
  });

  it("mints for a verified human", async () => {
    vi.stubEnv("WORLD_VERIFY_MODE", "mock");
    const { bindHuman } = await import("@/lib/server/world/human");
    await bindHuman({ address: WALLET, nullifierHash: NULLIFIER, mode: "mock", protocolVersion: "4.0" });
    const { claimEnsName } = await import("@/lib/server/ens/claim");
    const out = await claimEnsName({ address: WALLET, rawLabel: "ironhabit" }, await claimDeps());
    expect(out).toMatchObject({ ok: true, name: "ironhabit.gohealthme.eth" });
  });

  it("keeps today's behaviour when World is off", async () => {
    vi.stubEnv("WORLD_VERIFY_MODE", "");
    const { claimEnsName } = await import("@/lib/server/ens/claim");
    const out = await claimEnsName({ address: WALLET, rawLabel: "ironhabit" }, await claimDeps());
    expect(out).toMatchObject({ ok: true, name: "ironhabit.gohealthme.eth" });
  });

  it("refuses a second wallet of the same human, and lets the first re-claim", async () => {
    vi.stubEnv("WORLD_VERIFY_MODE", "mock");
    const { claimEnsName } = await import("@/lib/server/ens/claim");
    const { mintParticipantName } = await import("@/lib/server/ens/write");
    // Both wallets answer as the same human (the store's bind forbids this,
    // so the name rule is checked on its own).
    const human = {
      enforced: () => true,
      humanOf: async () => ({ key: `mock:${NULLIFIER}` }),
    };
    const first = await claimEnsName(
      { address: WALLET, rawLabel: "ironhabit" },
      await claimDeps({ human }),
    );
    expect(first).toMatchObject({ ok: true });
    vi.mocked(mintParticipantName).mockClear();
    const second = await claimEnsName(
      { address: SECOND, rawLabel: "otherhabit" },
      await claimDeps({ human }),
    );
    expect(second).toMatchObject({ ok: false, status: 403 });
    expect(mintParticipantName).not.toHaveBeenCalled();
    const again = await claimEnsName(
      { address: WALLET, rawLabel: "ironhabit" },
      await claimDeps({ human }),
    );
    expect(again).toMatchObject({ ok: true });
  });

  it("drops a linked name so the new subname is the one shown", async () => {
    vi.stubEnv("WORLD_VERIFY_MODE", "");
    const { claimEnsName } = await import("@/lib/server/ens/claim");
    const d = await claimDeps();
    await claimEnsName({ address: WALLET, rawLabel: "ironhabit" }, d);
    expect(d.clearLink).toHaveBeenCalledWith(WALLET);
  });

  it("skips the handle mint for an unverified wallet when World is on", async () => {
    vi.stubEnv("WORLD_VERIFY_MODE", "mock");
    const { mintHandleNameBestEffort } = await import("@/lib/server/ens/claim");
    const d = await claimDeps();
    await mintHandleNameBestEffort(WALLET, "ironhabit", d, 10);
    expect(d.ownerWrite).not.toHaveBeenCalled();
  });
});

function resolvers(answers: { mainnet?: Address | null | Error; sepolia?: Address | null | Error }) {
  const make = (chain: "mainnet" | "sepolia") => ({
    chain,
    address: vi.fn(async () => {
      const a = answers[chain];
      if (a instanceof Error) throw a;
      return a ?? null;
    }),
  });
  return [make("mainnet"), make("sepolia")];
}

describe("linkEnsName", () => {
  it("accepts a name whose address record is the wallet, on either chain", async () => {
    const { linkEnsName, readLinkedName } = await import("@/lib/server/ens/link");
    const invalidate = vi.fn(async () => undefined);
    const out = await linkEnsName(
      { address: WALLET, rawName: "Andre.eth" },
      { resolvers: resolvers({ mainnet: WALLET, sepolia: null }), invalidate },
    );
    expect(out).toEqual({ ok: true, name: "andre.eth", chain: "mainnet" });
    expect(invalidate).toHaveBeenCalledWith(WALLET);
    expect((await readLinkedName(WALLET))?.name).toBe("andre.eth");
  });

  it("accepts a Sepolia-only name", async () => {
    const { linkEnsName } = await import("@/lib/server/ens/link");
    const out = await linkEnsName(
      { address: WALLET, rawName: "habit.eth" },
      { resolvers: resolvers({ mainnet: null, sepolia: WALLET }), invalidate: async () => undefined },
    );
    expect(out).toEqual({ ok: true, name: "habit.eth", chain: "sepolia" });
  });

  it("refuses a name that points at another wallet", async () => {
    const { linkEnsName, readLinkedName } = await import("@/lib/server/ens/link");
    const out = await linkEnsName(
      { address: WALLET, rawName: "vitalik.eth" },
      { resolvers: resolvers({ mainnet: OTHER, sepolia: null }), invalidate: async () => undefined },
    );
    expect(out).toMatchObject({ ok: false, status: 403 });
    expect(await readLinkedName(WALLET)).toBeNull();
  });

  it("refuses a name that does not resolve anywhere", async () => {
    const { linkEnsName } = await import("@/lib/server/ens/link");
    const out = await linkEnsName(
      { address: WALLET, rawName: "nobody-here.eth" },
      { resolvers: resolvers({ mainnet: null, sepolia: null }), invalidate: async () => undefined },
    );
    expect(out).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses a malformed name before any lookup", async () => {
    const { linkEnsName } = await import("@/lib/server/ens/link");
    const r = resolvers({ mainnet: WALLET });
    const out = await linkEnsName(
      { address: WALLET, rawName: "no dots here" },
      { resolvers: r, invalidate: async () => undefined },
    );
    expect(out).toMatchObject({ ok: false, status: 400 });
    expect(r[0].address).not.toHaveBeenCalled();
  });

  it("is an honest 502 when neither chain answers", async () => {
    const { linkEnsName } = await import("@/lib/server/ens/link");
    const out = await linkEnsName(
      { address: WALLET, rawName: "andre.eth" },
      {
        resolvers: resolvers({ mainnet: new Error("rpc down"), sepolia: new Error("rpc down") }),
        invalidate: async () => undefined,
      },
    );
    expect(out).toMatchObject({ ok: false, status: 502 });
  });
});

describe("display name", () => {
  const T0 = Date.UTC(2026, 8, 26, 12);

  it("prefers the linked name over the subname", async () => {
    const { linkEnsName, displayNameForAddress } = await import("@/lib/server/ens/link");
    await linkEnsName(
      { address: WALLET, rawName: "andre.eth" },
      { resolvers: resolvers({ mainnet: WALLET }), invalidate: async () => undefined, now: () => T0 },
    );
    const subname = vi.fn(async () => "ironhabit.gohealthme.eth");
    const name = await displayNameForAddress(WALLET, {
      resolvers: resolvers({ mainnet: WALLET }),
      fallback: subname,
      now: () => T0 + 60_000,
    });
    expect(name).toBe("andre.eth");
    expect(subname).not.toHaveBeenCalled();
  });

  it("trusts the link for an hour, then re-verifies and drops it once it no longer resolves", async () => {
    const { linkEnsName, displayNameForAddress, readLinkedName, LINK_VERIFY_TTL_MS } =
      await import("@/lib/server/ens/link");
    await linkEnsName(
      { address: WALLET, rawName: "andre.eth" },
      { resolvers: resolvers({ mainnet: WALLET }), invalidate: async () => undefined, now: () => T0 },
    );
    expect(LINK_VERIFY_TTL_MS).toBe(60 * 60 * 1000);
    const moved = resolvers({ mainnet: OTHER, sepolia: null });
    const fallback = async () => "ironhabit.gohealthme.eth";
    expect(
      await displayNameForAddress(WALLET, { resolvers: moved, fallback, now: () => T0 + 30 * 60_000 }),
    ).toBe("andre.eth");
    expect(moved[0].address).not.toHaveBeenCalled();
    expect(
      await displayNameForAddress(WALLET, { resolvers: moved, fallback, now: () => T0 + 61 * 60_000 }),
    ).toBe("ironhabit.gohealthme.eth");
    expect(await readLinkedName(WALLET)).toBeNull();
  });

  it("keeps the link but falls back for this read when the chains do not answer", async () => {
    const { linkEnsName, displayNameForAddress, readLinkedName } = await import("@/lib/server/ens/link");
    await linkEnsName(
      { address: WALLET, rawName: "andre.eth" },
      { resolvers: resolvers({ mainnet: WALLET }), invalidate: async () => undefined, now: () => T0 },
    );
    const down = resolvers({ mainnet: new Error("down"), sepolia: new Error("down") });
    expect(
      await displayNameForAddress(WALLET, {
        resolvers: down,
        fallback: async () => null,
        now: () => T0 + 2 * 60 * 60_000,
      }),
    ).toBeNull();
    expect((await readLinkedName(WALLET))?.name).toBe("andre.eth");
  });
});
