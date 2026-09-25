import { describe, expect, it } from "vitest";
import { lockCopy, runSlotOf, slotRank, type RunSlotInput } from "@/lib/game/lobby";

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
