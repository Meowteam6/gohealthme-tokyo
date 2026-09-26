// One human gets a small number of gohealthme.eth names, not an endless
// stream of mints paid in our Sepolia gas.
//
// Pinned here: a verified human can pick up to ENS_NAMES_PER_HUMAN names
// (default 3), re-claiming a name they already hold never counts, the next
// new name is refused with a plain 403 before any mint, the count is readable
// before the player commits, and World off keeps today's behaviour.

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
const ZERO: Address = "0x0000000000000000000000000000000000000000";
const HUMAN = { enforced: () => true, humanOf: async () => ({ key: "mock-0x01" }) };

beforeEach(() => {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "ens-cap-")));
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function deps(human: unknown = HUMAN) {
  return {
    ownerConfigured: () => true,
    namespace: async () => NS,
    ownerWrite: vi.fn(() => ({}) as never),
    resolve: {
      client: { readContract: vi.fn(async () => ZERO) } as never,
      namespace: async () => NS,
    },
    invalidate: vi.fn(async () => undefined),
    human: human as never,
    clearLink: vi.fn(async () => undefined),
  };
}

async function claim(label: string, human: unknown = HUMAN) {
  const { claimEnsName } = await import("@/lib/server/ens/claim");
  return claimEnsName({ address: WALLET, rawLabel: label }, deps(human));
}

describe("name re-pick cap", () => {
  it("allows three names, then refuses a fourth before any mint", async () => {
    const { mintParticipantName } = await import("@/lib/server/ens/write");
    const { NAME_CAP_REACHED } = await import("@/lib/server/ens/human-gate");
    expect(await claim("alpha")).toMatchObject({ ok: true });
    expect(await claim("bravo")).toMatchObject({ ok: true });
    expect(await claim("charlie")).toMatchObject({ ok: true });
    vi.mocked(mintParticipantName).mockClear();
    expect(await claim("delta")).toEqual({ ok: false, status: 403, reason: NAME_CAP_REACHED });
    expect(mintParticipantName).not.toHaveBeenCalled();
    expect(NAME_CAP_REACHED).toMatch(/link a \.eth/i);
  });

  it("never counts re-claiming the name already held", async () => {
    for (let i = 0; i < 5; i += 1) {
      expect(await claim("alpha")).toMatchObject({ ok: true });
    }
    expect(await claim("bravo")).toMatchObject({ ok: true });
    expect(await claim("charlie")).toMatchObject({ ok: true });
  });

  it("still lets a capped human re-claim their current name", async () => {
    await claim("alpha");
    await claim("bravo");
    await claim("charlie");
    expect(await claim("charlie")).toMatchObject({ ok: true });
  });

  it("reads the names left before the player commits", async () => {
    const { namesLeft } = await import("@/lib/server/ens/human-gate");
    expect(await namesLeft(WALLET, HUMAN)).toBe(3);
    await claim("alpha");
    expect(await namesLeft(WALLET, HUMAN)).toBe(2);
    await claim("bravo");
    await claim("charlie");
    expect(await namesLeft(WALLET, HUMAN)).toBe(0);
  });

  it("honours ENS_NAMES_PER_HUMAN", async () => {
    vi.stubEnv("ENS_NAMES_PER_HUMAN", "1");
    expect(await claim("alpha")).toMatchObject({ ok: true });
    expect(await claim("bravo")).toMatchObject({ ok: false, status: 403 });
  });

  it("has no cap when World is off", async () => {
    const off = { enforced: () => false, humanOf: async () => null };
    for (const label of ["alpha", "bravo", "charlie", "delta"]) {
      expect(await claim(label, off)).toMatchObject({ ok: true });
    }
    const { namesLeft } = await import("@/lib/server/ens/human-gate");
    expect(await namesLeft(WALLET, off)).toBeNull();
  });
});
