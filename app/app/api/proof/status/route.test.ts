import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("GET /api/proof/status", () => {
  it("reports document proof unavailable when no verifier is configured", async () => {
    vi.stubEnv("CONFIDENTIAL_AI_API_KEY", "");
    vi.stubEnv("DEMO_MODE", "");
    const { GET } = await import("@/app/api/proof/status/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      document: { available: false, reason: "no document verifier is configured" },
      wearable: { available: true },
    });
  });
});
