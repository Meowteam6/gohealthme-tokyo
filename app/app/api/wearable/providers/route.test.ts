import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// WHOOP is offered only to allowlisted wallets; a wallet already linked to
// WHOOP keeps its link visible either way.

const providerConfigured = vi.fn();
const providerIdFor = vi.fn();
const isConnected = vi.fn();
const observedMetrics = vi.fn();
const requireAddressSignature = vi.fn();

vi.mock("@/lib/server/wearable", () => ({
  PROVIDER_IDS: ["junction", "whoop", "apple"],
  providerConfigured: (...a: unknown[]) => providerConfigured(...a),
  providerIdFor: (...a: unknown[]) => providerIdFor(...a),
  providerById: (id: string) => ({
    id,
    label: id,
    metrics: [],
    isConnected: (...a: unknown[]) => isConnected(id, ...a),
    observedMetrics: (...a: unknown[]) => observedMetrics(id, ...a),
  }),
}));
vi.mock("@/lib/server/wallet-auth", () => ({
  requireAddressSignature: (...a: unknown[]) => requireAddressSignature(...a),
}));


const seat = { allowed: true, seatsLeft: 5 };
vi.mock("@/lib/server/wearable/whoop-seats", () => ({
  whoopSeatStatus: async () => ({ ...seat }),
  claimWhoopSeat: async () => undefined,
}));

// Apple's two gates: the store (Supabase) and the app flag (APPLE_APP_AVAILABLE).
const appleConfigured = vi.fn();
const appleAppAvailable = vi.fn();
vi.mock("@/lib/server/wearable/apple", () => ({
  appleConfigured: () => appleConfigured(),
  appleAppAvailable: () => appleAppAvailable(),
}));

const { GET } = await import("@/app/api/wearable/providers/route");

const USER = "0x1111111111111111111111111111111111111111";

interface Entry {
  id: string;
  configured: boolean;
  connected: boolean;
  note: string | null;
  capability: string;
}

async function entry(id: string, query: string): Promise<Entry | undefined> {
  const res = await GET(new NextRequest(`https://app.test/api/wearable/providers${query}`));
  const body = (await res.json()) as { providers: Entry[] };
  return body.providers.find((p) => p.id === id);
}

async function whoopEntry(query: string) {
  return entry("whoop", query);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  providerConfigured.mockReturnValue(true);
  providerIdFor.mockResolvedValue("junction");
  isConnected.mockResolvedValue(false);
  observedMetrics.mockResolvedValue({ kind: "declared" });
  requireAddressSignature.mockResolvedValue({ ok: true, address: USER });
  seat.allowed = true;
  seat.seatsLeft = 5;
  appleConfigured.mockReturnValue(true);
  appleAppAvailable.mockReturnValue(true);
});

describe("GET /api/wearable/providers probes Apple whenever it is linked (2026-10-06)", () => {
  // Apple records itself as the wallet's provider only when the first day
  // arrives, so a phone that redeemed a code and has not synced is linked
  // while the stored choice is still Junction. The pairing panel reads
  // Apple's entry directly, and "declared" there renders as paired with every
  // metric. The probe is our own table, so it costs nothing upstream.
  it("answers Apple's capability while another provider is the stored choice", async () => {
    providerIdFor.mockResolvedValue("junction");
    isConnected.mockImplementation(async (id: string) => id === "apple");
    observedMetrics.mockImplementation(async (id: string) =>
      id === "apple" ? { kind: "awaiting-sync" } : { kind: "declared" },
    );

    const apple = await entry("apple", `?address=${USER}`);

    expect(apple?.connected).toBe(true);
    expect(apple?.capability).toBe("awaiting-sync");
    expect(observedMetrics).toHaveBeenCalledWith("apple", USER);
  });

  it("still probes a vendor provider only when it is the stored choice", async () => {
    providerIdFor.mockResolvedValue("whoop");
    isConnected.mockResolvedValue(true);

    const junction = await entry("junction", `?address=${USER}`);

    expect(junction?.connected).toBe(true);
    expect(junction?.capability).toBe("declared");
    expect(observedMetrics).not.toHaveBeenCalledWith("junction", USER);
    expect(observedMetrics).toHaveBeenCalledWith("whoop", USER);
  });

  it("does not probe an Apple that is not linked", async () => {
    isConnected.mockResolvedValue(false);
    await entry("apple", `?address=${USER}`);
    expect(observedMetrics).not.toHaveBeenCalled();
  });
});

describe("GET /api/wearable/providers Apple flag (2026-10-06)", () => {
  // A wallet whose iPhone already synced is read through Junction when the
  // flag is off (lib/server/wearable/index.ts rule 1). That fallback must
  // never be silent: the picker says the build is not open for Apple yet.
  it("says Apple Watch is not open on this build when the store exists but the flag is off", async () => {
    providerConfigured.mockImplementation((id: string) => id !== "apple");
    appleAppAvailable.mockReturnValue(false);
    for (const query of ["", `?address=${USER}`]) {
      const apple = await entry("apple", query);
      expect(apple?.configured, query).toBe(false);
      expect(apple?.note, query).toBe("Apple Watch is not open on this build yet.");
    }
  });

  it("offers Apple with no note once the flag is on", async () => {
    const apple = await entry("apple", `?address=${USER}`);
    expect(apple?.configured).toBe(true);
    expect(apple?.note).toBeNull();
  });

  it("has nothing to explain when the deployment has no Apple store at all", async () => {
    providerConfigured.mockImplementation((id: string) => id !== "apple");
    appleConfigured.mockReturnValue(false);
    appleAppAvailable.mockReturnValue(false);
    const apple = await entry("apple", "");
    expect(apple?.configured).toBe(false);
    expect(apple?.note).toBeNull();
  });
});

describe("GET /api/wearable/providers WHOOP seats", () => {
  it("offers WHOOP to anyone while seats remain, with or without an address", async () => {
    expect((await whoopEntry(""))?.configured).toBe(true);
    expect((await whoopEntry(`?address=${USER}`))?.configured).toBe(true);
  });

  it("stops offering WHOOP once the seats are full, and says why", async () => {
    seat.allowed = false;
    seat.seatsLeft = 0;
    expect((await whoopEntry(""))?.configured).toBe(false);
    const whoop = await whoopEntry(`?address=${USER}`);
    expect(whoop?.configured).toBe(false);
    expect((whoop as unknown as { note: string | null }).note).toMatch(/seats are full/);
  });

  it("keeps an existing WHOOP link visible after the wallet leaves the list", async () => {
    seat.allowed = false;
    seat.seatsLeft = 0;
    isConnected.mockImplementation(async (id: string) => id === "whoop");
    const whoop = await whoopEntry(`?address=${USER}`);
    expect(whoop?.connected).toBe(true);
    expect(whoop?.configured).toBe(true);
  });
});
