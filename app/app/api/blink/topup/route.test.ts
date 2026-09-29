import { describe, it, expect, afterEach, vi } from "vitest";

// The testnet faucet puts new test USDC into play, so KILL_BASE_MONEY_IN
// (Andre, 2026-09-30) refuses it before any read, reservation or credit.

const credit = vi.fn();
const treasury = vi.fn(async () => 10_000_000_000n);
vi.mock("@/lib/server/balance", () => ({
  credit: (...args: unknown[]) => credit(...args),
  getBalance: vi.fn(async () => 0n),
}));
vi.mock("@/app/api/_money/treasury-balance", () => ({
  treasuryUsdcBalanceUusdc: () => treasury(),
}));

const ADDRESS = "0x1111111111111111111111111111111111111111";

async function post(body: unknown): Promise<Response> {
  vi.resetModules();
  const { POST } = await import("@/app/api/blink/topup/route");
  return POST(
    new Request("http://localhost/api/blink/topup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/blink/topup with new money paused", () => {
  it("refuses with plain copy and touches nothing", async () => {
    vi.stubEnv("KILL_BASE_MONEY_IN", "1");
    const res = await post({ address: ADDRESS });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/paused/);
    expect(body.error).toContain("Nothing was credited.");
    expect(body.error).not.toMatch(/KILL_|[!—]/);
    expect(treasury).not.toHaveBeenCalled();
    expect(credit).not.toHaveBeenCalled();
  });

  it("goes on to its usual checks with the switch off (regression)", async () => {
    vi.stubEnv("KILL_BASE_MONEY_IN", "");
    const res = await post({ address: "not-an-address" });
    expect(res.status).toBe(400);
  });
});
