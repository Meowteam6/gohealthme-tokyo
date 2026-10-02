import { describe, expect, it } from "vitest";
import {
  buildLobby,
  creatorMoneyInOf,
  lobbyNeedsSensorCheck,
  lockCopy,
  runSlotOf,
  slotRank,
  type LobbyInput,
  type RunSlotInput,
} from "@/lib/game/lobby";
import type { PoolInfo } from "@/lib/contract";

// One decision per run, shown as a lock with its fix on the lobby row - before
// any stake. These pin the precedence and that no plumbing reaches the copy.

function input(overrides: Partial<RunSlotInput> = {}): RunSlotInput {
  return {
    phase: "live",
    canPay: true,
    joined: false,
    address: "0xabc",
    joinBlock: { kind: "ok" },
    worldLane: "off",
    humanVerified: false,
    gate: "passed",
    needsDocumentVerifier: false,
    verifier: "available",
    payouts: "ready",
    moneyIn: "open",
    deviceLabel: "WHOOP",
    ...overrides,
  };
}

describe("runSlotOf", () => {
  it("is playable when nothing stands in the way", () => {
    expect(runSlotOf(input())).toEqual({ kind: "playable" });
  });

  it("closes an ended run, whether or not the player is in it", () => {
    expect(runSlotOf(input({ phase: "expired", joined: true }))).toEqual({
      kind: "closed",
      joined: true,
    });
    expect(runSlotOf(input({ phase: "settled" }))).toEqual({ kind: "closed", joined: false });
  });

  it("closes a cancelled run to new players", () => {
    expect(runSlotOf(input({ cancelled: true }))).toEqual({ kind: "closed", joined: false });
  });

  it("never offers a run that cannot pay", () => {
    expect(runSlotOf(input({ canPay: false }))).toEqual({ kind: "cannot-pay" });
  });

  it("never stands in front of a run the player already entered", () => {
    expect(
      runSlotOf(input({ joined: true, joinBlock: { kind: "no-device" }, worldLane: "on" })),
    ).toEqual({ kind: "in-run" });
  });

  it("asks a visitor to sign in", () => {
    expect(runSlotOf(input({ address: null }))).toEqual({
      kind: "locked",
      lock: { kind: "sign-in" },
    });
  });

  it("puts a hardware limit ahead of everything fixable (WHOOP on a steps run)", () => {
    expect(
      runSlotOf(
        input({
          joinBlock: { kind: "unsupported", metric: "steps" },
          worldLane: "on",
        }),
      ),
    ).toEqual({
      kind: "locked",
      lock: { kind: "cannot-measure", metric: "steps", deviceLabel: "WHOOP" },
    });
  });

  it("locks every wearable run during a provider outage", () => {
    expect(runSlotOf(input({ joinBlock: { kind: "outage", reason: "Junction 502" } }))).toEqual({
      kind: "locked",
      lock: { kind: "outage" },
    });
  });

  it("asks for proof of human only when World is on for the build", () => {
    expect(runSlotOf(input({ worldLane: "on" }))).toEqual({
      kind: "locked",
      lock: { kind: "not-human" },
    });
    expect(runSlotOf(input({ worldLane: "on", humanVerified: true }))).toEqual({
      kind: "playable",
    });
    expect(runSlotOf(input({ worldLane: "off" }))).toEqual({ kind: "playable" });
  });

  // Punch list item 1: a failed World status read used to collapse into
  // "World off", so an unverified wallet on a World-on build got the stake.
  it("holds the stake while the World read is loading", () => {
    expect(runSlotOf(input({ worldLane: "loading" }))).toEqual({ kind: "checking" });
  });

  it("locks the stake behind a retry when the World read failed, never playable", () => {
    expect(runSlotOf(input({ worldLane: "error" }))).toEqual({
      kind: "locked",
      lock: { kind: "check-failed", check: "human" },
    });
    // Even for a wallet the client believes is verified: the read failed.
    expect(runSlotOf(input({ worldLane: "error", humanVerified: true }))).toEqual({
      kind: "locked",
      lock: { kind: "check-failed", check: "human" },
    });
  });

  // Punch list item 2: /c/<token> is public, so the closed-beta gate has to
  // be a lock on the run itself.
  describe("closed-beta gate", () => {
    it("locks an unapproved wallet out before the stake", () => {
      expect(runSlotOf(input({ gate: "not-approved" }))).toEqual({
        kind: "locked",
        lock: { kind: "not-approved", pending: false },
      });
    });

    it("tells a waitlisted wallet its request is in", () => {
      expect(runSlotOf(input({ gate: "pending" }))).toEqual({
        kind: "locked",
        lock: { kind: "not-approved", pending: true },
      });
    });

    it("holds while the gate is loading and retries when it failed", () => {
      expect(runSlotOf(input({ gate: "loading" }))).toEqual({ kind: "checking" });
      expect(runSlotOf(input({ gate: "error" }))).toEqual({
        kind: "locked",
        lock: { kind: "check-failed", check: "access" },
      });
    });

    it("orders not-approved after not-human", () => {
      expect(runSlotOf(input({ worldLane: "on", gate: "not-approved" }))).toEqual({
        kind: "locked",
        lock: { kind: "not-human" },
      });
    });

    // The list proves a human too (2026-09-30). With World on and the list
    // read failed, the player may well be on it: a retry, never "prove you
    // are one human" on a guess.
    it("retries a failed list read on a World-on build instead of asking for World ID", () => {
      expect(runSlotOf(input({ worldLane: "on", humanVerified: false, gate: "error" }))).toEqual({
        kind: "locked",
        lock: { kind: "check-failed", check: "access" },
      });
    });

    it("never gates a run the player is already in", () => {
      expect(runSlotOf(input({ joined: true, gate: "not-approved" }))).toEqual({
        kind: "in-run",
      });
    });

    it("asks a signed-out visitor to sign in first", () => {
      expect(runSlotOf(input({ address: null, gate: "not-approved" }))).toEqual({
        kind: "locked",
        lock: { kind: "sign-in" },
      });
    });
  });

  // Punch list item 3: the document checker off.
  describe("document checker", () => {
    it("locks an upload run while the checker is off", () => {
      expect(
        runSlotOf(input({ needsDocumentVerifier: true, verifier: "off" })),
      ).toEqual({ kind: "locked", lock: { kind: "verifier-off" } });
    });

    it("holds while the checker status loads, and retries when it failed", () => {
      expect(
        runSlotOf(input({ needsDocumentVerifier: true, verifier: "loading" })),
      ).toEqual({ kind: "checking" });
      expect(
        runSlotOf(input({ needsDocumentVerifier: true, verifier: "error" })),
      ).toEqual({ kind: "locked", lock: { kind: "check-failed", check: "verifier" } });
    });

    it("leaves wearable runs alone when the checker is off", () => {
      expect(
        runSlotOf(input({ needsDocumentVerifier: false, verifier: "off" })),
      ).toEqual({ kind: "playable" });
    });

    it("tells a signed-out visitor about the pause before asking them to sign in", () => {
      expect(
        runSlotOf(input({ address: null, needsDocumentVerifier: true, verifier: "off" })),
      ).toEqual({ kind: "locked", lock: { kind: "verifier-off" } });
    });
  });

  // Punch list item 6: the World ID payout confirmation unknown or broken.
  describe("payout rule", () => {
    it("locks every run when payouts cannot be confirmed on this build", () => {
      expect(runSlotOf(input({ payouts: "misconfigured" }))).toEqual({
        kind: "locked",
        lock: { kind: "payouts-paused" },
      });
    });

    it("holds while the payout rule loads, and retries when it failed", () => {
      expect(runSlotOf(input({ payouts: "loading" }))).toEqual({ kind: "checking" });
      expect(runSlotOf(input({ payouts: "error" }))).toEqual({
        kind: "locked",
        lock: { kind: "check-failed", check: "payouts" },
      });
    });

    it("never stands in front of a run the player is already in", () => {
      expect(runSlotOf(input({ joined: true, payouts: "misconfigured" }))).toEqual({
        kind: "in-run",
      });
    });
  });

  // KILL_BASE_MONEY_IN (Andre, 2026-09-30): new stakes pause build-wide, said
  // on the card before any stake, and money already in is never touched.
  describe("new money paused", () => {
    it("locks every open challenge with its own lock, ordered like the payout pause", () => {
      expect(runSlotOf(input({ moneyIn: "paused" }))).toEqual({
        kind: "locked",
        lock: { kind: "money-in-paused", reason: null },
      });
      // Build-wide, so a signed-out visitor learns it before signing in.
      expect(runSlotOf(input({ moneyIn: "paused", address: null }))).toEqual({
        kind: "locked",
        lock: { kind: "money-in-paused", reason: null },
      });
      // Ahead of every per-player lock.
      expect(
        runSlotOf(input({ moneyIn: "paused", worldLane: "on", gate: "not-approved", joinBlock: { kind: "no-device" } })),
      ).toEqual({ kind: "locked", lock: { kind: "money-in-paused", reason: null } });
      // The payout pause still reads first when both hold.
      expect(runSlotOf(input({ moneyIn: "paused", payouts: "misconfigured" }))).toEqual({
        kind: "locked",
        lock: { kind: "payouts-paused" },
      });
    });

    it("carries the operator's reason onto the lock", () => {
      expect(runSlotOf(input({ moneyIn: "paused", moneyInReason: "Back Friday." }))).toEqual({
        kind: "locked",
        lock: { kind: "money-in-paused", reason: "Back Friday." },
      });
    });

    it("holds while the switches load and retries when the read failed", () => {
      expect(runSlotOf(input({ moneyIn: "loading" }))).toEqual({ kind: "checking" });
      expect(runSlotOf(input({ moneyIn: "error" }))).toEqual({
        kind: "locked",
        lock: { kind: "check-failed", check: "switches" },
      });
    });

    it("never stands in front of a challenge the player is already in, or a closed one", () => {
      expect(runSlotOf(input({ joined: true, moneyIn: "paused" }))).toEqual({ kind: "in-run" });
      expect(runSlotOf(input({ phase: "expired", joined: true, moneyIn: "paused" }))).toEqual({
        kind: "closed",
        joined: true,
      });
    });

    it("lets a creator whose challenge already holds money stake in it", () => {
      expect(runSlotOf(input({ moneyIn: "paused", creatorMoneyIn: true }))).toEqual({ kind: "playable" });
      expect(runSlotOf(input({ moneyIn: "loading", creatorMoneyIn: true }))).toEqual({ kind: "playable" });
      expect(runSlotOf(input({ moneyIn: "error", creatorMoneyIn: true }))).toEqual({ kind: "playable" });
      // The exception opens only the pause: every other lock still holds.
      expect(
        runSlotOf(input({ moneyIn: "paused", creatorMoneyIn: true, joinBlock: { kind: "no-device" } })),
      ).toEqual({ kind: "locked", lock: { kind: "no-sensor" } });
      expect(runSlotOf(input({ moneyIn: "paused", creatorMoneyIn: true, payouts: "misconfigured" }))).toEqual({
        kind: "locked",
        lock: { kind: "payouts-paused" },
      });
    });

    it("changes nothing while new money is open (regression)", () => {
      for (const over of [
        {},
        { worldLane: "on" as const },
        { worldLane: "on" as const, humanVerified: true },
        { gate: "pending" as const },
        { joinBlock: { kind: "no-device" as const } },
        { payouts: "misconfigured" as const },
        { needsDocumentVerifier: true, verifier: "off" as const },
        { address: null },
      ]) {
        const open = runSlotOf(input({ ...over, moneyIn: "open" }));
        const withCreator = runSlotOf(input({ ...over, moneyIn: "open", creatorMoneyIn: true }));
        expect(withCreator).toEqual(open);
      }
    });
  });

  // "Pay on the verdict" (Andre, 2026-10-02). A list player or an admin is
  // paid on the wearable verdict, like V3, so nothing about a hit waits on a
  // World ID they do not have: the join is open to them like to anyone proven
  // human. The retired "world-to-collect" lock is never produced, even for a
  // caller that still passes the old collectNeedsWorld flag.
  describe("a list player or an admin on a build where World players confirm with World ID", () => {
    it("is playable: SPOTTER pays them on the verdict", () => {
      expect(runSlotOf(input({ worldLane: "on", humanVerified: true }))).toEqual({ kind: "playable" });
      expect(runSlotOf(input({ worldLane: "on", humanVerified: true, collectNeedsWorld: true }))).toEqual({
        kind: "playable",
      });
    });

    it("keeps every other lock in front of them (regression)", () => {
      expect(
        runSlotOf(input({ worldLane: "on", humanVerified: true, collectNeedsWorld: true, gate: "error" })),
      ).toEqual({ kind: "locked", lock: { kind: "check-failed", check: "access" } });
      expect(runSlotOf(input({ joined: true, collectNeedsWorld: true }))).toEqual({ kind: "in-run" });
      expect(
        runSlotOf(input({ worldLane: "on", humanVerified: true, joinBlock: { kind: "no-device" } })),
      ).toEqual({ kind: "locked", lock: { kind: "no-sensor" } });
    });
  });

  describe("creatorMoneyInOf", () => {
    const CREATOR = "0x00000000000000000000000000000000000000Aa";
    it("is the challenge's creator with money already in its pot", () => {
      expect(creatorMoneyInOf({ creator: CREATOR, balance: 2_000_000n }, CREATOR.toLowerCase())).toBe(true);
      expect(creatorMoneyInOf({ creator: CREATOR, balance: 0n }, CREATOR)).toBe(false);
      expect(creatorMoneyInOf({ creator: CREATOR, balance: 2_000_000n }, "0xabc")).toBe(false);
      expect(creatorMoneyInOf({ creator: CREATOR, balance: 2_000_000n }, null)).toBe(false);
    });
  });

  describe("linked sensor holds", () => {
    it("gives a sensor that has not synced its own lock, not the generic check", () => {
      expect(
        runSlotOf(input({ joinBlock: { kind: "unchecked", hold: "awaiting-sync" } })),
      ).toEqual({
        kind: "locked",
        lock: { kind: "sensor-hold", hold: "awaiting-sync", deviceLabel: "WHOOP" },
      });
    });

    it("gives an unreadable sensor its own lock", () => {
      expect(
        runSlotOf(input({ joinBlock: { kind: "unchecked", hold: "unreadable" } })),
      ).toEqual({
        kind: "locked",
        lock: { kind: "sensor-hold", hold: "unreadable", deviceLabel: "WHOOP" },
      });
    });

    it("keeps a bare unchecked block on the one-tap sensor check", () => {
      expect(runSlotOf(input({ joinBlock: { kind: "unchecked" } }))).toEqual({
        kind: "locked",
        lock: { kind: "sensor-unchecked" },
      });
    });
  });

  it("marks a hybrid run joinable by upload, and still ahead of it checks World", () => {
    expect(runSlotOf(input({ joinBlock: { kind: "ok", proof: "upload" } }))).toEqual({
      kind: "playable",
      proof: "upload",
    });
    expect(
      runSlotOf(input({ joinBlock: { kind: "ok", proof: "upload" }, worldLane: "on" })),
    ).toEqual({ kind: "locked", lock: { kind: "not-human" } });
  });

  it("separates no sensor from a sensor not checked this visit", () => {
    expect(runSlotOf(input({ joinBlock: { kind: "no-device" } }))).toEqual({
      kind: "locked",
      lock: { kind: "no-sensor" },
    });
    expect(runSlotOf(input({ joinBlock: { kind: "unchecked" } }))).toEqual({
      kind: "locked",
      lock: { kind: "sensor-unchecked" },
    });
  });
});

