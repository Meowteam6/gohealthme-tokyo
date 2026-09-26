import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";

// The capability probe. It exists because Junction's declared metric list is
// the UNION of what several brands can do: it offers a proprietary sleep score
// to a wallet whose tracker has none, and a steps run to a WHOOP strap with no
// pedometer. Narrowing to what the device has actually produced is what moves
// that discovery from after the money to before it.

const getMetricProgress = vi.fn();
const getMissEvidence = vi.fn();

vi.mock("@/lib/server/junction", () => ({
  createLinkToken: vi.fn(),
  getProgress: vi.fn(),
  getRecent: vi.fn(),
  isConnected: vi.fn(),
  getMetricProgress: (...args: unknown[]) => getMetricProgress(...args),
  getMissEvidence: (...args: unknown[]) => getMissEvidence(...args),
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

/**
 * Answer as though only `present` produced a non-zero value. The probe asks
 * with the smallest positive threshold, so qualifyingDays is the count of days
 * the number was above zero.
 */
function onlyPresent(present: string[]): void {
  getMetricProgress.mockImplementation((_addr: string, metric: string) =>
    Promise.resolve({
      qualifyingDays: present.includes(metric) ? 5 : 0,
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

  it("answers 'awaiting-sync', never the declared union, when nothing has synced", async () => {
    // The WHOOP-via-Junction trap. Right after linking, nothing has arrived.
    // "declared" handed this wallet Junction's seven-metric union, so a WHOOP
    // strap was offered steps runs, the player staked, and the claim failed
    // closed days later. An empty list would blank their whole board instead.
    // Neither is true: the join waits for the first sync.
    onlyPresent([]);

    expect(await junctionProvider.observedMetrics(nextAddress())).toEqual({
      kind: "awaiting-sync",
    });
  });

  it("re-probes an awaiting wallet after the short cache, so a sync unlocks it", async () => {
    vi.useFakeTimers();
    try {
      const address = nextAddress();
      onlyPresent([]);
      expect((await junctionProvider.observedMetrics(address)).kind).toBe(
        "awaiting-sync",
      );

      // The strap syncs. Unlocks within minutes, not the thirty-minute TTL.
      onlyPresent(["sleep_score", "sleep_hours"]);
      vi.advanceTimersByTime(4 * 60_000);
      const synced = await junctionProvider.observedMetrics(address);
      expect(synced.kind).toBe("observed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not re-probe an awaiting wallet on every page load", async () => {
    onlyPresent([]);
    const address = nextAddress();

    await junctionProvider.observedMetrics(address);
    const callsAfterFirst = getMetricProgress.mock.calls.length;
    await junctionProvider.observedMetrics(address);

    expect(getMetricProgress.mock.calls.length).toBe(callsAfterFirst);
  });

  it("treats a day of zero steps as absent, so a WHOOP strap is not a pedometer", async () => {
    // Junction may answer a WHOOP activity day with steps: 0 instead of null.
    // Counting that as "has steps" would put the strap back on a steps run.
    // The probe only counts a day above zero.
    getMetricProgress.mockImplementation((_addr: string, metric: string) =>
      Promise.resolve({
        qualifyingDays: metric === "sleep_score" ? 4 : 0,
        // Steps "has data" every day - all zeros.
        daysWithData: metric === "steps" || metric === "sleep_score" ? 4 : 0,
        daysWithSource: 4,
      }),
    );

    const observed = await junctionProvider.observedMetrics(nextAddress());

    expect(observed.kind).toBe("observed");
    const metrics = observed.kind === "observed" ? observed.metrics : [];
    expect(metrics).toContain("sleep_score");
    expect(metrics).not.toContain("steps");
  });

  it("counts workouts as measurable for any syncing device", async () => {
    // A day with no workout is a real zero to the verdict. A device syncing
    // sleep can be judged on workouts even if it logged none this fortnight;
    // refusing that tells somebody who rested that their strap cannot count.
    onlyPresent(["sleep_score"]);

    const observed = await junctionProvider.observedMetrics(nextAddress());

    expect(observed).toEqual({
      kind: "observed",
      metrics: ["sleep_score", "workouts"],
    });
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
      const present = metric === "sleep_hours" ? 3 : 0;
      return Promise.resolve({
        qualifyingDays: present,
        daysWithData: present,
        daysWithSource: 3,
      });
    });

    const observed = await junctionProvider.observedMetrics(nextAddress());

    // One probe threw and the others answered, so this is real evidence.
    expect(observed).toEqual({
      kind: "observed",
      metrics: ["sleep_hours", "workouts"],
    });
  });

  it("caches per wallet so a browse surface does not re-probe", async () => {
    onlyPresent(["steps"]);
    const address = nextAddress();

    await junctionProvider.observedMetrics(address);
    const callsAfterFirst = getMetricProgress.mock.calls.length;
    await junctionProvider.observedMetrics(address);

    expect(getMetricProgress.mock.calls.length).toBe(callsAfterFirst);
  });

  it("asks whether the number EXISTS above zero, not whether it was good", async () => {
    onlyPresent(["steps"]);

    await junctionProvider.observedMetrics(nextAddress());

    // The smallest positive threshold: a device that reports 400 steps a day
    // still proves it can count steps, and a zero proves nothing.
    for (const call of getMetricProgress.mock.calls) {
      expect(call[2]).toBe(Number.MIN_VALUE);
    }
  });
});

describe("junctionProvider.getMissEvidence", () => {
  it("serves the miss rule's local-calendar read from the Junction module", async () => {
    const evidence = { values: { "2026-09-27": 6 }, heartbeatDays: ["2026-09-27"], tzOffsetSec: 32400 };
    getMissEvidence.mockResolvedValue(evidence);
    const address = nextAddress();

    await expect(
      junctionProvider.getMissEvidence!(address, "sleep_hours", "2026-09-24"),
    ).resolves.toEqual(evidence);
    expect(getMissEvidence).toHaveBeenCalledWith(address, "sleep_hours", "2026-09-24");
  });
});
