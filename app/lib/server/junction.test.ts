import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMissEvidence, getOrCreateUser } from "@/lib/server/junction";

// Two defects pinned here:
//   1. getOrCreateUser re-resolved the wallet -> Junction user_id mapping on
//      every call, so one 800ms dashboard poll cost three HTTP round-trips
//      where one would do. The mapping never changes once created.
//   2. No Junction request had a timeout, so a hung upstream consumed the whole
//      60s function budget and took the request down with it.
//
// The module cache is process-wide, so every test uses its own address.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function resolveOnlyFetch(userId: string) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/v2/user/resolve/")) {
      return Promise.resolve(Response.json({ user_id: userId }));
    }
    return Promise.resolve(Response.json({ user_id: userId }, { status: 201 }));
  });
}

describe("getOrCreateUser memoization", () => {
  it("resolves a wallet once and serves later calls from the cache", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "test-key");
    const fetchMock = resolveOnlyFetch("vital-1");
    vi.stubGlobal("fetch", fetchMock);

    const address = "0x1111111111111111111111111111111111111111";
    expect(await getOrCreateUser(address)).toBe("vital-1");
    expect(await getOrCreateUser(address.toUpperCase())).toBe("vital-1");
    expect(await getOrCreateUser(address)).toBe("vital-1");

    // Three calls, one round-trip. This is the poll cost that used to triple.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight resolve across a burst of concurrent callers", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "test-key");
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) =>
          setTimeout(() => resolve(Response.json({ user_id: "vital-2" })), 20),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const address = "0x2222222222222222222222222222222222222222";
    const results = await Promise.all([
      getOrCreateUser(address),
      getOrCreateUser(address),
      getOrCreateUser(address),
    ]);
    expect(results).toEqual(["vital-2", "vital-2", "vital-2"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never caches a failure", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        calls += 1;
        // First pass: both resolve attempts and the create fail. Second pass:
        // the resolve works.
        return calls <= 3
          ? Promise.resolve(new Response("down", { status: 500 }))
          : Promise.resolve(Response.json({ user_id: "vital-3" }));
      }),
    );

    const address = "0x3333333333333333333333333333333333333333";
    await expect(getOrCreateUser(address)).rejects.toThrow(/Junction/);
    // A transient outage must not pin an unusable entry for the whole TTL.
    await expect(getOrCreateUser(address)).resolves.toBe("vital-3");
  });

  it("creates the user when the resolve says not found", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      String(input).includes("/v2/user/resolve/")
        ? Promise.resolve(new Response("not found", { status: 404 }))
        : Promise.resolve(Response.json({ user_id: "vital-4" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const address = "0x4444444444444444444444444444444444444444";
    expect(await getOrCreateUser(address)).toBe("vital-4");
    // A 404 on resolve is the normal not-created-yet path, not a retryable
    // failure: one resolve, one create.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("junction request timeouts", () => {
  it("a hung Junction aborts on the timeout instead of consuming the budget", async () => {
    const sockets = new Set<Socket>();
    const server: Server = createServer(() => {
      // Never answers.
    });
    server.on("connection", (socket: Socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    try {
      vi.stubEnv("JUNCTION_API_KEY", "test-key");
      vi.stubEnv("JUNCTION_BASE_URL", `http://127.0.0.1:${port}`);
      vi.stubEnv("JUNCTION_TIMEOUT_MS", "150");
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const started = Date.now();
      await expect(
        getOrCreateUser("0x5555555555555555555555555555555555555555"),
      ).rejects.toBeInstanceOf(Error);
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});

describe("getMissEvidence", () => {
  /** A Junction that answers the resolve plus the three summaries. */
  function summaries(body: {
    sleep?: unknown[];
    activity?: unknown[];
    workouts?: unknown[];
    providers?: unknown[];
  }) {
    return vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v2/user/resolve/")) {
        return Promise.resolve(Response.json({ user_id: "vital-miss" }));
      }
      if (url.includes("/v2/user/providers/")) {
        return Promise.resolve(
          Response.json({
            providers: body.providers ?? [{ slug: "oura", status: "connected" }],
          }),
        );
      }
      if (url.includes("/v2/summary/sleep/")) {
        return Promise.resolve(Response.json({ sleep: body.sleep ?? [] }));
      }
      if (url.includes("/v2/summary/activity/")) {
        return Promise.resolve(Response.json({ activity: body.activity ?? [] }));
      }
      if (url.includes("/v2/summary/workouts/")) {
        return Promise.resolve(Response.json({ workouts: body.workouts ?? [] }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
  }

  it("keys each night to Junction's local calendar_date and reports the wearer's offset", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "test-key");
    const fetchMock = summaries({
      sleep: [
        { calendar_date: "2026-09-26", bedtime_stop: "2026-09-25T21:50:00Z", total: 6 * 3600, timezone_offset: 32400 },
        { calendar_date: "2026-09-27", bedtime_stop: "2026-09-26T22:10:00Z", total: 5.5 * 3600, timezone_offset: 32400 },
        // Tracked, never scored: a heartbeat with no hours.
        { calendar_date: "2026-09-25", bedtime_stop: "2026-09-24T21:00:00Z", timezone_offset: 32400 },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const evidence = await getMissEvidence(
      "0x6666666666666666666666666666666666666661",
      "sleep_hours",
      "2026-09-24",
    );

    expect(evidence.values).toEqual({ "2026-09-26": 6, "2026-09-27": 5.5 });
    expect([...evidence.heartbeatDays].sort()).toEqual(["2026-09-25", "2026-09-26", "2026-09-27"]);
    expect(evidence.tzOffsetSec).toBe(32400);
    const sleepCall = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .find((url) => url.includes("/v2/summary/sleep/"));
    expect(sleepCall).toContain("start_date=2026-09-24");
  });

  it("counts workouts per day with sleep and activity days as the heartbeat", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      summaries({
        sleep: [{ calendar_date: "2026-09-27", bedtime_stop: "2026-09-26T22:10:00Z", total: 25_000, timezone_offset: 32400 }],
        activity: [{ calendar_date: "2026-09-26", steps: 0, timezone_offset: 32400 }],
        workouts: [
          { calendar_date: "2026-09-27", time_start: "2026-09-27T00:30:00Z" },
          { calendar_date: "2026-09-27", time_start: "2026-09-27T03:30:00Z" },
        ],
      }),
    );

    const evidence = await getMissEvidence(
      "0x6666666666666666666666666666666666666662",
      "workouts",
      "2026-09-24",
    );

    expect(evidence.values).toEqual({ "2026-09-27": 2 });
    expect([...evidence.heartbeatDays].sort()).toEqual(["2026-09-26", "2026-09-27"]);
    expect(evidence.tzOffsetSec).toBe(32400);
  });

  it("reports an unknown offset when no record carries one", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      summaries({ sleep: [{ calendar_date: "2026-09-27", total: 25_000 }] }),
    );

    const evidence = await getMissEvidence(
      "0x6666666666666666666666666666666666666663",
      "sleep_hours",
      "2026-09-24",
    );

    expect(evidence.tzOffsetSec).toBeNull();
  });

  it("refuses a metric whose day is never final", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "test-key");
    vi.stubGlobal("fetch", summaries({}));
    await expect(
      getMissEvidence("0x6666666666666666666666666666666666666664", "steps", "2026-09-24"),
    ).rejects.toThrow(/sleep and workouts only/);
  });

  it("an outage throws, so the miss rule records nothing", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        String(input).includes("/v2/user/resolve/")
          ? Promise.resolve(Response.json({ user_id: "vital-miss-5" }))
          : Promise.resolve(new Response("down", { status: 503 })),
      ),
    );
    await expect(
      getMissEvidence("0x6666666666666666666666666666666666666665", "sleep_hours", "2026-09-24"),
    ).rejects.toThrow(/503/);
  });
});

// Review findings on fix/record-misses: partial nights (F2) and the source
// that records workouts (F3). The miss direction only; values still feed the
// pass path, which may only ever get more generous here.
describe("getMissEvidence: partial nights and the workout source", () => {
  function fake(body: {
    sleep?: unknown[];
    activity?: unknown[];
    workouts?: unknown[];
    providers?: unknown[];
  }) {
    return vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v2/user/resolve/")) {
        return Promise.resolve(Response.json({ user_id: "vital-f" }));
      }
      if (url.includes("/v2/user/providers/")) {
        return Promise.resolve(Response.json({ providers: body.providers ?? [] }));
      }
      if (url.includes("/v2/summary/sleep/")) {
        return Promise.resolve(Response.json({ sleep: body.sleep ?? [] }));
      }
      if (url.includes("/v2/summary/activity/")) {
        return Promise.resolve(Response.json({ activity: body.activity ?? [] }));
      }
      if (url.includes("/v2/summary/workouts/")) {
        return Promise.resolve(Response.json({ workouts: body.workouts ?? [] }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
  }
  const night = (day: string, hours: number, type: string, provider = "oura") => ({
    calendar_date: day,
    total: hours * 3600,
    type,
    timezone_offset: 32400,
    source: { provider },
  });

  it("F2: sums a night split into two main-sleep segments instead of keeping the longer", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      fake({
        sleep: [
          night("2026-09-27", 4, "long_sleep"),
          night("2026-09-27", 4, "long_sleep"),
        ],
      }),
    );
    const evidence = await getMissEvidence(
      "0x7777777777777777777777777777777777777771",
      "sleep_hours",
      "2026-09-24",
    );
    expect(evidence.values["2026-09-27"]).toBe(8);
    expect(evidence.partialDays ?? []).not.toContain("2026-09-27");
  });

  it("F2: a day whose only sleep is a nap is partial, never a short night", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      fake({
        sleep: [
          night("2026-09-26", 7.5, "long_sleep"),
          // The ring charged overnight; the afternoon nap is all it saw.
          night("2026-09-27", 0.5, "acknowledged_nap"),
        ],
      }),
    );
    const evidence = await getMissEvidence(
      "0x7777777777777777777777777777777777777772",
      "sleep_hours",
      "2026-09-24",
    );
    expect(evidence.partialDays).toContain("2026-09-27");
    expect(evidence.partialDays ?? []).not.toContain("2026-09-26");
  });

  it("F2: a short sleep next to a main sleep makes the day partial (it may be half a split night)", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      fake({
        sleep: [night("2026-09-27", 5, "long_sleep"), night("2026-09-27", 2, "short_sleep")],
      }),
    );
    const evidence = await getMissEvidence(
      "0x7777777777777777777777777777777777777773",
      "sleep_hours",
      "2026-09-24",
    );
    expect(evidence.partialDays).toContain("2026-09-27");
  });

  it("F3: only the source that records workouts is a heartbeat", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      fake({
        providers: [
          { slug: "oura", status: "connected" },
          { slug: "strava", status: "connected" },
        ],
        sleep: [
          night("2026-09-26", 7, "long_sleep"),
          night("2026-09-27", 7, "long_sleep"),
          night("2026-09-28", 7, "long_sleep"),
        ],
        workouts: [
          { calendar_date: "2026-09-25", timezone_offset: 32400, source: { provider: "strava" } },
        ],
      }),
    );
    const evidence = await getMissEvidence(
      "0x7777777777777777777777777777777777777774",
      "workouts",
      "2026-09-24",
    );
    // Oura's nightly sleep syncs say nothing about whether Strava synced.
    expect(evidence.heartbeatDays).toEqual(["2026-09-25"]);
    expect(evidence.sourceProblem ?? null).toBeNull();
  });

  it("F3: a linked source in an unusable state blocks the miss", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      fake({
        providers: [
          { slug: "oura", status: "connected" },
          { slug: "strava", status: "error" },
        ],
        workouts: [
          { calendar_date: "2026-09-25", timezone_offset: 32400, source: { provider: "strava" } },
        ],
      }),
    );
    const evidence = await getMissEvidence(
      "0x7777777777777777777777777777777777777775",
      "workouts",
      "2026-09-24",
    );
    expect(evidence.sourceProblem).toMatch(/strava/);
  });

  it("F3: with no workout on record and two linked sources, the workout source is unknown", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      fake({
        providers: [
          { slug: "oura", status: "connected" },
          { slug: "garmin", status: "connected" },
        ],
        sleep: [night("2026-09-26", 7, "long_sleep"), night("2026-09-27", 7, "long_sleep")],
      }),
    );
    const evidence = await getMissEvidence(
      "0x7777777777777777777777777777777777777776",
      "workouts",
      "2026-09-24",
    );
    expect(evidence.sourceProblem).toMatch(/workout/);
  });

  it("F3: one linked source is the workout source even before its first workout", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      fake({
        providers: [{ slug: "garmin", status: "connected" }],
        activity: [
          { calendar_date: "2026-09-26", timezone_offset: 32400, source: { provider: "garmin" } },
          { calendar_date: "2026-09-27", timezone_offset: 32400, source: { provider: "garmin" } },
          { calendar_date: "2026-09-28", timezone_offset: 32400 },
        ],
      }),
    );
    const evidence = await getMissEvidence(
      "0x7777777777777777777777777777777777777777",
      "workouts",
      "2026-09-24",
    );
    expect(evidence.sourceProblem ?? null).toBeNull();
    expect([...evidence.heartbeatDays].sort()).toEqual(["2026-09-26", "2026-09-27", "2026-09-28"]);
  });
});
