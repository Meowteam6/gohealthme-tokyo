import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readTokens, writeTokens } from "@/lib/server/wearable/tokens";
import { randomUUID } from "crypto";

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

// Salted per RUN, not just per test. The file-backed store under DATA_DIR
// survives between vitest runs, so a counter that restarts at zero hands the
// next run addresses the previous one already wrote token records for - and a
// "never linked" assertion then reads the last run's data and fails.
const RUN_SALT = randomUUID().replace(/-/g, "").slice(0, 12);
let counter = 0;
function nextAddress(): string {
  counter += 1;
  return `0x${RUN_SALT}${counter.toString(16).padStart(28, "0")}`;
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
      stage_summary: {
        total_in_bed_time_milli: 28_800_000,
        total_awake_time_milli: 1_800_000,
        total_no_data_time_milli: 1_800_000,
        total_light_sleep_time_milli: 12_600_000,
        total_slow_wave_sleep_time_milli: 7_200_000,
        total_rem_sleep_time_milli: 5_400_000,
      },
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
  it("asks for exactly the scopes the declared metrics need", () => {
    const url = new URL(buildAuthorizeUrl("nonce:0xabc"));
    expect(url.origin + url.pathname).toBe(
      "https://api.prod.whoop.com/oauth/oauth2/auth",
    );
    // Sleep and workouts are both verifiable goals, so both are requested.
    // read:cycles is absent because cycle energy is TOTAL expenditure and
    // cannot honestly answer an active-calories goal; body measurement and
    // profile are absent because no goal is measured against them.
    expect(url.searchParams.get("scope")).toBe(
      "read:sleep read:workout offline",
    );
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

describe("getMetricProgress", () => {
  it("refuses a metric a WHOOP strap physically cannot measure", async () => {
    const address = nextAddress();
    await linked(address);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // Steps, daily distance and active calories are all refused, each for a
    // stated reason. Answering zero would tell somebody who walked 12,000
    // steps they missed the goal.
    const refused = ["steps", "distance_km", "active_calories"] as const;
    for (const metric of refused) {
      await expect(
        whoopProvider.getMetricProgress(
          address,
          metric,
          100,
          "2026-06-15",
          "2026-06-21",
        ),
      ).rejects.toThrow(/cannot measure/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("declares only what it can honestly answer", () => {
    expect([...whoopProvider.metrics].sort()).toEqual([
      "sleep_efficiency",
      "sleep_hours",
      "sleep_score",
      "workouts",
    ]);
  });

  it("serves sleep_efficiency from the efficiency field, not the score", async () => {
    const address = nextAddress();
    await linked(address);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({
          records: [
            // Performance 40 would fail a 90 bar; efficiency 93 passes it.
            // The two must not be interchangeable.
            sleepRecord("2026-06-20T07:00:00.000Z", 40),
          ],
          next_token: null,
        }),
      ),
    );

    const progress = await whoopProvider.getMetricProgress(
      address,
      "sleep_efficiency",
      90,
      "2026-06-15",
      "2026-06-21",
    );

    expect(progress.qualifyingDays).toBe(1);
    expect(progress.daysWithData).toBe(1);
  });

  it("never substitutes efficiency for a missing sleep score", async () => {
    const address = nextAddress();
    await linked(address);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({
          records: [
            // WHOOP scored the night but produced no performance percentage.
            // Efficiency is 90 and must NOT stand in for it: that would hold
            // this user to a materially easier bar for the same stake.
            sleepRecord("2026-06-20T07:00:00.000Z", null),
          ],
          next_token: null,
        }),
      ),
    );

    const progress = await whoopProvider.getMetricProgress(
      address,
      "sleep_score",
      75,
      "2026-06-15",
      "2026-06-21",
    );

    expect(progress.qualifyingDays).toBe(0);
    // An unscored night is MISSING DATA, not a failure - so it reads as
    // sync-in-progress rather than a paid "you missed it".
    expect(progress.daysWithData).toBe(0);
  });

  it("counts workout sessions per day, unscored sessions included", async () => {
    const address = nextAddress();
    await linked(address);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({
          records: [
            { id: "w1", end: "2026-06-16T09:00:00.000Z", score_state: "SCORED" },
            { id: "w2", end: "2026-06-16T18:00:00.000Z", score_state: "SCORED" },
            // The session happening is the evidence, not its score.
            { id: "w3", end: "2026-06-18T09:00:00.000Z", score_state: "UNSCORABLE" },
          ],
          next_token: null,
        }),
      ),
    );

    const progress = await whoopProvider.getMetricProgress(
      address,
      "workouts",
      1,
      "2026-06-15",
      "2026-06-21",
    );

    // Two qualifying days, not three sessions: the goal is days with a workout.
    expect(progress.qualifyingDays).toBe(2);
  });

  it("reports every day in the window as sourced for workouts", async () => {
    const address = nextAddress();
    await linked(address);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({
          records: [
            { id: "w1", end: "2026-06-16T09:00:00.000Z", score_state: "SCORED" },
          ],
          next_token: null,
        }),
      ),
    );

    const progress = await whoopProvider.getMetricProgress(
      address,
      "workouts",
      1,
      "2026-06-15",
      "2026-06-21",
    );

    // A day with no session means nobody trained - a real zero, not missing
    // data. daysWithSource was permanently 0 here, which the progress route
    // reads as "nothing has ever synced", so every connected WHOOP wallet on a
    // workouts pool sat on "waiting on your first sync" forever with the fee
    // already paid.
    expect(progress.daysWithSource).toBe(7);
    expect(progress.qualifyingDays).toBe(1);
  });

  it("reads workouts from the workout endpoint, not the sleep one", async () => {
    const address = nextAddress();
    await linked(address);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ records: [], next_token: null }));
    vi.stubGlobal("fetch", fetchMock);

    await whoopProvider.getMetricProgress(
      address,
      "workouts",
      1,
      "2026-06-15",
      "2026-06-21",
    );

    const url = new URL((fetchMock.mock.calls[0] as [string])[0]);
    expect(url.pathname).toBe("/developer/v2/activity/workout");
  });
});