describe("lockCopy", () => {
  const all = [
    { kind: "sign-in" },
    { kind: "not-human" },
    { kind: "no-sensor" },
    { kind: "sensor-unchecked" },
    { kind: "cannot-measure", metric: "steps", deviceLabel: "WHOOP" },
    { kind: "outage" },
    { kind: "sensor-hold", hold: "awaiting-sync", deviceLabel: "Junction" },
    { kind: "sensor-hold", hold: "unreadable", deviceLabel: null },
    { kind: "not-approved", pending: false },
    { kind: "not-approved", pending: true },
    { kind: "verifier-off" },
    { kind: "payouts-paused" },
    { kind: "money-in-paused", reason: null },
    { kind: "money-in-paused", reason: "Back after the upgrade on Friday." },
    { kind: "world-to-collect" },
    { kind: "check-failed", check: "human" },
    { kind: "check-failed", check: "access" },
    { kind: "check-failed", check: "payouts" },
    { kind: "check-failed", check: "verifier" },
    { kind: "check-failed", check: "switches" },
  ] as const;

  it("gives every fixable lock a fix and names no plumbing", () => {
    for (const lock of all) {
      const copy = lockCopy(lock, "/pools");
      expect(copy.title.length).toBeGreaterThan(0);
      const text = `${copy.title} ${copy.detail}`;
      expect(text).not.toMatch(/NEXT_PUBLIC|env|unexpected response|Junction 502|!/);
      if (copy.tone !== "wait") expect(copy.fix.kind).not.toBe("none");
    }
  });

  it("says a WHOOP cannot count steps and sends the player to change wearable", () => {
    const copy = lockCopy(
      { kind: "cannot-measure", metric: "steps", deviceLabel: "WHOOP" },
      "/pools/7",
    );
    expect(copy.title).toBe("WHOOP cannot measure this one");
    expect(copy.detail).toContain("step count");
    expect(copy.tone).toBe("hardware");
    expect(copy.fix).toEqual({
      kind: "link",
      label: "Change my wearable",
      href: "/character?step=sensor&next=%2Fpools%2F7",
    });
  });

  it("gives a failed check a retry in place and says nothing was charged", () => {
    const copy = lockCopy({ kind: "check-failed", check: "human" }, "/c/tok");
    expect(copy.fix).toEqual({ kind: "retry", label: "Check again" });
    expect(copy.detail).toContain("Nothing has been charged");
  });

  it("sends an unapproved dare invitee to get in and back to the dare", () => {
    const copy = lockCopy({ kind: "not-approved", pending: false }, "/c/tok");
    expect(copy.fix).toEqual({ kind: "link", label: "Get in", href: "/character?next=%2Fc%2Ftok" });
  });

  it("says a paused build takes no stake and needs no action from the player", () => {
    for (const lock of [{ kind: "verifier-off" }, { kind: "payouts-paused" }] as const) {
      const copy = lockCopy(lock, "/pools");
      expect(copy.tone).toBe("wait");
      expect(copy.fix.kind).toBe("none");
      expect(copy.detail).toMatch(/not taking stakes/);
    }
  });

  it("says new stakes are paused, money in still comes out, and the reason when set", () => {
    const copy = lockCopy({ kind: "money-in-paused", reason: null }, "/pools");
    expect(copy.title).toBe("New stakes are paused for now");
    expect(copy.detail).toContain("Money already in still pays out and refunds as normal.");
    expect(copy.detail).toContain("Nothing has been charged.");
    expect(copy.tone).toBe("wait");
    expect(copy.fix.kind).toBe("none");
    const withReason = lockCopy({ kind: "money-in-paused", reason: "Back after the upgrade on Friday." }, "/pools");
    expect(withReason.detail).toMatch(/Nothing has been charged\. Back after the upgrade on Friday\.$/);
    expect(`${copy.title} ${copy.detail}`).not.toMatch(/[!\u2014]|\b(bet|wager|odds|winner)\b/i);
  });

  it("gives a failed switches read a retry in place", () => {
    const copy = lockCopy({ kind: "check-failed", check: "switches" }, "/pools");
    expect(copy.fix).toEqual({ kind: "retry", label: "Check again" });
    expect(copy.title).toMatch(/stakes are open/);
  });

  it("words a sensor hold with the wearable lane's copy and a re-check", () => {
    const copy = lockCopy(
      { kind: "sensor-hold", hold: "awaiting-sync", deviceLabel: "Junction" },
      "/pools",
    );
    expect(copy.title).toBe("Your wearable has not synced yet");
    // Nikki, 2026-09-27: "Check again" opened a wallet signature with no
    // explanation and read as a transaction. The detail says what to do and
    // the button says what the tap is. A player Dynamic signed in checks on
    // their session token with no prompt at all, and the copy cannot know
    // which path this tap takes, so it says "may" and stays true for both.
    expect(copy.detail).toBe(
      "Open the Junction app so it syncs, then come back. Checking may ask your wallet to sign; it never sends a payment.",
    );
    expect(copy.fix).toEqual({ kind: "check-sensor", label: "Check my wearable" });
    expect(copy.tone).toBe("wait");
  });

  it("checks the sensor in place instead of sending the player away", () => {
    expect(lockCopy({ kind: "sensor-unchecked" }, "/pools").fix.kind).toBe("check-sensor");
  });

  // One vocabulary (Andre, 2026-09-27): anything a player can join is a
  // challenge, never a run, pool or dare.
  it("calls what the player joins a challenge, never a run, pool or dare", () => {
    // sensor-hold copy is the wearable lane's (lib/wearable-join-gate.ts).
    for (const lock of all.filter((l) => l.kind !== "sensor-hold")) {
      const copy = lockCopy(lock, "/pools");
      const text = `${copy.title} ${copy.detail} ${"label" in copy.fix ? copy.fix.label : ""}`;
      expect(text, lock.kind).not.toMatch(/\b(runs?|pools?|dares?)\b/i);
    }
    expect(lockCopy({ kind: "not-human" }, "/pools").detail).toContain("covers every challenge");
    expect(lockCopy({ kind: "sensor-unchecked" }, "/pools").detail).toContain(
      "unlocks every challenge at once",
    );
    expect(
      lockCopy({ kind: "cannot-measure", metric: "steps", deviceLabel: "WHOOP" }, "/pools").detail,
    ).toMatch(/^This challenge is scored on step count/);
  });
});

