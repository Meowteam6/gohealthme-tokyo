import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";

// The access gate decides who gets into the closed beta, so these tests pin the
// two things that must not drift: idempotency (a re-request never resets a
// decision or a queue) and fail-closed enforcement (isAllowed is false for
// anyone not explicitly approved). A fresh temp DATA_DIR per load isolates the
// file-fallback store the same way the claims tests do.

const ADMIN = "0x1111111111111111111111111111111111111111";
const USER = "0x2222222222222222222222222222222222222222";
const OTHER = "0x3333333333333333333333333333333333333333";

async function load(admins = "") {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "access-")));
  vi.stubEnv("ADMIN_ADDRESSES", admins);
  vi.resetModules();
  return await import("@/lib/server/access");
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("admin designation", () => {
  it("recognises an admin address regardless of case, and no one else", async () => {
    const access = await load(ADMIN.toUpperCase().replace("0X", "0x"));
    expect(access.isAdmin(ADMIN)).toBe(true);
    expect(access.isAdmin(USER)).toBe(false);
    expect(access.isAdmin("not-an-address")).toBe(false);
    expect(access.isAdmin(null)).toBe(false);
  });

  it("has no admins when ADMIN_ADDRESSES is empty (gate stays closed)", async () => {
    const access = await load("");
    expect(access.isAdmin(ADMIN)).toBe(false);
    expect(access.adminAddresses()).toEqual([]);
  });

  it("parses a comma/space separated list and ignores invalid entries", async () => {
    const access = await load(`${ADMIN}, garbage ${OTHER}`);
    expect(access.adminAddresses()).toHaveLength(2);
    expect(access.isAdmin(ADMIN)).toBe(true);
    expect(access.isAdmin(OTHER)).toBe(true);
  });
});

describe("status view", () => {
  it("reports an unknown wallet as none / not-admin", async () => {
    const access = await load("");
    expect(await access.getAccessStatus(USER)).toEqual({
      status: "none",
      isAdmin: false,
      source: "none",
    });
  });

  it("reports an admin wallet as approved without any stored request", async () => {
    const access = await load(ADMIN);
    expect(await access.getAccessStatus(ADMIN)).toEqual({
      status: "approved",
      isAdmin: true,
      source: "admin",
    });
  });

  it("reports a stored request with source request", async () => {
    const access = await load("");
    await access.requestAccess({ address: USER });
    expect(await access.getAccessStatus(USER)).toEqual({
      status: "pending",
      isAdmin: false,
      source: "request",
    });
  });
});

describe("approval by World ID (prove-human)", () => {
  const NULLIFIER = `0x${"7".padStart(64, "0")}`;

  async function loadWithWorld(mode: string, admins = "") {
    vi.stubEnv("WORLD_VERIFY_MODE", mode);
    const access = await load(admins);
    const human = await import("@/lib/server/world/human");
    return { access, human };
  }

  it("counts a proven human as approved, source world, when the mode is on", async () => {
    const { access, human } = await loadWithWorld("mock");
    expect(await access.isAllowed(USER)).toBe(false);
    await human.bindHuman({
      address: USER,
      nullifierHash: NULLIFIER,
      mode: "mock",
      protocolVersion: "4.0",
    });
    expect(await access.getAccessStatus(USER)).toEqual({
      status: "approved",
      isAdmin: false,
      source: "world",
    });
    expect(await access.isAllowed(USER)).toBe(true);
    // A wallet that has not proven anything is still outside.
    expect(await access.isAllowed(OTHER)).toBe(false);
    expect((await access.getAccessStatus(OTHER)).status).toBe("none");
  });

  it("ignores the human record when the mode is unset (allowlist behaviour unchanged)", async () => {
    const { access, human } = await loadWithWorld("");
    await human.bindHuman({
      address: USER,
      nullifierHash: NULLIFIER,
      mode: "mock",
      protocolVersion: "4.0",
    });
    expect(await access.getAccessStatus(USER)).toEqual({
      status: "none",
      isAdmin: false,
      source: "none",
    });
    expect(await access.isAllowed(USER)).toBe(false);
  });

  it("keeps the admin allowlist as the owner switch alongside World", async () => {
    const { access } = await loadWithWorld("mock", ADMIN);
    expect(await access.getAccessStatus(ADMIN)).toEqual({
      status: "approved",
      isAdmin: true,
      source: "admin",
    });
    expect(await access.isAllowed(ADMIN)).toBe(true);
  });

  it("does not let a World approval overwrite a stored denial record", async () => {
    const { access, human } = await loadWithWorld("mock", ADMIN);
    await access.requestAccess({ address: USER });
    await access.decideAccess({ address: USER, decision: "deny", adminAddress: ADMIN });
    await human.bindHuman({
      address: USER,
      nullifierHash: NULLIFIER,
      mode: "mock",
      protocolVersion: "4.0",
    });
    // The proven human is let in (the World step is the new door), but the
    // admin's record is still there for when the mode is turned off.
    expect((await access.getAccessStatus(USER)).source).toBe("world");
    expect((await access.getAccessRecord(USER))?.status).toBe("denied");
  });
});

