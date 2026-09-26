import { describe, expect, it } from "vitest";
import {
  challengeCopy,
  challengePreviewOf,
  flowKindOf,
  groupRunCopy,
  missDetailOf,
  momentLabel,
  potLineOf,
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

  it("names a public commitment pool a group challenge", () => {
    expect(flowKindOf({ bountyModel: 2, initiative: "Sleep 7 hours" }, ctx)).toEqual({
      flow: "F1",
      name: "Group challenge",
      chip: "Group challenge",
    });
  });

  it("a stake-on-yourself creator who has not locked in yet reads On yourself, never Challenge from you", () => {
    const pool = { bountyModel: 2, initiative: "challenge" };
    // The creator lands on /pools/<id> before staking: nothing in the pot,
    // nobody in. It is their own stake on themselves, the same flow as after
    // they lock in.
    expect(flowKindOf(pool, { ...ctx, players: 0, creatorStaked: false, seed: 0n, viewerIsCreator: true })).toEqual({
      flow: "F2",
      name: "Match the stake",
      chip: "On yourself",
    });
    expect(flowKindOf(pool, { ...ctx, players: 0, creatorStaked: false, seed: 0n }).chip).toBe("Match @andre");
  });

  it("a stake on yourself by the creator's own stake, with no seed", () => {
    const pool = { bountyModel: 2, initiative: "challenge" };
    expect(flowKindOf(pool, { ...ctx, creatorStaked: true, viewerIsCreator: true }).chip).toBe("On yourself");
    expect(flowKindOf(pool, { ...ctx, players: 3, creatorStaked: true, viewerIsCreator: true }).chip).toBe(
      "You + 2",
    );
    expect(flowKindOf(pool, { ...ctx, creatorStaked: true }).chip).toBe("Match @andre");
    expect(flowKindOf(pool, { ...ctx, players: 2, creatorStaked: true }).chip).toBe("@andre + 1");
  });

  it("the creator's own stake makes it a match-the-stake challenge, extra in the pot or not", () => {
    const pool = { bountyModel: 2, initiative: "challenge" };
    // The one challenge flow: the creator stakes S and may add extra E at
    // create. Extra in the pot never turns it into a reward challenge.
    expect(flowKindOf(pool, { ...ctx, creatorStaked: true, seed: 2n * ONE, viewerIsCreator: true }).chip).toBe(
      "On yourself",
    );
    expect(flowKindOf(pool, { ...ctx, creatorStaked: true, seed: 2n * ONE }).chip).toBe("Match @andre");
  });

  it("a seed with no creator stake is an older challenge with a reward", () => {
    const pool = { bountyModel: 2, initiative: "challenge" };
    expect(flowKindOf(pool, { ...ctx, creatorStaked: false, seed: 10n * ONE })).toEqual({
      flow: "F3",
      name: "Challenge with a reward",
      chip: "Challenge from @andre",
    });
    expect(flowKindOf(pool, { ...ctx, creatorStaked: false, seed: 10n * ONE, viewerIsCreator: true }).chip).toBe(
      "Challenge from you",
    );
    // The seed did not read and the creator's stake is unknown: a stake on
    // yourself until the money says otherwise, never a challenge nobody funded.
    expect(flowKindOf(pool, { ...ctx, seed: null }).flow).toBe("F2");
  });

  it("takes the flow a surface already decided, from the same rule", () => {
    const pool = { bountyModel: 2, initiative: "challenge" };
    expect(flowKindOf(pool, { ...ctx, kind: "reward" }).flow).toBe("F3");
    expect(flowKindOf(pool, { ...ctx, kind: "self" }).flow).toBe("F2");
    expect(flowKindOf(pool, { ...ctx, kind: "unstaked", viewerIsCreator: true }).chip).toBe("On yourself");
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

// The miss chip's rule (missConsequence) lives in lib/commitment-copy.ts and
// is pinned in lib/commitment-copy.test.ts; only the head count is here.
describe("stakersAfter", () => {
  it("counts the reader when they are about to stake", () => {
    expect(stakersAfter(1, true)).toBe(2);
    expect(stakersAfter(1, false)).toBe(1);
  });
});

describe("F1 group challenge", () => {
  it("0 stakers, 2.00 extra, a challenge that records misses", () => {
    const copy = groupRunCopy({ ...base, pot: 2n * ONE });
    expect(copy.line).toBe(
      "Everyone stakes 1.00 USDC. Hit it and you split the stakes of whoever misses, plus 2.00 extra.",
    );
    expect(texts(copy.terms)).toEqual([
      "Same stake: 1.00, nobody in yet.",
      "Hit: 1.00 back + a share, 3.00 right now.",
      // The first staker's chip reads "stake back"; the term says what changes
      // once others join, before the stake, and that nobody hitting refunds
      // every recorded stake (H = 0).
      "Miss: your 1.00 comes back while you are the only one in; once others stake, a miss your wearable shows goes to whoever hits, or comes back if nobody does.",
      "Confirm your hit by Sep 27, 16:30, or you only get 1.00 back. Test money, beta.",
    ]);
  });

  it("3 stakers, no pot, the reader joining: the live range", () => {
    const copy = groupRunCopy({ ...base, players: 3 });
    expect(copy.line).toBe("Everyone stakes 1.00 USDC. Hit it and you split the stakes of whoever misses.");
    expect(texts(copy.terms)).toEqual([
      "Same stake: 1.00, 3 in so far.",
      "Hit: 1.00 back + a share, 1.00 to 4.00 right now.",
      "Miss: if your wearable shows it and anyone hits, your 1.00 goes to them; if nobody hits, it comes back. No data from your wearable is not a miss.",
      "Confirm your hit by Sep 27, 16:30, or you only get 1.00 back. Test money, beta.",
    ]);
  });

  it("3 stakers on a challenge that cannot record a miss never promises a missed stake", () => {
    const copy = groupRunCopy({ ...base, players: 3, pot: 2n * ONE, recordable: false, confirmBy: null });
    expect(copy.line).toBe(
      "Everyone stakes 1.00 USDC. Hit it and your 1.00 comes back, plus a share of the 2.00 extra.",
    );
    expect(texts(copy.terms)).toEqual([
      "Same stake: 1.00, 3 in so far.",
      "Hit: 1.00 back + a share, 1.50 to 3.00 right now.",
      "Miss: your 1.00 comes back. This challenge cannot record a miss.",
      "Confirm your hit before the challenge settles, or you only get 1.00 back. Test money, beta.",
    ]);
  });

  it("states no number when the fee did not read", () => {
    expect(groupRunCopy({ ...base, players: 3, feeBps: null }).terms[1].text).toBe("Hit: 1.00 back + a share.");
    expect(
      groupRunCopy({ ...base, players: 3, feeBps: null, recordable: false }).terms[1].text,
    ).toBe("Hit: your 1.00 comes back.");
  });
});

describe("F2 match the stake: the core game", () => {
  const ten = 10n * ONE;
  // A friend about to match @andre, who is already in.
  const friend = {
    ...base,
    entryFee: ten,
    players: 1,
    creatorName: "@andre",
    viewerIsCreator: false,
    creatorIn: true,
  };

  it("two players, no extra: the hitter takes the other stake, both hit means both get their stake back", () => {
    const copy = selfStakeCopy(friend);
    expect(copy.flow).toBe("F2");
    expect(copy.line).toBe(
      "You both stake 10.00 USDC. Whoever hits gets their 10.00 back plus the stake of whoever misses. Both hit: you both get 10.00 back. Extra in the pot is split among whoever hits.",
    );
    expect(texts(copy.terms)).toEqual([
      "Same stake: 10.00 each.",
      "One hits, one misses: whoever hits gets their 10.00 back + the other 10.00, 20.00 in all.",
      "Both hit: you each get your 10.00 back.",
      "Nobody hits: both stakes come back.",
      "Miss: it counts only when your wearable shows it. No data from your wearable is not a miss, so that stake comes back.",
      "Confirm your hit by Sep 27, 16:30, or you only get 10.00 back. Test money, beta.",
    ]);
  });

  it("two players and 2.00 extra: the extra is split among whoever hits, and goes to the starter if nobody does", () => {
    const copy = selfStakeCopy({ ...friend, pot: 2n * ONE });
    expect(texts(copy.terms)).toEqual([
      "Same stake: 10.00 each.",
      "One hits, one misses: whoever hits gets their 10.00 back + the other 10.00 + 2.00 extra, 22.00 in all.",
      "Both hit: you each get your 10.00 back + 1.00 of the extra, 11.00 each.",
      "Nobody hits: both stakes come back, and the 2.00 extra goes to @andre.",
      "Miss: it counts only when your wearable shows it. No data from your wearable is not a miss, so that stake comes back.",
      "Confirm your hit by Sep 27, 16:30, or you only get 10.00 back. Test money, beta.",
    ]);
    // The starter reading their own challenge.
    const mine = selfStakeCopy({ ...friend, pot: 2n * ONE, players: 2, includeJoiner: false, viewerIsCreator: true });
    expect(mine.terms[3].text).toBe("Nobody hits: both stakes come back, and the 2.00 extra goes to you.");
  });

  it("a challenge that cannot record a miss gives a miss back and never promises the other stake", () => {
    const copy = selfStakeCopy({ ...friend, pot: 2n * ONE, recordable: false, confirmBy: null });
    expect(copy.line).toBe(
      "You both stake 10.00 USDC. Hit it and your 10.00 comes back, plus a share of any extra. This challenge cannot record a miss, so a miss comes back too.",
    );
    expect(texts(copy.terms)).toEqual([
      "Same stake: 10.00 each.",
      "One hits, one misses: the miss comes back, since this challenge cannot record one; whoever hits gets their 10.00 back + 2.00 extra, 12.00 in all.",
      "Both hit: you each get your 10.00 back + 1.00 of the extra, 11.00 each.",
      "Nobody hits: both stakes come back, and the 2.00 extra goes to @andre.",
      "Miss: your 10.00 comes back. This challenge cannot record a miss.",
      "Confirm your hit before the challenge settles, or you only get 10.00 back. Test money, beta.",
    ]);
  });

  it("states no total when the fee did not read, and names the cut when there is one", () => {
    const unread = selfStakeCopy({ ...friend, pot: 2n * ONE, feeBps: null });
    expect(unread.terms[1].text).toBe(
      "One hits, one misses: whoever hits gets their 10.00 back + the other 10.00 + 2.00 extra.",
    );
    expect(unread.terms[2].text).toBe("Both hit: you each get your 10.00 back + half the 2.00 extra.");
    const cut = selfStakeCopy({ ...friend, feeBps: 500 });
    expect(cut.terms[1].text).toBe(
      "One hits, one misses: whoever hits gets their 10.00 back + the other 10.00 less GoHealthMe's cut, 19.50 in all.",
    );
  });

  it("three or more: an equal share of the missed stakes, and of the extra", () => {
    const copy = selfStakeCopy({ ...base, players: 2, pot: 3n * ONE, creatorName: "@andre", viewerIsCreator: false, creatorIn: true });
    expect(copy.line).toBe(
      "Everyone stakes 1.00 USDC. Whoever hits gets their 1.00 back plus an equal share of the stakes of whoever misses. Everyone hits: everyone gets 1.00 back. Extra in the pot is split among whoever hits.",
    );
    expect(texts(copy.terms)).toEqual([
      "Same stake: 1.00, 2 in so far.",
      "Hit: 1.00 back + a share, 2.00 to 6.00 right now.",
      "Everyone hits: you each get your 1.00 back + 1.00 of the extra, 2.00 each.",
      "Nobody hits: every stake comes back, and the 3.00 extra goes to @andre.",
      "Miss: if your wearable shows it and anyone hits, your 1.00 goes to them; if nobody hits, it comes back. No data from your wearable is not a miss.",
      "Confirm your hit by Sep 27, 16:30, or you only get 1.00 back. Test money, beta.",
    ]);
  });

  it("the starter alone: a miss comes back until a friend matches", () => {
    const copy = selfStakeCopy({ ...base, entryFee: ten, creatorName: "@andre", viewerIsCreator: true, creatorIn: false });
    expect(copy.line).toBe("Your 10.00 USDC on your own goal. Get a friend to match it.");
    expect(texts(copy.terms)).toEqual([
      "You are the only one staked.",
      "Hit: 10.00 back, plus anything backers add.",
      "Miss: 10.00 comes back while you are the only one in.",
      "Once a friend matches you, whoever hits gets their stake back plus the stake of whoever misses.",
    ]);
  });

  it("the starter alone with extra, on a challenge that cannot record a miss", () => {
    const copy = selfStakeCopy({
      ...base,
      players: 1,
      includeJoiner: false,
      pot: 3n * ONE,
      recordable: false,
      creatorName: "@andre",
      viewerIsCreator: true,
      creatorIn: true,
    });
    expect(texts(copy.terms)).toEqual([
      "You are the only one staked.",
      "Hit: 1.00 back + 3.00 extra.",
      "Miss: 1.00 comes back while you are the only one in, and the 3.00 extra goes back to you.",
      "Friends can match your stake. This challenge cannot record a miss, so a miss comes back either way.",
    ]);
  });

  it("a friend who opens the link before the starter locked in is told so", () => {
    const copy = selfStakeCopy({ ...friend, players: 0, pot: 2n * ONE, creatorIn: false });
    expect(copy.line).toBe("Match @andre's 10.00 USDC stake. @andre has not locked in yet.");
    expect(texts(copy.terms)).toEqual([
      "Same stake: 10.00. Nobody is in yet.",
      "Hit: 10.00 back + 2.00 extra.",
      "Miss: 10.00 comes back while you are the only one in.",
      "Once @andre locks in, whoever hits gets their stake back plus the stake of whoever misses.",
    ]);
  });
});

describe("challengePreviewOf: what the friend will see, from the create form", () => {
  it("shows the equal-stakes table with the numbers typed so far", () => {
    const preview = challengePreviewOf({
      stake: 10n * ONE,
      extra: 0n,
      recordable: true,
      creatorName: "@andre",
      friendName: "@nikki",
    });
    expect(preview.money.kind.chip).toBe("Match @andre");
    expect(preview.money.miss).toBe("Miss: goes to who hits");
    expect(preview.money.copy?.line).toBe(
      "You both stake 10.00 USDC. Whoever hits gets their 10.00 back plus the stake of whoever misses. Both hit: you both get 10.00 back. Extra in the pot is split among whoever hits.",
    );
    expect(preview.pot).toBe(20n * ONE);
    expect(preview.potLine).toBe("Pot 20.00 once you match: 10.00 each from you and @andre.");
    expect(preview.headline).toBe("Match @andre's 10.00 USDC stake");
  });

  it("adds the extra to the pot and names who put it in", () => {
    const preview = challengePreviewOf({
      stake: 10n * ONE,
      extra: 2n * ONE,
      recordable: true,
      creatorName: "@andre",
      friendName: null,
    });
    expect(preview.pot).toBe(22n * ONE);
    expect(preview.potLine).toBe("Pot 22.00 once you match: 10.00 each from you and @andre, plus 2.00 extra from @andre.");
    expect(preview.money.copy?.terms[1].text).toBe(
      "One hits, one misses: whoever hits gets their 10.00 back + the other 10.00 + 2.00 extra, 22.00 in all.",
    );
  });

  it("signed out, it reads as the starter's own challenge", () => {
    const preview = challengePreviewOf({
      stake: 5n * ONE,
      extra: 1n * ONE,
      recordable: false,
      creatorName: null,
      friendName: "@nikki",
    });
    expect(preview.headline).toBe("You stake 5.00 USDC. @nikki matches it.");
    expect(preview.potLine).toBe("Pot 11.00 once @nikki matches: 5.00 each from you and @nikki, plus 1.00 extra from you.");
    expect(preview.money.miss).toBe("Miss: stake back");
    expect(preview.money.copy?.terms[3].text).toBe("Nobody hits: both stakes come back, and the 1.00 extra goes to you.");
  });

  it("with nothing typed yet it still reads, at zero", () => {
    const preview = challengePreviewOf({ stake: 0n, extra: 0n, recordable: true, creatorName: null, friendName: null });
    expect(preview.headline).toBe("You stake 0.00 USDC. Your friend matches it.");
    expect(preview.potLine).toBe("Pot 0.00 once your friend matches: 0.00 each from you and your friend.");
  });
});

describe("potLineOf: one Pot number, its parts in words", () => {
  it("names each staker, then the extra", () => {
    expect(potLineOf({ stake: 10n * ONE, stakers: ["@andre"], extra: 2n * ONE })).toBe(
      "Pot 12.00: 10.00 from @andre, plus 2.00 extra.",
    );
    expect(potLineOf({ stake: 10n * ONE, stakers: ["you", "@nikki"], extra: 0n })).toBe(
      "Pot 20.00: 10.00 each from you and @nikki.",
    );
  });

  it("counts players when there are more than two, or only a count read", () => {
    expect(potLineOf({ stake: ONE, stakers: 3, extra: 0n })).toBe("Pot 3.00: 1.00 each from 3 players.");
    expect(potLineOf({ stake: ONE, stakers: 1, extra: 0n })).toBe("Pot 1.00: 1.00 from 1 player.");
    expect(potLineOf({ stake: ONE, stakers: 0, extra: 2n * ONE, extraFrom: "@andre" })).toBe(
      "Pot 2.00: nobody has staked yet, plus 2.00 extra from @andre.",
    );
  });
});

describe("F3 an older challenge with a reward", () => {
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
      "Miss: if your wearable shows it and another player hits, your 5.00 goes to them; if nobody hits, it comes back, and @andre takes back 10.00 after Oct 26, 21:00.",
      "1 person has accepted this link; if more than one, whoever misses pays whoever hits.",
    ]);
  });

  it("names the pot when the reward cannot be told from backers' money", () => {
    const copy = challengeCopy({ ...dare, reward: null, recordable: false, players: 2, includeJoiner: false });
    expect(copy.line).toBe("10.00 USDC extra is in the pot. You stake 5.00: hit it and get up to 15.00.");
    expect(copy.terms[3].text).toBe(
      "2 people have accepted this link; this challenge cannot record a miss, so a miss comes back however many accept.",
    );
  });

  it("two or more accepters on a challenge that cannot record a miss: the lock-in comes back, the reward only if nobody hits", () => {
    // Another accepter can still hit and take the pot, so the challenger
    // taking the reward back is not the consequence of this player's miss.
    const copy = challengeCopy({ ...dare, recordable: false, players: 1 });
    expect(copy.terms[2].text).toBe(
      "Miss: 5.00 comes back. If nobody hits, @andre takes back 10.00 after Oct 26, 21:00.",
    );
    // Alone, a miss means nobody hit, so the reward does go back.
    expect(challengeCopy({ ...dare, recordable: false }).terms[2].text).toBe(
      "Miss: 5.00 comes back, and @andre takes back 10.00 after Oct 26, 21:00.",
    );
  });
});

