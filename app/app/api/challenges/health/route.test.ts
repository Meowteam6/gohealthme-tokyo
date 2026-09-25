import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChallengesHealth } from "@/lib/server/challenges";

let health: ChallengesHealth = { ok: true, contract: "0x" + "a".repeat(40) };

vi.mock("@/lib/server/challenges", () => ({
  CHALLENGES_UNAVAILABLE_MESSAGE:
    "Dares are not live on this build yet. Nothing was charged.",
  checkChallengesHealth: async () => health,
}));

async function get(): Promise<Response> {
  const { GET } = await import("@/app/api/challenges/health/route");
  return GET();
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
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
