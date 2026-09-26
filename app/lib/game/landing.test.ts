import { describe, expect, it } from "vitest";
import type { PoolInfo } from "@/lib/contract";
import {
  challengeNote,
  endsAtWords,
  friendNote,
  friendQuestion,
  heroNote,
  openLandingRuns,
  openTag,
  outcomeCopy,
  pickFeaturedRun,
  playersWords,
  runKind,
  runName,
  segmentsText,
  stakeWords,
  termsOf,
  type OpenRun,
} from "@/lib/game/landing";

const USDC = 1_000_000n;
const NOW = 1_790_000_000n;
/** MISS_RULE_FROM_POOL_ID for these fixtures: every pool is past the cutoff. */
const CUTOFF = 1n;

function pool(over: Partial<PoolInfo> & { id: bigint }): PoolInfo {
  return {
    creator: "0x0000000000000000000000000000000000000001",
    bountyModel: 2,
    settled: false,
    cancelled: false,
    periodStart: NOW - 3600n,
    periodEnd: NOW + 16n * 3600n,
    entryFee: USDC,
    balance: 2n * USDC,
    initiative: "Sleep 7 hours Saturday night",
    goalSpec: "Sleep at least 7 hours for 1 night",
    ...over,
  };
}

const sleep = pool({ id: 5n });
const efficiency = pool({
  id: 4n,
  initiative: "Sleep efficiency 85 tonight",
  goalSpec: "Sleep efficiency 85% or better for 1 night",
  periodEnd: NOW + 18n * 3600n,
});
const workout = pool({
  id: 2n,
  initiative: "One workout today",
  goalSpec: "Complete at least 1 workout for 1 day",
  periodEnd: NOW + 15n * 3600n,
  balance: 3n * USDC,
});

describe("openLandingRuns", () => {
  it("keeps live, payable, public wearable runs, soonest ending first", () => {
    const pools = [
      sleep,
      efficiency,
      workout,
      pool({ id: 1n, cancelled: true, settled: true }),
      pool({ id: 6n, periodEnd: NOW - 1n }),
      pool({ id: 7n, initiative: "challenge" }),
      pool({ id: 8n, goalSpec: "[doc] Flu shot this month" }),
    ];
    const runs = openLandingRuns(pools, NOW, new Map([["2", 1], ["5", 0]]));
    expect(runs.map((r) => r.pool.id)).toEqual([2n, 5n, 4n]);
    expect(runs.map((r) => r.players)).toEqual([1, 0, null]);
  });
});

describe("pickFeaturedRun", () => {
  const run = (p: PoolInfo, players: number | null): OpenRun => ({ pool: p, players });

  it("features the run with the most players", () => {
    expect(pickFeaturedRun([run(sleep, 0), run(workout, 1), run(efficiency, 0)])?.pool.id).toBe(2n);
  });

  it("breaks a tie toward the sleep run, then the one ending soonest", () => {
    expect(pickFeaturedRun([run(workout, 0), run(efficiency, 0), run(sleep, 0)])?.pool.id).toBe(5n);
  });

  it("counts an unread count as zero and skips runs that are not commitment runs", () => {
    expect(pickFeaturedRun([run(workout, null), run(sleep, 0)])?.pool.id).toBe(5n);
    expect(pickFeaturedRun([run(pool({ id: 9n, bountyModel: 0 }), 4)])).toBeNull();
    expect(pickFeaturedRun([])).toBeNull();
  });
});

