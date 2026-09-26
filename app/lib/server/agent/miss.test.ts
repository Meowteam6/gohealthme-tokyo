import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import {
  evaluateMiss,
  judgeMissEvidence,
  localWindowDays,
  missEvidenceFromISO,
  missPreconditions,
  missRulePool,
  missSettleWindow,
  MISS_PHASE_MAX_S,
  type MissPool,
  type MissReadDeps,
} from "@/lib/server/agent/miss";
import type { LedgerEntry } from "@/lib/server/agent/ledger";
import type {
  MissEvidence,
  WearableProvider,
} from "@/lib/server/wearable/types";
import { classifyWearableGoal } from "@/lib/wearable-goal";

// The miss rule. SPOTTER records verdict=false only when the run is over, the
// sync grace has passed, the wearable covered every day of the run on the
// wearer's own calendar, and that data shows the goal was not met on any
// reading of the window. Anything short of that records nothing and the
// contract refunds the stake. Every gate below has a case.

const USER = "0x1111111111111111111111111111111111111111" as Address;
const GRACE = 6 * 3600;
const JST = 9 * 3600;

// Live pool 5 on Base Sepolia: 2026-09-26T02:39:43Z .. 2026-09-26T23:30:00Z,
// "sleep 7 hours, 1 night", commitment model. In Tokyo that is Saturday
// 11:39 to Sunday 08:30, so the run's night is Saturday into Sunday, keyed to
// Sunday 2026-09-27 (a night belongs to the local day it ended).
const POOL5: MissPool = {
  bountyModel: 2,
  goalSpec: "Sleep 7 hours for 1 night",
  settled: false,
  cancelled: false,
  periodStart: 1_790_390_383n,
  periodEnd: 1_790_465_400n,
};
const AFTER_GRACE = POOL5.periodEnd + BigInt(GRACE);

const sleepSpec = () => {
  const spec = classifyWearableGoal(POOL5.goalSpec);
  if (spec.metric === null) throw new Error("fixture goal must classify");
  return { ...spec, metric: spec.metric };
};

function evidence(partial: Partial<MissEvidence>): MissEvidence {
  return { values: {}, heartbeatDays: [], tzOffsetSec: JST, ...partial };
}

describe("localWindowDays", () => {
  it("places pool 5 on the Tokyo calendar as Saturday and Sunday", () => {
    expect(localWindowDays(POOL5.periodStart, POOL5.periodEnd, JST)).toEqual([
      "2026-09-26",
      "2026-09-27",
    ]);
  });

  it("places the same pool on the New York calendar as Friday and Saturday", () => {
    expect(
      localWindowDays(POOL5.periodStart, POOL5.periodEnd, -4 * 3600),
    ).toEqual(["2026-09-25", "2026-09-26"]);
  });
});

describe("missEvidenceFromISO", () => {
  it("reaches two UTC days before periodStart so any timezone and the hedge day are covered", () => {
    expect(missEvidenceFromISO(POOL5.periodStart)).toBe("2026-09-24");
  });
});

describe("missRulePool", () => {
  it("accepts a commitment pool, wearable-only, on a metric whose day is final", () => {
    const rule = missRulePool(POOL5);
    expect(rule.ok).toBe(true);
  });

  it("skips fixed-bounty and pot-split pools: a miss there would send the stake to the creator", () => {
    expect(missRulePool({ ...POOL5, bountyModel: 0 })).toEqual({ ok: false, basis: "not-commitment" });
    expect(missRulePool({ ...POOL5, bountyModel: 1 })).toEqual({ ok: false, basis: "not-commitment" });
  });

  it("skips document and hybrid proof pools", () => {
    expect(missRulePool({ ...POOL5, goalSpec: "[doc] flu shot this season" })).toEqual({
      ok: false,
      basis: "not-wearable-only",
    });
    expect(
      missRulePool({ ...POOL5, goalSpec: "[proof=wearable+self] Sleep 7 hours for 1 night" }),
    ).toEqual({ ok: false, basis: "not-wearable-only" });
  });

  it("skips steps, calories and distance, where a zero is ambiguous and no day is ever final", () => {
    for (const goalSpec of ["8000 steps for 1 day", "500 calories for 1 day", "run 5 km for 1 day"]) {
      expect(missRulePool({ ...POOL5, goalSpec })).toEqual({ ok: false, basis: "metric-not-final" });
    }
  });

  it("skips a goal that maps to no wearable metric", () => {
    expect(missRulePool({ ...POOL5, goalSpec: "be nicer to people" })).toEqual({
      ok: false,
      basis: "metric-not-final",
    });
  });

  it("accepts sleep score, sleep efficiency and workouts", () => {
    for (const goalSpec of [
      "sleep score 80 for 1 night",
      "sleep efficiency 85 for 1 night",
      "work out for 1 day",
    ]) {
      expect(missRulePool({ ...POOL5, goalSpec }).ok).toBe(true);
    }
  });
});

