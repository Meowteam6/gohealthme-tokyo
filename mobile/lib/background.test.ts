import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Background delivery: sleep and workouts reach the server without the app
// being opened. HealthKit wakes the app when samples land; the library's
// launch hook re-registers the observers on a cold start and flushes any
// event that arrived before JS booted. This module owns what is registered,
// at what frequency, and what a delivery does: one coalesced sync of the
// recent days through the ordinary sync path, never a raw sample.

type Listener = (args: { typeIdentifier: string; errorMessage?: string }) => void;

const hk = vi.hoisted(() => {
  const listeners = new Map<string, Listener[]>();
  return {
    listeners,
    configureBackgroundTypes: vi.fn(async (_types: string[], _freq: number) => true),
    enableBackgroundDelivery: vi.fn(async (_type: string, _freq: number) => true),
    subscribeToChanges: vi.fn((type: string, cb: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), cb]);
      return {
        remove: () => {
          listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== cb));
        },
      };
    }),
    fire(type: string, errorMessage?: string) {
      for (const l of listeners.get(type) ?? []) l({ typeIdentifier: type, errorMessage });
    },
  };
});

vi.mock("@kingstinct/react-native-healthkit", () => ({
  configureBackgroundTypes: hk.configureBackgroundTypes,
  enableBackgroundDelivery: hk.enableBackgroundDelivery,
  subscribeToChanges: hk.subscribeToChanges,
  UpdateFrequency: { immediate: 1, hourly: 2, daily: 3, weekly: 4 },
}));

vi.mock("./api", () => ({
  NotPairedError: class NotPairedError extends Error {},
}));

// The real sync reads HealthKit, which does not exist here; every test injects
// its own `sync`, so the default import only has to resolve.
vi.mock("./sync", () => ({ syncNow: vi.fn() }));

import { NotPairedError } from "./api";
import {
  BACKGROUND_DAYS,
  BACKGROUND_TYPES,
  createBackgroundListener,
  startBackgroundDelivery,
} from "./background";

const STEPS = "HKQuantityTypeIdentifierStepCount";
const SLEEP = "HKCategoryTypeIdentifierSleepAnalysis";
const WORKOUTS = "HKWorkoutTypeIdentifier";

