import { describe, expect, it } from "vitest";
import {
  challengeCopy,
  flowKindOf,
  groupRunCopy,
  missConsequence,
  missDetailOf,
  momentLabel,
  runMoneyOf,
  selfStakeCopy,
  sponsoredCopy,
  stakersAfter,
  type MoneyInput,
} from "@/lib/game/money-flow";

const ONE = 1_000_000n;
const texts = (terms: { text: string }[]) => terms.map((t) => t.text);

const base: MoneyInput = {
  entryFee: ONE,
  players: 0,
  pot: 0n,
  feeBps: 0,
  recordable: true,
  includeJoiner: true,
  confirmBy: "Sep 27, 16:30",
};

describe("flowKindOf", () => {
  const ctx = { players: 1, creatorStaked: null, creatorName: "@andre" };

  it("names a public commitment run a group run", () => {
    expect(flowKindOf({ bountyModel: 2, initiative: "Sleep 7 hours" }, ctx)).toEqual({
      flow: "F1",
      name: "Group run",
      chip: "Group run",
    });
  });

  it("tells a stake on yourself from a challenge by whether the creator staked", () => {
    const pool = { bountyModel: 2, initiative: "challenge" };
    expect(flowKindOf(pool, { ...ctx, creatorStaked: true, viewerIsCreator: true }).chip).toBe("On yourself");
    expect(flowKindOf(pool, { ...ctx, players: 3, creatorStaked: true, viewerIsCreator: true }).chip).toBe(
      "You + 2",
    );
    expect(flowKindOf(pool, { ...ctx, creatorStaked: true }).chip).toBe("Match @andre");
    expect(flowKindOf(pool, { ...ctx, players: 2, creatorStaked: true }).chip).toBe("@andre + 1");
    expect(flowKindOf(pool, { ...ctx, creatorStaked: false })).toEqual({
      flow: "F3",
      name: "Challenge a friend",
      chip: "Challenge from @andre",
    });
    expect(flowKindOf(pool, { ...ctx, creatorStaked: false, viewerIsCreator: true }).chip).toBe(
      "Challenge from you",
    );
  });

  it("falls back to the seed when the creator's stake did not read", () => {
    const pool = { bountyModel: 2, initiative: "challenge" };
    expect(flowKindOf(pool, { ...ctx, seed: 10n * ONE }).flow).toBe("F3");
    expect(flowKindOf(pool, { ...ctx, seed: 0n }).flow).toBe("F2");
  });

  it("names models 0 and 1 by their sponsor, and the backer page Backing", () => {
    expect(flowKindOf({ bountyModel: 0, initiative: "Steps" }, ctx).chip).toBe("Sponsored by @andre");
    expect(flowKindOf({ bountyModel: 1, initiative: "Steps" }, { ...ctx, viewerIsCreator: true }).chip).toBe(
      "Sponsored by you",
    );
    expect(flowKindOf({ bountyModel: 2, initiative: "challenge" }, { ...ctx, backer: true })).toEqual({
      flow: "F5",
      name: "Chip in",
      chip: "Backing",
    });
  });
});

describe("missConsequence", () => {
  it("says goes to who hits only on a recordable run with two or more stakers", () => {
    expect(missConsequence({ players: 2, recordable: true })).toBe("Miss: goes to who hits");
    expect(missConsequence({ players: 1, recordable: true })).toBe("Miss: stake back");
    expect(missConsequence({ players: 5, recordable: false })).toBe("Miss: stake back");
    expect(missConsequence({ players: 0, recordable: true })).toBe("Miss: stake back");
  });

  it("counts the reader when they are about to stake", () => {
    expect(stakersAfter(1, true)).toBe(2);
    expect(stakersAfter(1, false)).toBe(1);
  });
});

