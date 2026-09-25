import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";

// The binding is the rule "one human, one wallet; one wallet, one human".
// Pinned here: a first bind, an idempotent re-bind, and the two refusals
// (a second human on a bound wallet; a bound human on a second wallet) with
// the wallet slot handed back so the refused wallet stays usable by someone
// else. A fresh temp DATA_DIR per load isolates the file-fallback store the
// same way the access tests do.

const A = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";
const B = "0x2222222222222222222222222222222222222222";
const HUMAN_1 = `0x${"1".padStart(64, "0")}`;
const HUMAN_2 = `0x${"2".padStart(64, "0")}`;

async function load(mode = "mock") {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "world-human-")));
  // Reads default to this deployment's namespace, which follows the mode.
  vi.stubEnv("WORLD_VERIFY_MODE", mode);
  vi.resetModules();
  return await import("@/lib/server/world/human");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("bindHuman", () => {
  it("binds a fresh wallet to a fresh human and serves the status", async () => {
    const human = await load();
    const result = await human.bindHuman({
      address: A.toLowerCase(),
      nullifierHash: HUMAN_1,
      mode: "mock",
      protocolVersion: "4.0",
      now: () => 1_700_000_000_000,
    });
    expect(result).toMatchObject({ ok: true, created: true });
    if (result.ok) {
      expect(result.record.address).toBe(A);
      expect(result.record.verifiedAt).toBe("2023-11-14T22:13:20.000Z");
      expect(result.record.mode).toBe("mock");
    }
    expect(await human.isVerifiedHuman(A)).toBe(true);
    expect(await human.isVerifiedHuman(A.toLowerCase())).toBe(true);
    expect(await human.humanStatus(A)).toEqual({
      human: "verified",
      verifiedAt: "2023-11-14T22:13:20.000Z",
      proofMode: "mock",
    });
    expect(await human.walletForHuman(HUMAN_1)).toBe(A);
  });

  it("reports an unknown wallet as unverified", async () => {
    const human = await load();
    expect(await human.isVerifiedHuman(B)).toBe(false);
    expect(await human.humanStatus(B)).toEqual({ human: "unverified" });
    expect(await human.isVerifiedHuman("nope")).toBe(false);
    expect(await human.getHumanRecord("nope")).toBeNull();
  });

  it("is idempotent for the same human re-verifying the same wallet", async () => {
    const human = await load();
    const first = await human.bindHuman({
      address: A,
      nullifierHash: HUMAN_1,
      mode: "live",
      protocolVersion: "4.0",
      now: () => 1_000,
    });
    const again = await human.bindHuman({
      address: A,
      nullifierHash: HUMAN_1,
      mode: "live",
      protocolVersion: "3.0",
      now: () => 2_000,
    });
    expect(again).toMatchObject({ ok: true, created: false });
    if (first.ok && again.ok) {
      expect(again.record).toEqual(first.record);
    }
  });

  it("refuses a second human on an already bound wallet", async () => {
    const human = await load();
    await human.bindHuman({ address: A, nullifierHash: HUMAN_1, mode: "mock", protocolVersion: "4.0" });
    const result = await human.bindHuman({
      address: A,
      nullifierHash: HUMAN_2,
      mode: "mock",
      protocolVersion: "4.0",
    });
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      conflict: "wallet-has-other-human",
    });
    // The second human is still free to bind a wallet of their own.
    expect(await human.walletForHuman(HUMAN_2)).toBeNull();
    const own = await human.bindHuman({ address: B, nullifierHash: HUMAN_2, mode: "mock", protocolVersion: "4.0" });
    expect(own.ok).toBe(true);
  });

  it("refuses a bound human on a second wallet and names the first wallet", async () => {
    const human = await load();
    await human.bindHuman({ address: A, nullifierHash: HUMAN_1, mode: "mock", protocolVersion: "4.0" });
    const result = await human.bindHuman({
      address: B,
      nullifierHash: HUMAN_1,
      mode: "mock",
      protocolVersion: "4.0",
    });
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      conflict: "human-has-other-wallet",
      otherWallet: A,
    });
    if (!result.ok) expect(result.reason).toContain("0x8ba1...BA72");
    // Wallet B was handed back: it is unverified and a different human can take it.
    expect(await human.isVerifiedHuman(B)).toBe(false);
    const other = await human.bindHuman({ address: B, nullifierHash: HUMAN_2, mode: "mock", protocolVersion: "4.0" });
    expect(other.ok).toBe(true);
    expect(await human.isVerifiedHuman(B)).toBe(true);
  });

  it("self-heals a (legacy-key) human whose wallet pointer exists but whose record is missing", async () => {
    const human = await load();
    const LIVE = "live-staging" as const;
    const store = await import("@/lib/server/store");
    // Simulate a crash after the reverse index was written and before the
    // wallet record. The human is still held for wallet A (nobody else can
    // take it) and A's next verification writes the record.
    await store.writeJson(`world:nullifier:${HUMAN_1}.json`, {
      address: A,
      verifiedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(await human.isVerifiedHuman(A, LIVE)).toBe(false);
    const stolen = await human.bindHuman({ address: B, nullifierHash: HUMAN_1, mode: "live", protocolVersion: "4.0", namespace: LIVE });
    expect(stolen).toMatchObject({ ok: false, conflict: "human-has-other-wallet", otherWallet: A });
    const result = await human.bindHuman({ address: A, nullifierHash: HUMAN_1, mode: "live", protocolVersion: "4.0", namespace: LIVE });
    expect(result).toMatchObject({ ok: true, created: true });
    if (result.ok) expect(result.record.verifiedAt).toBe("2020-01-01T00:00:00.000Z");
    expect((await human.getHumanRecord(A, LIVE))?.nullifierHash).toBe(HUMAN_1);
    expect(await human.isVerifiedHuman(A, LIVE)).toBe(true);
  });

  it("serialises concurrent binds so one human never lands on two wallets", async () => {
    const human = await load();
    const [a, b] = await Promise.all([
      human.bindHuman({ address: A, nullifierHash: HUMAN_1, mode: "mock", protocolVersion: "4.0" }),
      human.bindHuman({ address: B, nullifierHash: HUMAN_1, mode: "mock", protocolVersion: "4.0" }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const winner = a.ok ? A : B;
    expect(await human.walletForHuman(HUMAN_1)).toBe(winner);
  });
});

describe("namespaces (a mock binding can never satisfy live)", () => {
  it("keeps a mock bind out of both live namespaces", async () => {
    const human = await load("mock");
    await human.bindHuman({ address: A, nullifierHash: HUMAN_1, mode: "mock", protocolVersion: "4.0" });
    expect(await human.isVerifiedHuman(A, "mock")).toBe(true);
    expect(await human.isVerifiedHuman(A, "live-staging")).toBe(false);
    expect(await human.isVerifiedHuman(A, "live-production")).toBe(false);
    expect(await human.walletForHuman(HUMAN_1, "live-production")).toBeNull();
    // The same wallet can still bind its real World ID on live: the mock
    // binding does not block it.
    const real = await human.bindHuman({
      address: A,
      nullifierHash: HUMAN_2,
      mode: "live",
      protocolVersion: "4.0",
      namespace: "live-production",
    });
    expect(real).toMatchObject({ ok: true, created: true });
  });

  it("follows the deployment: a mock record is invisible once the mode is live", async () => {
    const human = await load("mock");
    await human.bindHuman({ address: A, nullifierHash: HUMAN_1, mode: "mock", protocolVersion: "4.0" });
    expect(await human.isVerifiedHuman(A)).toBe(true);
    vi.stubEnv("WORLD_VERIFY_MODE", "live");
    vi.stubEnv("WORLD_APP_ID", "app_test");
    vi.stubEnv("WORLD_RP_ID", "rp_test");
    vi.stubEnv("WORLD_RP_SIGNING_KEY", "0x11");
    expect(await human.isVerifiedHuman(A)).toBe(false);
    expect(await human.humanStatus(A)).toEqual({ human: "unverified" });
  });

  it("reads legacy (pre-namespace) records only where they came from", async () => {
    const human = await load("mock");
    const store = await import("@/lib/server/store");
    const record = (address: string, nullifierHash: string, mode: "mock" | "live") => ({
      address,
      nullifierHash,
      verifiedAt: "2026-09-25T00:00:00.000Z",
      mode,
      protocolVersion: "4.0",
    });
    await store.writeJson(`world:human:${A.toLowerCase()}.json`, record(A, HUMAN_1, "mock"));
    await store.writeJson(`world:nullifier:${HUMAN_1}.json`, { address: A, verifiedAt: "x" });
    await store.writeJson(`world:human:${B.toLowerCase()}.json`, record(B, HUMAN_2, "live"));
    await store.writeJson(`world:nullifier:${HUMAN_2}.json`, { address: B, verifiedAt: "x" });

    expect(await human.isVerifiedHuman(A, "mock")).toBe(true);
    expect(await human.isVerifiedHuman(A, "live-staging")).toBe(false);
    expect(await human.isVerifiedHuman(A, "live-production")).toBe(false);
    expect(await human.isVerifiedHuman(B, "live-staging")).toBe(true);
    expect(await human.isVerifiedHuman(B, "mock")).toBe(false);
    expect(await human.isVerifiedHuman(B, "live-production")).toBe(false);
    expect(await human.walletForHuman(HUMAN_2, "live-staging")).toBe(B);
    expect(await human.walletForHuman(HUMAN_2, "mock")).toBeNull();
    // The legacy live human stays unique in live-staging.
    const second = await human.bindHuman({
      address: A,
      nullifierHash: HUMAN_2,
      mode: "live",
      protocolVersion: "4.0",
      namespace: "live-staging",
    });
    expect(second).toMatchObject({ ok: false, conflict: "human-has-other-wallet" });
  });

  it("refuses to write a proof into the other kind of namespace", async () => {
    const human = await load("mock");
    await expect(
      human.bindHuman({
        address: A,
        nullifierHash: HUMAN_1,
        mode: "mock",
        protocolVersion: "4.0",
        namespace: "live-production",
      }),
    ).rejects.toThrow(/cannot bind/);
  });
});
