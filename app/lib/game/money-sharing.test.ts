import { describe, expect, it } from "vitest";
import { challengeBackerUrl, challengeShareUrl, isBackerView } from "@/lib/challenges";
import {
  challengeLandingHeadOf,
  challengeRunKindOf,
  chipInIntroOf,
  chipInWarningOf,
  creatorStakedIn,
  inviteShareOf,
  rallyCopyOf,
  shareCardOf,
  type ChallengeRunKind,
} from "@/lib/game/money-sharing";

// docs/MONEY-FLOWS.md gaps 1, 5, 6, 7 and 11: the share links, the chip-in
// warning and the accept screen say what the contract does. Every sentence a
// player can read here is pinned, and none uses the words the voice forbids.

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

  it("is a match-the-stake challenge once the creator staked", () => {
    expect(challengeRunKindOf({ creatorStaked: true })).toBe("self");
  });

  it("is unstaked before the creator locks in, even with their extra already in the pot", () => {
    // The gap this pins (2026-09-27): a creator who added extra at create and
    // had not staked yet read as a reward challenge, so their friend landed on
    // "X challenged you" instead of "Match X's stake". Money in the pot never
    // changes the game; only the creator's stake says whether they are in.
    expect(challengeRunKindOf({ creatorStaked: false })).toBe("unstaked");
  });
});

describe("inviteShareOf: two links once the creator is in, none before", () => {
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
    expect(back.detail).toBe("They add to the pot on your challenge. It never stakes them in.");
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

  it("offers no link before a stake-on-yourself creator locks in, and says why", () => {
    const share = inviteShareOf("unstaked");
    expect(share.kind).toBe("blocked");
    if (share.kind !== "blocked") return;
    expect(share.reason).toContain("Lock in your stake first");
    expect(share.reason).toContain("match your stake");
    expect(share.reason).toContain("back you");
  });
});

describe("shareCardOf: the creator's share card only while the run is live", () => {
  it("shows nothing once the run is settled, cancelled or past its end, whatever the flow", () => {
    for (const kind of ["self", "unstaked"] as const) {
      expect(shareCardOf({ kind, live: false })).toBeNull();
    }
  });

  it("shows nothing until the flow has read: a card never guesses which links to offer", () => {
    expect(shareCardOf({ kind: null, live: true })).toBeNull();
  });

  it("is the flow's own card while live", () => {
    expect(shareCardOf({ kind: "self", live: true })).toEqual(inviteShareOf("self"));
    expect(shareCardOf({ kind: "unstaked", live: true })?.kind).toBe("blocked");
  });
});

describe("challengeLandingHeadOf: each link kind has its own headline", () => {
  const head = (view: "accept" | "backer") => challengeLandingHeadOf({ view, name: MIKA });

  it("Match my stake lands on Match {name}'s stake, with the amount when it read", () => {
    expect(challengeLandingHeadOf({ view: "accept", name: "@andre", stake: "10.00" })).toEqual({
      tag: "Match the stake",
      title: "Match @andre's 10.00 USDC stake",
    });
    expect(head("accept").title).toBe(`Match ${MIKA}'s stake`);
  });

  it("Back me lands on Back {name}, never 'challenged their friend'", () => {
    expect(head("backer")).toEqual({ tag: "Backing", title: `Back ${MIKA}` });
    expect(head("backer").title).not.toMatch(/challenged/);
  });

  it("rallies backers for the person on a stake-on-yourself run", () => {
    expect(rallyCopyOf(MIKA).heading).toBe(`Rally backers for ${MIKA}`);
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

  it("the chip-in card's lead and button name the creator", () => {
    expect(chipInIntroOf(other)).toEqual({
      lead: `Anyone with this link can add to the pot on ${MIKA}'s challenge. It is split among whoever hits when the challenge settles.`,
      cta: "Add to the pot",
    });
    expect(chipInIntroOf({ name: MIKA, you: true }).lead).toMatch(/^Anyone with your links/);
  });
});

describe("voice", () => {
  it("never says bet, wager, odds, luck or winner, and never exclaims", () => {
    const kinds: ChallengeRunKind[] = ["self", "unstaked"];
    const text = allText([
      kinds.map((k) => inviteShareOf(k)),
      challengeLandingHeadOf({ view: "accept", name: MIKA }),
      challengeLandingHeadOf({ view: "backer", name: MIKA }),
      rallyCopyOf(MIKA),
      chipInIntroOf({ name: MIKA, you: false }),
      chipInIntroOf({ name: MIKA, you: true }),
      [0, 1, 2].flatMap((m) => [
        chipInWarningOf({ bountyModel: m, creator: { name: MIKA, you: false }, selfStake: true, stakers: 1 }),
        chipInWarningOf({ bountyModel: m, creator: { name: MIKA, you: true }, selfStake: true, stakers: 1 }),
      ]),
    ]);
    expect(text).not.toMatch(FORBIDDEN);
    // One vocabulary: a player joins a challenge, never a run, pool or dare.
    expect(text).not.toMatch(/\b(run|runs|pool|pools|dare|dares)\b/i);
  });
});
