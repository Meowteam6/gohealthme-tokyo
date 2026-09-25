import { describe, it, expect, afterEach, vi } from "vitest";
import {
  DEFAULT_BLOCK_TRAITS,
  SCREEN_CACHE_TTL_MS,
  decide,
  describeRule,
  memoryScreenCache,
  parseQuickScan,
  screenAddress,
  screeningConfig,
  screeningConfigured,
} from "@/lib/server/screening/intercepta";

// The Intercepta client. Pinned: the live call shape from the docs, the
// printed rule, every failure collapsing to "unavailable" (never clear,
// never blocked), no call at all without a key, and a per-address cache so
// polling cannot burn the quota. fetch is injected; nothing here reaches the
// network and nothing in the shipped module fabricates a response.

const CLEAN = "0x8a39000000000000000000000000000000006141";
// OFAC SDN (Lazarus Group, Ronin bridge, listed 2022-04-14). Used only as a
// fixture address here; the fake fetch decides what it "returns".
const SANCTIONED = "0x098B716B8Aaf21512996dC57EB0615e2383E2f96";

afterEach(() => {
  vi.unstubAllEnvs();
});

function withKey() {
  vi.stubEnv("INTERCEPTA_API_KEY", "test-key");
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  ) as unknown as typeof fetch;
}

describe("screeningConfig", () => {
  it("is unconfigured without a key and configured with one", () => {
    expect(screeningConfigured()).toBe(false);
    withKey();
    expect(screeningConfigured()).toBe(true);
  });

  it("prints the rule with the default traits and no decisive score", () => {
    withKey();
    const rule = describeRule(screeningConfig());
    for (const trait of DEFAULT_BLOCK_TRAITS) expect(rule).toContain(trait);
    expect(rule).toContain("toxicScore is reported, not decisive");
  });

  it("honours INTERCEPTA_BLOCK_TRAITS and INTERCEPTA_BLOCK_SCORE overrides", () => {
    withKey();
    vi.stubEnv("INTERCEPTA_BLOCK_TRAITS", "sanction_address, blacklist");
    vi.stubEnv("INTERCEPTA_BLOCK_SCORE", "70");
    const config = screeningConfig();
    expect(config.blockTraits).toEqual(["sanction_address", "blacklist"]);
    expect(config.blockScore).toBe(70);
    expect(describeRule(config)).toContain("toxicScore >= 70");
  });
});

describe("parseQuickScan", () => {
  it("keeps name, risk and txsCount and drops the description prose", () => {
    const parsed = parseQuickScan({
      toxicScore: 90,
      traits: [
        { risk: 3, name: "sanction_address", txsCount: 12, description: "long prose" },
      ],
    });
    expect(parsed).toEqual({
      toxicScore: 90,
      traits: [{ name: "sanction_address", risk: 3, txsCount: 12 }],
    });
  });

  it("rejects bodies it cannot read", () => {
    expect(parseQuickScan(null)).toBeNull();
    expect(parseQuickScan({ traits: [] })).toBeNull();
    expect(parseQuickScan({ toxicScore: "1", traits: [] })).toBeNull();
    expect(parseQuickScan({ toxicScore: 1, traits: [{ risk: 1 }] })).toBeNull();
  });
});

describe("decide", () => {
  const config = { ...screeningConfig(), apiKey: "k" };

  it("clears an address with no traits", () => {
    expect(decide({ toxicScore: 0, traits: [] }, config)).toEqual({
      status: "clear",
      reason: "Intercepta reports no risk traits; toxicScore 0.",
    });
  });

  it("blocks on a sanction trait and names it", () => {
    const verdict = decide(
      {
        toxicScore: 95,
        traits: [{ name: "sanction_address", risk: 3, txsCount: 4 }],
      },
      config,
    );
    expect(verdict.status).toBe("blocked");
    expect(verdict.reason).toContain("sanction_address (4 tx)");
  });

  it("does not block on victim-side or exposure traits", () => {
    const verdict = decide(
      {
        toxicScore: 20,
        traits: [
          { name: "attack_money_target", risk: 1, txsCount: 1 },
          { name: "non_kyc_transfers", risk: 1, txsCount: 9 },
        ],
      },
      config,
    );
    expect(verdict.status).toBe("clear");
    expect(verdict.reason).toContain("non-blocking traits");
  });

  it("blocks on the score only when a threshold is configured", () => {
    const scan = { toxicScore: 80, traits: [] };
    expect(decide(scan, config).status).toBe("clear");
    expect(decide(scan, { ...config, blockScore: 80 }).status).toBe("blocked");
    expect(decide(scan, { ...config, blockScore: 81 }).status).toBe("clear");
  });
});

