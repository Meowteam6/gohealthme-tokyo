import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// This route is the only thing standing between an OAuth redirect and anyone
// binding their own WHOOP account to a stranger's wallet, and it had no test.
//
// Two invariants, both load-bearing:
//   - the ticket is the ONLY way to name an address. An `address` query param
//     must be ignored, or the signature check at /api/wearable/link is
//     decorative.
//   - the address travels in the httpOnly cookie, never in `state`. `state`
//     comes back through a URL the caller can retype.

const readLinkTicket = vi.fn();
const providerConfigured = vi.fn();
const buildAuthorizeUrl = vi.fn();

vi.mock("@/lib/server/wearable/link-ticket", () => ({
  readLinkTicket: (...args: unknown[]) => readLinkTicket(...args),
}));
vi.mock("@/lib/server/wearable", () => ({
  providerConfigured: (...args: unknown[]) => providerConfigured(...args),
}));
vi.mock("@/lib/server/wearable/whoop", () => ({
  buildAuthorizeUrl: (...args: unknown[]) => buildAuthorizeUrl(...args),
}));

const { GET, WHOOP_NONCE_COOKIE } = await import(
  "@/app/api/whoop/login/route"
);

const OWNER = "0x1111111111111111111111111111111111111111";
const VICTIM = "0x2222222222222222222222222222222222222222";
const AUTHORIZE = "https://api.prod.whoop.com/oauth/oauth2/auth?client_id=x";

function login(query: string): Promise<Response> {
  return GET(new NextRequest(`https://app.test/api/whoop/login${query}`));
}

function cookieOf(res: Response): string {
  return res.headers.get("set-cookie") ?? "";
}

function outcomeOf(res: Response): string | null {
  return new URL(res.headers.get("location") ?? "https://x/").searchParams.get(
    "whoop",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  providerConfigured.mockReturnValue(true);
  readLinkTicket.mockReturnValue(OWNER);
  buildAuthorizeUrl.mockReturnValue(AUTHORIZE);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/whoop/login", () => {
  it("redirects to WHOOP with only the nonce in state", async () => {
    const res = await login("?ticket=good");

    expect(res.headers.get("location")).toBe(AUTHORIZE);
    const state = buildAuthorizeUrl.mock.calls[0]?.[0] as string;
    // The address must NOT ride in state: WHOOP echoes it back through a URL
    // the caller can retype, so anything in it is caller-controlled by the
    // time the callback reads it.
    expect(state).not.toContain(OWNER);
    expect(state).not.toContain(":");
    // WHOOP requires at least 8 characters of state.
    expect(state.length).toBeGreaterThanOrEqual(8);
  });

  it("puts the ticket's address in an httpOnly cookie beside the nonce", async () => {
    const res = await login("?ticket=good");
    const cookie = cookieOf(res);
    const state = buildAuthorizeUrl.mock.calls[0]?.[0] as string;

    // The separator is percent-encoded on the wire; Next decodes it on read,
    // so assert the parts rather than pinning the encoding.
    const value = decodeURIComponent(
      new RegExp(`${WHOOP_NONCE_COOKIE}=([^;]*)`).exec(cookie)?.[1] ?? "",
    );
    expect(value).toBe(`${state}:${OWNER}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Path=/api/whoop");
    // Ten minutes: long enough for a consent screen, short enough to matter.
    expect(cookie).toContain("Max-Age=600");
  });

  it("marks the cookie Secure over https", async () => {
    expect(cookieOf(await login("?ticket=good"))).toContain("Secure");
  });

  it("IGNORES an address query param entirely", async () => {
    // The whole point of the ticket. If a query param could name the wallet,
    // the signature check at /api/wearable/link would be decorative.
    const res = await login(`?ticket=good&address=${VICTIM}`);

    expect(cookieOf(res)).toContain(OWNER);
    expect(cookieOf(res)).not.toContain(VICTIM);
  });

  it("refuses a missing, malformed or expired ticket the same way", async () => {
    // One outcome for all of them: which it was tells an attacker something
    // and the user nothing, since the fix is the same either way.
    readLinkTicket.mockReturnValue(null);

    for (const query of ["", "?ticket=", "?ticket=nonsense"]) {
      const res = await login(query);
      expect(outcomeOf(res)).toBe("expired");
      expect(buildAuthorizeUrl).not.toHaveBeenCalled();
    }
  });

  it("sends an unconfigured deployment back to a page, not a JSON error", async () => {
    providerConfigured.mockReturnValue(false);

    const res = await login("?ticket=good");

    // Reached by a top-level navigation from a button: a raw JSON error page
    // strands the user on a screen with no way back.
    expect(res.status).toBe(307);
    expect(outcomeOf(res)).toBe("unavailable");
    expect(buildAuthorizeUrl).not.toHaveBeenCalled();
  });

  it("sends an unexpected failure back to a page too", async () => {
    buildAuthorizeUrl.mockImplementation(() => {
      throw new Error("Missing required env var WHOOP_CLIENT_ID");
    });

    const res = await login("?ticket=good");

    expect(outcomeOf(res)).toBe("failed");
  });

  it("mints a different nonce every time", async () => {
    await login("?ticket=good");
    await login("?ticket=good");

    const first = buildAuthorizeUrl.mock.calls[0]?.[0] as string;
    const second = buildAuthorizeUrl.mock.calls[1]?.[0] as string;
    expect(first).not.toBe(second);
  });
});
