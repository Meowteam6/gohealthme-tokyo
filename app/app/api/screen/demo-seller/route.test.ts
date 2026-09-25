import { describe, it, expect, afterEach, vi } from "vitest";
import { CHAIN_CONFIGS } from "@circle-fin/x402-batching/client";

// The demo seller is a real 402 endpoint in the exact shape the Circle
// batching client parses, whose payee is a sanctioned mainnet address. It
// exists so the blocked half of the screening demo is an actual refused
// payment, not a fixture.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/screen/demo-seller", () => {
  it("answers 402 with a PAYMENT-REQUIRED header the batching client can read", async () => {
    const { GET, DEFAULT_DEMO_SELLER_PAYTO } = await import(
      "@/app/api/screen/demo-seller/route"
    );
    const res = await GET(new Request("http://localhost/api/screen/demo-seller"));
    expect(res.status).toBe(402);

    const header = res.headers.get("PAYMENT-REQUIRED");
    expect(header).not.toBeNull();
    const payload = JSON.parse(Buffer.from(header as string, "base64").toString("utf-8"));
    expect(payload.x402Version).toBe(2);
    const option = payload.accepts[0];
    expect(option).toMatchObject({
      scheme: "exact",
      network: `eip155:${CHAIN_CONFIGS.arcTestnet.chain.id}`,
      asset: CHAIN_CONFIGS.arcTestnet.usdc,
      payTo: DEFAULT_DEMO_SELLER_PAYTO,
      extra: {
        name: "GatewayWalletBatched",
        version: "1",
        verifyingContract: CHAIN_CONFIGS.arcTestnet.gatewayWallet,
      },
    });
    // The default payee is the documented OFAC SDN address, never a
    // participant's wallet.
    expect(option.payTo).toBe("0x098B716B8Aaf21512996dC57EB0615e2383E2f96");
  });

  it("lets X402_DEMO_SELLER_PAYTO choose the payee and ignores a malformed one", async () => {
    vi.stubEnv("X402_DEMO_SELLER_PAYTO", "0x2222222222222222222222222222222222222222");
    const { demoSellerPayTo, DEFAULT_DEMO_SELLER_PAYTO } = await import(
      "@/app/api/screen/demo-seller/route"
    );
    expect(demoSellerPayTo()).toBe("0x2222222222222222222222222222222222222222");
    vi.stubEnv("X402_DEMO_SELLER_PAYTO", "not-an-address");
    expect(demoSellerPayTo()).toBe(DEFAULT_DEMO_SELLER_PAYTO);
  });

  it("never accepts a payment: POST is 402 too", async () => {
    const { POST } = await import("@/app/api/screen/demo-seller/route");
    const res = await POST(
      new Request("http://localhost/api/screen/demo-seller", {
        method: "POST",
        headers: { "PAYMENT-SIGNATURE": "anything" },
      }),
    );
    expect(res.status).toBe(402);
  });
});
