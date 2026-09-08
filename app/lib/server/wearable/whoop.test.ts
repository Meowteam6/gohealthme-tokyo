import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readTokens, writeTokens } from "@/lib/server/wearable/tokens";

// The WHOOP client, pinned against the two things that are genuinely hard
// about a direct OAuth integration and the one thing the product depends on:
//
//   1. a 401 is AMBIGUOUS - WHOOP returns a byte-identical body for expired,
//      malformed and revoked - so the only way to tell a revoked user from a
//      stale token is to spend a refresh and see what the token endpoint says
//   2. the rate limit is per API KEY, not per user, so a 429 has to be waited
//      out rather than guessed at
//   3. the streak has to come out of a real-shaped payload, with naps and
//      unscored nights excluded and nothing raw escaping the module

const KEY = Buffer.alloc(32, 5).toString("base64");

let counter = 0;
function nextAddress(): string {
  counter += 1;
  return `0x${(0xa0000 + counter).toString(16).padStart(40, "0")}`;
}

const { whoopProvider, buildAuthorizeUrl, exchangeCode, whoopConfigured } =
  await import("@/lib/server/wearable/whoop");

function tokenBody(overrides: Record<string, unknown> = {}) {
  return {
    access_token: "access-1",
    refresh_token: "refresh-1",
    expires_in: 3600,
    token_type: "bearer",
    scope: "read:sleep offline",
    ...overrides,
  };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

/** A WHOOP sleep record in the shape the live OpenAPI spec declares. */
function sleepRecord(
  end: string,
  performance: number | null,
  extra: Record<string, unknown> = {},
) {
  return {
    id: `sleep-${end}`,
    start: `${end.slice(0, 10)}T23:00:00.000Z`,
    end,
    nap: false,
    score_state: "SCORED",
    score: {
      sleep_performance_percentage: performance,
      sleep_efficiency_percentage: 90,
      stage_summary: { total_in_bed_time_milli: 28_800_000 },
    },
    ...extra,
  };
}

async function linked(address: string, expiresInMs = 3_600_000): Promise<void> {
  await writeTokens("whoop", address, {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: Date.now() + expiresInMs,
    scope: "read:sleep offline",
  });
}

beforeEach(() => {
  vi.stubEnv("WEARABLE_TOKEN_KEY", KEY);
  vi.stubEnv("WHOOP_CLIENT_ID", "client-id");
  vi.stubEnv("WHOOP_CLIENT_SECRET", "client-secret");
  vi.stubEnv("WHOOP_REDIRECT_URI", "https://gohealthme.app/api/whoop/callback");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("whoopConfigured", () => {
  it("is false when any credential is missing", () => {
    expect(whoopConfigured()).toBe(true);
    vi.stubEnv("WHOOP_CLIENT_SECRET", "");
    expect(whoopConfigured()).toBe(false);
  });
});

describe("buildAuthorizeUrl", () => {
  it("asks only for sleep and offline - least privilege is the privacy claim", () => {
    const url = new URL(buildAuthorizeUrl("nonce:0xabc"));
    expect(url.origin + url.pathname).toBe(
      "https://api.prod.whoop.com/oauth/oauth2/auth",
    );
    // Recovery, workout, cycle and body-measurement are deliberately absent:
    // the product verifies sleep, so asking for more would be data the app
    // never reads.
    expect(url.searchParams.get("scope")).toBe("read:sleep offline");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("state")).toBe("nonce:0xabc");
  });
});

describe("exchangeCode", () => {
  it("posts the code with credentials in the body, not a basic header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(tokenBody()));
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await exchangeCode("auth-code");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.prod.whoop.com/oauth/oauth2/token");
    expect(init.headers).toMatchObject({
      "content-type": "application/x-www-form-urlencoded",
    });
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_secret")).toBe("client-secret");
    expect(tokens.accessToken).toBe("access-1");
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it("reports a refused grant as needing re-authorization, not as an outage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
        }),
      ),
    );

    await expect(exchangeCode("stale-code")).rejects.toThrow(
      /was refused \(400\)/,
    );
  });
});

