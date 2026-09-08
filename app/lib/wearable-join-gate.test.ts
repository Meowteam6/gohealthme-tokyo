import { describe, it, expect } from "vitest";
import { wearableJoinBlock, joinIsBlocked } from "@/lib/wearable-join-gate";

// The join decision, in one place because two surfaces make it. The pool page
// had a careful version of this and the challenge link had none at all, so a
// share link - probably the commonest way anyone reaches a pool here - bypassed
// every limit before the stake.

const STEPS = "walk 8000 steps a day for 7 days";
const DOC = "[doc] annual physical";
const WALLET = "0x1111111111111111111111111111111111111111";

const base = {
  goalSpec: STEPS,
  address: WALLET,
  joined: false,
  providerDown: null,
  viewerMetrics: ["steps"] as const,
  capabilityPending: false,
  needsDevice: false,
};

describe("wearableJoinBlock", () => {
  it("allows a device that measures the goal", () => {
    expect(wearableJoinBlock({ ...base })).toEqual({ kind: "ok" });
  });

  it("blocks a metric the device cannot produce, and names it", () => {
    const block = wearableJoinBlock({
      ...base,
      viewerMetrics: ["sleep_score", "sleep_hours"],
    });
    expect(block).toEqual({ kind: "unsupported", metric: "steps" });
    expect(joinIsBlocked(block)).toBe(true);
  });

  it("blocks a connected wallet whose capability has not been read", () => {
    // The cold-load case. Every hard page load starts here.
    expect(
      wearableJoinBlock({
        ...base,
        viewerMetrics: null,
        capabilityPending: true,
      }).kind,
    ).toBe("unchecked");
  });

  it("blocks a wallet with nothing linked, and says so distinctly", () => {
    // Signing cannot answer this question; connecting a device can.
    expect(
      wearableJoinBlock({ ...base, viewerMetrics: null, needsDevice: true })
        .kind,
    ).toBe("no-device");
  });

  it("withholds when capability is unknown for no stated reason", () => {
    // The branch that used to read "unknown" as "fine".
    expect(
      wearableJoinBlock({
        ...base,
        viewerMetrics: null,
        capabilityPending: false,
        needsDevice: false,
      }).kind,
    ).toBe("unchecked");
  });

  it("puts an outage ahead of a hardware limit", () => {
    // Nothing wearable can be verified during an outage regardless of the
    // device, and "come back shortly" is more useful than "your device cannot
    // do this" when the device is fine.
    const block = wearableJoinBlock({
      ...base,
      viewerMetrics: ["sleep_score"],
      providerDown: "The provider is refusing us.",
    });
    expect(block.kind).toBe("outage");
  });

  it("never blocks a document goal on a device", () => {
    expect(
      wearableJoinBlock({ ...base, goalSpec: DOC, viewerMetrics: null }),
    ).toEqual({ kind: "ok" });
  });

  it("never blocks somebody who already joined", () => {
    // The fee is spent. Withholding now protects nothing and would hide a
    // claim they are entitled to make.
    expect(
      wearableJoinBlock({
        ...base,
        joined: true,
        viewerMetrics: ["sleep_score"],
      }),
    ).toEqual({ kind: "ok" });
  });

  it("never blocks a visitor with no wallet", () => {
    // Browsing is not staking, and hiding the board from a visitor is its own
    // dead end.
    expect(
      wearableJoinBlock({ ...base, address: null, viewerMetrics: null }),
    ).toEqual({ kind: "ok" });
  });

  it("leaves an unclassifiable goal alone rather than guessing", () => {
    // It fails closed later, at the claim, where the verdict can say why.
    expect(
      wearableJoinBlock({ ...base, goalSpec: "be healthier" }),
    ).toEqual({ kind: "ok" });
  });

  it("blocks a signed wallet with nothing linked - the no-provider row", () => {
    // Five cells the sweep could not verify before its budget ran out. The
    // mechanism is the same predicate disagreement confirmed elsewhere:
    // viewerMetricsOf returns null for a wallet whose provider is selected but
    // never connected, and that must not read as "measures everything".
    const block = wearableJoinBlock({
      ...base,
      viewerMetrics: null,
      needsDevice: true,
      capabilityPending: true,
    });
    expect(block.kind).toBe("no-device");
    expect(joinIsBlocked(block)).toBe(true);
  });

  it("cannot be talked into ok by an unknown provider health alone", () => {
    // providerDown is null both when the provider is FINE and when we have not
    // been able to ask. Null must therefore never be sufficient on its own:
    // the capability checks below it are what actually withhold the join, and
    // this pins that ordering so a refactor cannot make null mean healthy.
    const block = wearableJoinBlock({
      ...base,
      providerDown: null,
      viewerMetrics: null,
      capabilityPending: true,
      needsDevice: false,
    });
    expect(block.kind).toBe("unchecked");
    expect(joinIsBlocked(block)).toBe(true);
  });
});