describe("F1 group run", () => {
  it("0 stakers, a 2.00 pot, a run that records misses", () => {
    const copy = groupRunCopy({ ...base, pot: 2n * ONE });
    expect(copy.line).toBe(
      "Everyone stakes 1.00 USDC. Hit it and you split the stakes of whoever misses, plus the 2.00 pot.",
    );
    expect(texts(copy.terms)).toEqual([
      "Same stake: 1.00, nobody in yet.",
      "Hit: 1.00 back + a share, 3.00 right now.",
      "Miss: if anyone hits, your 1.00 goes to them; if nobody hits, it comes back.",
      "Confirm your hit by Sep 27, 16:30, or you only get 1.00 back. Test money, beta.",
    ]);
  });

  it("3 stakers, no pot, the reader joining: the live range", () => {
    const copy = groupRunCopy({ ...base, players: 3 });
    expect(copy.line).toBe("Everyone stakes 1.00 USDC. Hit it and you split the stakes of whoever misses.");
    expect(texts(copy.terms)).toEqual([
      "Same stake: 1.00, 3 in so far.",
      "Hit: 1.00 back + a share, 1.00 to 4.00 right now.",
      "Miss: if anyone hits, your 1.00 goes to them; if nobody hits, it comes back.",
      "Confirm your hit by Sep 27, 16:30, or you only get 1.00 back. Test money, beta.",
    ]);
  });

  it("3 stakers on a run that cannot record a miss never promises a missed stake", () => {
    const copy = groupRunCopy({ ...base, players: 3, pot: 2n * ONE, recordable: false, confirmBy: null });
    expect(copy.line).toBe(
      "Everyone stakes 1.00 USDC. Hit it and your 1.00 comes back, plus a share of the 2.00 pot.",
    );
    expect(texts(copy.terms)).toEqual([
      "Same stake: 1.00, 3 in so far.",
      "Hit: 1.00 back + a share, 1.50 to 3.00 right now.",
      "Miss: your 1.00 comes back. This run cannot record a miss.",
      "Confirm your hit before the run settles, or you only get 1.00 back. Test money, beta.",
    ]);
  });

  it("states no number when the fee did not read", () => {
    expect(groupRunCopy({ ...base, players: 3, feeBps: null }).terms[1].text).toBe("Hit: 1.00 back + a share.");
    expect(
      groupRunCopy({ ...base, players: 3, feeBps: null, recordable: false }).terms[1].text,
    ).toBe("Hit: your 1.00 comes back.");
  });
});

describe("F2 stake on yourself", () => {
  const self = { ...base, creatorName: "@andre", viewerIsCreator: true };

  it("one staker: the creator about to lock in", () => {
    const copy = selfStakeCopy({ ...self, entryFee: 10n * ONE });
    expect(copy.line).toBe("Your 10.00 USDC on your own goal. Get friends to match it.");
    expect(texts(copy.terms)).toEqual([
      "You are the only one staked.",
      "Hit: 10.00 back, plus anything backers chip in.",
      "Miss: 10.00 comes back.",
      "Once a friend matches you, whoever misses pays whoever hits.",
    ]);
  });

  it("one staker with backer money, on a run that cannot record a miss", () => {
    const copy = selfStakeCopy({ ...self, players: 1, includeJoiner: false, pot: 3n * ONE, recordable: false });
    expect(texts(copy.terms)).toEqual([
      "You are the only one staked.",
      "Hit: 1.00 back + 3.00 from backers.",
      "Miss: 1.00 comes back.",
      "Friends can match your stake. This run cannot record a miss, so a miss comes back either way.",
    ]);
  });

  it("matched: the creator reading, three in", () => {
    const copy = selfStakeCopy({ ...self, players: 3, includeJoiner: false });
    expect(copy.flow).toBe("F2");
    expect(copy.line).toBe("You + 2 friends, 1.00 USDC each.");
    expect(texts(copy.terms)).toEqual([
      "Same stake: 1.00, 3 in so far.",
      "Hit: 1.00 back + a share, 1.00 to 3.00 right now.",
      "Miss: if anyone hits, your 1.00 goes to them; if nobody hits, it comes back.",
      "Confirm your hit by Sep 27, 16:30, or you only get 1.00 back. Test money, beta.",
    ]);
  });

  it("matched: a friend about to match a one-staker run", () => {
    const copy = selfStakeCopy({ ...self, viewerIsCreator: false, players: 1 });
    expect(copy.line).toBe("@andre + 1 friend, 1.00 USDC each.");
    expect(copy.terms[1].text).toBe("Hit: 1.00 back + a share, 1.00 to 2.00 right now.");
  });
});

