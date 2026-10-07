// Names in the open beta (NEXT_PUBLIC_ACCESS_GATE_DISABLED=1, 2026-10-07).
//
// World ID is optional, so the name claim can no longer refuse a wallet for
// lacking it. Pinned here:
//   - a wallet with a World binding keeps its human's key: one name per
//     human, and the pick cap shared across that human's names
//   - every other wallet gets ENS_NAMES_PER_HUMAN names counted on the
//     wallet itself (key wallet-<address>), is never NAME_HUMAN_REQUIRED,
//     and namesLeft answers a number so the claim form can say how many
//   - that holds with World on, off and paused: the open beta caps a build
//     without World too (with the flag off that build has no cap)
//   - with the flag off, World on still refuses an unbound wallet

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
const BOUND: Address = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";
const LISTED: Address = "0x2222222222222222222222222222222222222222";
const ZERO: Address = "0x0000000000000000000000000000000000000000";
const NULLIFIER = `0x${"1".padStart(64, "0")}`;
const LISTED_KEY = `wallet-${LISTED.toLowerCase()}`;
const BOUND_KEY = `mock-${NULLIFIER}`;

beforeEach(() => {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "ens-open-beta-")));
  vi.stubEnv("WORLD_VERIFY_MODE", "mock");
  vi.stubEnv("KILL_WORLD_ID", "");
  vi.stubEnv("ENS_NAMES_PER_HUMAN", "");
  vi.stubEnv("NEXT_PUBLIC_ACCESS_GATE_DISABLED", "1");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function bindBound(): Promise<void> {
  const { bindHuman } = await import("@/lib/server/world/human");
  const out = await bindHuman({ address: BOUND, nullifierHash: NULLIFIER, mode: "mock", protocolVersion: "4.0" });
  expect(out.ok).toBe(true);
}

async function claim(address: Address, label: string) {
  const { claimEnsName } = await import("@/lib/server/ens/claim");
  const { liveNameHumanDeps } = await import("@/lib/server/ens/human-gate");
  return claimEnsName(
    { address, rawLabel: label },
    {
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
    } as never,
  );
}

async function left(address: Address): Promise<number | null> {
  const { namesLeft } = await import("@/lib/server/ens/human-gate");
  return namesLeft(address);
}

async function check(address: Address) {
  const { checkNameHuman } = await import("@/lib/server/ens/human-gate");
  return checkNameHuman(address);
}

describe("World on, a wallet with no World binding", () => {
  it("is checked on its own wallet key and never refused for lacking World ID", async () => {
    expect(await check(LISTED)).toEqual({ ok: true, humanKey: LISTED_KEY });
  });

  it("gets the pick cap counted on its wallet: three names, then a plain refusal before any mint", async () => {
    const { NAME_CAP_REACHED } = await import("@/lib/server/ens/human-gate");
    const { mintParticipantName } = await import("@/lib/server/ens/write");
    expect(await left(LISTED)).toBe(3);
    expect(await claim(LISTED, "alpha")).toMatchObject({ ok: true });
    expect(await left(LISTED)).toBe(2);
    expect(await claim(LISTED, "bravo")).toMatchObject({ ok: true });
    expect(await left(LISTED)).toBe(1);
    expect(await claim(LISTED, "charlie")).toMatchObject({ ok: true });
    expect(await left(LISTED)).toBe(0);
    vi.mocked(mintParticipantName).mockClear();
    expect(await claim(LISTED, "delta")).toEqual({ ok: false, status: 403, reason: NAME_CAP_REACHED });
    expect(mintParticipantName).not.toHaveBeenCalled();
    // Re-claiming the current name never counts.
    expect(await claim(LISTED, "charlie")).toMatchObject({ ok: true });
  });
});

