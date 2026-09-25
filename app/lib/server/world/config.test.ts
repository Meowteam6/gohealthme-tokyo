import { describe, it, expect, vi, afterEach } from "vitest";

// worldSetup decides whether prove-human is enforced at all, so the three
// modes and the two ways a "live" can be misconfigured are pinned here. A
// misconfiguration must resolve to off WITH a problem string, never to a
// half-enabled state and never to a thrown error at import time.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  return await import("@/lib/server/world/config");
}

describe("worldSetup", () => {
  it("is off with no problem when WORLD_VERIFY_MODE is unset", async () => {
    const { worldSetup, worldEnabled } = await load({ WORLD_VERIFY_MODE: "" });
    expect(worldSetup()).toEqual({
      mode: "off",
      action: "prove-human",
      problem: null,
      live: null,
    });
    expect(worldEnabled()).toBe(false);
  });

  it("is mock when asked, with no World credentials needed", async () => {
    const { worldSetup, worldEnabled } = await load({
      WORLD_VERIFY_MODE: "mock",
      WORLD_APP_ID: "",
    });
    expect(worldSetup().mode).toBe("mock");
    expect(worldSetup().problem).toBeNull();
    expect(worldEnabled()).toBe(true);
  });

  it("is live with the Portal values and the staging default", async () => {
    const { worldSetup } = await load({
      WORLD_VERIFY_MODE: "live",
      WORLD_APP_ID: "app_abc",
      WORLD_RP_ID: "rp_abc",
      WORLD_RP_SIGNING_KEY: "0x11",
      WORLD_ENVIRONMENT: "",
    });
    const setup = worldSetup();
    expect(setup.mode).toBe("live");
    expect(setup.live).toEqual({
      appId: "app_abc",
      rpId: "rp_abc",
      signingKeyHex: "0x11",
      action: "prove-human",
      environment: "staging",
    });
  });

  it("falls back to off and names the missing variables for a bare live", async () => {
    const { worldSetup, worldEnabled } = await load({
      WORLD_VERIFY_MODE: "live",
      WORLD_APP_ID: "",
      WORLD_RP_ID: "",
      WORLD_RP_SIGNING_KEY: "",
    });
    const setup = worldSetup();
    expect(setup.mode).toBe("off");
    expect(setup.problem).toContain("WORLD_APP_ID");
    expect(setup.problem).toContain("WORLD_RP_ID");
    expect(setup.problem).toContain("WORLD_RP_SIGNING_KEY");
    expect(worldEnabled()).toBe(false);
  });

  it("rejects an app id that is not app_-prefixed", async () => {
    const { worldSetup } = await load({
      WORLD_VERIFY_MODE: "live",
      WORLD_APP_ID: "rp_wrong",
      WORLD_RP_ID: "rp_abc",
      WORLD_RP_SIGNING_KEY: "0x11",
    });
    expect(worldSetup().mode).toBe("off");
    expect(worldSetup().problem).toContain("WORLD_APP_ID");
  });

  it("treats an unknown mode value as off with a problem", async () => {
    const { worldSetup } = await load({ WORLD_VERIFY_MODE: "yes" });
    expect(worldSetup().mode).toBe("off");
    expect(worldSetup().problem).toContain('"yes"');
  });

  it("honours WORLD_ACTION and WORLD_ENVIRONMENT=production", async () => {
    const { worldSetup, worldEnvironment } = await load({
      WORLD_VERIFY_MODE: "live",
      WORLD_APP_ID: "app_abc",
      WORLD_RP_ID: "rp_abc",
      WORLD_RP_SIGNING_KEY: "0x11",
      WORLD_ACTION: "join-gohealthme",
      WORLD_ENVIRONMENT: "production",
    });
    expect(worldSetup().action).toBe("join-gohealthme");
    expect(worldEnvironment()).toBe("production");
  });
});