describe("screenAddress", () => {
  it("throws on a non-address: that is a caller bug, not a screening result", async () => {
    withKey();
    await expect(screenAddress("not-an-address")).rejects.toThrow(/not an EVM address/);
  });

  it("returns unconfigured without a key and never calls fetch", async () => {
    const f = fakeFetch(() => jsonResponse(200, { toxicScore: 0, traits: [] }));
    const result = await screenAddress(CLEAN, { fetch: f, cache: memoryScreenCache() });
    expect(result.status).toBe("unconfigured");
    expect(f).not.toHaveBeenCalled();
  });

  it("calls the documented endpoint with the key header and clears a clean wallet", async () => {
    withKey();
    const f = fakeFetch(() => jsonResponse(200, { toxicScore: 0, traits: [] }));
    const result = await screenAddress(CLEAN, { fetch: f, cache: memoryScreenCache() });

    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      `https://api.web3antivirus.io/api/public/v2/extension/account/${result.address}/quick-scan`,
    );
    expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("test-key");
    expect(result.status).toBe("clear");
    expect(result.toxicScore).toBe(0);
    expect(result.cached).toBe(false);
  });

  it("blocks a sanctioned wallet and carries the trait name, never the prose", async () => {
    withKey();
    const f = fakeFetch(() =>
      jsonResponse(200, {
        toxicScore: 99,
        traits: [
          {
            risk: 3,
            name: "sanction_address",
            txsCount: 1,
            description: "Address is on the OFAC list",
          },
        ],
      }),
    );
    const result = await screenAddress(SANCTIONED, { fetch: f, cache: memoryScreenCache() });
    expect(result.status).toBe("blocked");
    expect(result.traits).toEqual([{ name: "sanction_address", risk: 3, txsCount: 1 }]);
    expect(JSON.stringify(result)).not.toContain("OFAC list");
  });

  it("serves the second call within the hour from the cache", async () => {
    withKey();
    const cache = memoryScreenCache();
    const f = fakeFetch(() => jsonResponse(200, { toxicScore: 0, traits: [] }));
    const first = await screenAddress(CLEAN, { fetch: f, cache });
    const second = await screenAddress(CLEAN, { fetch: f, cache });
    expect(f).toHaveBeenCalledTimes(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.status).toBe("clear");
  });

  it("asks again once the cache entry has expired", async () => {
    withKey();
    const cache = memoryScreenCache();
    const f = fakeFetch(() => jsonResponse(200, { toxicScore: 0, traits: [] }));
    let t = Date.parse("2026-09-26T00:00:00.000Z");
    const now = () => new Date(t);
    await screenAddress(CLEAN, { fetch: f, cache, now });
    t += SCREEN_CACHE_TTL_MS + 1;
    const later = await screenAddress(CLEAN, { fetch: f, cache, now });
    expect(f).toHaveBeenCalledTimes(2);
    expect(later.cached).toBe(false);
  });

  it("retries once on a 5xx and then reports unavailable, not clear", async () => {
    withKey();
    const f = fakeFetch(() => jsonResponse(503, { status: 503 }));
    const result = await screenAddress(CLEAN, { fetch: f, cache: memoryScreenCache() });
    expect(f).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("503");
    expect(result.reason).toContain("held");
  });

  it("does not retry a rejected key and reports unavailable with the 403", async () => {
    withKey();
    const f = fakeFetch(() =>
      jsonResponse(403, {
        status: 403,
        response: "This authentication key is incorrect or doesn't exist",
      }),
    );
    const result = await screenAddress(CLEAN, { fetch: f, cache: memoryScreenCache() });
    expect(f).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("403");
  });

  it("reports unavailable when the provider times out", async () => {
    withKey();
    vi.stubEnv("INTERCEPTA_TIMEOUT_MS", "20");
    const f = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const result = await screenAddress(CLEAN, { fetch: f, cache: memoryScreenCache() });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("did not answer within 20ms");
  });

  it("reports unavailable on a body it cannot read", async () => {
    withKey();
    const f = fakeFetch(() => jsonResponse(200, { unexpected: true }));
    const result = await screenAddress(CLEAN, { fetch: f, cache: memoryScreenCache() });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("cannot read");
  });

  it("never caches an unavailable answer", async () => {
    withKey();
    const cache = memoryScreenCache();
    let calls = 0;
    const f = fakeFetch(() => {
      calls += 1;
      return calls <= 2
        ? jsonResponse(500, {})
        : jsonResponse(200, { toxicScore: 0, traits: [] });
    });
    const first = await screenAddress(CLEAN, { fetch: f, cache });
    const second = await screenAddress(CLEAN, { fetch: f, cache });
    expect(first.status).toBe("unavailable");
    expect(second.status).toBe("clear");
    expect(second.cached).toBe(false);
  });
});
