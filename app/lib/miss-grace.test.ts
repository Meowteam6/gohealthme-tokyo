import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MISS_GRACE_HOURS,
  MAX_MISS_GRACE_HOURS,
  MIN_MISS_GRACE_HOURS,
  missDeadlineMs,
  missGraceSeconds,
  parseMissGraceHours,
} from "@/lib/miss-grace";

// MISS_GRACE_HOURS is how long SPOTTER waits after a run ends before it may
// record a miss. Pinned here: the default, the clamp that keeps the miss write
// and the settle inside the contract's 24h settler-only window, and the
// fallback on garbage.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseMissGraceHours", () => {
  it("defaults to 6 hours when unset or blank", () => {
    expect(DEFAULT_MISS_GRACE_HOURS).toBe(6);
    expect(parseMissGraceHours(undefined)).toEqual({ hours: 6, adjusted: false });
    expect(parseMissGraceHours("  ")).toEqual({ hours: 6, adjusted: false });
  });

  it("reads a valid value, fractional included", () => {
    expect(parseMissGraceHours("2")).toEqual({ hours: 2, adjusted: false });
    expect(parseMissGraceHours("1.5")).toEqual({ hours: 1.5, adjusted: false });
  });

  it("clamps into 1..18 so the miss and the settle land inside the 24h settler window", () => {
    expect(MIN_MISS_GRACE_HOURS).toBe(1);
    expect(MAX_MISS_GRACE_HOURS).toBe(18);
    expect(parseMissGraceHours("0.1")).toEqual({ hours: 1, adjusted: true });
    expect(parseMissGraceHours("0")).toEqual({ hours: 1, adjusted: true });
    expect(parseMissGraceHours("40")).toEqual({ hours: 18, adjusted: true });
  });

  it("falls back to the default on a value that is not a number", () => {
    expect(parseMissGraceHours("six")).toEqual({ hours: 6, adjusted: true });
    expect(parseMissGraceHours("-3h")).toEqual({ hours: 6, adjusted: true });
  });
});

describe("missGraceSeconds / missDeadlineMs", () => {
  it("reads MISS_GRACE_HOURS from the environment", () => {
    vi.stubEnv("MISS_GRACE_HOURS", "3");
    expect(missGraceSeconds()).toBe(3 * 3600);
  });

  it("uses the default when the variable is unset", () => {
    vi.stubEnv("MISS_GRACE_HOURS", "");
    expect(missGraceSeconds()).toBe(6 * 3600);
  });

  it("puts the deadline grace hours after periodEnd, in epoch ms", () => {
    vi.stubEnv("MISS_GRACE_HOURS", "6");
    expect(missDeadlineMs(1_790_465_400n)).toBe((1_790_465_400 + 6 * 3600) * 1000);
    expect(missDeadlineMs(1_790_465_400)).toBe((1_790_465_400 + 6 * 3600) * 1000);
  });
});
