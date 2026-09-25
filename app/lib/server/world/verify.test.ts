import { describe, it, expect, vi } from "vitest";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import type { LiveConfig } from "@/lib/server/world/config";
import { normalizeNullifier, nullifierToDecimal } from "@/lib/server/world/nullifier";
import { parseIdkitPayload } from "@/lib/server/world/payload";
import {
  MOCK_ENVIRONMENT,
  WORLD_VERIFY_URL,
  expectedSignalHash,
  mockNullifier,
  verifyLive,
  verifyMock,
} from "@/lib/server/world/verify";

// The verifiers are the only thing standing between an IDKit payload and a
// stored human. Pinned: the payload shape check, the action and wallet
// (signal) binding in BOTH modes, the live round trip to World including its
// failure codes, and the mock path's determinism, which is what the demo's
// denied path rests on.

const WALLET = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";
const OTHER = "0x2222222222222222222222222222222222222222";
const ACTION = "prove-human";

const LIVE: LiveConfig = {
  appId: "app_test",
  rpId: "rp_test",
  signingKeyHex: "0x11",
  action: ACTION,
  environment: "staging",
};

function v4Payload(overrides: Record<string, unknown> = {}, item: Record<string, unknown> = {}) {
  return {
    protocol_version: "4.0",
    nonce: "0x01",
    action: ACTION,
    environment: "staging",
    responses: [
      {
        identifier: "proof_of_human",
        signal_hash: hashSignal(WALLET.toLowerCase()),
        proof: ["0x1", "0x2", "0x3", "0x4", "0x5"],
        nullifier: "0xabc",
        issuer_schema_id: 1,
        expires_at_min: 1_800_000_000,
        ...item,
      },
    ],
    ...overrides,
  };
}

function parsed(overrides: Record<string, unknown> = {}, item: Record<string, unknown> = {}) {
  const result = parseIdkitPayload(v4Payload(overrides, item));
  if (!result.ok) throw new Error(result.reason);
  return result.proof;
}

