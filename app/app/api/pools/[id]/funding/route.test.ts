import { describe, it, expect, vi, beforeEach } from "vitest";

// The run page tells a reward challenge from a backed stake on yourself by
// the creator's seed, which needs what backers added. This route hands the
// browser the same PoolFunded sum the challenge link page reads on the
// server, and never a figure it could not read.

const fetchPoolFunding = vi.fn();
vi.mock("@/lib/server/pool-funders", () => ({
  fetchPoolFunding: (poolId: bigint) => fetchPoolFunding(poolId),
}));

const { GET } = await import("@/app/api/pools/[id]/funding/route");
const { ContractNotConfiguredError } = await import("@/lib/contract");

const request = new Request("http://localhost/api/pools/7/funding");
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  fetchPoolFunding.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/pools/[id]/funding", () => {
  it("serialises the top-up sum and the funders of the pool asked for", async () => {
    fetchPoolFunding.mockResolvedValue({
      total: 3_000_000n,
      funders: ["0x1111000000000000000000000000000000000001"],
    });
    const res = await GET(request, ctx("7"));
    expect(res.status).toBe(200);
    expect(fetchPoolFunding).toHaveBeenCalledWith(7n);
    expect(await res.json()).toEqual({
      total: "3000000",
      funders: ["0x1111000000000000000000000000000000000001"],
    });
    expect(res.headers.get("cache-control")).toContain("s-maxage=60");
  });

  it("refuses a run number that is not one, before any scan", async () => {
    for (const id of ["abc", "0", "-3", ""]) {
      const res = await GET(request, ctx(id));
      expect(res.status).toBe(400);
    }
    expect(fetchPoolFunding).not.toHaveBeenCalled();
  });

  it("names no env var when the contract is not configured", async () => {
    fetchPoolFunding.mockRejectedValue(new ContractNotConfiguredError());
    const res = await GET(request, ctx("7"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Runs are not open on this build yet.");
  });

  it("answers 502 with no infrastructure detail when the scan fails", async () => {
    fetchPoolFunding.mockRejectedValue(new Error("HTTP request failed. URL: https://rpc.example/secret"));
    const res = await GET(request, ctx("7"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.total).toBeUndefined();
    expect(body.error).toMatch(/Reference pool-funding-/);
    expect(body.error).not.toMatch(/rpc\.example/);
  });
});
