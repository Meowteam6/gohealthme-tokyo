// The verdict card's words for a player SPOTTER pays on the verdict (Andre,
// 2026-10-02): a list player or an admin never reads "confirmed with World
// ID" or "not confirmed in time", because nothing was theirs to confirm. A
// World-verified player's card is unchanged.

import { describe, it, expect } from "vitest";

const { verdictHeadOf } = await import("@/components/game/VerdictStage");

const BASE = {
  goalShort: "7 hours",
  deviceName: "WHOOP",
  selfStaked: true,
  entryFee: 10_000_000n,
  settleAchievers: null,
};

function text(head: ReturnType<typeof verdictHeadOf>): string {
  return `${head?.eyebrow} ${head?.headline} ${String(head?.body)}`;
}

describe("verdictHeadOf, paid on the verdict", () => {
  it("says a settled, unrecorded hit was not recorded, never not confirmed", () => {
    const head = verdictHeadOf({ ...BASE, screen: { kind: "hit-unconfirmed", onVerdict: true } });
    expect(head?.eyebrow).toBe("Not recorded");
    expect(head?.headline).toBe("You hit 7 hours. Not recorded in time.");
    expect(text(head)).not.toMatch(/World ID|confirm/i);
  });

  it("says SPOTTER pays on the verdict while it checks and while the goal is not met", () => {
    for (const screen of [
      { kind: "checking", onVerdict: true } as const,
      { kind: "not-yet", onVerdict: true } as const,
    ]) {
      const head = verdictHeadOf({ ...BASE, screen });
      expect(text(head)).toMatch(/on the verdict/);
      expect(text(head)).not.toMatch(/World ID|confirm/i);
    }
  });

  it("leaves a World-verified player's card unchanged (regression)", () => {
    expect(verdictHeadOf({ ...BASE, screen: { kind: "hit-unconfirmed" } })?.headline).toBe(
      "You hit 7 hours. Not confirmed in time.",
    );
    expect(text(verdictHeadOf({ ...BASE, screen: { kind: "confirm-human" } }))).toMatch(/World ID/);
  });
});
