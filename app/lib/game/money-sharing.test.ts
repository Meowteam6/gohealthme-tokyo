import { describe, expect, it } from "vitest";
import { challengeBackerUrl, challengeShareUrl, isBackerView } from "@/lib/challenges";
import {
  acceptTermsOf,
  challengeLandingHeadOf,
  challengeRunKindOf,
  chipInIntroOf,
  chipInWarningOf,
  creatorStakedIn,
  inviteShareOf,
  lockInHint,
  rallyCopyOf,
  type ChallengeRunKind,
} from "@/lib/game/money-sharing";

// docs/MONEY-FLOWS.md gaps 1, 5, 6, 7 and 11: the share links, the chip-in
// warning and the accept screen say what the contract does. Every sentence a
// player can read here is pinned, and none uses the words the voice forbids.

const USDC = 1_000_000n;
const MIKA = "mika.gohealthme.eth";
const FORBIDDEN = /\b(bet|bets|wager|odds|gamble|luck|winner)\b|!/i;

function allText(value: unknown): string {
  return JSON.stringify(value);
}

describe("challengeRunKindOf: money first, then the creator's own stake", () => {
  const creator = "0x8A39000000000000000000000000000000006141";

  it("reads the creator in the player list case-insensitively", () => {
    expect(creatorStakedIn(creator, ["0x1111000000000000000000000000000000000001", creator.toLowerCase()])).toBe(true);
    expect(creatorStakedIn(creator, ["0x1111000000000000000000000000000000000001"])).toBe(false);
    expect(creatorStakedIn(creator, [])).toBe(false);
  });

  it("is a reward challenge when the creator put up a seed, even if they also joined", () => {
    expect(challengeRunKindOf({ creatorStaked: false, reward: 5n * USDC })).toBe("reward");
    expect(challengeRunKindOf({ creatorStaked: true, reward: 5n * USDC })).toBe("reward");
  });

  it("is a stake on yourself once the creator staked with no seed, whether or not the pot read", () => {
    expect(challengeRunKindOf({ creatorStaked: true, reward: 0n })).toBe("self");
    expect(challengeRunKindOf({ creatorStaked: true, reward: null })).toBe("self");
  });

  it("keeps a finished reward challenge a reward once the pot reads null, from the named row", () => {
    expect(challengeRunKindOf({ creatorStaked: false, reward: null, named: true })).toBe("reward");
  });

  it("is unstaked when the creator neither staked nor put up a reward", () => {
    expect(challengeRunKindOf({ creatorStaked: false, reward: 0n })).toBe("unstaked");
    expect(challengeRunKindOf({ creatorStaked: false, reward: null })).toBe("unstaked");
  });
});

describe("inviteShareOf: two links on a stake-on-yourself run, one on a reward challenge", () => {
  it("offers Match my stake (the accept link) and Back me (the backer link)", () => {
    const share = inviteShareOf("self");
    if (share.kind !== "links") throw new Error("expected links");
    expect(share.heading).toBe("Bring friends in");
    expect(share.links.map((l) => [l.kind, l.label, l.backer])).toEqual([
      ["match", "Match my stake", false],
      ["back", "Back me", true],
    ]);
    const [match, back] = share.links;
    expect(match.message).toContain("Match my stake");
    expect(back.message).toContain("Back me");
    expect(back.detail).toContain("never stakes them in");
  });

  it("builds each link kind to the URL the landing reads", () => {
    const origin = "https://gohealthme-tokyo.vercel.app";
    const token = "a".repeat(32);
    const share = inviteShareOf("self");
    if (share.kind !== "links") throw new Error("expected links");
    const urls = share.links.map((l) => (l.backer ? challengeBackerUrl : challengeShareUrl)(origin, token));
    expect(urls).toEqual([`${origin}/c/${token}`, `${origin}/c/${token}?as=backer`]);
    expect(isBackerView(new URL(urls[0]).searchParams.get("as") ?? undefined)).toBe(false);
    expect(isBackerView(new URL(urls[1]).searchParams.get("as") ?? undefined)).toBe(true);
  });

  it("keeps a reward challenge to one accept link, never 'Back me'", () => {
    const share = inviteShareOf("reward");
    if (share.kind !== "links") throw new Error("expected links");
    expect(share.heading).toBe("Send the challenge");
    expect(share.links).toHaveLength(1);
    expect(share.links[0]).toMatchObject({ kind: "challenge", backer: false });
    expect(allText(share)).not.toMatch(/Back me/);
  });

  it("offers no link before a stake-on-yourself creator locks in, and says why", () => {
    const share = inviteShareOf("unstaked");
    expect(share.kind).toBe("blocked");
    if (share.kind !== "blocked") return;
    expect(share.reason).toContain("Lock in your stake first");
    expect(share.reason).toContain("match your stake");
    expect(share.reason).toContain("back you");
  });
});

