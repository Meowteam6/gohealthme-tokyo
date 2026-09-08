// GET /api/wearable/progress returns a wallet's streak against a goal. Pinned
// here, because this route sits on the privacy boundary the product's claim
// rests on:
//
//   - THE SIGNATURE GATE. A wallet address is public. Without the EIP-191
//     signature that proves control of it, this route reads NOTHING from the
//     health provider - the wallet's provider is never even resolved, so
//     isConnected/getProgress are never called - and a stranger cannot pull
//     someone's sleep streak by copying their address out of a pool. Unsigned
//     reads are 401.
//   - DERIVED SCALARS ONLY. Even for the owner, the response carries the
//     streak COUNT, the target, a metric label, the provider id and a last-sync
//     date - never a raw per-night score, the baseline average, or the
//     day-by-day array that getProgress computes internally. Raw samples stay
//     server-side.
//   - AN UPSTREAM FAILURE IS OPAQUE. A provider's error text names the request
//     path and the account state; the caller may not even be the account
//     holder, so a 502 says only "temporarily unavailable" while the real
//     failure is logged. A missing/invalid provider credential lands here,
//     which is how the credential gate surfaces as a down provider, not a fake
//     pass.
//
// Replaces the /api/junction/progress tests. What is new: the route resolves
// the provider per wallet through @/lib/server/wearable instead of importing
// Junction directly, and every response names the provider that answered - so
// a WHOOP-backed wallet and a Junction-backed wallet are both pinned here.

import { describe, it, expect, vi, beforeEach } from "vitest";

const providerFor = vi.fn();
const isConnected = vi.fn();
const getProgress = vi.fn();
const requireAddressSignature = vi.fn();

vi.mock("@/lib/server/wearable", () => {
  // isProviderId/PROVIDER_IDS keep their real behaviour: they are pure
  // predicates over a two-element union, and stubbing them would make the
  // mock disagree with the module the route actually ships against.
  const PROVIDER_IDS = ["junction", "whoop"] as const;
  return {
    PROVIDER_IDS,
    isProviderId: (value: unknown) =>
      typeof value === "string" &&
      (PROVIDER_IDS as readonly string[]).includes(value),
    providerFor: (...args: unknown[]) => providerFor(...args),
  };
});
vi.mock("@/lib/server/wallet-auth", () => ({
  requireAddressSignature: (...args: unknown[]) =>
    requireAddressSignature(...args),
}));

const { GET } = await import("@/app/api/wearable/progress/route");
const { NextRequest } = await import("next/server");

const USER = "0x1111111111111111111111111111111111111111";

function get(query: string) {
  return GET(new NextRequest(`http://localhost/api/wearable/progress${query}`));
}

/** A stub standing in for whichever integration backs the wallet. */
function stubProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: "junction",
    label: "Junction",
    metrics: ["sleep_score", "sleep_efficiency", "sleep_hours"],
    isConnected: (...args: unknown[]) => isConnected(...args),
    getProgress: (...args: unknown[]) => getProgress(...args),
    ...overrides,
  };
}

