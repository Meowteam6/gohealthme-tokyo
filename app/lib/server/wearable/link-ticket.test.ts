import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The ticket is the only thing standing between an OAuth redirect and anyone
// binding their own WHOOP account to a stranger's wallet, so what is pinned
// here is that it cannot be forged, replayed past its expiry, or read under a
// different signing key.

const KEY = Buffer.alloc(32, 3).toString("base64");
const ADDRESS = "0x1111111111111111111111111111111111111111";

const { mintLinkTicket, readLinkTicket } = await import(
  "@/lib/server/wearable/link-ticket"
);

beforeEach(() => {
  vi.stubEnv("WEARABLE_TOKEN_KEY", KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("mintLinkTicket / readLinkTicket", () => {
  it("round-trips the address it was minted for", () => {
    expect(readLinkTicket(mintLinkTicket(ADDRESS))).toBe(ADDRESS.toLowerCase());
  });

  it("normalises the address to lowercase", () => {
    expect(readLinkTicket(mintLinkTicket(ADDRESS.toUpperCase()))).toBe(
      ADDRESS.toLowerCase(),
    );
  });

  it("refuses a ticket whose payload was swapped for another address", () => {
    const ticket = mintLinkTicket(ADDRESS);
    const [, signature] = ticket.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({
        a: "0x2222222222222222222222222222222222222222",
        e: Date.now() + 60_000,
      }),
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(readLinkTicket(`${forgedPayload}.${signature}`)).toBeNull();
  });

  it("refuses a ticket signed under a different key", () => {
    const ticket = mintLinkTicket(ADDRESS);
    vi.stubEnv("WEARABLE_TOKEN_KEY", Buffer.alloc(32, 9).toString("base64"));
    expect(readLinkTicket(ticket)).toBeNull();
  });

  it("refuses a malformed ticket rather than throwing", () => {
    expect(readLinkTicket("")).toBeNull();
    expect(readLinkTicket("no-dot")).toBeNull();
    expect(readLinkTicket("a.b.c")).toBeNull();
    expect(readLinkTicket("!!!.???")).toBeNull();
  });

  it("expires, so a leaked link cannot be replayed indefinitely", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T12:00:00Z"));
    const ticket = mintLinkTicket(ADDRESS);

    vi.setSystemTime(new Date("2026-06-22T12:09:00Z"));
    expect(readLinkTicket(ticket)).toBe(ADDRESS.toLowerCase());

    vi.setSystemTime(new Date("2026-06-22T12:11:00Z"));
    expect(readLinkTicket(ticket)).toBeNull();
  });

  it("does not carry a usable secret - the payload is signed, not encrypted", () => {
    // Stated as an explicit expectation so nobody later puts anything
    // sensitive in it: the ticket is readable by anyone holding it.
    const ticket = mintLinkTicket(ADDRESS);
    const decoded = JSON.parse(
      Buffer.from(ticket.split(".")[0], "base64").toString("utf8"),
    ) as Record<string, unknown>;
    expect(Object.keys(decoded).sort()).toEqual(["a", "e"]);
  });
});