function outcome() {
  return { sent: 1, daysWithData: 1, coveredDays: ["2026-10-06"], result: { stored: 1 } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  hk.listeners.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startBackgroundDelivery registration", () => {
  it("registers sleep, workouts and steps for launch-time observation", async () => {
    await startBackgroundDelivery("token", { sync: vi.fn(async () => outcome()) });

    expect(hk.configureBackgroundTypes).toHaveBeenCalledTimes(1);
    const [types, frequency] = hk.configureBackgroundTypes.mock.calls[0] as [string[], number];
    expect([...types].sort()).toEqual([SLEEP, STEPS, WORKOUTS].sort());
    expect(frequency).toBe(1);
    expect([...BACKGROUND_TYPES].sort()).toEqual([SLEEP, STEPS, WORKOUTS].sort());
  });

  it("asks Apple for hourly steps and immediate sleep and workouts", async () => {
    await startBackgroundDelivery("token", { sync: vi.fn(async () => outcome()) });

    const calls = hk.enableBackgroundDelivery.mock.calls.map(([t, f]) => [t, f]);
    expect(calls).toContainEqual([STEPS, 2]);
    expect(calls).toContainEqual([SLEEP, 1]);
    expect(calls).toContainEqual([WORKOUTS, 1]);
    expect(calls).toHaveLength(3);
  });

  it("subscribes to each type once and removes all three on stop", async () => {
    const handle = await startBackgroundDelivery("token", { sync: vi.fn(async () => outcome()) });

    expect(hk.subscribeToChanges).toHaveBeenCalledTimes(3);
    expect([...hk.listeners.keys()].sort()).toEqual([SLEEP, STEPS, WORKOUTS].sort());

    handle.stop();
    for (const type of [SLEEP, STEPS, WORKOUTS]) {
      expect(hk.listeners.get(type)).toEqual([]);
    }
  });

  it("still subscribes when Apple refuses a frequency, so a foreground delivery keeps working", async () => {
    hk.enableBackgroundDelivery.mockRejectedValueOnce(new Error("not authorized"));
    const onError = vi.fn();

    await startBackgroundDelivery("token", { sync: vi.fn(async () => outcome()), onError });

    expect(hk.subscribeToChanges).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("a delivery", () => {
  it("syncs the recent days through the ordinary sync path, once per burst", async () => {
    const sync = vi.fn(async () => outcome());
    const onSynced = vi.fn();
    await startBackgroundDelivery("token", { sync, onSynced, settleMs: 1000 });

    // HealthKit fires one observer per type, usually within the same second.
    hk.fire(SLEEP);
    hk.fire(WORKOUTS);
    hk.fire(STEPS);
    expect(sync).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith("token", BACKGROUND_DAYS);
    expect(onSynced).toHaveBeenCalledWith(outcome());
  });

  it("covers only the days a late Watch sync can touch, not the whole month", () => {
    expect(BACKGROUND_DAYS).toBeGreaterThanOrEqual(2);
    expect(BACKGROUND_DAYS).toBeLessThanOrEqual(3);
  });

  it("runs again for a delivery that lands while a sync is in flight", async () => {
    let release: () => void = () => undefined;
    const sync = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<ReturnType<typeof outcome>>((resolve) => {
          release = () => resolve(outcome());
        }),
      )
      .mockImplementation(async () => outcome());
    await startBackgroundDelivery("token", { sync, settleMs: 100 });

    hk.fire(SLEEP);
    await vi.advanceTimersByTimeAsync(100);
    expect(sync).toHaveBeenCalledTimes(1);

    hk.fire(WORKOUTS);
    await vi.advanceTimersByTimeAsync(100);
    // Still in flight: the second delivery must wait, not be dropped.
    expect(sync).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("ignores a delivery that carries an error instead of a change", async () => {
    const sync = vi.fn(async () => outcome());
    const onError = vi.fn();
    await startBackgroundDelivery("token", { sync, onError, settleMs: 100 });

    hk.fire(SLEEP, "Authorization not determined");
    await vi.advanceTimersByTimeAsync(100);

    expect(sync).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("reports a failed sync and keeps listening", async () => {
    const sync = vi
      .fn()
      .mockRejectedValueOnce(new Error("sync failed (502)"))
      .mockImplementation(async () => outcome());
    const onError = vi.fn();
    await startBackgroundDelivery("token", { sync, onError, settleMs: 100 });

    hk.fire(STEPS);
    await vi.advanceTimersByTimeAsync(100);
    expect(onError).toHaveBeenCalledTimes(1);

    hk.fire(STEPS);
    await vi.advanceTimersByTimeAsync(100);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("stops itself when the server says the phone is no longer paired", async () => {
    const sync = vi.fn().mockRejectedValueOnce(new NotPairedError("revoked"));
    const onError = vi.fn();
    await startBackgroundDelivery("token", { sync, onError, settleMs: 100 });

    hk.fire(SLEEP);
    await vi.advanceTimersByTimeAsync(100);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(NotPairedError);
    for (const type of [SLEEP, STEPS, WORKOUTS]) {
      expect(hk.listeners.get(type)).toEqual([]);
    }
  });

  it("does nothing after stop", async () => {
    const sync = vi.fn(async () => outcome());
    const handle = await startBackgroundDelivery("token", { sync, settleMs: 100 });

    hk.fire(SLEEP);
    handle.stop();
    await vi.advanceTimersByTimeAsync(100);

    expect(sync).not.toHaveBeenCalled();
  });
});

describe("createBackgroundListener", () => {
  // WHY ONE LISTENER PER PROCESS IS LOAD-BEARING. The native side keeps a
  // single callback per type for background-routed observers, and removing
  // any JS subscription for a type removes THE callback. Two live handles
  // for the same wallet therefore do not double the syncs: stopping either
  // one silences the other, and background delivery dies quietly. The app
  // calls listen from more than one place (pair, the permission step, the
  // launch effect), so the listener must make that safe.

  it("subscribes once for two concurrent listens of the same wallet", async () => {
    const sync = vi.fn(async () => outcome());
    const listener = createBackgroundListener({ sync, settleMs: 100 });

    await Promise.all([listener.listen("token"), listener.listen("token")]);

    expect(hk.subscribeToChanges).toHaveBeenCalledTimes(3);
    expect(hk.configureBackgroundTypes).toHaveBeenCalledTimes(1);
    for (const type of [SLEEP, STEPS, WORKOUTS]) {
      expect(hk.listeners.get(type)).toHaveLength(1);
    }

    hk.fire(SLEEP);
    await vi.advanceTimersByTimeAsync(100);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for a wallet it already listens for", async () => {
    const listener = createBackgroundListener({ sync: vi.fn(async () => outcome()) });

    await listener.listen("token");
    await listener.listen("token");

    expect(hk.subscribeToChanges).toHaveBeenCalledTimes(3);
  });

  it("stops the old wallet's subscriptions before subscribing the new one", async () => {
    const order: string[] = [];
    hk.subscribeToChanges.mockImplementation((type: string, cb: Listener) => {
      order.push(`sub:${type}`);
      hk.listeners.set(type, [...(hk.listeners.get(type) ?? []), cb]);
      return {
        remove: () => {
          order.push(`rm:${type}`);
          hk.listeners.set(type, (hk.listeners.get(type) ?? []).filter((l) => l !== cb));
        },
      };
    });
    const sync = vi.fn(async () => outcome());
    const listener = createBackgroundListener({ sync, settleMs: 100 });

    await listener.listen("old");
    await listener.listen("new");

    // Every removal of the old handle precedes every subscription of the new
    // one: a removal after the new subscribe would take the native callback
    // with it.
    const lastRemove = Math.max(...order.map((e, i) => (e.startsWith("rm:") ? i : -1)));
    const firstNewSub = order.findIndex((e, i) => e.startsWith("sub:") && i > 2);
    expect(lastRemove).toBeLessThan(firstNewSub);
    for (const type of [SLEEP, STEPS, WORKOUTS]) {
      expect(hk.listeners.get(type)).toHaveLength(1);
    }

    hk.fire(WORKOUTS);
    await vi.advanceTimersByTimeAsync(100);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith("new", BACKGROUND_DAYS);
  });

  it("leaves nothing subscribed when stopped while a listen is still starting", async () => {
    const listener = createBackgroundListener({ sync: vi.fn(async () => outcome()) });

    const starting = listener.listen("token");
    const stopping = listener.stop();
    await Promise.all([starting, stopping]);

    for (const type of [SLEEP, STEPS, WORKOUTS]) {
      expect(hk.listeners.get(type)).toEqual([]);
    }
  });

  it("subscribes again for the same wallet after a stop", async () => {
    const listener = createBackgroundListener({ sync: vi.fn(async () => outcome()) });

    await listener.listen("token");
    await listener.stop();
    await listener.listen("token");

    expect(hk.subscribeToChanges).toHaveBeenCalledTimes(6);
    for (const type of [SLEEP, STEPS, WORKOUTS]) {
      expect(hk.listeners.get(type)).toHaveLength(1);
    }
  });

  it("subscribes again after the server revoked the pairing and the wallet pairs this phone again", async () => {
    const sync = vi.fn().mockRejectedValueOnce(new NotPairedError("revoked")).mockImplementation(async () => outcome());
    const onError = vi.fn();
    const listener = createBackgroundListener({ sync, onError, settleMs: 100 });

    await listener.listen("token");
    hk.fire(SLEEP);
    await vi.advanceTimersByTimeAsync(100);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(NotPairedError);
    for (const type of [SLEEP, STEPS, WORKOUTS]) {
      expect(hk.listeners.get(type)).toEqual([]);
    }

    // The handle stopped itself; the listener must not think it is still live.
    await listener.listen("token");
    for (const type of [SLEEP, STEPS, WORKOUTS]) {
      expect(hk.listeners.get(type)).toHaveLength(1);
    }
  });
});
