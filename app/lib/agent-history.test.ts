import { describe, expect, it } from "vitest";
import { historyItems, defaultHistoryView, missLineOf } from "@/lib/agent-history";

// History leads with the player's own entries; "Everyone" shows the whole
// public feed. Signed out there is no "own", so the public feed is the page.

const claim = (goalId: string) => ({ goalId });

describe("history view", () => {
  const feed = { claims: [claim("a"), claim("b"), claim("c")], mine: [claim("b")] };

  it("defaults to the player's own entries when signed in, everyone when not", () => {
    expect(defaultHistoryView(true)).toBe("mine");
    expect(defaultHistoryView(false)).toBe("everyone");
  });

  it("shows own entries first, and the toggle shows everyone's", () => {
    expect(historyItems(feed, "mine").map((c) => c.goalId)).toEqual(["b"]);
    expect(historyItems(feed, "everyone").map((c) => c.goalId)).toEqual(["a", "b", "c"]);
  });

  it("never shows another player's entries as own when mine is missing", () => {
    expect(historyItems({ claims: feed.claims }, "mine")).toEqual([]);
  });
});

describe("the History line for a recorded miss", () => {
  const miss = (
    settle: { status: string; outcome?: "forfeited" | "refunded" | "cancelled" } | null,
  ) => ({
    missed: true as const,
    stakeUsd: "1.00",
    settle,
  });

  it("says plainly where the stake goes, in the player's own history", () => {
    expect(missLineOf(miss(null), true)).toBe(
      "Missed. At settle your 1.00 stake goes to who hits, or comes back if nobody does. A cancel before settle gives it back too.",
    );
    expect(missLineOf(miss({ status: "closed", outcome: "forfeited" }), true)).toBe(
      "Missed. Your 1.00 stake went to the players who hit.",
    );
    expect(missLineOf(miss({ status: "closed", outcome: "refunded" }), true)).toBe(
      "Missed, but nobody hit, so your 1.00 stake came back.",
    );
  });

  it("speaks in the third person on everyone's feed", () => {
    expect(missLineOf(miss(null), false)).toBe(
      "Missed. At settle the 1.00 stake goes to who hits, or comes back if nobody does. A cancel before settle gives it back too.",
    );
  });

  it("F7: a run the creator cancelled after the miss says the stake can be claimed back", () => {
    expect(missLineOf(miss({ status: "closed", outcome: "cancelled" }), true)).toBe(
      "Missed, but the creator cancelled the challenge, so your 1.00 stake can be claimed back.",
    );
  });

  it("is silent on every claim that is not a recorded miss", () => {
    expect(missLineOf({ settle: null }, true)).toBeNull();
  });

  it("never calls a miss a lost bet", () => {
    for (const settle of [null, { status: "closed", outcome: "forfeited" as const }]) {
      expect(missLineOf(miss(settle), true)).not.toMatch(/\bbet\b|lost|wager/i);
    }
  });
});