describe("isConnected", () => {
  it("is false for a wallet that never linked", async () => {
    expect(await whoopProvider.isConnected(nextAddress())).toBe(false);
  });

  it("is false, not an error, once the user has revoked us", async () => {
    const address = nextAddress();
    // Expired access token forces a refresh, and WHOOP refuses it.
    await linked(address, -1000);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
        }),
      ),
    );

    // Revocation is silent on WHOOP's side: there is no de-authorization
    // webhook, so a failing refresh is the only signal we ever get.
    expect(await whoopProvider.isConnected(address)).toBe(false);
    // And the dead record is dropped, so later reads ask the user to re-link
    // instead of repeating a refresh that can never succeed.
    expect(await readTokens("whoop", address)).toBeNull();
  });

  it("refreshes a stale token and stays connected", async () => {
    const address = nextAddress();
    await linked(address, -1000);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          json(tokenBody({ access_token: "access-2", refresh_token: "refresh-2" })),
        ),
    );

    expect(await whoopProvider.isConnected(address)).toBe(true);
    const stored = await readTokens("whoop", address);
    // The rotated pair must be persisted: WHOOP kills the old refresh token.
    expect(stored?.accessToken).toBe("access-2");
    expect(stored?.refreshToken).toBe("refresh-2");
  });
});