describe("missSettleWindow", () => {
  it("holds a miss-eligible pool until periodEnd + grace, then at most the miss phase", () => {
    expect(missSettleWindow(POOL5, GRACE)).toEqual({
      dueAt: POOL5.periodEnd + BigInt(GRACE),
      holdUntil: POOL5.periodEnd + BigInt(GRACE + MISS_PHASE_MAX_S),
    });
  });

  it("leaves every other pool on its old timing", () => {
    expect(missSettleWindow({ ...POOL5, bountyModel: 0 }, GRACE)).toBeNull();
    expect(missSettleWindow({ ...POOL5, goalSpec: "8000 steps for 1 day" }, GRACE)).toBeNull();
  });

  it("keeps the whole window inside the contract's 24h settler-only grace at the maximum", () => {
    const window = missSettleWindow(POOL5, 18 * 3600);
    expect(window).not.toBeNull();
    expect(window!.holdUntil - POOL5.periodEnd).toBeLessThan(24n * 3600n);
  });
});

describe("missPreconditions", () => {
  const participant = { joined: true, resultRecorded: false };

  it("waits for the grace: one second before periodEnd + grace is not final", () => {
    expect(
      missPreconditions({
        pool: POOL5,
        nowSec: AFTER_GRACE - 1n,
        graceSec: GRACE,
        participant,
        ledger: [],
      }),
    ).toEqual({ ok: false, basis: "grace" });
  });

  it("opens exactly at periodEnd + grace", () => {
    const pre = missPreconditions({
      pool: POOL5,
      nowSec: AFTER_GRACE,
      graceSec: GRACE,
      participant,
      ledger: [],
    });
    expect(pre.ok).toBe(true);
  });

  it("skips a settled or cancelled pool", () => {
    for (const pool of [{ ...POOL5, settled: true }, { ...POOL5, cancelled: true }]) {
      expect(
        missPreconditions({ pool, nowSec: AFTER_GRACE, graceSec: GRACE, participant, ledger: [] }),
      ).toEqual({ ok: false, basis: "pool-closed" });
    }
  });

  it("skips a wallet that is not in the pool, and one that already has a result", () => {
    expect(
      missPreconditions({
        pool: POOL5,
        nowSec: AFTER_GRACE,
        graceSec: GRACE,
        participant: { joined: false, resultRecorded: false },
        ledger: [],
      }),
    ).toEqual({ ok: false, basis: "not-joined" });
    expect(
      missPreconditions({
        pool: POOL5,
        nowSec: AFTER_GRACE,
        graceSec: GRACE,
        participant: { joined: true, resultRecorded: true },
        ledger: [],
      }),
    ).toEqual({ ok: false, basis: "already-recorded" });
  });

  it("never records a miss on a claim SPOTTER already decided to pay", () => {
    const ledger: LedgerEntry[] = [
      { at: "t", kind: "reason", decision: "pay", note: "paying.", ref: "wearable-1" },
    ];
    expect(
      missPreconditions({ pool: POOL5, nowSec: AFTER_GRACE, graceSec: GRACE, participant, ledger }),
    ).toEqual({ ok: false, basis: "pass-in-progress" });
  });

  it("never writes a second result over a ledger that already holds one", () => {
    const ledger: LedgerEntry[] = [
      { at: "t", kind: "record", goalId: "0x1", registryStatus: "skipped" },
    ];
    expect(
      missPreconditions({ pool: POOL5, nowSec: AFTER_GRACE, graceSec: GRACE, participant, ledger }),
    ).toEqual({ ok: false, basis: "already-recorded" });
  });
});

