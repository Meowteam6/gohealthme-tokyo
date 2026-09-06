import { describe, it, expect } from "vitest";
import { hideDocumentPools, hideEmptyCancelledPools } from "@/lib/pool-visibility";

// A pool nobody can be verified on must not be offered as joinable. While the
// document verifier is off, document-floor pools are hidden from the list (the
// chain still has them; the sweep still refunds their joiners at period end).
describe("hideDocumentPools", () => {
  const pools = [
    { id: 12n, goalSpec: "Sleep at least 7 hours a night for 7 nights" },
    { id: 7n, goalSpec: "[doc] Get your annual flu shot and upload your record" },
    { id: 11n, goalSpec: "[proof=doc+self] 8k steps a day, 7 days straight" },
    { id: 5n, goalSpec: "[proof=wearable+doc] Walk 10k steps a day" },
  ];

  it("hides pure document pools when the verifier is unavailable", () => {
    const { visible, hidden } = hideDocumentPools(pools, false);
    expect(visible.map((p) => p.id)).toEqual([12n, 5n]);
    expect(hidden.map((p) => p.id)).toEqual([7n, 11n]);
  });

  it("hides nothing when the verifier is available", () => {
    const { visible, hidden } = hideDocumentPools(pools, true);
    expect(visible).toHaveLength(4);
    expect(hidden).toHaveLength(0);
  });
});

// A cancelled pool nobody staked into is nothing to anyone; listing it under
// "wrapped up" reads as a payout that never happened (pool 13, 2026-09-06). A
// cancelled pool that still holds stakes stays listed so its joiners can find
// their refund.
describe("hideEmptyCancelledPools", () => {
  it("drops cancelled pools with no balance and keeps everything else", () => {
    const pools = [
      { id: 13n, cancelled: true, balance: 0n },
      { id: 9n, cancelled: true, balance: 2_000_000n },
      { id: 12n, cancelled: false, balance: 0n },
    ];
    expect(hideEmptyCancelledPools(pools).map((p) => p.id)).toEqual([9n, 12n]);
  });
});
