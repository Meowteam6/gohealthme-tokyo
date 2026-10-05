import { describe, it, expect } from "vitest";
import {
  isAppleDeviceLabel,
  joinIsBlocked,
  sensorHoldCopy,
  uploadFallbackNote,
  wearableJoinBlock,
} from "@/lib/wearable-join-gate";

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

describe("linked-but-held devices", () => {
  it("holds a linked device that has not synced, and says why", () => {
    // The WHOOP-via-Junction trap: linked, nothing synced, and Junction's
    // declared union used to read as "measures steps". Now a hold.
    const block = wearableJoinBlock({
      ...base,
      viewerMetrics: null,
      capabilityPending: true,
      needsDevice: false,
      capabilityHold: "awaiting-sync",
    });
    expect(block).toEqual({ kind: "unchecked", hold: "awaiting-sync" });
    expect(joinIsBlocked(block)).toBe(true);
  });

  it("holds a linked device the provider will not describe, never 'pair a sensor'", () => {
    const block = wearableJoinBlock({
      ...base,
      viewerMetrics: null,
      capabilityPending: true,
      needsDevice: false,
      capabilityHold: "unreadable",
    });
    expect(block).toEqual({ kind: "unchecked", hold: "unreadable" });
  });

  it("still reports an outage ahead of a hold", () => {
    const block = wearableJoinBlock({
      ...base,
      providerDown: "Junction returned 503",
      viewerMetrics: null,
      capabilityHold: "unreadable",
    });
    expect(block.kind).toBe("outage");
  });

  it("locks the run for a caller that has not learned about holds", () => {
    // Fail-safe: holds ride on "unchecked", so a consumer that ignores `hold`
    // still withholds the join rather than treating an unknown kind as fine.
    const block = wearableJoinBlock({
      ...base,
      viewerMetrics: null,
      capabilityPending: true,
      needsDevice: false,
    });
    expect(block).toEqual({ kind: "unchecked" });
  });
});

describe("hybrid wearable-plus-upload pools", () => {
  const HYBRID = "[proof=wearable+self] walk 8000 steps a day for 7 days";
  const HYBRID_DOC = "[proof=wearable+doc] walk 8000 steps a day for 7 days";

  it("stays joinable with no device when the upload path is on", () => {
    const block = wearableJoinBlock({
      ...base,
      goalSpec: HYBRID,
      viewerMetrics: null,
      needsDevice: true,
      uploadAvailable: true,
    });
    expect(block).toEqual({ kind: "ok", proof: "upload" });
    expect(joinIsBlocked(block)).toBe(false);
  });

  it("stays joinable when the sensor cannot measure it, via the upload", () => {
    const block = wearableJoinBlock({
      ...base,
      goalSpec: HYBRID,
      viewerMetrics: ["sleep_score", "workouts"],
      uploadAvailable: true,
    });
    expect(block).toEqual({ kind: "ok", proof: "upload" });
  });

  it("is a plain ok when the sensor measures it", () => {
    const block = wearableJoinBlock({
      ...base,
      goalSpec: HYBRID,
      uploadAvailable: true,
    });
    expect(block).toEqual({ kind: "ok" });
  });

  it("stays locked when the upload path is paused, because nothing could prove it", () => {
    const block = wearableJoinBlock({
      ...base,
      goalSpec: HYBRID,
      viewerMetrics: null,
      needsDevice: true,
      uploadAvailable: false,
    });
    expect(block.kind).toBe("no-device");
  });

  it("treats a caller that does not say as upload-off", () => {
    const block = wearableJoinBlock({
      ...base,
      goalSpec: HYBRID,
      viewerMetrics: null,
      needsDevice: true,
    });
    expect(block.kind).toBe("no-device");
  });

  it("never lets a pure wearable pool through on the upload flag", () => {
    const block = wearableJoinBlock({
      ...base,
      viewerMetrics: null,
      needsDevice: true,
      uploadAvailable: true,
    });
    expect(block.kind).toBe("no-device");
  });

  it("words the fallback for the upload the pool actually takes", () => {
    expect(uploadFallbackNote(HYBRID)).toMatch(/photo/);
    expect(uploadFallbackNote(HYBRID_DOC)).toMatch(/document/);
  });
});

describe("sensorHoldCopy", () => {
  it.each(["awaiting-sync", "unreadable"] as const)(
    "gives %s a wait-tone lock with a re-check, in plain words",
    (hold) => {
      const copy = sensorHoldCopy(hold, "Junction");
      expect(copy.tone).toBe("wait");
      expect(copy.fix).toEqual({ kind: "check-sensor", label: "Check my wearable" });
      expect(copy.detail).toContain("Junction");
      // No plumbing reaches a player.
      expect(`${copy.title} ${copy.detail}`).not.toMatch(
        /env|api|undefined|null|capability|[A-Z_]{6,}/,
      );
      // A linked device is never told to re-pair.
      expect(copy.detail).not.toMatch(/pair/i);
    },
  );

  it("sends an Apple wallet to the GoHealthMe app, never to Apple Health", () => {
    // Opening Apple's own Health app syncs nothing to SPOTTER; the GoHealthMe
    // app on the iPhone is what posts the day. Whichever label the server uses.
    for (const label of ["Apple Health", "Apple Watch"]) {
      const copy = sensorHoldCopy("awaiting-sync", label);
      expect(copy.detail).toMatch(/^Open the GoHealthMe app on your iPhone/);
      expect(copy.detail).toMatch(/background sync/);
      expect(copy.detail).not.toMatch(/Open the Apple/);
    }
    expect(isAppleDeviceLabel("Apple Health")).toBe(true);
    expect(isAppleDeviceLabel("apple watch")).toBe(true);
    expect(isAppleDeviceLabel("WHOOP")).toBe(false);
    expect(isAppleDeviceLabel("Pineapple")).toBe(false);
    expect(isAppleDeviceLabel(null)).toBe(false);
  });

  it("falls back to 'your wearable' with no label", () => {
    expect(sensorHoldCopy("awaiting-sync", null).detail).toMatch(
      /^Open your wearable's app/,
    );
  });
});