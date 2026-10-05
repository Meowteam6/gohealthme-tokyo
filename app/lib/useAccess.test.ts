// What the browser keeps from GET /api/access/status. The server says WHY an
// address is approved (`source`: admin, world, request, none). The hook used
// to drop it, so while KILL_WORLD_ID paused World a World-verified player was
// stamped "On the list": the World lane reads off, and an approved status alone
// looks like the list. Keeping `source` lets the card say "One human" for a
// World binding whether or not World is paused right now.

import { describe, it, expect, vi } from "vitest";

// The wallet hook reaches Dynamic's SDK, which has no business in a node test.
vi.mock("@/lib/wallet", () => ({
  useEmbeddedWallet: () => ({ address: null, authenticated: false, ready: false }),
}));

const { parseAccessStatus } = await import("@/lib/useAccess");

describe("parseAccessStatus", () => {
  it("keeps the server's source", () => {
    expect(parseAccessStatus({ status: "approved", isAdmin: false, source: "world" })).toEqual({
      status: "approved",
      isAdmin: false,
      source: "world",
    });
    expect(parseAccessStatus({ status: "approved", isAdmin: false, source: "request" })?.source).toBe(
      "request",
    );
    expect(parseAccessStatus({ status: "approved", isAdmin: true, source: "admin" })?.source).toBe("admin");
    expect(parseAccessStatus({ status: "none", isAdmin: false, source: "none" })?.source).toBe("none");
  });

  it("never invents a World binding from an answer without a source", () => {
    // An older server, or a garbled field: an approved wallet reads as the
    // list (the stamp it always had), an admin as admin, anyone else as none.
    expect(parseAccessStatus({ status: "approved", isAdmin: false })?.source).toBe("request");
    expect(parseAccessStatus({ status: "approved", isAdmin: false, source: "orb" })?.source).toBe("request");
    expect(parseAccessStatus({ status: "approved", isAdmin: true })?.source).toBe("admin");
    expect(parseAccessStatus({ status: "pending", isAdmin: false })?.source).toBe("request");
    expect(parseAccessStatus({ status: "none", isAdmin: false })?.source).toBe("none");
  });

  it("refuses an answer with no usable status, so the gate shows its retry", () => {
    expect(parseAccessStatus(null)).toBeNull();
    expect(parseAccessStatus({})).toBeNull();
    expect(parseAccessStatus({ status: "maybe", isAdmin: false, source: "world" })).toBeNull();
  });

  it("reads isAdmin as a strict boolean", () => {
    expect(parseAccessStatus({ status: "approved", isAdmin: "yes", source: "request" })?.isAdmin).toBe(false);
  });
});
