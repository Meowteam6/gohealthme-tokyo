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
    expect(wearableReadServices()).toEqual(["junction-read", "whoop-read"]);
    expect(providerById("whoop").readService).toBe("whoop-read");
    expect(providerById("junction").readService).toBe("junction-read");
  });
});