describe("buildLobby", () => {
  const NOW = 1_000_000n;
  function pool(id: number, overrides: Partial<PoolInfo> = {}): PoolInfo {
    return {
      id: BigInt(id),
      creator: "0x0000000000000000000000000000000000000001",
      bountyModel: 2,
      settled: false,
      cancelled: false,
      periodStart: NOW - 100n,
      periodEnd: NOW + 86_400n * BigInt(id),
      entryFee: 5_000_000n,
      balance: 50_000_000n,
      initiative: "sleep",
      goalSpec: "Walk 8000 steps a day for 5 days",
      ...overrides,
    };
  }
  function lobbyInput(overrides: Partial<LobbyInput> = {}): LobbyInput {
    return {
      pools: [],
      asOfSeconds: NOW,
      verifier: "available",
      payouts: "ready",
      moneyIn: "open",
      gate: "passed",
      joined: new Set(),
      highlightId: null,
      address: "0xabc",
      providerDown: null,
      viewerMetrics: ["steps", "sleep_score"],
      capabilityPending: false,
      needsDevice: false,
      capabilityHold: null,
      uploadAvailable: true,
      worldLane: "off",
      humanVerified: false,
      deviceLabel: "Junction",
      ...overrides,
    };
  }

  it("hides runs that can never pay and private dares", () => {
    const lobby = buildLobby(
      lobbyInput({
        pools: [pool(1, { entryFee: 0n }), pool(2, { initiative: "challenge" }), pool(3)],
      }),
    );
    expect(lobby.open.map((r) => r.pool.id)).toEqual([3n]);
  });

  it("shows the challenge link's own dare, highlighted, and only that one", () => {
    const lobby = buildLobby(
      lobbyInput({
        pools: [pool(2, { initiative: "challenge" }), pool(4, { initiative: "challenge" })],
        highlightId: "2",
      }),
    );
    expect(lobby.highlighted?.pool.id).toBe(2n);
    expect(lobby.open).toHaveLength(0);
  });

  it("splits runs I am in, open runs and closed runs", () => {
    const lobby = buildLobby(
      lobbyInput({
        pools: [pool(1), pool(2), pool(3, { periodEnd: NOW - 1n })],
        joined: new Set(["2"]),
      }),
    );
    expect(lobby.mine.map((r) => r.pool.id)).toEqual([2n]);
    expect(lobby.open.map((r) => r.pool.id)).toEqual([1n]);
    expect(lobby.closed.map((r) => r.pool.id)).toEqual([3n]);
  });

  it("locks a steps run for a WHOOP wallet and puts playable runs first", () => {
    const lobby = buildLobby(
      lobbyInput({
        pools: [pool(1), pool(2, { goalSpec: "Sleep score 80 for 5 nights" })],
        viewerMetrics: ["sleep_score"],
        deviceLabel: "WHOOP",
      }),
    );
    expect(lobby.open.map((r) => r.slot.kind)).toEqual(["playable", "locked"]);
    expect(lobby.open[1].slot).toEqual({
      kind: "locked",
      lock: { kind: "cannot-measure", metric: "steps", deviceLabel: "WHOOP" },
    });
  });

  it("offers one sensor check when the capability is not read this visit", () => {
    const lobby = buildLobby(
      lobbyInput({ pools: [pool(1)], viewerMetrics: null, capabilityPending: true }),
    );
    expect(lobbyNeedsSensorCheck(lobby)).toBe(true);
    expect(
      lobbyNeedsSensorCheck(buildLobby(lobbyInput({ pools: [pool(1)] }))),
    ).toBe(false);
  });

  it("keeps the dare link's upload run visible and locked while the checker is off", () => {
    const lobby = buildLobby(
      lobbyInput({
        pools: [
          pool(2, { initiative: "challenge", goalSpec: "[proof=doc] Annual flu shot" }),
          pool(3, { goalSpec: "[proof=doc] Dentist visit" }),
          pool(4, { goalSpec: "walk 8000 steps a day for 7 days [proof=wearable]" }),
        ],
        highlightId: "2",
        verifier: "off",
      }),
    );
    expect(lobby.highlighted?.pool.id).toBe(2n);
    expect(lobby.highlighted?.slot).toEqual({
      kind: "locked",
      lock: { kind: "verifier-off" },
    });
    // Other upload runs still hide from the board; wearable runs stay.
    expect(lobby.open.map((r) => r.pool.id)).toEqual([4n]);
  });

  it("keeps the dare link's run visible when it cannot pay, so its own copy shows", () => {
    const lobby = buildLobby(
      lobbyInput({
        pools: [pool(2, { initiative: "challenge", entryFee: 0n })],
        highlightId: "2",
      }),
    );
    expect(lobby.highlighted?.slot).toEqual({ kind: "cannot-pay" });
  });

  it("locks the dare for an unapproved wallet and holds it while checks load", () => {
    const dare = pool(2, { initiative: "challenge" });
    expect(
      buildLobby(lobbyInput({ pools: [dare], highlightId: "2", gate: "not-approved" }))
        .highlighted?.slot,
    ).toEqual({ kind: "locked", lock: { kind: "not-approved", pending: false } });
    expect(
      buildLobby(lobbyInput({ pools: [dare], highlightId: "2", worldLane: "error" }))
        .highlighted?.slot,
    ).toEqual({ kind: "locked", lock: { kind: "check-failed", check: "human" } });
    const checking = buildLobby(lobbyInput({ pools: [pool(3)], payouts: "loading" }));
    expect(checking.open.map((r) => r.slot.kind)).toEqual(["checking"]);
  });

  it("pauses every open run when payouts cannot be confirmed", () => {
    const lobby = buildLobby(
      lobbyInput({ pools: [pool(1), pool(2)], payouts: "misconfigured" }),
    );
    expect(lobby.open.map((r) => r.slot)).toEqual([
      { kind: "locked", lock: { kind: "payouts-paused" } },
      { kind: "locked", lock: { kind: "payouts-paused" } },
    ]);
  });

  it("pauses every open challenge while new money is paused, and not the ones I am in", () => {
    const lobby = buildLobby(
      lobbyInput({ pools: [pool(1), pool(2), pool(3)], joined: new Set(["3"]), moneyIn: "paused", moneyInReason: "Back Friday." }),
    );
    expect(lobby.open.map((r) => r.slot)).toEqual([
      { kind: "locked", lock: { kind: "money-in-paused", reason: "Back Friday." } },
      { kind: "locked", lock: { kind: "money-in-paused", reason: "Back Friday." } },
    ]);
    expect(lobby.mine.map((r) => r.slot)).toEqual([{ kind: "in-run" }]);
  });

  it("lets the creator lock in to their own challenge with money in, even while paused", () => {
    const own = pool(2, { initiative: "challenge", creator: "0x00000000000000000000000000000000000000Ab", balance: 2_000_000n });
    const lobby = buildLobby(
      lobbyInput({ pools: [own], highlightId: "2", address: "0x00000000000000000000000000000000000000ab", moneyIn: "paused" }),
    );
    expect(lobby.highlighted?.slot).toEqual({ kind: "playable" });
    // Anyone else on the same link sees the pause.
    const friend = buildLobby(lobbyInput({ pools: [own], highlightId: "2", moneyIn: "paused" }));
    expect(friend.highlighted?.slot).toEqual({ kind: "locked", lock: { kind: "money-in-paused", reason: null } });
  });

  describe("wearable holds and the upload fallback", () => {
    const hybrid = "[proof=wearable+self] walk 8000 steps a day for 7 days";

    it("opens a hybrid steps run by upload for a WHOOP wallet while uploads are on", () => {
      const lobby = buildLobby(
        lobbyInput({
          pools: [pool(1, { goalSpec: hybrid })],
          viewerMetrics: ["sleep_score"],
          deviceLabel: "WHOOP",
        }),
      );
      expect(lobby.open[0].slot).toEqual({ kind: "playable", proof: "upload" });
    });

    it("keeps the hybrid run locked when the upload path is off", () => {
      const lobby = buildLobby(
        lobbyInput({
          pools: [pool(1, { goalSpec: hybrid })],
          viewerMetrics: ["sleep_score"],
          deviceLabel: "WHOOP",
          uploadAvailable: false,
        }),
      );
      expect(lobby.open[0].slot).toEqual({
        kind: "locked",
        lock: { kind: "cannot-measure", metric: "steps", deviceLabel: "WHOOP" },
      });
    });

    it("shows an awaiting-sync lock on wearable runs, not the one-tap check", () => {
      const lobby = buildLobby(
        lobbyInput({
          pools: [pool(1)],
          viewerMetrics: null,
          capabilityHold: "awaiting-sync",
        }),
      );
      expect(lobby.open[0].slot).toEqual({
        kind: "locked",
        lock: { kind: "sensor-hold", hold: "awaiting-sync", deviceLabel: "Junction" },
      });
      expect(lobbyNeedsSensorCheck(lobby)).toBe(false);
    });

    it("shows an unreadable lock on wearable runs", () => {
      const lobby = buildLobby(
        lobbyInput({ pools: [pool(1)], viewerMetrics: null, capabilityHold: "unreadable" }),
      );
      expect(lobby.open[0].slot).toEqual({
        kind: "locked",
        lock: { kind: "sensor-hold", hold: "unreadable", deviceLabel: "Junction" },
      });
    });
  });

  it("locks every wearable run for a player with no sensor", () => {
    const lobby = buildLobby(
      lobbyInput({ pools: [pool(1), pool(2)], viewerMetrics: null, needsDevice: true }),
    );
    expect(lobby.open.every((r) => r.slot.kind === "locked")).toBe(true);
  });
});

describe("slotRank", () => {
  it("orders what the player can act on first", () => {
    const ranks = [
      slotRank({ kind: "in-run" }),
      slotRank({ kind: "playable" }),
      slotRank({ kind: "locked", lock: { kind: "no-sensor" } }),
      slotRank({ kind: "checking" }),
      slotRank({ kind: "closed", joined: true }),
      slotRank({ kind: "closed", joined: false }),
    ];
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });
});