describe("requestAccess idempotency", () => {
  it("opens a fresh request as pending and records the fields", async () => {
    const access = await load("");
    const result = await access.requestAccess({
      address: USER,
      name: "Jane",
      email: "jane@example.com",
      reason: "group chat",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.status).toBe("pending");
      expect(result.record.name).toBe("Jane");
      expect(result.record.email).toBe("jane@example.com");
    }
    expect(await access.getAccessStatus(USER)).toEqual({
      status: "pending",
      isAdmin: false,
      source: "request",
    });
  });

  it("does not reset a pending request on re-submit", async () => {
    const access = await load("");
    await access.requestAccess({ address: USER, name: "First", reason: "a" });
    const again = await access.requestAccess({
      address: USER,
      name: "Second",
      reason: "b",
    });
    expect(again.ok).toBe(true);
    if (again.ok) {
      // The original request survives; the second submit is a no-op.
      expect(again.record.name).toBe("First");
      expect(again.record.status).toBe("pending");
    }
  });

  it("returns the approval unchanged when an approved user re-requests", async () => {
    const access = await load(ADMIN);
    await access.requestAccess({ address: USER, name: "Jane" });
    await access.decideAccess({
      address: USER,
      decision: "approve",
      adminAddress: ADMIN,
    });
    const again = await access.requestAccess({ address: USER, name: "Jane again" });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.record.status).toBe("approved");
  });

  it("lets a denied user re-open a pending request", async () => {
    const access = await load(ADMIN);
    await access.requestAccess({ address: USER });
    await access.decideAccess({
      address: USER,
      decision: "deny",
      adminAddress: ADMIN,
    });
    expect((await access.getAccessStatus(USER)).status).toBe("denied");
    const reopened = await access.requestAccess({ address: USER, reason: "please" });
    expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(reopened.record.status).toBe("pending");
  });
});

describe("decideAccess", () => {
  it("404s when there is no request to decide", async () => {
    const access = await load(ADMIN);
    const result = await access.decideAccess({
      address: USER,
      decision: "approve",
      adminAddress: ADMIN,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  it("records who decided and when", async () => {
    const access = await load(ADMIN);
    await access.requestAccess({ address: USER });
    const result = await access.decideAccess({
      address: USER,
      decision: "approve",
      adminAddress: ADMIN,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.status).toBe("approved");
      expect(result.record.decidedAt).not.toBeNull();
      expect(result.record.decidedBy).not.toBeNull();
    }
  });
});

describe("isAllowed fails closed", () => {
  it("allows admins and approved users, and no one else", async () => {
    const access = await load(ADMIN);
    // admin: always
    expect(await access.isAllowed(ADMIN)).toBe(true);
    // pending: no
    await access.requestAccess({ address: USER });
    expect(await access.isAllowed(USER)).toBe(false);
    // approved: yes
    await access.decideAccess({
      address: USER,
      decision: "approve",
      adminAddress: ADMIN,
    });
    expect(await access.isAllowed(USER)).toBe(true);
    // never-seen and invalid: no
    expect(await access.isAllowed(OTHER)).toBe(false);
    expect(await access.isAllowed("nope")).toBe(false);
    expect(await access.isAllowed(null)).toBe(false);
  });

  it("keeps a denied user out", async () => {
    const access = await load(ADMIN);
    await access.requestAccess({ address: USER });
    await access.decideAccess({
      address: USER,
      decision: "deny",
      adminAddress: ADMIN,
    });
    expect(await access.isAllowed(USER)).toBe(false);
  });
});

describe("listAccessRequests", () => {
  it("returns every request", async () => {
    const access = await load("");
    await access.requestAccess({ address: USER, name: "A" });
    await access.requestAccess({ address: OTHER, name: "B" });
    const list = await access.listAccessRequests();
    expect(list).toHaveLength(2);
    expect(list.map((r) => r.name).sort()).toEqual(["A", "B"]);
  });
});

// The geo gate is the compliance requirement: a resident of a state excluded
// from the self-staked pilot must never enter the queue, and the refusal is
// server-side (requestAccess), not merely the client form. These pin fail-closed
// behaviour (a blocked state is rejected AND persists nothing) and the happy path
// (an allowed state is accepted and its state is stored on the record).
describe("geo compliance fail-closed", () => {
  it("rejects a request from a blocked state (CO) with 403 and persists nothing", async () => {
    const access = await load("");
    const result = await access.requestAccess({ address: USER, state: "CO" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    // Nothing was written: the requester never enters the queue.
    expect((await access.getAccessStatus(USER)).status).toBe("none");
    expect(await access.listAccessRequests()).toHaveLength(0);
  });

  it("rejects a blocked state given by full name too", async () => {
    const access = await load("");
    const result = await access.requestAccess({ address: USER, state: "Colorado" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("accepts a request from an allowed state (CA) and persists the state", async () => {
    const access = await load("");
    const result = await access.requestAccess({ address: USER, state: "CA" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.status).toBe("pending");
      expect(result.record.state).toBe("CA");
    }
    expect((await access.getAccessStatus(USER)).status).toBe("pending");
  });
});