describe("challengeLandingHeadOf: each link kind has its own headline", () => {
  const head = (kind: ChallengeRunKind, view: "accept" | "backer", target = "their friend") =>
    challengeLandingHeadOf({ kind, view, name: MIKA, target });

  it("Match my stake lands on the match headline", () => {
    expect(head("self", "accept").title).toBe(`${MIKA} wants you to match their stake`);
  });

  it("Back me lands on Back {name}, never 'challenged their friend'", () => {
    expect(head("self", "backer")).toEqual({ tag: "Backing", title: `Back ${MIKA}` });
    expect(head("unstaked", "backer").title).toBe(`Back ${MIKA}`);
    expect(head("self", "backer").title).not.toMatch(/challenged/);
  });

  it("a reward challenge keeps its challenge headlines", () => {
    expect(head("reward", "accept").title).toBe(`${MIKA} challenged you`);
    expect(head("reward", "backer", "@andre").title).toBe(`${MIKA} challenged @andre`);
  });

  it("rallies backers for the person on a stake-on-yourself run", () => {
    expect(rallyCopyOf("self", MIKA).heading).toBe(`Rally backers for ${MIKA}`);
    expect(rallyCopyOf("reward", MIKA).heading).toBe("Rally your friends");
  });
});

describe("acceptTermsOf: the miss chip and head count before the accept (gap 7)", () => {
  it("a reward challenge nobody accepted yet: a lone miss comes back, and a forwarded link is named", () => {
    const t = acceptTermsOf({ kind: "reward", recordable: true, players: 0, challengerName: MIKA });
    expect(t.chip).toBe("Miss: stake back");
    expect(t.count).toBe("Nobody has accepted this link yet");
    expect(t.miss).toContain("your lock-in comes back");
    expect(t.miss).toContain("If someone else accepts this link and hits, it goes to them.");
    expect(t.nobody).toBe(`Nobody hits: every lock-in comes back, and ${MIKA} takes back the pot.`);
  });

  it("a forwarded reward link with others in: a miss goes to who hits", () => {
    const t = acceptTermsOf({ kind: "reward", recordable: true, players: 2, challengerName: MIKA });
    expect(t.chip).toBe("Miss: goes to who hits");
    expect(t.count).toBe("2 accepted this link");
    expect(t.miss).toBe("Miss it: your lock-in goes to whoever hits. If nobody hits, it comes back.");
  });

  it("a run that cannot record a miss always says stake back, however many are in", () => {
    for (const players of [0, 1, 5]) {
      const t = acceptTermsOf({ kind: "reward", recordable: false, players, challengerName: MIKA });
      expect(t.chip).toBe("Miss: stake back");
      expect(t.miss).toBe("Miss it: your lock-in comes back. This run cannot record a miss.");
      expect(t.hit).not.toMatch(/missed/);
    }
  });

  it("matching a staked creator makes two: a recorded miss goes to who hits", () => {
    const t = acceptTermsOf({ kind: "self", recordable: true, players: 1, challengerName: MIKA });
    expect(t.chip).toBe("Miss: goes to who hits");
    expect(t.count).toBe("1 staked so far");
    expect(t.stakeLead).toBe("Everyone puts in the same stake:");
    expect(t.miss).toBe("Miss it: your stake goes to the players who hit.");
  });

  it("matching on a run that cannot record a miss keeps the stake-back wording", () => {
    const t = acceptTermsOf({ kind: "self", recordable: false, players: 1, challengerName: MIKA });
    expect(t.chip).toBe("Miss: stake back");
    expect(t.miss).toMatch(/cannot record a miss/);
  });
});

describe("lockInHint: the reward challenge's lock-in comes back on a miss (gap 5)", () => {
  it("replaces 'real money keeps the goal honest' with what the contract does", () => {
    for (const recordable of [true, false]) {
      const hint = lockInHint(recordable);
      expect(hint).toContain("Their lock-in comes back if they miss");
      expect(hint).not.toMatch(/honest/);
      expect(hint).toContain("You never keep it.");
    }
    expect(lockInHint(true)).toContain("unless someone else accepts the link and hits");
  });
});

