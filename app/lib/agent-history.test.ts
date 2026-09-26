import { describe, expect, it } from "vitest";
import { historyItems, defaultHistoryView } from "@/lib/agent-history";

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