describe("getRecent", () => {
  it("reports ASLEEP hours and no step series", async () => {
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

    // 3.5 light + 2 slow-wave + 1.5 REM = 7h asleep. In bed was 8h; the card
    // says "Sleep", so it must not show the larger number next to a 7-hour
    // goal the person did not actually meet.
    expect(recent.sleep).toEqual([
      { date: "2026-06-20", score: 88, hours: 7 },
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

describe("day attribution", () => {
  it("keys a night to the wearer's LOCAL day, not the UTC one", async () => {
    const address = nextAddress();
    await linked(address);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({
          records: [
            // 22:30 UTC on the 20th is 08:30 on the 21st in Sydney. Junction
            // keys on the device's own calendar_date, so slicing the UTC
            // timestamp would put this night in a different bucket from the
            // one the other provider uses - and a pool boundary would pay one
            // user and not the other for the same night.
            {
              ...sleepRecord("2026-06-20T22:30:00.000Z", 88),
              timezone_offset: "+10:00",
            },
          ],
          next_token: null,
        }),
      ),
    );

    const progress = await whoopProvider.getProgress(address, 75, 7);

    expect(progress.days[0]?.date).toBe("2026-06-21");
  });

  it("treats a 'Z' offset as UTC, which WHOOP documents it may send", async () => {
    const address = nextAddress();
    await linked(address);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({
          records: [
            {
              ...sleepRecord("2026-06-20T07:00:00.000Z", 88),
              timezone_offset: "Z",
            },
          ],
          next_token: null,
        }),
      ),
    );

    const progress = await whoopProvider.getProgress(address, 75, 7);

    expect(progress.days[0]?.date).toBe("2026-06-20");
  });

  it("falls back to UTC when a record carries no offset", async () => {
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

    const progress = await whoopProvider.getProgress(address, 75, 7);

    expect(progress.days[0]?.date).toBe("2026-06-20");
  });
});

describe("pagination", () => {
  it("never reports an incomplete read as a complete one", async () => {
    const address = nextAddress();
    await linked(address);
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Always another page: the walk is bounded, and the bound must be loud.
    // A fresh Response per call - a body can only be read once.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          json({
            records: [sleepRecord("2026-06-20T07:00:00.000Z", 88)],
            next_token: "more",
          }),
        ),
      ),
    );

    await whoopProvider.getProgress(address, 75, 7);

    // An undercount underpays a claim, so a truncated read is never silent.
    expect(
      warned.mock.calls.some((call) => String(call[0]).includes("incomplete")),
    ).toBe(true);
  });
});