function worldSays(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("normalizeNullifier", () => {
  it("canonicalises hex and decimal to the same padded hex", () => {
    const hex = normalizeNullifier("0xABC");
    expect(hex).toBe(`0x${"abc".padStart(64, "0")}`);
    expect(normalizeNullifier("2748")).toBe(hex);
    expect(nullifierToDecimal(hex as string)).toBe("2748");
  });

  it("refuses non-nullifiers", () => {
    expect(normalizeNullifier("0x0")).toBeNull();
    expect(normalizeNullifier("0")).toBeNull();
    expect(normalizeNullifier("abc")).toBeNull();
    expect(normalizeNullifier(`0x${"f".repeat(65)}`)).toBeNull();
    expect(normalizeNullifier(42)).toBeNull();
    expect(normalizeNullifier(null)).toBeNull();
  });
});

describe("parseIdkitPayload", () => {
  it("accepts a v4 uniqueness payload and keeps the raw object", () => {
    const raw = v4Payload();
    const result = parseIdkitPayload(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proof.protocolVersion).toBe("4.0");
      expect(result.proof.action).toBe(ACTION);
      expect(result.proof.identifier).toBe("proof_of_human");
      expect(result.proof.nullifier).toBe("0xabc");
      expect(result.proof.raw).toBe(raw);
    }
  });

  it("accepts a legacy v3 payload", () => {
    const result = parseIdkitPayload(v4Payload({ protocol_version: "3.0" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.proof.protocolVersion).toBe("3.0");
  });

  it("refuses a session proof, a bad version, and a missing nullifier", () => {
    expect(parseIdkitPayload(v4Payload({ session_id: "session_1" })).ok).toBe(false);
    expect(parseIdkitPayload(v4Payload({ protocol_version: "2.0" })).ok).toBe(false);
    expect(parseIdkitPayload(v4Payload({}, { nullifier: undefined })).ok).toBe(false);
    expect(parseIdkitPayload(v4Payload({ responses: [] })).ok).toBe(false);
    expect(parseIdkitPayload("nope").ok).toBe(false);
    expect(parseIdkitPayload(null).ok).toBe(false);
  });

  it("reports a missing signal_hash as null rather than refusing the shape", () => {
    const result = parseIdkitPayload(v4Payload({}, { signal_hash: undefined }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.proof.signalHash).toBeNull();
  });
});

describe("verifyLive", () => {
  it("forwards the payload as-is to World and returns the canonical nullifier", async () => {
    const fetchImpl = worldSays(200, {
      success: true,
      nullifier: "2748",
      environment: "staging",
    });
    const proof = parsed();
    const result = await verifyLive({ proof, address: WALLET, config: LIVE, fetchImpl });
    expect(result).toEqual({
      ok: true,
      nullifierHash: `0x${"abc".padStart(64, "0")}`,
      protocolVersion: "4.0",
      credential: "orb",
    });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${WORLD_VERIFY_URL}/rp_test`);
    expect(JSON.parse(init.body as string)).toEqual(proof.raw);
  });

  it("falls back to the payload nullifier when World returns none", async () => {
    const fetchImpl = worldSays(200, { success: true, results: [{ success: true }] });
    const result = await verifyLive({ proof: parsed(), address: WALLET, config: LIVE, fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.nullifierHash).toBe(`0x${"abc".padStart(64, "0")}`);
  });

  it("refuses World's rejection as 401 with a plain reason and the code", async () => {
    const fetchImpl = worldSays(400, {
      success: false,
      code: "max_verifications_reached",
      detail: "already used",
    });
    const result = await verifyLive({ proof: parsed(), address: WALLET, config: LIVE, fetchImpl });
    expect(result).toMatchObject({
      ok: false,
      status: 401,
      code: "max_verifications_reached",
    });
    if (!result.ok) expect(result.reason).toMatch(/already been used/);
  });

  it("reports an unreachable World as 502, not as a bad proof", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const result = await verifyLive({ proof: parsed(), address: WALLET, config: LIVE, fetchImpl });
    expect(result).toMatchObject({ ok: false, status: 502 });
  });

  it("refuses a proof for a different action before calling World", async () => {
    const fetchImpl = worldSays(200, { success: true });
    const result = await verifyLive({
      proof: parsed({ action: "other" }),
      address: WALLET,
      config: LIVE,
      fetchImpl,
    });
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a proof made for a different wallet, and one with no signal at all", async () => {
    const fetchImpl = worldSays(200, { success: true });
    const other = await verifyLive({ proof: parsed(), address: OTHER, config: LIVE, fetchImpl });
    expect(other).toMatchObject({ ok: false, status: 401 });
    if (!other.ok) expect(other.reason).toMatch(/different wallet/);

    const unbound = await verifyLive({
      proof: parsed({}, { signal_hash: undefined }),
      address: WALLET,
      config: LIVE,
      fetchImpl,
    });
    expect(unbound).toMatchObject({ ok: false, status: 401 });
    if (!unbound.ok) expect(unbound.reason).toMatch(/not bound to a wallet/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts the signal hash regardless of hex casing", async () => {
    const fetchImpl = worldSays(200, { success: true, nullifier: "0xabc" });
    const upper = expectedSignalHash(WALLET).toUpperCase().replace("0X", "0x");
    const result = await verifyLive({
      proof: parsed({}, { signal_hash: upper }),
      address: WALLET,
      config: LIVE,
      fetchImpl,
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a proof from the wrong environment, in the payload or in World's answer", async () => {
    const fromPayload = await verifyLive({
      proof: parsed({ environment: "production" }),
      address: WALLET,
      config: LIVE,
      fetchImpl: worldSays(200, { success: true, nullifier: "0xabc" }),
    });
    expect(fromPayload).toMatchObject({ ok: false, status: 401 });

    const fromWorld = await verifyLive({
      proof: parsed(),
      address: WALLET,
      config: LIVE,
      fetchImpl: worldSays(200, {
        success: true,
        nullifier: "0xabc",
        environment: "production",
      }),
    });
    expect(fromWorld).toMatchObject({ ok: false, status: 401 });
  });
});

describe("verifyMock (event mode)", () => {
  function mockProof(overrides: Record<string, unknown> = {}, item: Record<string, unknown> = {}) {
    return parsed({ environment: MOCK_ENVIRONMENT, ...overrides }, item);
  }

  it("derives the same nullifier for the same identity every time, and a different one otherwise", () => {
    const a = verifyMock({ proof: mockProof({}, { nullifier: "0x1" }), address: WALLET, action: ACTION });
    const b = verifyMock({ proof: mockProof({}, { nullifier: "0x01" }), address: WALLET, action: ACTION });
    const c = verifyMock({ proof: mockProof({}, { nullifier: "0x2" }), address: WALLET, action: ACTION });
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) {
      expect(a.nullifierHash).toBe(b.nullifierHash);
      expect(a.nullifierHash).not.toBe(c.nullifierHash);
      expect(a.nullifierHash).toBe(
        mockNullifier(ACTION, `0x${"1".padStart(64, "0")}`),
      );
      expect(a.nullifierHash).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it("still binds the proof to the wallet", () => {
    const result = verifyMock({ proof: mockProof(), address: OTHER, action: ACTION });
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("refuses a real staging or production proof on a mock deployment", () => {
    const result = verifyMock({ proof: parsed(), address: WALLET, action: ACTION });
    expect(result).toMatchObject({ ok: false, status: 401 });
    if (!result.ok) expect(result.reason).toMatch(/event mode/);
  });

  it("refuses a different action, and accepts a non-Orb credential (no Orb gate)", () => {
    expect(
      verifyMock({ proof: mockProof({ action: "x" }), address: WALLET, action: ACTION }),
    ).toMatchObject({ ok: false, status: 401 });
    expect(
      verifyMock({
        proof: mockProof({}, { identifier: "passport" }),
        address: WALLET,
        action: ACTION,
      }),
    ).toMatchObject({ ok: true, credential: "passport" });
  });
});
