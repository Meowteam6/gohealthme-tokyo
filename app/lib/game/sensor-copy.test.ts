import { describe, it, expect } from "vitest";
import { countsLine } from "@/lib/game/sensor-copy";

describe("pairing card line", () => {
  it("lists only launch goals the provider counts", () => {
    expect(countsLine("whoop")).toBe("Counts sleep efficiency, hours of sleep and workouts.");
    expect(countsLine("junction")).toBe("Counts sleep efficiency, hours of sleep and workouts.");
    expect(countsLine("apple")).toBe("Counts sleep efficiency, hours of sleep and workouts.");
  });
});