describe("F3 challenge a friend", () => {
  const dare = {
    ...base,
    entryFee: 5n * ONE,
    pot: 10n * ONE,
    challengerName: "@andre",
    challengerIsYou: false,
    targetName: "@nikki",
    targetIsYou: true,
    reward: 10n * ONE,
    endsOn: "Oct 26, 21:00",
  };

  it("the challenged player, first to accept", () => {
    const copy = challengeCopy(dare);
    expect(copy.line).toBe("@andre put up 10.00 USDC. You stake 5.00: hit it and get 15.00.");
    expect(texts(copy.terms)).toEqual([
      "Accepting stakes 5.00.",
      "Hit: 5.00 back + 10.00.",
      "Miss: 5.00 comes back, and @andre takes back 10.00 after Oct 26, 21:00.",
      "Nobody has accepted this link yet; if more than one, whoever misses pays whoever hits.",
    ]);
  });

  it("the challenger's preview, before anyone accepts", () => {
    const copy = challengeCopy({ ...dare, challengerIsYou: true, targetIsYou: false, includeJoiner: true });
    expect(copy.line).toBe("You put up 10.00 USDC. @nikki stakes 5.00: hit it and get 15.00.");
    expect(copy.terms[2].text).toBe("Miss: 5.00 comes back, and you take back 10.00 after Oct 26, 21:00.");
  });

  it("a forwarded link: one already in, a second about to accept", () => {
    const copy = challengeCopy({ ...dare, players: 1, targetName: null, targetIsYou: false });
    expect(copy.line).toBe("@andre put up 10.00 USDC. Whoever accepts stakes 5.00: hit it and get up to 20.00.");
    expect(texts(copy.terms)).toEqual([
      "Accepting stakes 5.00.",
      "Hit: 5.00 back + a share, 10.00 to 20.00 right now.",
      "Miss: if another player hits, your 5.00 goes to them; if nobody hits, it comes back, and @andre takes back 10.00 after Oct 26, 21:00.",
      "1 person has accepted this link; if more than one, whoever misses pays whoever hits.",
    ]);
  });

  it("names the pot when the reward cannot be told from backers' money", () => {
    const copy = challengeCopy({ ...dare, reward: null, recordable: false, players: 2, includeJoiner: false });
    expect(copy.line).toBe("The pot holds 10.00 USDC. You stake 5.00: hit it and get up to 15.00.");
    expect(copy.terms[3].text).toBe(
      "2 people have accepted this link; this run cannot record a miss, so a miss comes back however many accept.",
    );
  });
});

describe("F4 sponsored run", () => {
  it("model 0: a multiple of the stake that can come in under it", () => {
    const copy = sponsoredCopy({ bountyModel: 0, entryFee: 5n * ONE, pot: 20n * ONE, sponsorName: "@acme", sponsorIsYou: false });
    expect(copy.line).toBe("@acme put up 20.00 USDC. Stake 5.00 to enter.");
    expect(texts(copy.terms)).toEqual([
      "Hit: pays 5.00 × your multiplier, scaled down if the pot is short, so it can be under 5.00.",
      "Miss: 5.00 comes back.",
      "Nobody hits: 20.00 goes back to @acme.",
    ]);
  });

  it("model 1: a weighted share, the sponsor reading", () => {
    const copy = sponsoredCopy({ bountyModel: 1, entryFee: 5n * ONE, pot: 20n * ONE, sponsorName: "@acme", sponsorIsYou: true });
    expect(copy.line).toBe("You put up 20.00 USDC. Stake 5.00 to enter.");
    expect(texts(copy.terms)).toEqual([
      "Hit: pays a weighted share, which can be under 5.00.",
      "Miss: 5.00 comes back.",
      "Nobody hits: 20.00 goes back to you.",
    ]);
  });
});

describe("runMoneyOf", () => {
  it("picks the flow, both chips and the terms in one call", () => {
    const money = runMoneyOf({
      pool: { bountyModel: 2, initiative: "Sleep 7 hours" },
      flow: { players: 1, creatorStaked: null, creatorName: "0x12…abcd" },
      numbers: { ...base, players: 1 },
    });
    expect(money.kind.chip).toBe("Group run");
    expect(money.miss).toBe("Miss: goes to who hits");
    expect(money.copy?.flow).toBe("F1");
  });

  it("a model 0 run always gives a miss back, and the backer page has no terms", () => {
    const sponsored = runMoneyOf({
      pool: { bountyModel: 0, initiative: "Steps" },
      flow: { players: 4, creatorStaked: null, creatorName: "@acme" },
      numbers: { ...base, players: 4, recordable: false },
    });
    expect(sponsored.miss).toBe("Miss: stake back");
    expect(sponsored.copy?.flow).toBe("F4");
    const backing = runMoneyOf({
      pool: { bountyModel: 2, initiative: "challenge" },
      flow: { players: 1, creatorStaked: true, creatorName: "@andre", backer: true },
      numbers: { ...base, players: 1, includeJoiner: false },
    });
    expect(backing.kind.chip).toBe("Backing");
    expect(backing.copy).toBeNull();
  });
});

describe("missDetailOf", () => {
  it("turns the miss term into the sentence under the stake button", () => {
    expect(missDetailOf(groupRunCopy({ ...base, players: 1 }))).toBe(
      "If anyone hits, your 1.00 goes to them; if nobody hits, it comes back.",
    );
    expect(missDetailOf(sponsoredCopy({ bountyModel: 0, entryFee: ONE, pot: ONE, sponsorName: "@a", sponsorIsYou: false }))).toBe(
      "1.00 comes back.",
    );
  });
});

describe("momentLabel", () => {
  it("formats a moment in the given zone", () => {
    expect(momentLabel(Date.UTC(2026, 8, 27, 7, 30), "Asia/Tokyo")).toBe("Sep 27, 16:30");
  });
});
