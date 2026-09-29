import { describe, it, expect } from "vitest";
import {
  MONEY_IN_PAUSED_TITLE,
  cleanKillReason,
  moneyInPausedDetail,
  moneyInStateOf,
  parseSwitches,
  withKillReason,
} from "@/lib/switches";

// What the browser makes of GET /api/switches. The join rule holds here too:
// a read that has not answered is "loading" and one that failed is "error",
// never the permissive "open".

describe("parseSwitches", () => {
  it("reads the route's answer", () => {
    expect(parseSwitches({ worldId: false, baseMoneyIn: true, reason: "Back Friday." })).toEqual({
      worldId: false,
      baseMoneyIn: true,
      reason: "Back Friday.",
    });
    expect(parseSwitches({ worldId: true, baseMoneyIn: false, reason: null })).toEqual({
      worldId: true,
      baseMoneyIn: false,
      reason: null,
    });
  });

  it("refuses anything that is not two booleans", () => {
    expect(parseSwitches(null)).toBeNull();
    expect(parseSwitches({})).toBeNull();
    expect(parseSwitches({ worldId: "1", baseMoneyIn: false })).toBeNull();
    expect(parseSwitches({ worldId: false, baseMoneyIn: "true" })).toBeNull();
  });

  it("cleans a reason it did not expect", () => {
    expect(parseSwitches({ worldId: false, baseMoneyIn: true, reason: 7 })?.reason).toBeNull();
    expect(parseSwitches({ worldId: false, baseMoneyIn: true, reason: "  " })?.reason).toBeNull();
  });
});

describe("moneyInStateOf", () => {
  it("is open or paused once the switches answered", () => {
    expect(moneyInStateOf({ data: { worldId: false, baseMoneyIn: false, reason: null }, isError: false })).toBe("open");
    expect(moneyInStateOf({ data: { worldId: true, baseMoneyIn: false, reason: null }, isError: false })).toBe("open");
    expect(moneyInStateOf({ data: { worldId: false, baseMoneyIn: true, reason: null }, isError: false })).toBe("paused");
  });

  it("holds while loading and on a failed read, never open", () => {
    expect(moneyInStateOf({ data: undefined, isError: false })).toBe("loading");
    expect(moneyInStateOf({ data: undefined, isError: true })).toBe("error");
  });
});

describe("the paused copy", () => {
  it("says new money is paused and money already in still comes out", () => {
    const detail = moneyInPausedDetail(null);
    expect(MONEY_IN_PAUSED_TITLE).toBe("New stakes are paused for now");
    expect(detail).toContain("Money already in still pays out and refunds as normal.");
    expect(detail).not.toMatch(/[!—]/);
    expect(detail).not.toMatch(/\b(run|pool|dare|bet|wager|odds|winner)\b/i);
  });

  it("adds the operator's reason as its own sentence when set", () => {
    expect(moneyInPausedDetail("Back after the upgrade on Friday.")).toMatch(
      /refunds as normal\..* Back after the upgrade on Friday\.$/,
    );
    expect(withKillReason("Base line.", null)).toBe("Base line.");
    expect(withKillReason("Base line.", "Back soon")).toBe("Base line. Back soon");
  });

  it("cleans a reason: trimmed, one line, capped", () => {
    expect(cleanKillReason(undefined)).toBeNull();
    expect(cleanKillReason("  a\n b  ")).toBe("a b");
    expect(cleanKillReason("y".repeat(300))).toHaveLength(200);
  });
});
