import { describe, it, expect, afterEach, vi } from "vitest";

// GET /api/switches: public, never cached, and nothing but the three fields.

async function get(): Promise<Response> {
  vi.resetModules();
  const { GET } = await import("@/app/api/switches/route");
  return GET();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/switches", () => {
  it("reports both switches off by default, never cached", async () => {
    vi.stubEnv("KILL_WORLD_ID", "");
    vi.stubEnv("KILL_BASE_MONEY_IN", "");
    vi.stubEnv("KILL_REASON", "");
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ worldId: false, baseMoneyIn: false, reason: null });
  });

  it("reports what the operator threw, with the reason", async () => {
    vi.stubEnv("KILL_WORLD_ID", "true");
    vi.stubEnv("KILL_BASE_MONEY_IN", "1");
    vi.stubEnv("KILL_REASON", "Back after the upgrade on Friday.");
    const res = await get();
    expect(await res.json()).toEqual({
      worldId: true,
      baseMoneyIn: true,
      reason: "Back after the upgrade on Friday.",
    });
  });

  it("never carries anything but the three fields", async () => {
    vi.stubEnv("KILL_WORLD_ID", "1");
    vi.stubEnv("WORLD_RP_SIGNING_KEY", "0xsecret");
    const body = (await (await get()).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["baseMoneyIn", "reason", "worldId"]);
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
