import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// This route had NO test, and the invariant it protects is the one that decides
// whose WHOOP account backs whose payouts.
//
// The bug this pins: `state` is echoed back by WHOOP through a URL the caller
// can retype. An earlier version carried `nonce:address` in `state` and checked
// only the nonce half against the cookie, so an attacker could complete a real
// consent for their OWN account and then hand-craft the callback with their
// genuine nonce and a VICTIM's address. One WHOOP account would back any number
// of wallets, and the victim's real connection would be silently overwritten.

const exchangeCode = vi.fn();
const writeTokens = vi.fn();
const claimWhoopSeat = vi.fn();
vi.mock("@/lib/server/wearable/whoop-seats", () => ({
  claimWhoopSeat: (...args: unknown[]) => claimWhoopSeat(...args),
}));
const setProviderId = vi.fn();

vi.mock("@/lib/server/wearable/whoop", () => ({
  exchangeCode: (...args: unknown[]) => exchangeCode(...args),
}));
vi.mock("@/lib/server/wearable/tokens", () => ({
  writeTokens: (...args: unknown[]) => writeTokens(...args),
}));
vi.mock("@/lib/server/wearable", () => ({
  setProviderId: (...args: unknown[]) => setProviderId(...args),
}));

const { GET } = await import("@/app/api/whoop/callback/route");
const { WHOOP_NONCE_COOKIE, WHOOP_RETURN_COOKIE } = await import(
  "@/lib/server/wearable/whoop-cookies"
);

const OWNER = "0x1111111111111111111111111111111111111111";
const VICTIM = "0x2222222222222222222222222222222222222222";
const NONCE = "a".repeat(32);

const TOKENS = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: Date.now() + 3_600_000,
  scope: "read:sleep read:workout offline",
};

function callback(query: string, cookie?: string): Promise<Response> {
  const request = new NextRequest(
    `https://app.test/api/whoop/callback${query}`,
    cookie === undefined
      ? undefined
      : { headers: { cookie: `${WHOOP_NONCE_COOKIE}=${cookie}` } },
  );
  return GET(request);
}

