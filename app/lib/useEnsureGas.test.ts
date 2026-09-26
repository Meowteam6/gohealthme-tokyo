import { describe, it, expect } from "vitest";
import { withDripLine } from "@/lib/useEnsureGas";
import { GAS_DRIP_STATUS_LINE } from "@/lib/ensure-gas";
import type { GaslessStatus } from "@/lib/useGasSponsorship";

const EOA: GaslessStatus = {
  paymasterConfigured: true,
  smartWalletDetected: false,
  willSponsor: false,
  reason: "plain EOA",
};

describe("withDripLine", () => {
  it("carries the drip line to the badge while a drip runs", () => {
    expect(withDripLine(EOA, GAS_DRIP_STATUS_LINE).dripLine).toBe(GAS_DRIP_STATUS_LINE);
  });

  it("hands back the same status object when idle", () => {
    expect(withDripLine(EOA, null)).toBe(EOA);
  });
});
