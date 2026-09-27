import { describe, it, expect } from "vitest";
import { countsLine, countsLineFor } from "@/lib/game/sensor-copy";

describe("pairing card line", () => {
  it("lists only launch goals the provider counts", () => {
    expect(countsLine("whoop")).toBe("Counts sleep efficiency, hours of sleep and workouts.");
    expect(countsLine("junction")).toBe("Counts sleep efficiency, hours of sleep and workouts.");
    expect(countsLine("apple")).toBe("Counts sleep efficiency, hours of sleep and workouts.");
  });

  it("says what counts for a paired device, leaving out goals no run is scored on", () => {
    expect(
      countsLineFor(["sleep_score", "sleep_efficiency", "sleep_hours", "workouts"]),
    ).toBe("Counts sleep efficiency, hours of sleep and workouts.");
    expect(countsLineFor(["sleep_score"])).toBe("Counts none of the current challenges yet.");
  });
});
