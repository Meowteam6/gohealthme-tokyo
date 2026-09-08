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
});