describe("run words", () => {
  it("names a run by its title, or its goal when the title is a tag", () => {
    expect(runName(sleep)).toBe("Sleep 7 hours Saturday night");
    expect(runName(pool({ id: 1n, initiative: "sleep" }))).toBe("Sleep at least 7 hours for 1 night");
    expect(runName(pool({ id: 1n, initiative: "challenge" }))).toBe("Sleep at least 7 hours for 1 night");
    // An efficiency title written without its sign gets it back, so the lobby,
    // Also open and the run page say the same number.
    const eff = { initiative: "Sleep efficiency 85 tonight", goalSpec: "Sleep efficiency 85% or better for 1 night" };
    expect(runName(eff)).toBe("Sleep efficiency 85% tonight");
    expect(runName({ ...eff, initiative: "Sleep efficiency 85% tonight" })).toBe("Sleep efficiency 85% tonight");
    expect(runName({ ...eff, initiative: "Sleep efficiency 90 tonight" })).toBe("Sleep efficiency 90 tonight");
  });

  it("kinds, stake words and player counts", () => {
    expect(runKind(sleep.goalSpec)).toBe("sleep");
    expect(runKind(workout.goalSpec)).toBe("workout");
    expect(runKind("Walk at least 8,000 steps for 1 day")).toBe("move");
    expect(stakeWords(USDC)).toBe("1");
    expect(stakeWords(USDC / 2n)).toBe("0.50");
    expect(playersWords(0)).toBe("Nobody in yet");
    expect(playersWords(1)).toBe("1 player in");
    expect(playersWords(3)).toBe("3 players in");
    expect(playersWords(null)).toBeNull();
  });

  it("says when a run ends in the viewer's zone, and tags tonight's sleep run", () => {
    // 2026-09-26T23:30:00Z is Sunday 08:30 in Tokyo.
    expect(endsAtWords(1_790_465_400n, "Asia/Tokyo")).toBe("Sun 08:30");
    expect(openTag(sleep.goalSpec, sleep.periodEnd, Number(NOW))).toBe("Open tonight");
    expect(openTag(workout.goalSpec, workout.periodEnd, Number(NOW))).toBe("Open now");
    expect(openTag(sleep.goalSpec, NOW + 72n * 3600n, Number(NOW))).toBe("Open now");
  });
});

describe("heroNote", () => {
  it("nobody in: hitting alone returns the stake plus the sponsor pot", () => {
    const terms = termsOf({ pool: sleep, players: 0 }, 0, CUTOFF);
    expect(terms).not.toBeNull();
    expect(segmentsText(heroNote(terms!))).toBe(
      "Nobody's in yet. Hit it alone and 3.00 comes back: your 1.00 plus the 2.00 pot.",
    );
  });

  it("players in: the range from everyone hitting to only you", () => {
    const terms = termsOf({ pool: workout, players: 1 }, 0, CUTOFF)!;
    const note = heroNote(terms);
    expect(segmentsText(note)).toBe(
      "1 player in. Hit it and you get 2.00 to 4.00 back: your 1.00, plus an equal share of the 2.00 sponsor pot and any missed stakes.",
    );
    expect(note.filter((s) => s.strong).map((s) => s.text)).toEqual(["2.00", "4.00"]);
  });

  it("no sponsor pot, nobody in", () => {
    const terms = termsOf({ pool: pool({ id: 3n, balance: 0n }), players: 0 }, 0, CUTOFF)!;
    expect(segmentsText(heroNote(terms))).toBe(
      "Nobody's in yet. Hit it and your 1.00 comes back, plus a share of the stakes that miss.",
    );
  });

  it("states no figure past the stake when the fee did not read", () => {
    const terms = termsOf({ pool: sleep, players: 0 }, null, CUTOFF)!;
    expect(segmentsText(heroNote(terms))).toBe(
      "Everyone stakes 1.00. Hit it and your stake comes back plus a share of the missed stakes.",
    );
  });

  it("has no terms while the player count is unknown", () => {
    expect(termsOf({ pool: sleep, players: null }, 0)).toBeNull();
  });

  it("never promises a missed stake on a run that cannot record a miss", () => {
    // No cutoff set: no pool records a miss (lib/miss-rule.ts).
    const bare = termsOf({ pool: pool({ id: 3n, balance: 0n }), players: 0 }, 0, null)!;
    expect(bare.recordsMisses).toBe(false);
    expect(segmentsText(heroNote(bare))).toBe(
      "Nobody's in yet. Hit it or miss it, your 1.00 comes back: this run cannot record a miss.",
    );
    const two = termsOf({ pool: pool({ id: 3n, balance: 2n * USDC }), players: 2 }, 0, null)!;
    expect(segmentsText(heroNote(two))).toBe("2 players in. Hit it and your 1.00 comes back. This run cannot record a miss, so a miss comes back too.");
    const withPot = termsOf({ pool: workout, players: 1 }, 0, null)!;
    expect(segmentsText(heroNote(withPot))).toBe(
      "1 player in. Hit it and you get 2.00 to 3.00 back: your 1.00, plus an equal share of the 2.00 sponsor pot. A miss here is refunded.",
    );
  });
});