// A full internal progress object. The route must forward only a slice of it;
// the rest (raw scores, baseline, the day array) must never reach the client.
const FULL_PROGRESS = {
  streakDays: 6,
  lastNight: 88,
  qualified: false,
  baselineWeekAvg: 71.5,
  days: [
    { date: "2026-08-16", score: 88 },
    { date: "2026-08-15", score: 79 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAddressSignature.mockResolvedValue({ ok: true, address: USER });
  providerFor.mockResolvedValue(stubProvider());
  isConnected.mockResolvedValue(true);
  getProgress.mockResolvedValue(FULL_PROGRESS);
});

describe("GET /api/wearable/progress", () => {
  it("rejects a missing or malformed address before auth or any read", async () => {
    const res = await get("?address=0xnope");
    expect(res.status).toBe(400);
    expect(requireAddressSignature).not.toHaveBeenCalled();
    expect(providerFor).not.toHaveBeenCalled();
    expect(getProgress).not.toHaveBeenCalled();
  });

  it("refuses an unsigned read: 401 and NOTHING is read from the provider", async () => {
    requireAddressSignature.mockResolvedValue({
      ok: false,
      reason: "missing wallet signature headers",
    });
    const res = await get(`?address=${USER}`);
    expect(res.status).toBe(401);
    // The boundary: no signature, no health read. Not even a provider lookup.
    expect(providerFor).not.toHaveBeenCalled();
    expect(isConnected).not.toHaveBeenCalled();
    expect(getProgress).not.toHaveBeenCalled();
  });

  it("reports not-connected as connected:false, never a 404", async () => {
    isConnected.mockResolvedValue(false);
    const res = await get(`?address=${USER}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      connected: false,
      provider: "junction",
      linkState: "not-linked",
      metric: null,
      streakDays: null,
      targetDays: 7,
      lastSync: null,
    });
    expect(getProgress).not.toHaveBeenCalled();
  });

  it("forwards ONLY the derived scalars, never raw scores or the day array", async () => {
    const res = await get(`?address=${USER}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // What the client is allowed to see.
    expect(body).toEqual({
      connected: true,
      provider: "junction",
      // Data has arrived, so the link is fully live - not the awaiting state.
      linkState: "linked",
      metric: "Sleep score ≥ 75",
      streakDays: 6,
      targetDays: 7,
      lastSync: "2026-08-16",
    });

    // What must never cross the boundary, asserted on the serialized text so a
    // nested leak cannot slip through a shape check.
    const text = JSON.stringify(body);
    expect(body).not.toHaveProperty("days");
    expect(body).not.toHaveProperty("lastNight");
    expect(body).not.toHaveProperty("baselineWeekAvg");
    expect(text).not.toContain("lastNight");
    expect(text).not.toContain("baselineWeekAvg");
    expect(text).not.toContain("88"); // a raw per-night score
    expect(text).not.toContain("79"); // another raw per-night score
    expect(text).not.toContain("71.5"); // the baseline average
  });

  it("names the provider that actually answered, per wallet", async () => {
    providerFor.mockResolvedValue(stubProvider({ id: "whoop", label: "WHOOP" }));
    const res = await get(`?address=${USER}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { provider: string; streakDays: number };
    expect(body.provider).toBe("whoop");
    expect(body.streakDays).toBe(6);
    expect(providerFor).toHaveBeenCalledWith(USER);
  });

  it("names the provider on the not-connected answer too", async () => {
    providerFor.mockResolvedValue(stubProvider({ id: "whoop", label: "WHOOP" }));
    isConnected.mockResolvedValue(false);
    const res = await get(`?address=${USER}`);
    expect(await res.json()).toEqual({
      connected: false,
      provider: "whoop",
      linkState: "not-linked",
      metric: null,
      streakDays: null,
      targetDays: 7,
      lastSync: null,
    });
  });

  it("scopes progress to a pool window and labels the metric with the start", async () => {
    // start/end are unix seconds; targetDays is the inclusive day span.
    const start = Math.floor(Date.parse("2026-08-10T00:00:00Z") / 1000);
    const end = Math.floor(Date.parse("2026-08-16T00:00:00Z") / 1000);
    const res = await get(`?address=${USER}&start=${start}&end=${end}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { metric: string; targetDays: number };
    expect(body.targetDays).toBe(7);
    expect(body.metric).toContain("since 2026-08-10");
    // The window ISO bounds are handed to getProgress, not re-derived here.
    const call = getProgress.mock.calls[0];
    expect(call[3]).toBe("2026-08-10");
    expect(call[4]).toBe("2026-08-16");
  });

  it("rejects an out-of-range threshold", async () => {
    const res = await get(`?address=${USER}&threshold=250`);
    expect(res.status).toBe(400);
    expect(getProgress).not.toHaveBeenCalled();
  });

  it("answers an upstream failure with a generic 502 and logs the real cause", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    isConnected.mockRejectedValue(
      new Error("Junction /v2/user/providers/vital-1 returned 402: payment required"),
    );
    const res = await get(`?address=${USER}`);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    // No upstream path, account state, or provider message on the wire.
    expect(body.error).toBe("Health data is temporarily unavailable");
    expect(body.error).not.toContain("402");
    expect(body.error).not.toContain("providers");
    // Loud where it matters.
    expect(consoleError).toHaveBeenCalledOnce();
    expect(String(consoleError.mock.calls[0])).toContain("402");
    consoleError.mockRestore();
  });
});