describe("judgeMissEvidence: sleep", () => {
  const judge = (ev: MissEvidence, pool: MissPool = POOL5) => {
    const spec = classifyWearableGoal(pool.goalSpec);
    if (spec.metric === null) throw new Error("fixture goal must classify");
    return judgeMissEvidence({
      spec: { ...spec, metric: spec.metric },
      periodStart: pool.periodStart,
      periodEnd: pool.periodEnd,
      evidence: ev,
    });
  };

  it("records a miss when every night of the run synced and none met the goal", () => {
    const decision = judge(
      evidence({ values: { "2026-09-26": 5.5, "2026-09-27": 6.1 } }),
    );
    expect(decision).toEqual({
      miss: true,
      window: ["2026-09-26", "2026-09-27"],
      qualifyingDays: 0,
    });
  });

  it("pool 5 in Tokyo: Friday night fails, Saturday night passes, no miss", () => {
    expect(judge(evidence({ values: { "2026-09-26": 5, "2026-09-27": 8 } }))).toEqual({
      miss: false,
      basis: "met",
    });
  });

  it("pool 5 in Tokyo: Saturday night missing, no miss", () => {
    expect(judge(evidence({ values: { "2026-09-26": 5 } }))).toEqual({
      miss: false,
      basis: "coverage-gap",
    });
  });

  it("a night reported as zero is not data", () => {
    expect(judge(evidence({ values: { "2026-09-26": 5, "2026-09-27": 0 } }))).toEqual({
      miss: false,
      basis: "coverage-gap",
    });
  });

  it("met only on the day after the window still counts for the player (timezone hedge)", () => {
    expect(
      judge(evidence({ values: { "2026-09-26": 5, "2026-09-27": 6, "2026-09-28": 8 } })),
    ).toEqual({ miss: false, basis: "met-at-boundary" });
  });

  it("met only on the day before the window still counts for the player", () => {
    expect(
      judge(evidence({ values: { "2026-09-25": 7.5, "2026-09-26": 5, "2026-09-27": 6 } })),
    ).toEqual({ miss: false, basis: "met-at-boundary" });
  });

  it("an unknown timezone records nothing", () => {
    expect(
      judge(evidence({ values: { "2026-09-26": 5, "2026-09-27": 6 }, tzOffsetSec: null })),
    ).toEqual({ miss: false, basis: "tz-unknown" });
  });

  it("a goal longer than the run's window records nothing", () => {
    expect(
      judge(
        evidence({ values: { "2026-09-26": 5, "2026-09-27": 6 } }),
        { ...POOL5, goalSpec: "Sleep 7 hours for 3 nights" },
      ),
    ).toEqual({ miss: false, basis: "goal-longer-than-window" });
  });

  it("heartbeats do not stand in for a missing sleep value", () => {
    expect(
      judge(
        evidence({
          values: { "2026-09-26": 5 },
          heartbeatDays: ["2026-09-26", "2026-09-27"],
        }),
      ),
    ).toEqual({ miss: false, basis: "coverage-gap" });
  });
});

describe("judgeMissEvidence: workouts", () => {
  const WORKOUT_POOL: MissPool = { ...POOL5, goalSpec: "Work out for 1 day" };
  const judge = (ev: MissEvidence) => {
    const spec = classifyWearableGoal(WORKOUT_POOL.goalSpec);
    if (spec.metric === null) throw new Error("fixture goal must classify");
    return judgeMissEvidence({
      spec: { ...spec, metric: spec.metric },
      periodStart: WORKOUT_POOL.periodStart,
      periodEnd: WORKOUT_POOL.periodEnd,
      evidence: ev,
    });
  };

  it("records a miss when the device synced every day of the run and logged no session", () => {
    expect(
      judge(evidence({ heartbeatDays: ["2026-09-25", "2026-09-26", "2026-09-27"] })),
    ).toEqual({ miss: true, window: ["2026-09-26", "2026-09-27"], qualifyingDays: 0 });
  });

  it("a day with no heartbeat records nothing: no sync is not no workout", () => {
    expect(judge(evidence({ heartbeatDays: ["2026-09-26"] }))).toEqual({
      miss: false,
      basis: "coverage-gap",
    });
  });

  it("a device whose last sync predates the run's final day records nothing", () => {
    expect(judge(evidence({ heartbeatDays: ["2026-09-25", "2026-09-26"] }))).toEqual({
      miss: false,
      basis: "coverage-gap",
    });
  });

  it("one session inside the window is a hit", () => {
    expect(
      judge(
        evidence({
          values: { "2026-09-27": 1 },
          heartbeatDays: ["2026-09-26", "2026-09-27"],
        }),
      ),
    ).toEqual({ miss: false, basis: "met" });
  });
});

// ------------------------------------------------------------ the I/O shell

function fakeProvider(overrides: Partial<WearableProvider> = {}): WearableProvider {
  return {
    id: "junction",
    label: "Junction",
    readService: "junction-read",
    readLabel: "wearable summary (Junction)",
    readEstUsd: "0.01",
    linkKind: "oauth",
    metrics: ["sleep_score", "sleep_efficiency", "sleep_hours", "workouts"],
    startLink: vi.fn(),
    isConnected: vi.fn().mockResolvedValue(true),
    getMetricProgress: vi.fn(),
    getProgress: vi.fn(),
    getRecent: vi.fn(),
    observedMetrics: vi.fn(),
    disconnect: vi.fn(),
    getMissEvidence: vi
      .fn()
      .mockResolvedValue(evidence({ values: { "2026-09-26": 5, "2026-09-27": 6 } })),
    ...overrides,
  } as WearableProvider;
}

function readDeps(provider: WearableProvider, overrides: Partial<MissReadDeps> = {}): MissReadDeps {
  return {
    storedProviderId: vi.fn().mockResolvedValue("junction"),
    providerConfigured: vi.fn().mockReturnValue(true),
    providerById: vi.fn().mockReturnValue(provider),
    ...overrides,
  };
}