describe("getProgress", () => {
  it("counts qualifying nights, skipping naps and unscored records", async () => {
    const address = nextAddress();
    await linked(address);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({
          records: [
            sleepRecord("2026-06-20T07:00:00.000Z", 88),
            sleepRecord("2026-06-19T07:00:00.000Z", 60),
            // A nap must never count as a night.
            sleepRecord("2026-06-18T14:00:00.000Z", 95, { nap: true }),
            // Still being scored: not evidence yet.
            sleepRecord("2026-06-17T07:00:00.000Z", 99, {
              score_state: "PENDING_SCORE",
            }),
            sleepRecord("2026-06-16T07:00:00.000Z", 80),
          ],
          next_token: null,
        }),
      ),
    );

    const progress = await whoopProvider.getProgress(
      address,
      75,
      7,
      "2026-06-15",
      "2026-06-21",
    );

    expect(progress.streakDays).toBe(2);
    expect(progress.days[0]).toEqual({ date: "2026-06-20", score: 88 });
  });

  it("requests the documented collection parameters", async () => {
    const address = nextAddress();
    await linked(address);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ records: [], next_token: null }));
    vi.stubGlobal("fetch", fetchMock);

    await whoopProvider.getProgress(address, 75, 7);

    const url = new URL((fetchMock.mock.calls[0] as [string])[0]);
    expect(url.origin + url.pathname).toBe(
      "https://api.prod.whoop.com/developer/v2/activity/sleep",
    );
    // 25 is WHOOP's documented page ceiling.
    expect(url.searchParams.get("limit")).toBe("25");
    expect(url.searchParams.get("start")).toBeTruthy();
  });

  it("follows next_token to a second page", async () => {
    const address = nextAddress();
    await linked(address);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          records: [sleepRecord("2026-06-20T07:00:00.000Z", 88)],
          next_token: "page-2",
        }),
      )
      .mockResolvedValueOnce(
        json({
          records: [sleepRecord("2026-06-19T07:00:00.000Z", 90)],
          next_token: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const progress = await whoopProvider.getProgress(
      address,
      75,
      7,
      "2026-06-15",
      "2026-06-21",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      new URL((fetchMock.mock.calls[1] as [string])[0]).searchParams.get(
        "nextToken",
      ),
    ).toBe("page-2");
    expect(progress.streakDays).toBe(2);
  });

  it("spends a refresh on a 401 and retries, because a 401 cannot self-identify", async () => {
    const address = nextAddress();
    await linked(address);
    const fetchMock = vi
      .fn()
      // WHOOP's 401 body is identical for expired, malformed and revoked.
      .mockResolvedValueOnce(
        new Response("Authorization was not valid", { status: 401 }),
      )
      .mockResolvedValueOnce(
        json(tokenBody({ access_token: "access-2", refresh_token: "refresh-2" })),
      )
      .mockResolvedValueOnce(
        json({
          records: [sleepRecord("2026-06-20T07:00:00.000Z", 88)],
          next_token: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const progress = await whoopProvider.getProgress(
      address,
      75,
      7,
      "2026-06-15",
      "2026-06-21",
    );

    expect(progress.streakDays).toBe(1);
    // The retry must carry the NEW token, not the one that just failed.
    const retryInit = (fetchMock.mock.calls[2] as [string, RequestInit])[1];
    expect(
      (retryInit.headers as Record<string, string>).authorization,
    ).toBe("Bearer access-2");
  });

  it("waits out a 429 using the documented reset header", async () => {
    const address = nextAddress();
    await linked(address);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", {
          status: 429,
          // The limit is per API key, not per user, so the reset is the only
          // honest wait: guessing either fails a claim early or holds a
          // serverless function open for nothing.
          headers: { "x-ratelimit-reset": "0" },
        }),
      )
      .mockResolvedValueOnce(
        json({
          records: [sleepRecord("2026-06-20T07:00:00.000Z", 88)],
          next_token: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const progress = await whoopProvider.getProgress(
      address,
      75,
      7,
      "2026-06-15",
      "2026-06-21",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(progress.streakDays).toBe(1);
  });

  it("surfaces a server error in the house upstream format", async () => {
    const address = nextAddress();
    await linked(address);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("upstream boom", { status: 503 })),
    );

    // "<provider> <path> returned <status>" is what lib/wearable-provider.ts
    // parses to tell an outage apart from a credential problem.
    await expect(whoopProvider.getProgress(address, 75, 7)).rejects.toThrow(
      /WHOOP \/v2\/activity\/sleep returned 503/,
    );
  });

  it("never asks WHOOP for a cached response", async () => {
    const address = nextAddress();
    await linked(address);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ records: [], next_token: null }));
    vi.stubGlobal("fetch", fetchMock);

    await whoopProvider.getProgress(address, 75, 7);

    // WHOOP's terms forbid permanent copies of their data, so no layer of this
    // app may serve a sleep read from cache.
    expect(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].cache,
    ).toBe("no-store");
  });
});

describe("getRecent", () => {
  it("reports hours from the score's stage summary and no step series", async () => {
    const address = nextAddress();
    await linked(address);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({
          records: [sleepRecord("2026-06-20T07:00:00.000Z", 88)],
          next_token: null,
        }),
      ),
    );

    const recent = await whoopProvider.getRecent(address, 7);

    expect(recent.sleep).toEqual([
      { date: "2026-06-20", score: 88, hours: 8 },
    ]);
    // WHOOP measures strain, not steps. An empty series is the honest answer;
    // a row of zeros would read as a user who did not move.
    expect(recent.activity).toEqual([]);
  });
});

describe("disconnect", () => {
  it("revokes upstream and drops the local record", async () => {
    const address = nextAddress();
    await linked(address);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await whoopProvider.disconnect(address);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.prod.whoop.com/developer/v2/user/access");
    expect(init.method).toBe("DELETE");
    expect(await readTokens("whoop", address)).toBeNull();
  });

  it("still drops the local record when the revoke call fails", async () => {
    const address = nextAddress();
    await linked(address);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await whoopProvider.disconnect(address);

    // Keeping a token we can no longer honour would strand the user as
    // permanently "connected" with every read failing.
    expect(await readTokens("whoop", address)).toBeNull();
  });
});