describe("exchangeCode validation", () => {
  it("refuses a token response with no refresh token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json(tokenBody({ refresh_token: "" }))),
    );

    // Storing it would work for an hour and then die on a cron nobody watches,
    // telling the user their wearable is simply not connected.
    await expect(exchangeCode("code")).rejects.toThrow(/offline scope/);
  });
});

describe("getMissEvidence", () => {
  /** Answers each WHOOP collection by path, so one read can hit both. */
  function byPath(routes: Record<string, unknown[]>) {
    return vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      const records =
        Object.entries(routes).find(([suffix]) => path.endsWith(suffix))?.[1] ?? [];
      return Promise.resolve(json({ records, next_token: null }));
    });
  }

  it("keys sleep to the wearer's local wake day and reports their offset", async () => {
    const address = nextAddress();
    await linked(address);
    vi.stubGlobal(
      "fetch",
      byPath({
        "/activity/sleep": [
          // Woke 07:10 Sunday in Tokyo = 22:10 UTC Saturday.
          { ...sleepRecord("2026-09-26T22:10:00.000Z", 70), timezone_offset: "+09:00" },
          // Woke 06:50 Saturday in Tokyo.
          { ...sleepRecord("2026-09-25T21:50:00.000Z", 60), timezone_offset: "+09:00" },
        ],
      }),
    );

    const evidence = await whoopProvider.getMissEvidence!(address, "sleep_hours", "2026-09-24");

    expect(evidence.tzOffsetSec).toBe(9 * 3600);
    // Light 3.5h + deep 2h + REM 1.5h = 7h asleep on the fixture record.
    expect(evidence.values).toEqual({ "2026-09-26": 7, "2026-09-27": 7 });
    expect([...evidence.heartbeatDays].sort()).toEqual(["2026-09-26", "2026-09-27"]);
  });

  it("an unscored night is a heartbeat, never a value", async () => {
    const address = nextAddress();
    await linked(address);
    vi.stubGlobal(
      "fetch",
      byPath({
        "/activity/sleep": [
          {
            ...sleepRecord("2026-09-26T22:10:00.000Z", null),
            score_state: "PENDING_SCORE",
            timezone_offset: "+09:00",
          },
        ],
      }),
    );

    const evidence = await whoopProvider.getMissEvidence!(address, "sleep_hours", "2026-09-24");

    expect(evidence.values).toEqual({});
    expect(evidence.heartbeatDays).toEqual(["2026-09-27"]);
  });

  it("counts workouts on the local day they ended, with sleep as the heartbeat", async () => {
    const address = nextAddress();
    await linked(address);
    vi.stubGlobal(
      "fetch",
      byPath({
        "/activity/sleep": [
          { ...sleepRecord("2026-09-25T21:50:00.000Z", 60), timezone_offset: "+09:00" },
          { ...sleepRecord("2026-09-26T22:10:00.000Z", 70), timezone_offset: "+09:00" },
        ],
        // 16:30 UTC Saturday is 01:30 Sunday in Tokyo: Sunday's workout.
        "/activity/workout": [
          {
            id: "w1",
            end: "2026-09-26T16:30:00.000Z",
            score_state: "SCORED",
            timezone_offset: "+09:00",
          },
        ],
      }),
    );

    const evidence = await whoopProvider.getMissEvidence!(address, "workouts", "2026-09-24");

    expect(evidence.values).toEqual({ "2026-09-27": 1 });
    expect([...evidence.heartbeatDays].sort()).toEqual(["2026-09-26", "2026-09-27"]);
    expect(evidence.tzOffsetSec).toBe(9 * 3600);
  });

  it("reports an unknown offset when no record carries one", async () => {
    const address = nextAddress();
    await linked(address);
    vi.stubGlobal(
      "fetch",
      byPath({ "/activity/sleep": [sleepRecord("2026-09-26T22:10:00.000Z", 70)] }),
    );

    const evidence = await whoopProvider.getMissEvidence!(address, "sleep_hours", "2026-09-24");

    expect(evidence.tzOffsetSec).toBeNull();
  });

  it("refuses a metric the strap cannot measure", async () => {
    const address = nextAddress();
    await linked(address);
    await expect(
      whoopProvider.getMissEvidence!(address, "steps", "2026-09-24"),
    ).rejects.toThrow(/cannot measure steps/);
  });
});