const EVAL_INPUT = {
  pool: POOL5,
  address: USER,
  participant: { joined: true, resultRecorded: false },
  ledger: [] as LedgerEntry[],
  nowSec: AFTER_GRACE,
  graceSec: GRACE,
};

describe("evaluateMiss", () => {
  it("records a miss on full coverage with the goal not met", async () => {
    const provider = fakeProvider();
    const decision = await evaluateMiss(readDeps(provider), EVAL_INPUT);
    expect(decision).toMatchObject({
      miss: true,
      providerId: "junction",
      window: ["2026-09-26", "2026-09-27"],
      qualifyingDays: 0,
    });
    expect(provider.getMissEvidence).toHaveBeenCalledWith(USER, "sleep_hours", "2026-09-24");
  });

  it("before the grace, reads nothing and the skip is not final", async () => {
    const deps = readDeps(fakeProvider());
    const decision = await evaluateMiss(deps, { ...EVAL_INPUT, nowSec: AFTER_GRACE - 1n });
    expect(decision).toEqual({ miss: false, basis: "grace", final: false });
    expect(deps.storedProviderId).not.toHaveBeenCalled();
  });

  it("a wallet that never chose a provider makes zero provider calls", async () => {
    const provider = fakeProvider();
    const deps = readDeps(provider, { storedProviderId: vi.fn().mockResolvedValue(null) });
    const decision = await evaluateMiss(deps, EVAL_INPUT);
    expect(decision).toEqual({ miss: false, basis: "no-stored-provider", final: true });
    expect(deps.providerById).not.toHaveBeenCalled();
    expect(provider.isConnected).not.toHaveBeenCalled();
  });

  it("a stored provider that is no longer configured records nothing", async () => {
    const deps = readDeps(fakeProvider(), { providerConfigured: vi.fn().mockReturnValue(false) });
    expect(await evaluateMiss(deps, EVAL_INPUT)).toEqual({
      miss: false,
      basis: "provider-unconfigured",
      final: true,
    });
  });

  it("a provider that cannot measure the metric records nothing", async () => {
    const provider = fakeProvider({ metrics: ["sleep_score", "workouts"] });
    expect(await evaluateMiss(readDeps(provider), EVAL_INPUT)).toEqual({
      miss: false,
      basis: "metric-unsupported",
      final: true,
    });
    expect(provider.getMissEvidence).not.toHaveBeenCalled();
  });

  it("a disconnected wearable records nothing", async () => {
    const provider = fakeProvider({ isConnected: vi.fn().mockResolvedValue(false) });
    expect(await evaluateMiss(readDeps(provider), EVAL_INPUT)).toEqual({
      miss: false,
      basis: "not-connected",
      final: true,
    });
  });

  it("a provider with no local calendar (Apple) records nothing", async () => {
    const provider = fakeProvider({ getMissEvidence: undefined });
    expect(await evaluateMiss(readDeps(provider), EVAL_INPUT)).toEqual({
      miss: false,
      basis: "tz-unknown",
      final: true,
    });
  });

  it("a provider outage records nothing and never throws", async () => {
    const provider = fakeProvider({
      getMissEvidence: vi.fn().mockRejectedValue(new Error("Junction 503")),
    });
    expect(await evaluateMiss(readDeps(provider), EVAL_INPUT)).toEqual({
      miss: false,
      basis: "read-error",
      final: true,
    });
  });

  it("a connection check that throws records nothing and never throws", async () => {
    const provider = fakeProvider({
      isConnected: vi.fn().mockRejectedValue(new Error("WHOOP down")),
    });
    expect(await evaluateMiss(readDeps(provider), EVAL_INPUT)).toEqual({
      miss: false,
      basis: "read-error",
      final: true,
    });
  });

  it("a store failure reading the provider choice records nothing and never throws", async () => {
    const deps = readDeps(fakeProvider(), {
      storedProviderId: vi.fn().mockRejectedValue(new Error("redis down")),
    });
    expect(await evaluateMiss(deps, EVAL_INPUT)).toEqual({
      miss: false,
      basis: "read-error",
      final: true,
    });
  });

  it("a met goal is a final skip", async () => {
    const provider = fakeProvider({
      getMissEvidence: vi
        .fn()
        .mockResolvedValue(evidence({ values: { "2026-09-26": 5, "2026-09-27": 8 } })),
    });
    expect(await evaluateMiss(readDeps(provider), EVAL_INPUT)).toEqual({
      miss: false,
      basis: "met",
      final: true,
    });
  });

  it("uses the sleep spec the pool's goal classifies to", () => {
    expect(sleepSpec().metric).toBe("sleep_hours");
    expect(sleepSpec().goalDays).toBe(1);
  });
});
