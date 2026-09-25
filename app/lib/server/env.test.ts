import { describe, it, expect, vi, afterEach } from "vitest";
import {
  demoModeEnabled,
  FROZEN_V3_POOLS_ADDRESS,
  FrozenPoolsError,
  requireHealthPoolsAddress,
} from "@/lib/server/env";
import { getHealthPoolsAddress } from "@/lib/contract";
import { poolsScanFromBlock } from "@/lib/server/chunked-logs";

// Production-safety guards that every money path and every scan resolves
// through. Pinned so V4 can never act on the frozen V3 pilot pools and a
// stray DEMO_MODE can never mint mocked verdicts for real users.

const TOKYO = "0x1234567890123456789012345678901234567890";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("requireHealthPoolsAddress (SPOTTER, oracle, verdict, pools)", () => {
  it("refuses the frozen V3 pilot address in any casing", () => {
    vi.stubEnv("HEALTH_POOLS_ADDRESS", FROZEN_V3_POOLS_ADDRESS);
    expect(() => requireHealthPoolsAddress()).toThrow(FrozenPoolsError);
    vi.stubEnv("HEALTH_POOLS_ADDRESS", FROZEN_V3_POOLS_ADDRESS.toLowerCase());
    expect(() => requireHealthPoolsAddress()).toThrow(/frozen V3 pilot/);
  });

  it("refuses a missing or malformed address", () => {
    vi.stubEnv("HEALTH_POOLS_ADDRESS", "");
    expect(() => requireHealthPoolsAddress()).toThrow(/HEALTH_POOLS_ADDRESS/);
    vi.stubEnv("HEALTH_POOLS_ADDRESS", "0x123");
    expect(() => requireHealthPoolsAddress()).toThrow(/not a 0x address/);
  });

  it("returns the Tokyo address", () => {
    vi.stubEnv("HEALTH_POOLS_ADDRESS", TOKYO);
    expect(requireHealthPoolsAddress()).toBe(TOKYO);
  });
});

describe("getHealthPoolsAddress (browser and public reads)", () => {
  it("treats the frozen V3 address as not configured", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NEXT_PUBLIC_HEALTH_POOLS_ADDRESS", FROZEN_V3_POOLS_ADDRESS);
    expect(getHealthPoolsAddress()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_HEALTH_POOLS_ADDRESS", TOKYO);
    expect(getHealthPoolsAddress()).toBe(TOKYO);
  });
});

describe("poolsScanFromBlock", () => {
  it("reads HEALTH_POOLS_FROM_BLOCK, then the NEXT_PUBLIC twin, then the default", () => {
    vi.stubEnv("HEALTH_POOLS_FROM_BLOCK", "");
    vi.stubEnv("NEXT_PUBLIC_HEALTH_POOLS_FROM_BLOCK", "");
    expect(poolsScanFromBlock()).toBe(45_800_000n);
    vi.stubEnv("NEXT_PUBLIC_HEALTH_POOLS_FROM_BLOCK", "46100000");
    expect(poolsScanFromBlock()).toBe(46_100_000n);
    vi.stubEnv("HEALTH_POOLS_FROM_BLOCK", "46200000");
    expect(poolsScanFromBlock()).toBe(46_200_000n);
    vi.stubEnv("HEALTH_POOLS_FROM_BLOCK", "not-a-block");
    expect(poolsScanFromBlock()).toBe(46_100_000n);
  });
});

describe("demoModeEnabled", () => {
  it("is on only when asked, and never on a production deployment", () => {
    vi.stubEnv("DEMO_MODE", "");
    expect(demoModeEnabled()).toBe(false);
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(demoModeEnabled()).toBe(true);
    vi.stubEnv("VERCEL_ENV", "production");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(demoModeEnabled()).toBe(false);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("REFUSED"));
  });
});