describe("chipInWarningOf: one warning, worded per bounty model (F5, gaps 1 and 11)", () => {
  const other = { name: MIKA, you: false };

  it("model 2: split among whoever hits, nobody hits goes to the creator, not refunded", () => {
    const w = chipInWarningOf({ bountyModel: 2, creator: other, selfStake: false, stakers: 3 });
    expect(w.title).toBe("Before you add");
    expect(w.lines).toEqual([
      "It is split among whoever hits.",
      `If nobody hits, it goes to ${MIKA}.`,
      "It is not refunded to you.",
    ]);
  });

  it("model 2 on a stake-on-yourself run with one staker: it reaches them hit or miss", () => {
    const w = chipInWarningOf({ bountyModel: 2, creator: other, selfStake: true, stakers: 1 });
    expect(w.lines).toContain(`If ${MIKA} is the only one staked, it goes to ${MIKA}, hit or miss.`);
    expect(w.lines.at(-1)).toBe("It is not refunded to you.");
  });

  it("keeps the one-staker line when the count did not read, drops it once matched", () => {
    const unread = chipInWarningOf({ bountyModel: 2, creator: other, selfStake: true, stakers: null });
    expect(allText(unread)).toContain("hit or miss");
    const matched = chipInWarningOf({ bountyModel: 2, creator: other, selfStake: true, stakers: 2 });
    expect(allText(matched)).not.toContain("hit or miss");
  });

  it("model 0: goes back to the sponsor unless the bounties outgrow the pot", () => {
    const w = chipInWarningOf({ bountyModel: 0, creator: { name: "acme", you: false }, selfStake: false, stakers: 4 });
    expect(w.lines).toEqual([
      "It goes back to acme unless the bounties owed to the hitters outgrow the pot.",
      "It is not refunded to you.",
    ]);
  });

  it("model 1: split by result among whoever hits", () => {
    const w = chipInWarningOf({ bountyModel: 1, creator: { name: "acme", you: false }, selfStake: false, stakers: 4 });
    expect(w.lines).toEqual([
      "It is split by result among whoever hits.",
      "If nobody hits, it goes to acme.",
      "It is not refunded to you.",
    ]);
  });

  it("the creator adding to their own run reads 'you', and is never told it is not refunded", () => {
    const self = chipInWarningOf({ bountyModel: 2, creator: { name: MIKA, you: true }, selfStake: true, stakers: 1 });
    expect(self.lines).toEqual([
      "It is split among whoever hits.",
      "If nobody hits, it comes back to you.",
      "While you are the only one staked, it comes back to you, hit or miss.",
    ]);
    const sponsor = chipInWarningOf({ bountyModel: 0, creator: { name: "acme", you: true }, selfStake: false, stakers: 2 });
    expect(sponsor.lines).toEqual(["It comes back to you unless the bounties owed to the hitters outgrow the pot."]);
    expect(allText([self, sponsor])).not.toMatch(/not refunded/);
  });

  it("the chip-in card's lead and button follow the flow", () => {
    expect(chipInIntroOf("reward", other).cta).toBe("Add to the reward");
    expect(chipInIntroOf("self", other)).toEqual({
      lead: `Anyone with this link can add to the pot on ${MIKA}'s run. It is paid out when the run settles.`,
      cta: "Add to the pot",
    });
    expect(chipInIntroOf("self", { name: MIKA, you: true }).lead).toMatch(/^Anyone with your links/);
  });
});

describe("voice", () => {
  it("never says bet, wager, odds, luck or winner, and never exclaims", () => {
    const kinds: ChallengeRunKind[] = ["self", "reward", "unstaked"];
    const text = allText([
      kinds.map((k) => inviteShareOf(k)),
      kinds.flatMap((k) => [
        challengeLandingHeadOf({ kind: k, view: "accept", name: MIKA, target: "@andre" }),
        challengeLandingHeadOf({ kind: k, view: "backer", name: MIKA, target: "@andre" }),
        rallyCopyOf(k, MIKA),
        chipInIntroOf(k, { name: MIKA, you: false }),
        acceptTermsOf({ kind: k, recordable: true, players: 1, challengerName: MIKA }),
        acceptTermsOf({ kind: k, recordable: false, players: 0, challengerName: MIKA }),
      ]),
      [0, 1, 2].flatMap((m) => [
        chipInWarningOf({ bountyModel: m, creator: { name: MIKA, you: false }, selfStake: true, stakers: 1 }),
        chipInWarningOf({ bountyModel: m, creator: { name: MIKA, you: true }, selfStake: true, stakers: 1 }),
      ]),
      lockInHint(true),
      lockInHint(false),
    ]);
    expect(text).not.toMatch(FORBIDDEN);
  });
});
