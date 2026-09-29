import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChallengesHealth } from "@/lib/server/challenges";

let health: ChallengesHealth = { ok: true, contract: "0x" + "a".repeat(40) };
let healthReads = 0;

vi.mock("@/lib/server/challenges", () => ({
  CHALLENGES_UNAVAILABLE_MESSAGE:
    "Challenges are not live on this build yet. Nothing was charged.",
  checkChallengesHealth: async () => {
    healthReads += 1;
    return health;
  },
}));

async function get(): Promise<Response> {
  const { GET } = await import("@/app/api/challenges/health/route");
  return GET();
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.unstubAllEnvs();
  healthReads = 0;
});

describe("GET /api/challenges/health", () => {
  it("returns ok when the store can take a dare", async () => {
    health = { ok: true, contract: "0x" + "a".repeat(40) };
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 503 with player copy and no reason code or env name", async () => {
    health = { ok: false, code: "no-database" };
    const res = await get();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Nothing was charged");
    expect(JSON.stringify(body)).not.toContain("no-database");
    expect(JSON.stringify(body)).not.toMatch(/SUPABASE|HEALTH_POOLS/);
  });
});

// KILL_BASE_MONEY_IN (Andre, 2026-09-30): the create form's preflight is the
// check that gates money, so a paused build stops a new challenge here,
// before the deposit, in plain words.
describe("GET /api/challenges/health with new money paused", () => {
  it("refuses with the paused copy before reading the store", async () => {
    vi.stubEnv("KILL_BASE_MONEY_IN", "1");
    health = { ok: true, contract: "0x" + "a".repeat(40) };
    const res = await get();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { ok: boolean; paused?: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.paused).toBe(true);
    expect(body.error).toMatch(/paused/);
    expect(body.error).toContain("Money already in still pays out and refunds as normal.");
    expect(body.error).toContain("Nothing was charged.");
    expect(JSON.stringify(body)).not.toMatch(/KILL_/);
    expect(healthReads).toBe(0);
  });

  it("carries the operator's reason", async () => {
    vi.stubEnv("KILL_BASE_MONEY_IN", "true");
    vi.stubEnv("KILL_REASON", "Back after the upgrade on Friday.");
    const body = (await (await get()).json()) as { error: string };
    expect(body.error).toMatch(/Back after the upgrade on Friday\.$/);
  });

  it("is unchanged with the switch off (regression)", async () => {
    vi.stubEnv("KILL_BASE_MONEY_IN", "0");
    health = { ok: true, contract: "0x" + "a".repeat(40) };
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(healthReads).toBe(1);
  });
});

