import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The capability probe. It exists because Junction's declared metric list is
// the UNION of what several brands can do: it offers a proprietary sleep score
// to a wallet whose tracker has none, and that wallet would be invited to stake
// on a pool it can never satisfy. Narrowing to what the device has actually
// produced is what moves that discovery from after the money to before it.

const getMetricProgress = vi.fn();

vi.mock("@/lib/server/junction", () => ({
  createLinkToken: vi.fn(),
  getProgress: vi.fn(),
  getRecent: vi.fn(),
  isConnected: vi.fn(),
  getMetricProgress: (...args: unknown[]) => getMetricProgress(...args),
}));

const { junctionProvider } = await import(
  "@/lib/server/wearable/junction-provider"
);

// The probe caches per wallet, so every test needs its own address or it reads
// the previous test's answer.
let counter = 0;
function nextAddress(): string {
  counter += 1;
  return `0x${(0xc0000 + counter).toString(16).padStart(40, "0")}`;
}

/** Answer as though only `present` produced any data. */
function onlyPresent(present: string[]): void {
  getMetricProgress.mockImplementation((_addr: string, metric: string) =>
    Promise.resolve({
      qualifyingDays: 0,
      daysWithData: present.includes(metric) ? 5 : 0,
      daysWithSource: 5,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("junctionProvider.observedMetrics", () => {
  it("narrows to what the device actually produced", async () => {
    onlyPresent(["sleep_efficiency", "sleep_hours", "steps"]);

    const observed = await junctionProvider.observedMetrics(nextAddress());

    // sleep_score is declared by Junction and absent from this tracker, which
    // is the case the whole probe exists for.
    expect(observed).not.toBeNull();
    expect(observed).toContain("steps");
    expect(observed).toContain("sleep_efficiency");
    expect(observed).not.toContain("sleep_score");
  });

  it("returns NULL, not an empty list, when nothing has been observed", async () => {
    // A wallet that linked ten minutes ago has produced nothing. An empty
    // array would mean "measures none of these" and hide every wearable pool
    // on their board; null falls back to the declared list.
    onlyPresent([]);

    expect(await junctionProvider.observedMetrics(nextAddress())).toBeNull();
  });

  it("never narrows on an upstream failure", async () => {
    getMetricProgress.mockRejectedValue(new Error("Junction returned 503"));

    // A Junction hiccup must not take pools off somebody's board.
    expect(await junctionProvider.observedMetrics(nextAddress())).toBeNull();
  });

  it("survives one metric failing while the others answer", async () => {
    getMetricProgress.mockImplementation((_addr: string, metric: string) => {
      if (metric === "steps") return Promise.reject(new Error("boom"));
      return Promise.resolve({
        qualifyingDays: 0,
        daysWithData: metric === "sleep_hours" ? 3 : 0,
        daysWithSource: 3,
      });
    });

    const observed = await junctionProvider.observedMetrics(nextAddress());

    expect(observed).toEqual(["sleep_hours"]);
  });

  it("caches per wallet so a browse surface does not re-probe", async () => {
    onlyPresent(["steps"]);
    const address = nextAddress();

    await junctionProvider.observedMetrics(address);
    const callsAfterFirst = getMetricProgress.mock.calls.length;
    await junctionProvider.observedMetrics(address);

    expect(getMetricProgress.mock.calls.length).toBe(callsAfterFirst);
  });

  it("asks whether the number EXISTS, not whether it was good", async () => {
    onlyPresent(["steps"]);

    await junctionProvider.observedMetrics(nextAddress());

    // An unreachable threshold: a device that reports 400 steps a day still
    // proves it can count steps.
    for (const call of getMetricProgress.mock.calls) {
      expect(call[2]).toBe(Number.POSITIVE_INFINITY);
    }
  });
});
