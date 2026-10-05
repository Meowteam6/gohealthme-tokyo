// Names while World ID is paused (KILL_WORLD_ID).
//
// The pause turns worldSetup() off, and the name gate used to read that as
// "prove-human is off": no human check and no cap, so a World-verified player
// could mint names without limit until the switch came back. Pinned here:
//   - a wallet with a World binding keeps its human's cap through the pause,
//     counted on the same record as before it (picks made with World on count)
//   - a wallet with no World binding (a new list player) is never refused for
//     lacking World ID, since the pause gives them no way to get one; it gets
//     ENS_NAMES_PER_HUMAN names counted on that wallet
//   - a build without World configured is unchanged by the switch: no cap
//   - linking a .eth the player already owns mints nothing and is never
//     refused by the pick cap (NAME_CAP_REACHED tells a capped player to link)

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

beforeEach(() => {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "ens-paused-")));
  vi.stubEnv("WORLD_VERIFY_MODE", "mock");
  vi.stubEnv("KILL_WORLD_ID", "");
  vi.stubEnv("ENS_NAMES_PER_HUMAN", "");
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

function pause(): void {
  vi.stubEnv("KILL_WORLD_ID", "1");
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

describe("a World-bound wallet while World is paused", () => {
  it("keeps the pick cap: three names, then a plain refusal before any mint", async () => {
    await bindBound();
    pause();
    const { worldSetup } = await import("@/lib/server/world/config");
    expect(worldSetup()).toMatchObject({ mode: "off", paused: true });
    const { NAME_CAP_REACHED } = await import("@/lib/server/ens/human-gate");
    const { mintParticipantName } = await import("@/lib/server/ens/write");

    expect(await left(BOUND)).toBe(3);
    for (const label of ["alpha", "bravo", "charlie"]) {
      expect(await claim(BOUND, label)).toMatchObject({ ok: true });
    }
    expect(await left(BOUND)).toBe(0);
    vi.mocked(mintParticipantName).mockClear();
    expect(await claim(BOUND, "delta")).toEqual({ ok: false, status: 403, reason: NAME_CAP_REACHED });
    expect(mintParticipantName).not.toHaveBeenCalled();
    // Re-claiming the current name never counts.
    expect(await claim(BOUND, "charlie")).toMatchObject({ ok: true });
  });

  it("counts the picks made before the pause on the same record", async () => {
    await bindBound();
    expect(await claim(BOUND, "alpha")).toMatchObject({ ok: true });
    expect(await claim(BOUND, "bravo")).toMatchObject({ ok: true });
    pause();
    expect(await left(BOUND)).toBe(1);
    expect(await claim(BOUND, "charlie")).toMatchObject({ ok: true });
    expect(await claim(BOUND, "delta")).toMatchObject({ ok: false, status: 403 });
  });

  it("keeps one name per human: a name this human holds elsewhere still refuses", async () => {
    await bindBound();
    // The human's name record names another wallet (the bind store allows one
    // wallet per human, so this is the name rule checked on its own).
    const { writeJson } = await import("@/lib/server/store");
    await writeJson(`ens-human-name-mock-${NULLIFIER}.json`, {
      address: LISTED,
      label: "otherhabit",
      at: new Date(0).toISOString(),
      picks: 1,
    });
    pause();
    const { NAME_ONE_PER_HUMAN } = await import("@/lib/server/ens/human-gate");
    expect(await claim(BOUND, "ironhabit")).toEqual({ ok: false, status: 403, reason: NAME_ONE_PER_HUMAN });
    expect(await left(BOUND)).toBe(0);
  });
});

describe("a wallet with no World binding while World is paused", () => {
  it("is never refused for lacking World ID, and gets the cap counted on its wallet", async () => {
    pause();
    const { NAME_CAP_REACHED } = await import("@/lib/server/ens/human-gate");
    expect(await left(LISTED)).toBe(3);
    for (const label of ["alpha", "bravo", "charlie"]) {
      expect(await claim(LISTED, label)).toMatchObject({ ok: true });
    }
    expect(await left(LISTED)).toBe(0);
    expect(await claim(LISTED, "delta")).toEqual({ ok: false, status: 403, reason: NAME_CAP_REACHED });
    expect(await claim(LISTED, "charlie")).toMatchObject({ ok: true });
  });

  it("does not share a count with a World-bound wallet", async () => {
    await bindBound();
    pause();
    await claim(BOUND, "alpha");
    await claim(BOUND, "bravo");
    expect(await left(LISTED)).toBe(3);
  });

  it("is refused again once World is back on, before any signature matters", async () => {
    const { NAME_HUMAN_REQUIRED } = await import("@/lib/server/ens/human-gate");
    expect(await claim(LISTED, "alpha")).toEqual({ ok: false, status: 403, reason: NAME_HUMAN_REQUIRED });
  });
});

describe("a build without World configured", () => {
  it("is unchanged by the switch: no human check and no cap", async () => {
    vi.stubEnv("WORLD_VERIFY_MODE", "");
    pause();
    for (const label of ["alpha", "bravo", "charlie", "delta"]) {
      expect(await claim(LISTED, label)).toMatchObject({ ok: true });
    }
    expect(await left(LISTED)).toBeNull();
  });
});

describe("linking a .eth the player already owns", () => {
  it("is never refused by the pick cap, World on or paused", async () => {
    await bindBound();
    for (const label of ["alpha", "bravo", "charlie"]) {
      await claim(BOUND, label);
    }
    const { checkNameHuman } = await import("@/lib/server/ens/human-gate");
    expect(await checkNameHuman(BOUND)).toMatchObject({ ok: true });
    pause();
    expect(await checkNameHuman(BOUND)).toMatchObject({ ok: true });
  });

  it("still needs World ID while World is on", async () => {
    const { checkNameHuman, NAME_HUMAN_REQUIRED } = await import("@/lib/server/ens/human-gate");
    expect(await checkNameHuman(LISTED)).toEqual({ ok: false, status: 403, reason: NAME_HUMAN_REQUIRED });
  });
});
