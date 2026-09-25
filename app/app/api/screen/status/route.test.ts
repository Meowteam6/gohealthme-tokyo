import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// GET /api/screen/status: reads the ledger, never calls Intercepta, and is
// honest about a deployment that does not screen at all.

const readLedger = vi.fn();

vi.mock("@/lib/server/agent/ledger", () => ({
  readLedger: (...args: unknown[]) => readLedger(...args),
}));

const { GET } = await import("@/app/api/screen/status/route");

const GOAL = "0x" + "ab".repeat(32);
const AT = "2026-09-26T00:00:00.000Z";

function request(goalId: string): Request {
  return new Request(`http://localhost/api/screen/status?goalId=${goalId}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  readLedger.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/screen/status", () => {
  it("rejects a malformed goalId", async () => {
    const res = await GET(request("0x123"));
    expect(res.status).toBe(400);
    expect(readLedger).not.toHaveBeenCalled();
  });

  it("reports unconfigured when no key is set and nothing was screened", async () => {
    const res = await GET(request(GOAL));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "unconfigured" });
  });

  it("reports pending when a key is set but the claim has no screen row yet", async () => {
    vi.stubEnv("INTERCEPTA_API_KEY", "k");
    const res = await GET(request(GOAL));
    expect(await res.json()).toEqual({ status: "pending" });
  });

  it("reports the newest screen row with its reason and time", async () => {
    readLedger.mockResolvedValue([
      {
        kind: "screen",
        at: AT,
        provider: "intercepta",
        purpose: "record",
        address: "0x1111111111111111111111111111111111111111",
        status: "unavailable",
        rule: "r",
        reason: "Intercepta did not answer within 5000ms. Payout held until screening answers.",
        cached: false,
      },
      { kind: "error", at: AT, stage: "record", message: "payout held by screening: ..." },
      {
        kind: "screen",
        at: "2026-09-26T00:05:00.000Z",
        provider: "intercepta",
        purpose: "record",
        address: "0x1111111111111111111111111111111111111111",
        status: "blocked",
        toxicScore: 99,
        traits: ["sanction_address"],
        rule: "r",
        reason: "Intercepta flagged sanction_address (1 tx); toxicScore 99.",
        cached: true,
      },
    ]);
    const res = await GET(request(GOAL));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      status: "blocked",
      reason: "Intercepta flagged sanction_address (1 tx); toxicScore 99.",
      checkedAt: "2026-09-26T00:05:00.000Z",
    });
    expect(readLedger).toHaveBeenCalledWith(GOAL);
  });

  it("answers 500 with a generic message when the store fails", async () => {
    readLedger.mockRejectedValue(new Error("redis down at /secret/path"));
    const res = await GET(request(GOAL));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("/secret/path");
  });
});
