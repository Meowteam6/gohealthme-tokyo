import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";

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
// Salted per RUN, not just per test. The file-backed store under DATA_DIR
// survives between vitest runs, so a counter that restarts at zero hands the
// next run addresses the previous one already wrote token records for - and a
// "never linked" assertion then reads the last run's data and fails.
const RUN_SALT = randomUUID().replace(/-/g, "").slice(0, 12);
let counter = 0;
function nextAddress(): string {
  counter += 1;
  return `0x${RUN_SALT}${counter.toString(16).padStart(28, "0")}`;
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
    expect(observed.kind).toBe("observed");
    const metrics = observed.kind === "observed" ? observed.metrics : [];
    expect(metrics).toContain("steps");
    expect(metrics).toContain("sleep_efficiency");
    expect(metrics).not.toContain("sleep_score");
  });

  it("answers 'declared', not an empty list, when nothing has been observed", async () => {
    // A wallet that linked ten minutes ago has produced nothing. An empty
    // array would mean "measures none of these" and hide every wearable pool
    // on their board; declared is the permissive fallback.
    onlyPresent([]);

    expect((await junctionProvider.observedMetrics(nextAddress())).kind).toBe(
      "declared",
    );
  });

  it("answers 'unknown' when NO probe could answer, and does not cache it", async () => {
    // Distinct from "observed nothing". Falling back to declared here offers
    // the full seven-metric union on no evidence at all, which is what the
    // probe exists to prevent - and caching it would make a Junction outage
    // outlive itself by thirty minutes.
    const address = nextAddress();
    getMetricProgress.mockRejectedValue(new Error("Junction returned 503"));

    expect((await junctionProvider.observedMetrics(address)).kind).toBe(
      "unknown",
    );

    // The recovery must be visible immediately, not after the TTL.
    onlyPresent(["steps"]);
    const recovered = await junctionProvider.observedMetrics(address);
    expect(recovered.kind).toBe("observed");
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

    // One probe threw and the others answered, so this is real evidence.
    expect(observed).toEqual({ kind: "observed", metrics: ["sleep_hours"] });
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
