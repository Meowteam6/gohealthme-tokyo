import { beforeEach, describe, expect, it, vi } from "vitest";

// The operator's manual record route. It judges a ROLLING sleep streak with no
// pool period, no sync grace and no coverage check, so it must never write a
// miss: under the commitment model a recorded miss forfeits a stake, and only
// SPOTTER's miss rule (lib/server/agent/miss.ts) may decide one. A pass still
// records exactly as before.

const recordResult = vi.fn();
const recordVerdict = vi.fn();
const participantJoined = vi.fn();
const getProgress = vi.fn();

vi.mock("@/lib/server/oracle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/oracle")>()),
  recordResult: (...args: unknown[]) => recordResult(...args),
}));
vi.mock("@/lib/server/verdict", () => ({
  recordVerdict: (...args: unknown[]) => recordVerdict(...args),
  VERDICT_FACETS: { wearable: 1 },
}));
vi.mock("@/lib/server/pools", () => ({
  participantJoined: (...args: unknown[]) => participantJoined(...args),
}));
vi.mock("@/lib/server/wearable", () => ({
  providerFor: vi.fn(async () => ({
    id: "junction",
    isConnected: vi.fn(async () => true),
    getProgress: (...args: unknown[]) => getProgress(...args),
  })),
}));

const SECRET = "oracle-secret";
const USER = "0x1111111111111111111111111111111111111111";

function post(body: Record<string, unknown>) {
  return new Request("http://localhost/api/oracle/record", {
    method: "POST",
    headers: { "x-oracle-secret": SECRET, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ORACLE_API_SECRET", SECRET);
  participantJoined.mockResolvedValue(true);
  recordResult.mockResolvedValue("0xpass");
  recordVerdict.mockResolvedValue({ status: "recorded" });
});

describe("POST /api/oracle/record", () => {
  it("refuses to write a miss and writes nothing on chain", async () => {
    getProgress.mockResolvedValue({ streakDays: 2, baselineWeekAvg: null });
    const { POST } = await import("@/app/api/oracle/record/route");

    const res = await POST(post({ poolId: 1, address: USER, goalDays: 7 }));

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/SPOTTER/);
    expect(recordResult).not.toHaveBeenCalled();
    expect(recordVerdict).not.toHaveBeenCalled();
  });

  it("still records a pass", async () => {
    getProgress.mockResolvedValue({ streakDays: 7, baselineWeekAvg: null });
    const { POST } = await import("@/app/api/oracle/record/route");

    const res = await POST(post({ poolId: 1, address: USER, goalDays: 7 }));

    expect(res.status).toBe(200);
    expect(recordResult).toHaveBeenCalledWith(1n, USER, true, 10_000n);
  });
});
