import { afterEach, describe, expect, it, vi } from "vitest";
import { openBeta } from "@/lib/open-beta";

// The open-beta switch (Andre and Nikki, 2026-10-07). One reader for the
// browser bundle and the server, so no two gates can disagree about it. Only
// the literal "1" turns it on: the same spelling playwright.config.ts has
// always used, so the suite's meaning of the flag is unchanged.

describe("openBeta", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is on when NEXT_PUBLIC_ACCESS_GATE_DISABLED is exactly 1", () => {
    vi.stubEnv("NEXT_PUBLIC_ACCESS_GATE_DISABLED", "1");
    expect(openBeta()).toBe(true);
  });

  it("is off for an empty value, true, or 0", () => {
    for (const value of ["", "true", "0"]) {
      vi.stubEnv("NEXT_PUBLIC_ACCESS_GATE_DISABLED", value);
      expect(openBeta(), JSON.stringify(value)).toBe(false);
    }
  });

  it("is off when the variable is not set at all", () => {
    const saved = process.env.NEXT_PUBLIC_ACCESS_GATE_DISABLED;
    delete process.env.NEXT_PUBLIC_ACCESS_GATE_DISABLED;
    try {
      expect(openBeta()).toBe(false);
    } finally {
      if (saved !== undefined) process.env.NEXT_PUBLIC_ACCESS_GATE_DISABLED = saved;
    }
  });
});
