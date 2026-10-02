import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accessGateDisabled,
  approvalModeOf,
  challengeCreateBlock,
  collectNeedsWorldOf,
  gateStateOf,
  payoutPathOf,
  payoutStateOf,
  verifierStateOf,
  type GateInputs,
} from "@/lib/game/join-checks";

// Every read the join depends on maps "not answered" to a hold and "failed"
// to a retry. None of them maps a failure to the permissive answer.

/** New money open: the switches answered and nothing is paused. */
const OPEN = { state: "open", reason: null } as const;

function gate(overrides: Partial<GateInputs> = {}): GateInputs {
  return {
    gateDisabled: false,
    gate: false,
    gateLoading: false,
    address: "0xabc",
    access: { status: "none", loading: false, error: false },
    ...overrides,
  };
}

describe("gateStateOf", () => {
  it("passes an approved, admin or World-verified wallet (gatePassed)", () => {
    expect(gateStateOf(gate({ gate: true }))).toBe("passed");
  });

  it("passes everyone only when the test-suite switch is on", () => {
    expect(gateStateOf(gate({ gateDisabled: true }))).toBe("passed");
  });

  it("refuses a wallet that never asked", () => {
    expect(gateStateOf(gate())).toBe("not-approved");
  });

  it("refuses a denied wallet the same way", () => {
    expect(gateStateOf(gate({ access: { status: "denied", loading: false, error: false } }))).toBe(
      "not-approved",
    );
  });

  it("tells a waitlisted wallet apart", () => {
    expect(
      gateStateOf(gate({ access: { status: "pending", loading: false, error: false } })),
    ).toBe("pending");
  });

  it("holds while the gate or the list is loading", () => {
    expect(gateStateOf(gate({ gateLoading: true }))).toBe("loading");
    expect(gateStateOf(gate({ access: { status: "none", loading: true, error: false } }))).toBe(
      "loading",
    );
  });

  it("reports a failed list read as an error, never as approved", () => {
    expect(gateStateOf(gate({ access: { status: "none", loading: false, error: true } }))).toBe(
      "error",
    );
  });
});

describe("accessGateDisabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off unless the suite switch is exactly 1", () => {
    vi.stubEnv("NEXT_PUBLIC_ACCESS_GATE_DISABLED", "");
    expect(accessGateDisabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_ACCESS_GATE_DISABLED", "true");
    expect(accessGateDisabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_ACCESS_GATE_DISABLED", "1");
    expect(accessGateDisabled()).toBe(true);
  });
});

describe("verifierStateOf", () => {
  it("maps the proof-status read to the four states", () => {
    expect(verifierStateOf({ available: true, isError: false })).toBe("available");
    expect(verifierStateOf({ available: false, isError: false })).toBe("off");
    expect(verifierStateOf({ available: undefined, isError: false })).toBe("loading");
    expect(verifierStateOf({ available: undefined, isError: true })).toBe("error");
  });

  it("keeps the last known answer through a failed refetch", () => {
    expect(verifierStateOf({ available: false, isError: true })).toBe("off");
  });
});

describe("challengeCreateBlock", () => {
  it("lets a dare be made only when the checker and the payout rule are known good", () => {
    expect(challengeCreateBlock("available", "ready", OPEN)).toEqual({ kind: "ok" });
  });

  it("pauses dares while the document checker is off, before any deposit", () => {
    const block = challengeCreateBlock("off", "ready", OPEN);
    expect(block.kind).toBe("paused");
    if (block.kind === "paused") {
      expect(block.detail).toMatch(/nothing has been charged/i);
      expect(block.detail).not.toMatch(/CONFIDENTIAL|DEMO_MODE|env/);
    }
  });

  it("pauses dares when payouts cannot be confirmed on this build", () => {
    expect(challengeCreateBlock("available", "misconfigured", OPEN).kind).toBe("paused");
  });

  it("says challenge, never run, reward or dare, in what the player reads", () => {
    for (const block of [challengeCreateBlock("off", "ready", OPEN), challengeCreateBlock("available", "misconfigured", OPEN)]) {
      if (block.kind !== "paused") throw new Error("expected paused");
      expect(`${block.title} ${block.detail}`).not.toMatch(/\b(run|runs|reward|dare|pool)\b/i);
      expect(block.detail).toMatch(/nothing has been charged/i);
    }
  });

  it("holds while loading and retries on a failed read, never ok", () => {
    expect(challengeCreateBlock("loading", "ready", OPEN)).toEqual({ kind: "checking" });
    expect(challengeCreateBlock("available", "loading", OPEN)).toEqual({ kind: "checking" });
    expect(challengeCreateBlock("error", "ready", OPEN).kind).toBe("retry");
    expect(challengeCreateBlock("available", "error", OPEN).kind).toBe("retry");
  });
});

