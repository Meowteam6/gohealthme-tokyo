import { describe, expect, it } from "vitest";
import { joinCoinCopy } from "./join-coin";

const ONE_USDC = 1_000_000n;

describe("joinCoinCopy", () => {
  it("names the stake on the hold button and in its confirm", () => {
    const copy = joinCoinCopy(ONE_USDC, "idle");
    expect(copy.face).toBe("1.00");
    expect(copy.label).toBe("Hold to stake 1.00 USDC");
    expect(copy.confirmLabel).toBe("Stake 1.00 USDC");
    expect(copy.hint).toBe("About a second. Let go to cancel.");
    expect(copy.committedHint).toContain("1.00 USDC");
    expect(copy.disabledReason).toBeNull();
  });

  it("never says coin now that the stake is a hold button", () => {
    for (const phase of ["idle", "wallet-loading", "checking", "joining", "retry"] as const) {
      const text = Object.values(joinCoinCopy(ONE_USDC, phase)).join(" ");
      expect(text).not.toMatch(/\bcoin\b/i);
    }
  });

  it("never offers the coin while a join is in flight, and says why", () => {
    for (const phase of ["wallet-loading", "checking", "joining"] as const) {
      const reason = joinCoinCopy(ONE_USDC, phase).disabledReason;
      expect(reason).not.toBeNull();
      expect(reason).not.toBe("");
    }
  });

  it("says the stake did not move before asking for another hold after a failure", () => {
    const copy = joinCoinCopy(ONE_USDC, "retry");
    expect(copy.hint).toMatch(/^Your stake did not move\./);
    expect(copy.disabledReason).toBeNull();
  });

  it("does not ask for money on a free run", () => {
    const copy = joinCoinCopy(0n, "idle");
    expect(copy.face).toBe("Free");
    expect(copy.label).not.toMatch(/USDC/);
    expect(copy.confirmLabel).not.toMatch(/USDC/);
    expect(copy.hint).toMatch(/costs nothing/);
  });

  it("never uses bet language", () => {
    for (const phase of ["idle", "wallet-loading", "checking", "joining", "retry"] as const) {
      const text = Object.values(joinCoinCopy(ONE_USDC, phase)).join(" ");
      expect(text).not.toMatch(/\b(bet|wager|odds|gambl)/i);
    }
  });
});
