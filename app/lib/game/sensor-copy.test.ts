import { describe, it, expect } from "vitest";
import { countsLine, countsLineFor, pairedDeviceName, providerCardLabel } from "@/lib/game/sensor-copy";

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

describe("provider card label", () => {
  it("names Apple by the device a player pairs, not the data source the server reads", () => {
    expect(providerCardLabel("apple", "Apple Health")).toBe("Apple Watch");
    expect(providerCardLabel("whoop", "WHOOP")).toBe("WHOOP");
    expect(providerCardLabel("junction", "Junction")).toBe("Junction");
    expect(providerCardLabel("unknown", "Your wearable")).toBe("Your wearable");
  });

  it("calls a paired Apple device the Watch only once sleep has arrived from one", () => {
    // Steps alone come from the iPhone in a pocket. Saying "Apple Watch is
    // paired" to that wallet contradicts the lobby lock that says the iPhone
    // has no sleep data.
    expect(pairedDeviceName("apple", "Apple Health", ["sleep_hours", "workouts"])).toBe("Apple Watch");
    expect(pairedDeviceName("apple", "Apple Health", ["sleep_efficiency"])).toBe("Apple Watch");
    expect(pairedDeviceName("apple", "Apple Health", ["steps"])).toBe("Your iPhone");
    expect(pairedDeviceName("apple", "Apple Health", [])).toBe("Your iPhone");
    expect(pairedDeviceName("whoop", "WHOOP", ["sleep_hours"])).toBe("WHOOP");
    expect(pairedDeviceName("junction", "Junction", [])).toBe("Junction");
  });
});