// KILL_BASE_MONEY_IN (Andre, 2026-09-30): a new challenge is new money, so
// the create form stops before anything is filled in, and again on submit.
describe("challengeCreateBlock with new money paused", () => {
  it("pauses a new challenge, says money in still comes out, and nothing was charged", () => {
    const block = challengeCreateBlock("available", "ready", { state: "paused", reason: null });
    expect(block.kind).toBe("paused");
    if (block.kind !== "paused") return;
    expect(block.title).toBe("Challenges are paused for now");
    expect(block.detail).toContain("New stakes are paused for now");
    expect(block.detail).toContain("Money already in still pays out and refunds as normal.");
    expect(block.detail).toMatch(/nothing has been charged/i);
    expect(`${block.title} ${block.detail}`).not.toMatch(/\b(run|runs|reward|dare|pool)\b|[!\u2014]|KILL_/i);
  });

  it("adds the operator's reason at the end", () => {
    const block = challengeCreateBlock("available", "ready", { state: "paused", reason: "Back Friday." });
    expect(block.kind === "paused" && block.detail.endsWith("Back Friday.")).toBe(true);
  });

  it("holds while the switches load and retries when the read failed, never ok", () => {
    expect(challengeCreateBlock("available", "ready", { state: "loading", reason: null })).toEqual({ kind: "checking" });
    const failed = challengeCreateBlock("available", "ready", { state: "error", reason: null });
    expect(failed.kind).toBe("retry");
    if (failed.kind === "retry") expect(failed.title).toMatch(/stakes are open/);
  });

  it("keeps the older pauses first when they also hold", () => {
    const block = challengeCreateBlock("off", "ready", { state: "paused", reason: null });
    expect(block.kind === "paused" && block.detail).toMatch(/document checker/);
  });
});

// "Pay on the verdict" (Andre, 2026-10-02). A list player or an admin is paid
// on the verdict, so their own stake can always follow the extra they put in:
// the create form never stops them for World ID. Only build-wide limits stop
// a create.
describe("challengeCreateBlock for a list player or an admin", () => {
  it("lets every proven creator through when nothing build-wide holds", () => {
    expect(challengeCreateBlock("available", "ready", OPEN)).toEqual({ kind: "ok" });
  });

  it("keeps the build-wide pauses (regression)", () => {
    expect(challengeCreateBlock("available", "ready", { state: "paused", reason: null }).kind).toBe("paused");
    expect(challengeCreateBlock("available", "misconfigured", OPEN).kind).toBe("paused");
  });
});

describe("approvalModeOf and payoutStateOf", () => {
  it("reads a mode the route answered", () => {
    expect(approvalModeOf({ lane: "on", value: "world" })).toBe("world");
    expect(approvalModeOf({ lane: "on", value: "misconfigured" })).toBe("misconfigured");
  });

  it("treats a missing route as the step being off for this build", () => {
    expect(approvalModeOf({ lane: "off", value: null })).toBe("off");
  });

  it("treats a failed or unusable answer as an error, never off", () => {
    expect(approvalModeOf({ lane: "error", value: null })).toBe("error");
    expect(approvalModeOf({ lane: "on", value: null })).toBe("error");
  });

  it("holds while the probe is loading", () => {
    expect(approvalModeOf({ lane: "loading", value: null })).toBe("loading");
  });

  it("lets a win pay only when the mode is known and runnable", () => {
    expect(payoutStateOf("off")).toBe("ready");
    expect(payoutStateOf("mock")).toBe("ready");
    expect(payoutStateOf("world")).toBe("ready");
    expect(payoutStateOf("misconfigured")).toBe("misconfigured");
    expect(payoutStateOf("loading")).toBe("loading");
    expect(payoutStateOf("error")).toBe("error");
  });
});

describe("collectNeedsWorldOf (retired)", () => {
  it("is false for everyone: nobody needs World ID to collect a hit any more", () => {
    for (const humanProof of ["list", "admin", "world", null] as const) {
      for (const approvalMode of ["world", "mock", "off", "misconfigured", "loading", "error"] as const) {
        expect(
          collectNeedsWorldOf({ worldLane: "on", approvalMode, human: "verified", humanProof }),
        ).toBe(false);
      }
    }
  });
});

// The client mirror of the server's payoutConfirmFor (approval.ts): who
// confirms a payout with World ID, and who SPOTTER pays on the verdict.
describe("payoutPathOf", () => {
  it("asks a World-verified player to confirm wherever the confirmation is on", () => {
    for (const approvalMode of ["world", "mock", "misconfigured"] as const) {
      expect(payoutPathOf({ approvalMode, humanProof: "world" })).toBe("world");
    }
  });

  it("pays a list player or an admin on the verdict, whatever the build", () => {
    for (const approvalMode of ["world", "mock", "misconfigured", "off"] as const) {
      expect(payoutPathOf({ approvalMode, humanProof: "list" })).toBe("verdict");
      expect(payoutPathOf({ approvalMode, humanProof: "admin" })).toBe("verdict");
    }
  });

  it("pays everyone on the verdict while the confirmation is off", () => {
    expect(payoutPathOf({ approvalMode: "off", humanProof: "world" })).toBe("verdict");
    expect(payoutPathOf({ approvalMode: "off", humanProof: null })).toBe("verdict");
  });

  it("never guesses: unknown while the mode is being read, world for an unproven wallet", () => {
    expect(payoutPathOf({ approvalMode: "loading", humanProof: "list" })).toBeNull();
    expect(payoutPathOf({ approvalMode: "error", humanProof: "list" })).toBeNull();
    expect(payoutPathOf({ approvalMode: "world", humanProof: null })).toBe("world");
  });
});
