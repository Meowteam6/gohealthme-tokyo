import { describe, it, expect, vi, beforeEach } from "vitest";

// The provider seam is what lets the World booth answer be a config swap.
// Pinned here: the mode switch fails loudly on a typo, the mock provider is
// deterministic and only accepts a proof bound to the action it issued, and
// the world provider signs the rp_context server-side, pins the environment,
// forwards the proof intact, and refuses everything World refuses.

const ADDRESS = "0x1111111111111111111111111111111111111111";
const ACTION = "settle:0xabc:1";

async function load() {
  vi.resetModules();
  return import("@/lib/server/agent/approval-provider");
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("approvalMode", () => {
  it("is off when WORLD_APPROVAL_MODE is unset or blank", async () => {
    const { approvalMode } = await load();
    expect(approvalMode()).toBe("off");
    vi.stubEnv("WORLD_APPROVAL_MODE", "  ");
    expect(approvalMode()).toBe("off");
  });

  it("accepts mock and world in any case", async () => {
    const { approvalMode } = await load();
    vi.stubEnv("WORLD_APPROVAL_MODE", "MOCK");
    expect(approvalMode()).toBe("mock");
    vi.stubEnv("WORLD_APPROVAL_MODE", "world");
    expect(approvalMode()).toBe("world");
  });

  it("throws on a value that is neither, so a typo cannot silently disable the human step", async () => {
    const { approvalMode } = await load();
    vi.stubEnv("WORLD_APPROVAL_MODE", "mocked");
    expect(() => approvalMode()).toThrow(/WORLD_APPROVAL_MODE/);
  });
});

describe("mock provider (event mode)", () => {
  it("labels its challenge as mocked and carries no world context", async () => {
    const { mockApprovalProvider } = await load();
    const challenge = await mockApprovalProvider().challenge({
      action: ACTION,
      ttlSeconds: 90,
    });
    expect(challenge).toEqual({ provider: "mock", mocked: true });
  });

  it("is deterministic: same wallet and action, same nullifier; different action, different nullifier", async () => {
    const { mockNullifier } = await load();
    const a = mockNullifier(ADDRESS, ACTION);
    const b = mockNullifier(ADDRESS.toUpperCase().replace("0X", "0x"), ACTION);
    const c = mockNullifier(ADDRESS, "settle:0xabc:2");
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("accepts only a mocked proof bound to the requested action that approves", async () => {
    const { mockApprovalProvider, MOCK_PROOF_KIND, mockNullifier } = await load();
    const provider = mockApprovalProvider();
    const ok = await provider.verify({
      action: ACTION,
      address: ADDRESS,
      proof: { kind: MOCK_PROOF_KIND, action: ACTION, approve: true },
    });
    expect(ok).toEqual({ ok: true, nullifier: mockNullifier(ADDRESS, ACTION) });

    const wrongAction = await provider.verify({
      action: ACTION,
      address: ADDRESS,
      proof: { kind: MOCK_PROOF_KIND, action: "settle:0xabc:2", approve: true },
    });
    expect(wrongAction).toMatchObject({ ok: false, reason: /different request/ });

    const notMock = await provider.verify({
      action: ACTION,
      address: ADDRESS,
      proof: { protocol_version: "4.0", action: ACTION, responses: [] },
    });
    expect(notMock).toMatchObject({ ok: false });

    const none = await provider.verify({ action: ACTION, address: ADDRESS, proof: null });
    expect(none).toMatchObject({ ok: false, reason: /no proof/ });
  });
});

describe("world provider", () => {
  const signRequestImpl = vi.fn(() => ({
    sig: "0xsig",
    nonce: "0xnonce",
    createdAt: 1_700_000_000,
    expiresAt: 1_700_000_090,
  }));

  function fetchReplying(status: number, body: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status }));
  }

  async function provider(fetchImpl: typeof fetch) {
    const { worldApprovalProvider } = await load();
    return worldApprovalProvider({
      rpId: "rp_test",
      signingKeyHex: "0x" + "11".repeat(32),
      appId: "app_test",
      environment: "staging",
      verifyUrl: "https://verify.example/api/v4/verify/",
      allowLegacyProofs: false,
      fetchImpl,
      signRequestImpl,
    });
  }

  const goodProof = {
    protocol_version: "4.0",
    nonce: "0xnonce",
    action: ACTION,
    environment: "production",
    responses: [{ identifier: "orb", nullifier: "0xff", proof: [] }],
  };

  it("signs the rp_context on the server with the action and ttl, and hands the browser only public fields", async () => {
    const p = await provider(fetchReplying(200, {}));
    const challenge = await p.challenge({ action: ACTION, ttlSeconds: 90 });
    expect(signRequestImpl).toHaveBeenCalledWith({
      signingKeyHex: "11".repeat(32),
      action: ACTION,
      ttl: 90,
    });
    expect(challenge).toEqual({
      provider: "world",
      mocked: false,
      world: {
        appId: "app_test",
        environment: "staging",
        allowLegacyProofs: false,
        rpContext: {
          rp_id: "rp_test",
          nonce: "0xnonce",
          created_at: 1_700_000_000,
          expires_at: 1_700_000_090,
          signature: "0xsig",
        },
      },
    });
    expect(JSON.stringify(challenge)).not.toContain("11".repeat(32));
  });

  it("forwards the proof intact to /verify/{rp_id} with the environment pinned from config", async () => {
    const fetchImpl = fetchReplying(200, { success: true, nullifier: "255" });
    const p = await provider(fetchImpl);
    const outcome = await p.verify({ action: ACTION, address: ADDRESS, proof: goodProof });
    expect(outcome).toEqual({ ok: true, nullifier: "0xff" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://verify.example/api/v4/verify/rp_test");
    const sent = JSON.parse(String(init.body));
    expect(sent.environment).toBe("staging");
    expect(sent.responses).toEqual(goodProof.responses);
    expect(sent.action).toBe(ACTION);
  });

  it("refuses a proof bound to another action before calling World", async () => {
    const fetchImpl = fetchReplying(200, { success: true });
    const p = await provider(fetchImpl);
    const outcome = await p.verify({
      action: ACTION,
      address: ADDRESS,
      proof: { ...goodProof, action: "settle:0xabc:9" },
    });
    expect(outcome).toMatchObject({ ok: false, reason: /different request/ });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses when World rejects, naming the code and never approving", async () => {
    const p = await provider(
      fetchReplying(400, { success: false, code: "all_verifications_failed" }),
    );
    const outcome = await p.verify({ action: ACTION, address: ADDRESS, proof: goodProof });
    expect(outcome).toEqual({
      ok: false,
      reason: "World did not accept the proof (all_verifications_failed)",
    });
  });

  it("fails closed when the verify endpoint is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const p = await provider(fetchImpl as unknown as typeof fetch);
    const outcome = await p.verify({ action: ACTION, address: ADDRESS, proof: goodProof });
    expect(outcome).toMatchObject({ ok: false, reason: /could not be reached/ });
  });

  it("from env: every variable is required and a bad app id is refused", async () => {
    const { worldApprovalProviderFromEnv } = await load();
    expect(() => worldApprovalProviderFromEnv()).toThrow(/NEXT_PUBLIC_WORLD_APP_ID/);
    vi.stubEnv("NEXT_PUBLIC_WORLD_APP_ID", "notanapp");
    expect(() => worldApprovalProviderFromEnv()).toThrow(/must start with app_/);
    vi.stubEnv("NEXT_PUBLIC_WORLD_APP_ID", "app_1");
    expect(() => worldApprovalProviderFromEnv()).toThrow(/WORLD_RP_ID/);
    vi.stubEnv("WORLD_RP_ID", "rp_1");
    expect(() => worldApprovalProviderFromEnv()).toThrow(/WORLD_SIGNING_KEY/);
    vi.stubEnv("WORLD_SIGNING_KEY", "0x" + "22".repeat(32));
    vi.stubEnv("WORLD_ENVIRONMENT", "prod");
    expect(() => worldApprovalProviderFromEnv()).toThrow(/WORLD_ENVIRONMENT/);
    vi.stubEnv("WORLD_ENVIRONMENT", "staging");
    expect(worldApprovalProviderFromEnv().name).toBe("world");
  });
});

describe("normalizeNullifier", () => {
  it("accepts hex and decimal renderings and rejects garbage", async () => {
    const { normalizeNullifier } = await load();
    expect(normalizeNullifier("0xff")).toBe("0xff");
    expect(normalizeNullifier("255")).toBe("0xff");
    expect(normalizeNullifier("nope")).toBeNull();
  });
});
