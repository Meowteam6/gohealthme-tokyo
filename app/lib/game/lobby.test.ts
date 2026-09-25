import { describe, expect, it } from "vitest";
import {
  buildLobby,
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
    { kind: "not-approved", pending: false },
    { kind: "not-approved", pending: true },
    { kind: "verifier-off" },
    { kind: "payouts-paused" },
    { kind: "check-failed", check: "human" },
    { kind: "check-failed", check: "access" },
    { kind: "check-failed", check: "payouts" },
    { kind: "check-failed", check: "verifier" },
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

  it("says a WHOOP cannot count steps and sends the player to change sensor", () => {
    const copy = lockCopy(
      { kind: "cannot-measure", metric: "steps", deviceLabel: "WHOOP" },
      "/pools/7",
    );
    expect(copy.title).toBe("WHOOP cannot measure this one");
    expect(copy.detail).toContain("step count");
    expect(copy.tone).toBe("hardware");
    expect(copy.fix).toEqual({
      kind: "link",
      label: "Change my sensor",
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

  it("checks the sensor in place instead of sending the player away", () => {
    expect(lockCopy({ kind: "sensor-unchecked" }, "/pools").fix.kind).toBe("check-sensor");
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
      gate: "passed",
      joined: new Set(),
      highlightId: null,
      address: "0xabc",
      providerDown: null,
      viewerMetrics: ["steps", "sleep_score"],
      capabilityPending: false,
      needsDevice: false,
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
