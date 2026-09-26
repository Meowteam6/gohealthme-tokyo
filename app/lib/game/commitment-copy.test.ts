import { describe, expect, it } from "vitest";
import {
  commitmentLostCopy,
  commitmentRowTerms,
  feeLine,
  hitRange,
  howThisRunPays,
  joinTermsLine,
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
    const t = { entryFee: ONE, players: 2, balance: 2n * ONE, feeBps: 0 };
    expect(hitRange(t, true)).toEqual({ low: ONE, high: 3n * ONE });
    expect(howThisRunPays(t, true)).toEqual({
      same: "Everyone puts in the same 1.00 USDC. Your result depends only on what your wearable verifies, never on chance.",
      hit: "Hit your goal: your 1.00 comes back, plus an equal share of the stakes of players who missed.",
      range: "With 3 players in, a hit pays 1.00 USDC if everyone hits, up to 3.00 USDC if only you do.",
      miss: "Miss it: your 1.00 goes to the players who hit.",
      nobody: "Nobody hits: everyone gets their stake back.",
      fee: "GoHealthMe takes no cut on this build.",
    });
    expect(joinTermsLine(t)).toBe(
      "Hit it: your 1.00 back plus up to 2.00 more. Miss: your 1.00 goes to the players who hit. Nobody hits: it comes back to you.",
    );
  });

  it("scenario 2: just you in, with a 0.50 sponsor pot", () => {
    const t = { entryFee: ONE, players: 1, balance: 1_500_000n, feeBps: 0 };
    const lines = howThisRunPays(t, false);
    expect(lines.hit).toBe(
      "Hit your goal: your 1.00 comes back, plus an equal share of the missed stakes and the 0.50 USDC sponsor pot.",
    );
    expect(lines.range).toBe("With just you in, a hit pays 1.50 USDC.");
  });

  it("scenario 3: fee unreadable, so no numbers beyond the stake", () => {
    const t = { entryFee: ONE, players: 2, balance: 2n * ONE, feeBps: null };
    expect(hitRange(t, true)).toBeNull();
    expect(howThisRunPays(t, true).range).toBeNull();
    expect(howThisRunPays(t, true).fee).toBeNull();
    expect(joinTermsLine(t)).toBe(
      "Hit it: your 1.00 back plus a share. Miss: your 1.00 goes to the players who hit. Nobody hits: it comes back to you.",
    );
  });

  it("a fee comes off missed stakes only, matching the contract", () => {
    const t = { entryFee: ONE, players: 3, balance: 3n * ONE, feeBps: 1000 };
    expect(hitRange(t, false)).toEqual({ low: ONE, high: 2_800_000n });
    expect(feeLine(500)).toBe("GoHealthMe keeps 5% of missed stakes, never any of a stake that hit.");
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
