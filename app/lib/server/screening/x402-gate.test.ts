import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";

// The agent-to-agent side of the gate: SPOTTER's x402 buy screens the
// seller's payTo before gw.pay() signs. Pinned with a fake GatewayClient and
// a fake Intercepta fetch: a sanctioned seller is refused before any
// authorization, an unscreenable one is held, a clean one is paid, and a 402
// that names no recipient is never paid at all.

vi.mock("@circle-fin/x402-batching/client", () => ({
  GatewayClient: vi.fn(),
}));

const SELLER_CLEAN = "0x2222222222222222222222222222222222222222";
// OFAC SDN (Lazarus Group). Fixture only: the fake fetch below decides.
const SELLER_SANCTIONED = "0x098B716B8Aaf21512996dC57EB0615e2383E2f96";
const URL_PAID = "https://seller.example/paid";

async function load() {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "x402-gate-")));
  vi.stubEnv("X402_PRIVATE_KEY", "ab".repeat(32));
  vi.stubEnv("X402_CHAIN_READ_URL", URL_PAID);
  vi.stubEnv("INTERCEPTA_API_KEY", "test-key");
  vi.resetModules();
  return import("@/lib/server/agent/x402");
}

function interceptaFetch(traitsByAddress: Record<string, string[] | "down">) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = /account\/(0x[0-9a-fA-F]{40})\/quick-scan/.exec(url);
    const entry = match === null ? undefined : traitsByAddress[match[1].toLowerCase()];
    if (entry === undefined || entry === "down") {
      return new Response("{}", { status: 503 });
    }
    return new Response(
      JSON.stringify({
        toxicScore: entry.length === 0 ? 0 : 99,
        traits: entry.map((name) => ({ name, risk: 3, txsCount: 1, description: "prose" })),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
}

async function gatewayWith(payTo: string | undefined) {
  const { GatewayClient } = await import("@circle-fin/x402-batching/client");
  const supports = vi.fn().mockResolvedValue({
    supported: true,
    requirements: payTo === undefined ? { amount: "1000" } : { amount: "1000", payTo },
  });
  const pay = vi.fn().mockResolvedValue({
    amount: 1000n,
    transaction: "0xgateway",
    data: { ok: true },
  });
  vi.mocked(GatewayClient).mockImplementation(function (this: unknown) {
    return { supports, pay } as unknown as InstanceType<typeof GatewayClient>;
  });
  return { supports, pay };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("x402 seller screening", () => {
  it("carries the seller's payTo on the quote", async () => {
    const x402 = await load();
    await gatewayWith(SELLER_CLEAN.toLowerCase());
    const quote = await x402.liveBuyDeps().quoteChainRead();
    expect(quote.url).toBe(URL_PAID);
    expect(quote.payee).toBe(SELLER_CLEAN);
  });

  it("refuses a sanctioned seller before gw.pay() is ever called", async () => {
    const x402 = await load();
    const gw = await gatewayWith(SELLER_SANCTIONED);
    const fetchMock = interceptaFetch({
      [SELLER_SANCTIONED.toLowerCase()]: ["sanction_address"],
    });
    vi.stubGlobal("fetch", fetchMock);

    const deps = x402.liveBuyDeps();
    const quote = await deps.quoteChainRead();
    await expect(deps.buy(quote, { jsonrpc: "2.0" })).rejects.toThrow(
      /payout held by screening: Intercepta blocked .* at x402\. Intercepta flagged sanction_address/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(gw.pay).not.toHaveBeenCalled();
  });

  it("holds the purchase when Intercepta is down: nothing is signed", async () => {
    const x402 = await load();
    const gw = await gatewayWith(SELLER_CLEAN);
    vi.stubGlobal("fetch", interceptaFetch({ [SELLER_CLEAN.toLowerCase()]: "down" }));

    const deps = x402.liveBuyDeps();
    const quote = await deps.quoteChainRead();
    await expect(deps.buy(quote, {})).rejects.toThrow(/Intercepta unavailable/);
    expect(gw.pay).not.toHaveBeenCalled();
  });

  it("pays a clean seller after the live screen", async () => {
    const x402 = await load();
    const gw = await gatewayWith(SELLER_CLEAN);
    vi.stubGlobal("fetch", interceptaFetch({ [SELLER_CLEAN.toLowerCase()]: [] }));

    const deps = x402.liveBuyDeps();
    const quote = await deps.quoteChainRead();
    const result = await deps.buy(quote, { jsonrpc: "2.0" });
    expect(gw.pay).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      amountUsd: "0.01",
      settlement: "x402",
      gatewayTx: "0xgateway",
      data: { ok: true },
    });
  });

  it("never pays a 402 that names no recipient", async () => {
    const x402 = await load();
    const gw = await gatewayWith(undefined);
    const fetchMock = interceptaFetch({});
    vi.stubGlobal("fetch", fetchMock);

    const deps = x402.liveBuyDeps();
    const quote = await deps.quoteChainRead();
    expect(quote.payee).toBeUndefined();
    await expect(deps.buy(quote, {})).rejects.toThrow(/no payTo to screen/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(gw.pay).not.toHaveBeenCalled();
  });

  it("still settles prepaid, with no screen, when the quote has no paid endpoint", async () => {
    vi.stubEnv("X402_PRIVATE_KEY", "");
    const x402 = await load();
    vi.stubEnv("X402_PRIVATE_KEY", "");
    const fetchMock = interceptaFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const deps = x402.liveBuyDeps();
    const quote = await deps.quoteChainRead();
    expect(quote.url).toBeNull();
    const result = await deps.buy(quote, {});
    expect(result.settlement).toBe("prepaid");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