describe("World on, a World-bound wallet", () => {
  it("keeps its human's key, so one name per human still holds", async () => {
    await bindBound();
    expect(await check(BOUND)).toEqual({ ok: true, humanKey: BOUND_KEY });
    // The human's name record names another wallet (the bind store allows one
    // wallet per human, so this is the name rule checked on its own).
    const { writeJson } = await import("@/lib/server/store");
    await writeJson(`ens-human-name-${BOUND_KEY}.json`, {
      address: LISTED,
      label: "otherhabit",
      at: new Date(0).toISOString(),
      picks: 1,
    });
    const { NAME_ONE_PER_HUMAN } = await import("@/lib/server/ens/human-gate");
    expect(await claim(BOUND, "ironhabit")).toEqual({ ok: false, status: 403, reason: NAME_ONE_PER_HUMAN });
    expect(await left(BOUND)).toBe(0);
  });

  it("does not share a count with an unbound wallet", async () => {
    await bindBound();
    expect(await claim(BOUND, "alpha")).toMatchObject({ ok: true });
    expect(await claim(BOUND, "bravo")).toMatchObject({ ok: true });
    expect(await left(BOUND)).toBe(1);
    expect(await left(LISTED)).toBe(3);
  });
});

describe("a build without World configured", () => {
  it("is gated and capped per wallet in the open beta", async () => {
    vi.stubEnv("WORLD_VERIFY_MODE", "");
    const { NAME_CAP_REACHED } = await import("@/lib/server/ens/human-gate");
    expect(await check(LISTED)).toEqual({ ok: true, humanKey: LISTED_KEY });
    expect(await left(LISTED)).toBe(3);
    for (const label of ["alpha", "bravo", "charlie"]) {
      expect(await claim(LISTED, label)).toMatchObject({ ok: true });
    }
    expect(await left(LISTED)).toBe(0);
    expect(await claim(LISTED, "delta")).toEqual({ ok: false, status: 403, reason: NAME_CAP_REACHED });
  });
});

describe("World paused by the kill switch", () => {
  it("answers as the paused suite does: a binding keeps its human key, everyone else their wallet", async () => {
    await bindBound();
    vi.stubEnv("KILL_WORLD_ID", "1");
    const { worldSetup } = await import("@/lib/server/world/config");
    expect(worldSetup()).toMatchObject({ mode: "off", paused: true });
    const { NAME_CAP_REACHED } = await import("@/lib/server/ens/human-gate");
    expect(await check(BOUND)).toEqual({ ok: true, humanKey: BOUND_KEY });
    expect(await check(LISTED)).toEqual({ ok: true, humanKey: LISTED_KEY });
    expect(await left(LISTED)).toBe(3);
    for (const label of ["alpha", "bravo", "charlie"]) {
      expect(await claim(LISTED, label)).toMatchObject({ ok: true });
    }
    expect(await claim(LISTED, "delta")).toEqual({ ok: false, status: 403, reason: NAME_CAP_REACHED });
  });
});

describe("with the flag off", () => {
  it("World on still refuses a wallet with no World binding", async () => {
    vi.stubEnv("NEXT_PUBLIC_ACCESS_GATE_DISABLED", "");
    const { NAME_HUMAN_REQUIRED } = await import("@/lib/server/ens/human-gate");
    expect(await check(LISTED)).toEqual({ ok: false, status: 403, reason: NAME_HUMAN_REQUIRED });
    expect(await claim(LISTED, "alpha")).toEqual({ ok: false, status: 403, reason: NAME_HUMAN_REQUIRED });
    expect(await left(LISTED)).toBeNull();
  });

  it("a build without World stays uncapped", async () => {
    vi.stubEnv("NEXT_PUBLIC_ACCESS_GATE_DISABLED", "");
    vi.stubEnv("WORLD_VERIFY_MODE", "");
    expect(await check(LISTED)).toEqual({ ok: true, humanKey: null });
    for (const label of ["alpha", "bravo", "charlie", "delta"]) {
      expect(await claim(LISTED, label)).toMatchObject({ ok: true });
    }
    expect(await left(LISTED)).toBeNull();
  });
});
