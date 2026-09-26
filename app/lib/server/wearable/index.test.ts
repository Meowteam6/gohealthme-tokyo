import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";

// Which provider serves a wallet decides which health data backs its payouts,
// and SPOTTER resolves it from a cron long after the browser is gone. The rule
// that matters most is the conditional one: a stored choice only wins while
// that provider is still configured, so pulling a credential degrades to
// "connect a device" rather than throwing a missing-env error at every read.

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

const {
  PROVIDER_IDS,
  availableProviders,
  providerById,
  providerConfigured,
  providerIdFor,
  setProviderId,
  storedProviderId,
  wearableReadServices,
} = await import("@/lib/server/wearable");

function configureBoth(): void {
  vi.stubEnv("JUNCTION_API_KEY", "sk_test");
  vi.stubEnv("WHOOP_CLIENT_ID", "client-id");
  vi.stubEnv("WHOOP_CLIENT_SECRET", "client-secret");
  vi.stubEnv("WHOOP_REDIRECT_URI", "https://example.test/api/whoop/callback");
  vi.stubEnv("WEARABLE_TOKEN_KEY", Buffer.alloc(32, 5).toString("base64"));
}

beforeEach(() => {
  configureBoth();
  vi.stubEnv("WEARABLE_PROVIDER_DEFAULT", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const { appleAppAvailable, appleConfigured } = await import(
  "@/lib/server/wearable/apple"
);

describe("apple is offered only when its phone app ships", () => {
  it("is not configured without the app flag, whatever the database says", () => {
    // A database alone made Apple look pairable to people who had no app to
    // install: "open the app on your iPhone" for an app with no public build,
    // then every wearable run locked. Hidden until the flag says it ships.
    vi.stubEnv("APPLE_APP_AVAILABLE", "");
    expect(appleAppAvailable()).toBe(false);
    expect(providerConfigured("apple")).toBe(false);
    expect(availableProviders()).not.toContain("apple");
  });

  it("follows the store once the app flag is on", () => {
    vi.stubEnv("APPLE_APP_AVAILABLE", "1");
    expect(appleAppAvailable()).toBe(true);
    expect(providerConfigured("apple")).toBe(appleConfigured());
  });
});

describe("providerConfigured", () => {
  it("needs the token key for whoop, because it stores user credentials", () => {
    expect(providerConfigured("whoop")).toBe(true);
    vi.stubEnv("WEARABLE_TOKEN_KEY", "");
    // Reporting whoop as available with nowhere safe to put tokens would look
    // like an outage the moment somebody tried to link.
    expect(providerConfigured("whoop")).toBe(false);
    expect(providerConfigured("junction")).toBe(true);
  });

  it("needs an api key for junction", () => {
    vi.stubEnv("JUNCTION_API_KEY", "");
    expect(providerConfigured("junction")).toBe(false);
  });
});

describe("availableProviders", () => {
  it("lists only what this deployment can actually serve", () => {
    expect(availableProviders()).toEqual(["junction", "whoop"]);
    vi.stubEnv("JUNCTION_API_KEY", "");
    expect(availableProviders()).toEqual(["whoop"]);
  });
});

describe("providerIdFor", () => {
  it("defaults to junction when nothing is chosen", async () => {
    expect(await providerIdFor(nextAddress())).toBe("junction");
  });

  it("honours a stored choice", async () => {
    const address = nextAddress();
    await setProviderId(address, "whoop");
    expect(await storedProviderId(address)).toBe("whoop");
    expect(await providerIdFor(address)).toBe("whoop");
  });

  it("is case-insensitive on the address", async () => {
    const address = nextAddress();
    await setProviderId(address.toUpperCase(), "whoop");
    expect(await providerIdFor(address.toLowerCase())).toBe("whoop");
  });

  it("falls back when the chosen provider is no longer configured", async () => {
    const address = nextAddress();
    await setProviderId(address, "whoop");
    vi.stubEnv("WHOOP_CLIENT_ID", "");

    // The user sees "connect a device", which is true and actionable, instead
    // of a 500 from a missing env var on every read.
    expect(await providerIdFor(address)).toBe("junction");
  });

  it("uses the only configured provider before consulting the env default", async () => {
    vi.stubEnv("JUNCTION_API_KEY", "");
    vi.stubEnv("WEARABLE_PROVIDER_DEFAULT", "junction");
    expect(await providerIdFor(nextAddress())).toBe("whoop");
  });

  it("honours WEARABLE_PROVIDER_DEFAULT when both are configured", async () => {
    vi.stubEnv("WEARABLE_PROVIDER_DEFAULT", "whoop");
    expect(await providerIdFor(nextAddress())).toBe("whoop");
  });

  it("ignores a default naming an unconfigured or unknown provider", async () => {
    vi.stubEnv("WEARABLE_PROVIDER_DEFAULT", "fitbit");
    expect(await providerIdFor(nextAddress())).toBe("junction");
    vi.stubEnv("WEARABLE_PROVIDER_DEFAULT", "whoop");
    vi.stubEnv("WHOOP_CLIENT_SECRET", "");
    expect(await providerIdFor(nextAddress())).toBe("junction");
  });
});

describe("wearableReadServices", () => {
  it("names every provider's read service, for the client-side mirror", () => {
    // lib/claim-restore.ts hardcodes this same set because it cannot import a
    // server module. A provider missing there sends returning users to the
    // wrong proof tab over a claim SPOTTER already paid for.
    expect(wearableReadServices()).toEqual([
      "junction-read",
      "whoop-read",
      "apple-read",
    ]);
    expect(providerById("whoop").readService).toBe("whoop-read");
    expect(providerById("junction").readService).toBe("junction-read");
    expect(providerById("apple").readService).toBe("apple-read");
  });
});

describe("provider contract", () => {
  it("every registered provider declares a linkKind", () => {
    // A provider that forgets it makes the link route's recording decision on
    // undefined, which silently takes the app-shaped branch.
    for (const id of PROVIDER_IDS) {
      expect(["oauth", "app"]).toContain(providerById(id).linkKind);
    }
  });

  it("every registered provider declares at least one metric", () => {
    // An empty list would hide every wearable pool from that provider's users
    // rather than failing visibly.
    for (const id of PROVIDER_IDS) {
      expect(providerById(id).metrics.length).toBeGreaterThan(0);
    }
  });

  it("every registered provider has a distinct read service name", () => {
    // lib/claim-restore.ts maps these back to a proof tab. A duplicate would
    // send one provider's users to another's surface.
    const services = PROVIDER_IDS.map((id) => providerById(id).readService);
    expect(new Set(services).size).toBe(services.length);
  });
});

// F5 (fix/record-misses review): the miss rule reads the provider a wallet
// had when the run began, so repointing the wallet afterwards (one signed
// "Connect WHOOP" tap, abandoned at consent) cannot turn real data into none.
const { pinnedProviderId } = await import("@/lib/server/wearable");
const { writeJson } = await import("@/lib/server/store");

describe("pinnedProviderId", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function at(iso: string): void {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  }
  const sec = (iso: string) => BigInt(Date.parse(iso) / 1000);

  it("keeps the provider stored at periodStart after a switch", async () => {
    const address = nextAddress();
    at("2026-09-25T00:00:00Z");
    await setProviderId(address, "junction");
    at("2026-09-27T12:00:00Z");
    await setProviderId(address, "whoop");
    expect(await storedProviderId(address)).toBe("whoop");
    expect(await pinnedProviderId(address, sec("2026-09-26T02:39:43Z"))).toBe("junction");
  });

  it("pins the first choice made after periodStart when there was none before", async () => {
    const address = nextAddress();
    at("2026-09-26T05:00:00Z");
    await setProviderId(address, "junction");
    at("2026-09-27T12:00:00Z");
    await setProviderId(address, "whoop");
    expect(await pinnedProviderId(address, sec("2026-09-26T02:39:43Z"))).toBe("junction");
  });

  it("reads a record written before the history existed as its one choice", async () => {
    const address = nextAddress();
    await writeJson(`wearable-provider:${address.toLowerCase()}`, {
      provider: "junction",
      updatedAt: Date.parse("2026-09-20T00:00:00Z"),
    });
    at("2026-09-27T12:00:00Z");
    await setProviderId(address, "whoop");
    expect(await pinnedProviderId(address, sec("2026-09-26T02:39:43Z"))).toBe("junction");
  });

  it("is null for a wallet that never chose", async () => {
    expect(await pinnedProviderId(nextAddress(), sec("2026-09-26T02:39:43Z"))).toBeNull();
  });
});
