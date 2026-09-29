import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";

// requireHuman is what the money-adjacent routes call. Off means a no-op
// that says so; on means a bare wallet is refused with the reason the UI
// shows, and a bound wallet passes.

const A = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";
const B = "0x2222222222222222222222222222222222222222";
const ADMIN = "0x3333333333333333333333333333333333333333";

async function load(mode: string) {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "world-req-")));
  vi.stubEnv("WORLD_VERIFY_MODE", mode);
  vi.resetModules();
  const human = await import("@/lib/server/world/human");
  const req = await import("@/lib/server/world/require-human");
  return { human, req };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requireHuman", () => {
  it("passes everyone, unenforced, when WORLD_VERIFY_MODE is unset", async () => {
    const { req } = await load("");
    expect(await req.requireHuman(A)).toEqual({ ok: true, enforced: false });
    expect(await req.requireHuman("garbage")).toEqual({ ok: true, enforced: false });
  });

  it("refuses an unverified wallet with the plain reason when the mode is on", async () => {
    const { req } = await load("mock");
    const result = await req.requireHuman(B);
    expect(result).toEqual({
      ok: false,
      status: 403,
      reason: req.HUMAN_REQUIRED_REASON,
    });
    expect(await req.requireHuman("garbage")).toMatchObject({ ok: false, status: 403 });
  });

  it("passes a verified wallet, enforced, when the mode is on", async () => {
    vi.stubEnv("WORLD_APP_ID", "app_test");
    vi.stubEnv("WORLD_RP_ID", "rp_test");
    vi.stubEnv("WORLD_RP_SIGNING_KEY", "0x11");
    const { human, req } = await load("live");
    await human.bindHuman({
      address: A,
      nullifierHash: `0x${"1".padStart(64, "0")}`,
      mode: "live",
      protocolVersion: "4.0",
    });
    expect(await req.requireHuman(A)).toEqual({ ok: true, enforced: true });
    expect(await req.requireHuman(A.toLowerCase())).toEqual({ ok: true, enforced: true });
  });

  // The list path (Andre, 2026-09-30): with World on, "No World ID? Ask for a
  // spot on the list instead" led to a player who got in and then could not
  // play a single challenge. An admin and an approved list entry count as a
  // proven human too; World stays the self-serve way.
  it("passes an admin and an approved list entry, enforced, when the mode is on", async () => {
    vi.stubEnv("ADMIN_ADDRESSES", ADMIN);
    const { req } = await load("mock");
    const access = await import("@/lib/server/access");
    expect(await req.requireHuman(ADMIN)).toEqual({ ok: true, enforced: true });

    await access.requestAccess({ address: B });
    expect(await req.requireHuman(B)).toMatchObject({ ok: false, status: 403 });
    await access.decideAccess({ address: B, decision: "approve", adminAddress: ADMIN });
    expect(await req.requireHuman(B)).toEqual({ ok: true, enforced: true });
  });

  it("refuses a pending or denied list entry when the mode is on", async () => {
    vi.stubEnv("ADMIN_ADDRESSES", ADMIN);
    const { req } = await load("mock");
    const access = await import("@/lib/server/access");
    await access.requestAccess({ address: B });
    expect(await req.requireHuman(B)).toMatchObject({ ok: false, status: 403 });
    await access.decideAccess({ address: B, decision: "deny", adminAddress: ADMIN });
    expect(await req.requireHuman(B)).toMatchObject({ ok: false, status: 403 });
  });

  it("is a no-op while World is paused by the kill switch, so SPOTTER keeps paying", async () => {
    vi.stubEnv("KILL_WORLD_ID", "1");
    const { req } = await load("mock");
    expect(await req.requireHuman(B)).toEqual({ ok: true, enforced: false });
  });
});
