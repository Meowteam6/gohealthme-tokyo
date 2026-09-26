import { describe, expect, it } from "vitest";
import {
  commitmentFacts,
  commitmentReminder,
  commitmentLostCopy,
  commitmentRowTerms,
  feeLine,
  hitRange,
  paidBreakdown,
  sponsorPotOf,
} from "@/lib/game/commitment-copy";

const ONE = 1_000_000n;

describe("commitment copy", () => {
  it("lobby row terms hold for any count", () => {
    expect(commitmentRowTerms(ONE)).toBe("Stake 1.00 · get it back + a share if you hit");
  });

  it("sponsor pot is the balance minus every stake, never negative", () => {
    expect(sponsorPotOf({ entryFee: ONE, players: 2, balance: 2_500_000n })).toBe(500_000n);
    expect(sponsorPotOf({ entryFee: ONE, players: 3, balance: 2_000_000n })).toBe(0n);
  });

  it("scenario 1: two players in, no sponsor, no fee, reader about to join", () => {
    const t = { entryFee: ONE, players: 2, balance: 2n * ONE, feeBps: 0, recordsMisses: true };
    expect(hitRange(t, true)).toEqual({ low: ONE, high: 3n * ONE });
    // The same run where a miss cannot be recorded: every miss is refunded.
    expect(hitRange({ ...t, recordsMisses: false }, true)).toEqual({ low: ONE, high: ONE });
    expect(feeLine(t.feeBps)).toBe("GoHealthMe takes no cut on this build.");
  });

  it("scenario 2: just you in, with a 0.50 sponsor pot", () => {
    const t = { entryFee: ONE, players: 1, balance: 1_500_000n, feeBps: 0, recordsMisses: true };
    expect(hitRange(t, false)).toEqual({ low: 1_500_000n, high: 1_500_000n });
  });

  it("scenario 3: fee unreadable, so no range and no fee line", () => {
    const t = { entryFee: ONE, players: 2, balance: 2n * ONE, feeBps: null, recordsMisses: true };
    expect(hitRange(t, true)).toBeNull();
    expect(feeLine(null)).toBeNull();
  });

  it("a fee comes off missed stakes only, matching the contract", () => {
    const t = { entryFee: ONE, players: 3, balance: 3n * ONE, feeBps: 1000, recordsMisses: true };
    expect(hitRange(t, false)).toEqual({ low: ONE, high: 2_800_000n });
    expect(feeLine(500)).toBe("GoHealthMe keeps 5% of missed stakes, never any of a stake that hit.");
  });

  it("the run board reminder states all three outcomes once two or more are staked", () => {
    expect(commitmentReminder({ recordable: true, players: 2 })).toBe(
      "Hit it: your stake back plus an equal share of the missed stakes and any sponsor pot. Miss it: your stake goes to the players who hit. Nobody hits: everyone gets their stake back.",
    );
  });

  it("the reminder follows the miss chip: alone in the run, a miss comes back", () => {
    // The player reading is already in, so `players` counts them. With one
    // staker a miss means nobody hit, and every stake comes back.
    expect(commitmentReminder({ recordable: true, players: 1 })).toBe(
      "Hit it: your stake back plus an equal share of the missed stakes and any sponsor pot. Miss it: your stake comes back while you are the only one in; once others stake, it goes to whoever hits, or comes back if nobody does. Nobody hits: everyone gets their stake back.",
    );
  });

  it("the reminder never promises a forfeit on a count it has not read", () => {
    const line = commitmentReminder({ recordable: true, players: null });
    expect(line).toContain("Miss it: if anyone else hits, your stake goes to them; if nobody hits, it comes back.");
    expect(line).not.toContain("goes to the players who hit");
  });

  it("a run that cannot record a miss never promises a missed stake, however many are in", () => {
    for (const players of [1, 2, 6, null]) {
      expect(commitmentReminder({ recordable: false, players })).toBe(
        "Hit it: your stake back plus an equal share of any sponsor pot. Miss it: this run cannot record a miss, so your stake comes back when it settles. Nobody hits: everyone gets their stake back.",
      );
    }
    expect(commitmentFacts(false).miss).not.toContain("players who hit");
  });

  it("paid breakdown splits the credited amount into stake back and the rest", () => {
    expect(paidBreakdown("3.00", ONE)).toBe(
      "1.00 stake back + 2.00 from missed stakes and any sponsor pot.",
    );
    expect(paidBreakdown("1.00", ONE)).toBe(
      "1.00 stake back. Everyone hit it, so there were no missed stakes to share.",
    );
    expect(paidBreakdown("0.5", ONE)).toBe("0.50 USDC paid out.");
  });

  it("a miss says where the stake went, from what the chain recorded", () => {
    expect(commitmentLostCopy({ entryFee: ONE, stakeBack: false, achievers: 2 })).toEqual({
      headline: "Run lost",
      body: "Your 1.00 went to the players who hit.",
    });
    expect(commitmentLostCopy({ entryFee: ONE, stakeBack: false, achievers: 0 })).toEqual({
      headline: "Nobody hit it",
      body: "Nobody hit it. Everyone's stake comes back, your 1.00 included. Claim it below.",
    });
    expect(commitmentLostCopy({ entryFee: ONE, stakeBack: true, achievers: 1 }).body).toBe(
      "The goal was not met. No miss was written on chain, so the settle sent your 1.00 back. Claim it below.",
    );
    expect(commitmentLostCopy({ entryFee: ONE, stakeBack: false, achievers: null }).body).toBe(
      "The miss was recorded on chain. If anyone hit it, your 1.00 went to them; if nobody did, it comes back to you below.",
    );
  });
});
