import { describe, it, expect, vi, beforeEach } from "vitest";

// A failed outcome scan must never reach a sponsor as {totals:{}}: the console
// would render that as $0.00 funded and "Fewer than 5" for a busy pool.

const fetchPoolEventTotals = vi.fn();
vi.mock("@/lib/sponsor-data", () => ({
  fetchPoolEventTotals: () => fetchPoolEventTotals(),
}));

const { GET } = await import("@/app/api/sponsor/outcomes/route");
const { ContractNotConfiguredError } = await import("@/lib/contract");

beforeEach(() => {
  fetchPoolEventTotals.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/sponsor/outcomes", () => {
  it("serialises totals on success", async () => {
    fetchPoolEventTotals.mockResolvedValue({
      "1": { joined: 7, completions: 3, paidUsdc: 5_000_000n, toppedUpUsdc: 1n },
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      totals: { "1": { joined: 7, completions: 3, paidUsdc: "5000000", toppedUpUsdc: "1" } },
    });
  });

  it("answers 503 with a plain line when the scan fails, never an empty map", async () => {
    fetchPoolEventTotals.mockRejectedValue(new Error("HTTP request failed. URL: https://rpc.example/secret"));
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.totals).toBeUndefined();
    expect(body.error).toMatch(/could not be read/);
    expect(body.error).not.toMatch(/rpc\.example/);
  });

  it("names no env var when the contract is not configured", async () => {
    fetchPoolEventTotals.mockRejectedValue(new ContractNotConfiguredError());
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Runs are not open on this build yet.");
  });
});
