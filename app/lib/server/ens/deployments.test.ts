// Regression: the ProxyDeployed ABI once marked sender and proxyAddress as
// non-indexed, so the real Sepolia log decoded to nothing and the bootstrap
// reported "no ProxyDeployed event" after a successful deploy. This is the
// exact log from tx 0xfb70e369...2d88 on Sepolia (2026-09-26).

import { describe, it, expect } from "vitest";
import { parseEventLogs, type Hex } from "viem";
import { ENS_SEPOLIA, VERIFIABLE_FACTORY_ABI } from "@/lib/server/ens/deployments";

const REAL_LOG = {
  address: ENS_SEPOLIA.verifiableFactory,
  topics: [
    "0x0a2c575ff341b41da136c9ccae74ec230a927a024d18f0dccf46d123f28f5f54",
    "0x000000000000000000000000c278e8e4621a0ba02bacb6291e595ecd168a04e1",
    "0x000000000000000000000000d6cd9911a15c43a9afd5ad4e68b92daabb08a299",
  ] as [Hex, ...Hex[]],
  data: "0xb29afc80361cb70448adb6595c1d5b0ebd188ad51e75e29829d01ca217fee8df000000000000000000000000a80338aaa8d23831cea25e858d1774534abb0263" as Hex,
  blockHash: null,
  blockNumber: null,
  logIndex: null,
  transactionHash: null,
  transactionIndex: null,
  removed: false,
};

describe("VERIFIABLE_FACTORY_ABI", () => {
  it("decodes the live ProxyDeployed log (sender and proxy are indexed)", () => {
    const [ev] = parseEventLogs({
      abi: VERIFIABLE_FACTORY_ABI,
      logs: [REAL_LOG],
      eventName: "ProxyDeployed",
    });
    expect(ev).toBeDefined();
    expect(ev.args.sender.toLowerCase()).toBe("0xc278e8e4621a0ba02bacb6291e595ecd168a04e1");
    expect(ev.args.proxyAddress.toLowerCase()).toBe("0xd6cd9911a15c43a9afd5ad4e68b92daabb08a299");
    expect(ev.args.implementation.toLowerCase()).toBe(ENS_SEPOLIA.userRegistryImpl);
  });
});