function outcomeOf(res: Response): string | null {
  return new URL(res.headers.get("location") ?? "https://x/").searchParams.get(
    "whoop",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  exchangeCode.mockResolvedValue(TOKENS);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/whoop/callback", () => {
  it("binds the tokens to the address in the COOKIE, never one in state", async () => {
    // The attack: a genuine nonce and a genuine code, with somebody else's
    // address appended to state. The address must come from the cookie.
    const res = await callback(
      `?code=real-code&state=${NONCE}:${VICTIM}`,
      `${NONCE}:${OWNER}`,
    );

    // state no longer equals the cookie's nonce half once an address is
    // appended, so this is refused outright.
    expect(outcomeOf(res)).toBe("expired");
    expect(writeTokens).not.toHaveBeenCalled();
    expect(setProviderId).not.toHaveBeenCalled();
  });

  it("stores against the cookie's address on the honest path", async () => {
    const res = await callback(
      `?code=real-code&state=${NONCE}`,
      `${NONCE}:${OWNER}`,
    );

    expect(outcomeOf(res)).toBe("connected");
    expect(writeTokens).toHaveBeenCalledWith("whoop", OWNER, TOKENS);
    expect(setProviderId).toHaveBeenCalledWith(OWNER, "whoop");
    // A WHOOP seat is taken only once tokens are stored.
    expect(claimWhoopSeat).toHaveBeenCalledWith(OWNER);
  });

  it("refuses the exact shape the old code accepted", async () => {
    // Replays the vulnerable combination verbatim: a nonce-only cookie (what
    // /login used to set) plus `nonce:victim` in state. The old callback
    // compared only the nonce half, matched, and bound the attacker's tokens
    // to the victim. Now the cookie carries no address, so there is nothing to
    // bind and the request dies before exchangeCode.
    const res = await callback(
      `?code=real-code&state=${NONCE}:${VICTIM}`,
      NONCE,
    );

    expect(writeTokens).not.toHaveBeenCalled();
    expect(setProviderId).not.toHaveBeenCalled();
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(outcomeOf(res)).toBe("failed");
  });

  it("refuses a callback with no cookie at all", async () => {
    const res = await callback(`?code=real-code&state=${NONCE}`);

    expect(outcomeOf(res)).toBe("expired");
    expect(writeTokens).not.toHaveBeenCalled();
  });

  it("refuses a state that does not match this browser's nonce", async () => {
    const res = await callback(
      `?code=real-code&state=${"b".repeat(32)}`,
      `${NONCE}:${OWNER}`,
    );

    expect(outcomeOf(res)).toBe("expired");
    expect(writeTokens).not.toHaveBeenCalled();
  });

  it("refuses a cookie whose address half is not an address", async () => {
    const res = await callback(
      `?code=real-code&state=${NONCE}`,
      `${NONCE}:not-an-address`,
    );

    expect(outcomeOf(res)).toBe("failed");
    expect(writeTokens).not.toHaveBeenCalled();
  });

  it("treats a declined consent as a choice, not a failure", async () => {
    const res = await callback("?error=access_denied", `${NONCE}:${OWNER}`);

    expect(outcomeOf(res)).toBe("declined");
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("stores nothing when the token exchange fails", async () => {
    exchangeCode.mockRejectedValue(new Error("WHOOP refused the code"));

    const res = await callback(
      `?code=stale&state=${NONCE}`,
      `${NONCE}:${OWNER}`,
    );

    expect(outcomeOf(res)).toBe("failed");
    expect(writeTokens).not.toHaveBeenCalled();
    expect(setProviderId).not.toHaveBeenCalled();
    expect(claimWhoopSeat).not.toHaveBeenCalled();
  });

  it("clears the cookie on every exit, so a nonce is never reusable", async () => {
    for (const res of [
      await callback(`?code=c&state=${NONCE}`, `${NONCE}:${OWNER}`),
      await callback("?error=access_denied", `${NONCE}:${OWNER}`),
      await callback(`?code=c&state=wrong`, `${NONCE}:${OWNER}`),
    ]) {
      expect(res.headers.get("set-cookie")).toContain(WHOOP_NONCE_COOKIE);
    }
  });

  function withReturn(query: string, returnPath: string): Promise<Response> {
    return GET(
      new NextRequest(`https://app.test/api/whoop/callback${query}`, {
        headers: {
          cookie:
            `${WHOOP_NONCE_COOKIE}=${NONCE}:${OWNER}; ` +
            `${WHOOP_RETURN_COOKIE}=${encodeURIComponent(returnPath)}`,
        },
      }),
    );
  }

  it("returns to the page the connect started on, with the outcome", async () => {
    // A player pairing from character creation lands back on the sensor step,
    // which reads ?whoop=, instead of a dashboard the onboarding gate covers.
    const res = await withReturn(
      `?code=real-code&state=${NONCE}`,
      "/character?step=sensor&next=/pools/3",
    );

    const location = new URL(res.headers.get("location") ?? "https://x/");
    expect(location.origin).toBe("https://app.test");
    expect(location.pathname).toBe("/character");
    expect(location.searchParams.get("step")).toBe("sensor");
    expect(location.searchParams.get("next")).toBe("/pools/3");
    expect(location.searchParams.get("whoop")).toBe("connected");
    expect(res.headers.get("set-cookie")).toContain(WHOOP_RETURN_COOKIE);
  });

  it("returns a declined consent to the same page", async () => {
    const res = await withReturn("?error=access_denied", "/pools/3");

    const location = new URL(res.headers.get("location") ?? "https://x/");
    expect(location.pathname).toBe("/pools/3");
    expect(location.searchParams.get("whoop")).toBe("declined");
  });

  it("never redirects off-site, even from a tampered cookie", async () => {
    const res = await withReturn(
      `?code=real-code&state=${NONCE}`,
      "//evil.test/phish",
    );

    const location = new URL(res.headers.get("location") ?? "https://x/");
    expect(location.origin).toBe("https://app.test");
    expect(location.pathname).toBe("/dashboard");
  });

  it("defaults to the dashboard with no return cookie", async () => {
    const res = await callback(`?code=real-code&state=${NONCE}`, `${NONCE}:${OWNER}`);
    expect(new URL(res.headers.get("location") ?? "https://x/").pathname).toBe(
      "/dashboard",
    );
  });
});