describe("outcomeCopy", () => {
  const terms = termsOf({ pool: sleep, players: 0 }, 0, CUTOFF)!;

  it("works each outcome's figure from the live run", () => {
    expect(outcomeCopy("hit", terms).worked).toEqual({
      label: "In this run, if you hit alone",
      usd: "3.00",
      tone: "money",
    });
    expect(outcomeCopy("miss", terms).worked).toEqual({ label: "You get back", usd: "0.00", tone: "dusk" });
    expect(outcomeCopy("none", terms).worked).toEqual({ label: "Your stake back", usd: "1.00", tone: "plain" });
  });

  it("says a run with no wearable data is not a miss", () => {
    expect(outcomeCopy("miss", terms).body).toContain("If your wearable sends nothing for the run, that is not a miss");
    expect(outcomeCopy("miss", terms).body).toContain("Your 1.00 is shared equally");
  });

  it("shows no worked figure without a live run", () => {
    expect(outcomeCopy("hit", null, true).worked).toBeNull();
    expect(outcomeCopy("miss", null, true).worked).toBeNull();
    expect(outcomeCopy("none", null, true).worked).toBeNull();
    expect(outcomeCopy("hit", null, true).body).toBe("An equal share of the missed stakes goes to everyone who hits.");
    expect(outcomeCopy("miss", null, true).body).toContain("on a run that can record a miss");
  });

  it("says a miss comes back on a run that cannot record one", () => {
    const refundRun = termsOf({ pool: sleep, players: 2 }, 0, null)!;
    const miss = outcomeCopy("miss", refundRun);
    expect(miss.heading).toBe("On this run, your stake comes back.");
    expect(miss.worked).toEqual({ label: "You get back", usd: "1.00", tone: "plain" });
    // Hitting alone beside one other player: their miss is refunded first,
    // so 1.00 + the 2.00 pot, where a recorded miss would have made it 4.00.
    expect(outcomeCopy("hit", termsOf({ pool: workout, players: 1 }, 0, null)!).worked?.usd).toBe("3.00");
    expect(outcomeCopy("hit", termsOf({ pool: workout, players: 1 }, 0, CUTOFF)!).worked?.usd).toBe("4.00");
    expect(outcomeCopy("miss", null, false).heading).toBe("Your stake comes back.");
  });
});

describe("challengeNote", () => {
  it("works both friends hitting and only one hitting from commitmentOutcome", () => {
    expect(segmentsText(challengeNote(USDC, true))).toBe(
      "Stake 1.00 each. If you both hit, you both get 1.00 back. On a challenge that can record a miss, if only one of you hits, that one gets 2.00.",
    );
    expect(segmentsText(challengeNote(5n * USDC, true))).toContain("that one gets 10.00.");
    // Miss rule off on this build: nothing past both stakes coming back.
    expect(segmentsText(challengeNote(USDC, false))).toBe("Stake 1.00 each. If you both hit, you both get 1.00 back.");
  });
});

describe("friendNote", () => {
  it("works the featured run's two-player math while nobody else is in", () => {
    // Pool 5 on this build: 0 in, 2.00 sponsor pot, cannot record a miss.
    const empty = termsOf({ pool: sleep, players: 0 }, 0, null)!;
    expect(segmentsText(friendNote(empty))).toBe(
      "Stake 1.00 each. If you both hit, each of you gets 2.00 back.",
    );
    // A run that records a miss also says what their miss is worth to you.
    const recording = termsOf({ pool: sleep, players: 0 }, 0, CUTOFF)!;
    expect(segmentsText(friendNote(recording))).toBe(
      "Stake 1.00 each. If you both hit, each of you gets 2.00 back. If they miss, you get 4.00.",
    );
  });

  it("names what a hit is made of once others are in, with no figure it cannot stand behind", () => {
    // Pool 2: 1 player in, 3.00 balance, so a 2.00 sponsor pot.
    const busy = termsOf({ pool: workout, players: 1 }, 0, null)!;
    expect(segmentsText(friendNote(busy))).toBe(
      "Stake 1.00 each. If you both hit, each of you gets your 1.00 back plus an equal share of the 2.00 sponsor pot.",
    );
    const noPot = termsOf({ pool: pool({ id: 9n, balance: USDC }), players: 1 }, 0, null)!;
    expect(segmentsText(friendNote(noPot))).toBe("Stake 1.00 each. If you both hit, you both get your stake back.");
  });

  it("asks the question for the kind of run it links to", () => {
    expect(friendQuestion("workout")).toBe("Know someone who swears they work out every day?");
    expect(friendQuestion("sleep")).toBe("Know someone who swears they sleep 8 hours?");
    expect(friendQuestion(null)).toBe("Know someone who swears they sleep 8 hours?");
  });
});
