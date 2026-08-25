import { describe, it, expect } from "vitest";
import {
  BLOCKED_STATES,
  isStateBlocked,
  normalizeStateCode,
  stateBlockReason,
} from "@/lib/geo-blocklist";

describe("geo-blocklist", () => {
  const BLOCKED_CODES = Object.keys(BLOCKED_STATES);

  it("lists exactly the 14 pilot-excluded states", () => {
    expect(BLOCKED_CODES.sort()).toEqual(
      ["AR", "AZ", "CO", "CT", "DE", "LA", "MD", "MT", "ND", "NE", "SC", "SD", "TN", "VT"].sort(),
    );
  });

  it("blocks every listed state by code", () => {
    for (const code of BLOCKED_CODES) {
      expect(isStateBlocked(code)).toBe(true);
    }
  });

  it("allows states that are not on the list", () => {
    for (const allowed of ["CA", "NY", "TX", "WA", "FL", "IL"]) {
      expect(isStateBlocked(allowed)).toBe(false);
      expect(stateBlockReason(allowed)).toBeNull();
    }
  });

  it("resolves full state names as well as codes", () => {
    expect(isStateBlocked("Colorado")).toBe(true);
    expect(isStateBlocked("south carolina")).toBe(true);
    expect(isStateBlocked("North Dakota")).toBe(true);
    expect(isStateBlocked("California")).toBe(false);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(isStateBlocked("  az  ")).toBe(true);
    expect(isStateBlocked("Az")).toBe(true);
    expect(isStateBlocked("  Tennessee ")).toBe(true);
    expect(normalizeStateCode(" co ")).toBe("CO");
  });

  it("treats empty, null, and undefined input as not blocked", () => {
    expect(isStateBlocked("")).toBe(false);
    expect(isStateBlocked(null)).toBe(false);
    expect(isStateBlocked(undefined)).toBe(false);
    expect(normalizeStateCode("")).toBeNull();
  });

  it("does not block an unknown two-letter code (fail-open by design)", () => {
    // Documents the fail-open the gate must guard: a code we do not list is
    // allowed, so the gate must collect a canonical state, not free text.
    expect(isStateBlocked("ZZ")).toBe(false);
    expect(normalizeStateCode("ZZ")).toBe("ZZ");
  });

  it("gives a skill-staking reason for a skill-staking state", () => {
    expect(stateBlockReason("AZ")).toMatch(/skill contests/i);
  });

  it("gives a consideration reason for a consideration state", () => {
    expect(stateBlockReason("CO")).toMatch(/entry stake/i);
  });

  it("every blocked state returns a non-null reason", () => {
    for (const code of BLOCKED_CODES) {
      expect(stateBlockReason(code)).not.toBeNull();
    }
  });
});
