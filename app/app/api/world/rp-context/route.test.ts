import { describe, it, expect, vi, afterEach } from "vitest";
import { generatePrivateKey } from "viem/accounts";

// The rp-context route is the only place the RP signing key is used. Pinned:
// each mode answers with what the widget needs and nothing more, GET never
// mints a signature, and POST in live mode mints a real one with the
// documented 300 s window.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  return await import("@/app/api/world/rp-context/route");
}

describe("/api/world/rp-context", () => {
  it("reports off, with the problem, when the mode is unset or broken", async () => {
    const off = await load({ WORLD_VERIFY_MODE: "" });
    const offBody = await (await off.GET()).json();
    expect(offBody.mode).toBe("off");
    expect(offBody.problem).toMatch(/not switched on/);

    const broken = await load({
      WORLD_VERIFY_MODE: "live",
      WORLD_APP_ID: "",
      WORLD_RP_ID: "",
      WORLD_RP_SIGNING_KEY: "",
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const body = await (await broken.POST()).json();
    expect(body.mode).toBe("off");
    // Player copy on the wire; the env var names go to the server log only.
    expect(body.problem).toMatch(/paused on this build/);
    expect(body.problem).not.toMatch(/WORLD_/);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("WORLD_RP_SIGNING_KEY"));
    spy.mockRestore();
  });

  it("reports mock with the action and no credentials", async () => {
    const route = await load({ WORLD_VERIFY_MODE: "mock", WORLD_ACTION: "" });
    expect(await (await route.POST()).json()).toEqual({
      mode: "mock",
      action: "prove-human",
    });
  });

  it("mints a signed RP context on POST in live mode, and only on POST", async () => {
    const route = await load({
      WORLD_VERIFY_MODE: "live",
      WORLD_APP_ID: "app_test",
      WORLD_RP_ID: "rp_test",
      WORLD_RP_SIGNING_KEY: generatePrivateKey(),
      WORLD_ENVIRONMENT: "staging",
    });

    const viaGet = await (await route.GET()).json();
    expect(viaGet).toEqual({
      mode: "live",
      app_id: "app_test",
      action: "prove-human",
      environment: "staging",
    });

    const viaPost = await (await route.POST()).json();
    expect(viaPost.mode).toBe("live");
    expect(viaPost.rp_context.rp_id).toBe("rp_test");
    expect(viaPost.rp_context.nonce).toMatch(/^0x[0-9a-f]+$/);
    expect(viaPost.rp_context.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(viaPost.rp_context.expires_at - viaPost.rp_context.created_at).toBe(300);
    // The signing key never leaves the server.
    expect(JSON.stringify(viaPost)).not.toContain("signingKey");
  });
});
