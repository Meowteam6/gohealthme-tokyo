import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import {
  MONEY_ALREADY_IN_LINE,
  MONEY_IN_PAUSED_TITLE,
  cleanKillReason,
  moneyInPausedDetail,
  moneyInStateOf,
  parseSwitches,
  testUsdcPausedDetail,
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

  it("strips bidi overrides so a reason cannot reorder the line around it", () => {
    // U+202A-202E (embeddings and overrides) and U+2066-2069 (isolates).
    const bidi = "\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069";
    expect(cleanKillReason(`Back\u202e soon${bidi}`)).toBe("Back soon");
    expect(cleanKillReason("\u2067Back soon\u2069")).toBe("Back soon");
  });

  it("strips zero-width characters, and a reason made only of them is null", () => {
    // U+200B-200F (zero-width space, joiners, LRM, RLM) and U+FEFF (BOM).
    expect(cleanKillReason("Ba\u200bck\u200c so\u200d\u200e\u200fon\ufeff")).toBe("Back soon");
    expect(cleanKillReason("\u200b\u200f\ufeff")).toBeNull();
    expect(cleanKillReason(" \u200b \ufeff ")).toBeNull();
  });

  it("strips the other invisible marks of the same kind: ALM and the word joiner", () => {
    // U+061C (Arabic letter mark, a bidi mark like LRM) and U+2060-2064 (word
    // joiner and the invisible operators).
    expect(cleanKillReason("Back\u061c soon\u2060\u2061\u2062\u2063\u2064")).toBe("Back soon");
  });

  it("caps the length after stripping, so invisible padding cannot eat the note", () => {
    expect(cleanKillReason(`${"\u200b".repeat(500)}Back soon`)).toBe("Back soon");
  });

  it("keeps the stripped characters out of the source itself", () => {
    // Raw bidi controls in a regex literal are invisible to a reviewer and can
    // reorder how the code around them displays (Trojan Source). The ranges
    // are written as \u escapes.
    const source = readFileSync(fileURLToPath(new URL("./switches.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/);
  });
});

describe("testUsdcPausedDetail", () => {
  it("says plainly that new test USDC is paused, with or without a delivery", () => {
    for (const delivered of [true, false]) {
      const line = testUsdcPausedDetail(null, delivered);
      expect(line).toMatch(/^New test USDC is paused for now/);
      expect(line).not.toMatch(/[!—]/);
      expect(line).not.toMatch(/\b(run|pool|dare|bet|wager|odds|winner)\b/i);
    }
  });

  it("tells a player whose waiting balance went out that it did", () => {
    expect(testUsdcPausedDetail(null, true)).toContain("already waiting for you was delivered");
    expect(testUsdcPausedDetail(null, false)).toContain(MONEY_ALREADY_IN_LINE);
    expect(testUsdcPausedDetail(null, false)).toContain("Nothing new was added.");
  });

  it("adds the operator's reason last", () => {
    expect(testUsdcPausedDetail("Back Friday.", true)).toMatch(/ Back Friday\.$/);
  });
});
