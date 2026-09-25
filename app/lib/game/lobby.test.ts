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
    humanRequired: false,
    humanVerified: false,
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
      runSlotOf(input({ joined: true, joinBlock: { kind: "no-device" }, humanRequired: true })),
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
          humanRequired: true,
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
    expect(runSlotOf(input({ humanRequired: true }))).toEqual({
      kind: "locked",
      lock: { kind: "not-human" },
    });
    expect(runSlotOf(input({ humanRequired: true, humanVerified: true }))).toEqual({
      kind: "playable",
    });
    expect(runSlotOf(input({ humanRequired: false }))).toEqual({ kind: "playable" });
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
      documentAvailable: true,
      joined: new Set(),
      highlightId: null,
      address: "0xabc",
      providerDown: null,
      viewerMetrics: ["steps", "sleep_score"],
      capabilityPending: false,
      needsDevice: false,
      humanRequired: false,
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
      slotRank({ kind: "closed", joined: true }),
      slotRank({ kind: "closed", joined: false }),
    ];
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });
});