describe("F4 sponsored challenge", () => {
  it("model 0 at create: a multiple of the stake that can come in under it", () => {
    const copy = sponsoredCopy({
      bountyModel: 0,
      entryFee: 5n * ONE,
      pot: 20n * ONE,
      reward: 20n * ONE,
      sponsorName: "@acme",
      sponsorIsYou: false,
    });
    expect(copy.line).toBe("@acme put up 20.00 USDC. Stake 5.00 to enter.");
    expect(texts(copy.terms)).toEqual([
      "Hit: pays 5.00 × your multiplier, scaled down if the pot is short, so it can be under 5.00.",
      "Miss: 5.00 comes back.",
      "Nobody hits: 20.00 goes back to @acme.",
    ]);
  });

  it("model 1 at create: a weighted share, the sponsor reading", () => {
    const copy = sponsoredCopy({
      bountyModel: 1,
      entryFee: 5n * ONE,
      pot: 20n * ONE,
      reward: 20n * ONE,
      sponsorName: "@acme",
      sponsorIsYou: true,
    });
    expect(copy.line).toBe("You put up 20.00 USDC. Stake 5.00 to enter.");
    expect(texts(copy.terms)).toEqual([
      "Hit: pays a weighted share, which can be under 5.00.",
      "Miss: 5.00 comes back.",
      "Nobody hits: 20.00 goes back to you.",
    ]);
  });

  it("on a live challenge the figure is the extra (balance net of stakes), not the sponsor's deposit", () => {
    // R + B: what the sponsor put up plus what backers added. Nobody can
    // tell them apart from the chain, so the line names the pot, and the
    // whole of it goes back to the sponsor when nobody hits.
    const copy = sponsoredCopy({
      bountyModel: 0,
      entryFee: 5n * ONE,
      pot: 23n * ONE,
      reward: null,
      sponsorName: "@acme",
      sponsorIsYou: false,
    });
    expect(copy.line).toBe("23.00 USDC extra from the sponsor and backers. Stake 5.00 to enter.");
    expect(copy.terms[2].text).toBe("Nobody hits: 23.00 goes back to @acme.");
    expect(copy.line).not.toMatch(/put up/);
  });

  it("runMoneyOf words a sponsored challenge by its extra on a live page and by the deposit on the create form", () => {
    const pool = { bountyModel: 0, initiative: "Steps" };
    const flow = { players: 2, creatorStaked: null, creatorName: "@acme" };
    const numbers = { ...base, players: 2, pot: 23n * ONE, recordable: false };
    expect(runMoneyOf({ pool, flow, numbers }).copy?.line).toBe("23.00 USDC extra from the sponsor and backers. Stake 1.00 to enter.");
    expect(runMoneyOf({ pool, flow, numbers, reward: 23n * ONE }).copy?.line).toBe(
      "@acme put up 23.00 USDC. Stake 1.00 to enter.",
    );
  });
});

describe("runMoneyOf", () => {
  it("picks the flow, both chips and the terms in one call", () => {
    const money = runMoneyOf({
      pool: { bountyModel: 2, initiative: "Sleep 7 hours" },
      flow: { players: 1, creatorStaked: null, creatorName: "0x12…abcd" },
      numbers: { ...base, players: 1 },
    });
    expect(money.kind.chip).toBe("Group challenge");
    expect(money.miss).toBe("Miss: goes to who hits");
    expect(money.copy?.flow).toBe("F1");
  });

  it("a model 0 challenge always gives a miss back, and the backer page has no terms", () => {
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
      "If your wearable shows it and anyone hits, your 1.00 goes to them; if nobody hits, it comes back. No data from your wearable is not a miss.",
    );
    expect(
      missDetailOf(
        sponsoredCopy({ bountyModel: 0, entryFee: ONE, pot: ONE, reward: null, sponsorName: "@a", sponsorIsYou: false }),
      ),
    ).toBe("1.00 comes back.");
  });
});

describe("momentLabel", () => {
  it("formats a moment in the given zone", () => {
    expect(momentLabel(Date.UTC(2026, 8, 27, 7, 30), "Asia/Tokyo")).toBe("Sep 27, 16:30");
  });
});
