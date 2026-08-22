import { describe, it, expect } from "vitest";
import { toBaseUnits, fromBaseUnits, USDC_DECIMALS } from "@/lib/usdc";

describe("usdc", () => {
  it("has 6 decimals", () => {
    expect(USDC_DECIMALS).toBe(6);
  });
  it("converts whole and fractional USDC to base-unit strings", () => {
    expect(toBaseUnits("1")).toBe("1000000");
    expect(toBaseUnits("1.99")).toBe("1990000");
    expect(toBaseUnits("0.25")).toBe("250000");
  });
  it("rejects more than 6 decimal places", () => {
    expect(() => toBaseUnits("1.1234567")).toThrow();
  });
  it("round-trips back to a decimal string", () => {
    expect(fromBaseUnits("1990000")).toBe("1.99");
    expect(fromBaseUnits("1000000")).toBe("1");
  });
});
