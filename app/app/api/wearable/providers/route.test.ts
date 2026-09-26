import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// WHOOP is offered only to allowlisted wallets; a wallet already linked to
// WHOOP keeps its link visible either way.

const providerConfigured = vi.fn();
const providerIdFor = vi.fn();
const isConnected = vi.fn();
const requireAddressSignature = vi.fn();

vi.mock("@/lib/server/wearable", () => ({
  PROVIDER_IDS: ["junction", "whoop", "apple"],
  providerConfigured: (...a: unknown[]) => providerConfigured(...a),
  providerIdFor: (...a: unknown[]) => providerIdFor(...a),
  providerById: (id: string) => ({
    id,
    label: id,
    metrics: [],
    isConnected: (...a: unknown[]) => isConnected(id, ...a),
    observedMetrics: async () => ({ kind: "declared" }),
  }),
}));
vi.mock("@/lib/server/wallet-auth", () => ({
  requireAddressSignature: (...a: unknown[]) => requireAddressSignature(...a),
}));

const { GET } = await import("@/app/api/wearable/providers/route");

const USER = "0x1111111111111111111111111111111111111111";

async function whoopEntry(query: string) {
  const res = await GET(new NextRequest(`https://app.test/api/wearable/providers${query}`));
  const body = (await res.json()) as { providers: Array<{ id: string; configured: boolean; connected: boolean }> };
  return body.providers.find((p) => p.id === "whoop");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  providerConfigured.mockReturnValue(true);
  providerIdFor.mockResolvedValue("junction");
  isConnected.mockResolvedValue(false);
  requireAddressSignature.mockResolvedValue({ ok: true, address: USER });
});

describe("GET /api/wearable/providers WHOOP allowlist", () => {
  it("does not offer WHOOP without an address", async () => {
    expect((await whoopEntry(""))?.configured).toBe(false);
  });

  it("does not offer WHOOP to a wallet off the list", async () => {
    vi.stubEnv("WHOOP_ALLOWED_WALLETS", "0x2222222222222222222222222222222222222222");
    expect((await whoopEntry(`?address=${USER}`))?.configured).toBe(false);
  });

  it("offers WHOOP to a listed wallet, any casing", async () => {
    vi.stubEnv("WHOOP_ALLOWED_WALLETS", USER.toUpperCase().replace("0X", "0x"));
    expect((await whoopEntry(`?address=${USER}`))?.configured).toBe(true);
  });

  it("keeps an existing WHOOP link visible after the wallet leaves the list", async () => {
    vi.stubEnv("WHOOP_ALLOWED_WALLETS", "");
    isConnected.mockImplementation(async (id: string) => id === "whoop");
    const whoop = await whoopEntry(`?address=${USER}`);
    expect(whoop?.connected).toBe(true);
    expect(whoop?.configured).toBe(true);
  });
});