// Review findings on fix/record-misses: partial nights (F2) and the pass and
// miss paths keying WHOOP workouts to different days (F4).
describe("getMissEvidence: partial nights and local workout days", () => {
  function byPath(routes: Record<string, unknown[]>) {
    return vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      const records =
        Object.entries(routes).find(([suffix]) => path.endsWith(suffix))?.[1] ?? [];
      return Promise.resolve(json({ records, next_token: null }));
    });
  }
  /** A scored main sleep of `hours` observed asleep, and `noDataMs` lost. */
  function night(end: string, hours: number, noDataMs: number) {
    return sleepRecord(end, 80, {
      timezone_offset: "+09:00",
      score: {
        sleep_performance_percentage: 80,
        sleep_efficiency_percentage: 90,
        stage_summary: {
          total_in_bed_time_milli: hours * 3_600_000 + noDataMs,
          total_awake_time_milli: 0,
          total_no_data_time_milli: noDataMs,
          total_light_sleep_time_milli: hours * 3_600_000,
          total_slow_wave_sleep_time_milli: 0,
          total_rem_sleep_time_milli: 0,
        },
      },
    });
  }

  it("F2: a night with no-data time on the strap is partial, not a short night", async () => {
    const address = nextAddress();
    await linked(address);
    vi.stubGlobal(
      "fetch",
      byPath({
        "/activity/sleep": [
          night("2026-09-25T21:50:00.000Z", 7.5, 0),
          // The strap loosened for 3h: 4.5h observed, 3h of no data.
          night("2026-09-26T22:10:00.000Z", 4.5, 3 * 3_600_000),
        ],
      }),
    );
    const evidence = await whoopProvider.getMissEvidence!(address, "sleep_hours", "2026-09-24");
    expect(evidence.partialDays).toEqual(["2026-09-27"]);
    expect(evidence.values["2026-09-27"]).toBe(4.5);
  });

  it("F2: two main sleeps ending the same local day are summed for hours", async () => {
    const address = nextAddress();
    await linked(address);
    vi.stubGlobal(
      "fetch",
      byPath({
        "/activity/sleep": [
          { ...night("2026-09-26T18:00:00.000Z", 4, 0), id: "a" },
          { ...night("2026-09-26T23:00:00.000Z", 4, 0), id: "b" },
        ],
      }),
    );
    const evidence = await whoopProvider.getMissEvidence!(address, "sleep_hours", "2026-09-24");
    expect(evidence.values["2026-09-27"]).toBe(8);
    expect(evidence.partialDays ?? []).toEqual([]);
  });

  it("F4: the pass path keys workouts to the same local day as the miss path", async () => {
    const address = nextAddress();
    await linked(address);
    // Tokyo, 'Hit the gym 2 times', run Sat 00:00 to Mon 00:00 JST. The
    // sessions end Sat 08:00 JST (Fri 23:00 UTC) and Sat 19:00 JST.
    const workouts = [
      { id: "w1", end: "2026-09-25T23:00:00.000Z", score_state: "SCORED", timezone_offset: "+09:00" },
      { id: "w2", end: "2026-09-26T10:00:00.000Z", score_state: "SCORED", timezone_offset: "+09:00" },
    ];
    vi.stubGlobal("fetch", byPath({ "/activity/workout": workouts }));
    const progress = await whoopProvider.getMetricProgress(
      address,
      "workouts",
      1,
      "2026-09-25",
      "2026-09-26",
    );
    const evidence = await whoopProvider.getMissEvidence!(address, "workouts", "2026-09-24");
    // Both sessions are Saturday in Tokyo on both paths; keyed by UTC end
    // date the pass path saw a Friday session too and counted two days.
    expect(evidence.values).toEqual({ "2026-09-26": 2 });
    expect(progress.qualifyingDays).toBe(1);
    expect(progress.daysWithData).toBe(1);
  });
});
