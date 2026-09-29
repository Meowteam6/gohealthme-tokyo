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
  it("refuses mock on a production deployment: off, with a problem string", async () => {
    const { worldSetup, worldEnabled } = await load({
      WORLD_VERIFY_MODE: "mock",
      VERCEL_ENV: "production",
    });
    const setup = worldSetup();
    expect(setup.mode).toBe("off");
    expect(setup.problem).toMatch(/refused on a production deployment/);
    expect(worldEnabled()).toBe(false);
  });

  it("refuses live on staging (the simulator) on a production deployment", async () => {
    const { worldSetup, worldNamespace, playerWorldProblem } = await load({
      WORLD_VERIFY_MODE: "live",
      WORLD_APP_ID: "app_abc",
      WORLD_RP_ID: "rp_abc",
      WORLD_RP_SIGNING_KEY: "0x11",
      WORLD_ENVIRONMENT: "",
      VERCEL_ENV: "production",
    });
    const setup = worldSetup();
    expect(setup.mode).toBe("off");
    expect(setup.problem).toMatch(/WORLD_ENVIRONMENT must be production/);
    expect(worldNamespace(setup)).toBeNull();
    // The player never sees the env var name.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const line = playerWorldProblem(setup, "cid-1");
    expect(line).not.toMatch(/WORLD_|VERCEL_/);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("WORLD_ENVIRONMENT"));
    spy.mockRestore();
  });

  it("runs live production on a production deployment, in its own namespace", async () => {
    const { worldSetup, worldNamespace } = await load({
      WORLD_VERIFY_MODE: "live",
      WORLD_APP_ID: "app_abc",
      WORLD_RP_ID: "rp_abc",
      WORLD_RP_SIGNING_KEY: "0x11",
      WORLD_ENVIRONMENT: "production",
      VERCEL_ENV: "production",
    });
    expect(worldSetup().mode).toBe("live");
    expect(worldNamespace()).toBe("live-production");
  });

  it("namespaces mock and live-staging apart on a preview", async () => {
    const mock = await load({ WORLD_VERIFY_MODE: "mock", VERCEL_ENV: "preview" });
    expect(mock.worldNamespace()).toBe("mock");
    const live = await load({
      WORLD_VERIFY_MODE: "live",
      WORLD_APP_ID: "app_abc",
      WORLD_RP_ID: "rp_abc",
      WORLD_RP_SIGNING_KEY: "0x11",
      WORLD_ENVIRONMENT: "staging",
      VERCEL_ENV: "preview",
    });
    expect(live.worldNamespace()).toBe("live-staging");
  });

  it("keeps mock on a preview deployment", async () => {
    const { worldSetup } = await load({ WORLD_VERIFY_MODE: "mock", VERCEL_ENV: "preview" });
    expect(worldSetup().mode).toBe("mock");
  });

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

// KILL_WORLD_ID (Andre, 2026-09-30): the operator can pause World ID without a
// code change. Every reader of worldSetup follows (verify refuses new proofs,
// rp-context is off, the lobby shows the list path), while the bindings World
// already made keep counting (boundWorldNamespace, access.ts).
describe("the World ID kill switch", () => {
  const LIVE = {
    WORLD_VERIFY_MODE: "live",
    WORLD_APP_ID: "app_abc",
    WORLD_RP_ID: "rp_abc",
    WORLD_RP_SIGNING_KEY: "0x11",
  };

  it("turns a working live setup off, marked paused, with no config in the problem", async () => {
    const { worldSetup, worldEnabled, worldNamespace } = await load({ ...LIVE, KILL_WORLD_ID: "1" });
    const setup = worldSetup();
    expect(setup.mode).toBe("off");
    expect(setup.paused).toBe(true);
    expect(setup.problem).not.toBeNull();
    expect(setup.live).toBeNull();
    expect(worldEnabled()).toBe(false);
    expect(worldNamespace(setup)).toBeNull();
  });

  it("turns mock off too", async () => {
    const { worldSetup } = await load({ WORLD_VERIFY_MODE: "mock", KILL_WORLD_ID: "true" });
    expect(worldSetup()).toMatchObject({ mode: "off", paused: true });
  });

  it("tells a player it is paused, plainly, and logs no error for a deliberate pause", async () => {
    const { worldSetup, playerWorldProblem, PLAYER_WORLD_PAUSED } = await load({ ...LIVE, KILL_WORLD_ID: "1" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const line = playerWorldProblem(worldSetup(), "cid-2");
    expect(line).toBe(PLAYER_WORLD_PAUSED);
    expect(line).not.toMatch(/KILL_|WORLD_|VERCEL_|[!\u2014]/);
    expect(line).toMatch(/paused/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("keeps the namespace existing bindings live in while paused", async () => {
    const { boundWorldNamespace } = await load({ ...LIVE, KILL_WORLD_ID: "1" });
    expect(boundWorldNamespace()).toBe("live-staging");
    const mock = await load({ WORLD_VERIFY_MODE: "mock", KILL_WORLD_ID: "1", VERCEL_ENV: "" });
    expect(mock.boundWorldNamespace()).toBe("mock");
  });

  it("has no bound namespace when World was never configured", async () => {
    const { boundWorldNamespace, worldSetup } = await load({ WORLD_VERIFY_MODE: "", KILL_WORLD_ID: "1" });
    expect(boundWorldNamespace()).toBeNull();
    expect(worldSetup()).toMatchObject({ mode: "off", problem: null });
  });

  it("changes nothing when the switch is off (regression)", async () => {
    const { worldSetup, boundWorldNamespace } = await load({ ...LIVE, KILL_WORLD_ID: "" });
    expect(worldSetup().mode).toBe("live");
    expect(worldSetup().paused).toBeUndefined();
    expect(boundWorldNamespace()).toBe("live-staging");
    const zero = await load({ ...LIVE, KILL_WORLD_ID: "0" });
    expect(zero.worldSetup().mode).toBe("live");
  });
});
