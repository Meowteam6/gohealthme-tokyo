import { describe, expect, it } from "vitest";
import { entryBadge } from "@/components/landing/entry-badge";

// The hero's second trust line. Flag off (openBeta false or absent) keeps the
// two labels the landing has shipped with; open beta says what the beta is.

const BANNED = /!|\brun\b|\bpool\b|\bdare\b/i;

describe("entryBadge", () => {
  it("reads Open beta, test USDC when the open-beta switch is on, whatever World does", () => {
    expect(entryBadge({ human: true, openBeta: true })).toBe("Open beta, test USDC");
    expect(entryBadge({ human: false, openBeta: true })).toBe("Open beta, test USDC");
  });

  it("flag off: World on reads One person, one entry", () => {
    expect(entryBadge({ human: true, openBeta: false })).toBe("One person, one entry");
    expect(entryBadge({ human: true })).toBe("One person, one entry");
  });

  it("flag off: World off reads Invite-only beta", () => {
    expect(entryBadge({ human: false, openBeta: false })).toBe("Invite-only beta");
    expect(entryBadge({ human: false })).toBe("Invite-only beta");
  });

  it("no label carries an exclamation mark or the words run, pool or dare", () => {
    for (const human of [true, false]) {
      for (const openBeta of [true, false, undefined]) {
        expect(entryBadge({ human, openBeta })).not.toMatch(BANNED);
      }
    }
  });
});
