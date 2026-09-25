import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accessGateDisabled,
  approvalModeOf,
  gateStateOf,
  payoutStateOf,
  verifierStateOf,
  type GateInputs,
} from "@/lib/game/join-checks";

// Every read the join depends on maps "not answered" to a hold and "failed"
// to a retry. None of them maps a failure to the permissive answer.

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
