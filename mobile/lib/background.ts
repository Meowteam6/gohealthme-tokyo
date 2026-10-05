// Background delivery: last night's sleep reaches the server without anyone
// opening the app.
//
// HOW IT WORKS, so the next person does not have to read the library.
//
// Apple wakes an app in the background when samples of a type it asked for
// land in HealthKit, but only if an observer query for that type is already
// running when the app launches. The library's core pod does that part:
// configureBackgroundTypes persists the types, and a launch hook registers
// the observers on every cold start before JS boots, queuing any event that
// fires in that gap and flushing it to subscribeToChanges the moment we
// subscribe. So the work here is to say WHAT to observe, HOW OFTEN Apple may
// wake us, and what a wake DOES.
//
// WHAT A WAKE DOES. One sync of the recent days through the ordinary path in
// lib/sync.ts, so the server sees the same body a foreground sync sends: daily
// totals, the timezone, the covered days. Nothing here can send a raw sample.
// HealthKit fires one observer per type and usually several within a second
// (a Watch sync delivers sleep, workouts and steps together), so deliveries
// are coalesced into one sync per burst rather than one per observer.
//
// WHICH DAYS. Only the days a late Watch sync can touch: today and the two
// before it. A night ends today; a workout from the evening before last
// lands when the Watch next meets the phone. Re-reading a month on every
// wake would be wasteful inside the few seconds iOS grants.

import {
  configureBackgroundTypes,
  enableBackgroundDelivery,
  subscribeToChanges,
  UpdateFrequency,
  type SampleTypeIdentifier,
} from "@kingstinct/react-native-healthkit";

import { NotPairedError } from "./api";
import { syncNow, type SyncOutcome } from "./sync";

const SLEEP: SampleTypeIdentifier = "HKCategoryTypeIdentifierSleepAnalysis";
const WORKOUTS: SampleTypeIdentifier = "HKWorkoutTypeIdentifier";
const STEPS: SampleTypeIdentifier = "HKQuantityTypeIdentifierStepCount";

/** The types a background wake is registered for. */
export const BACKGROUND_TYPES: readonly SampleTypeIdentifier[] = [SLEEP, WORKOUTS, STEPS];

/**
 * How often Apple may wake the app per type. Sleep and workouts decide
 * payouts and arrive once a day, so immediate. Steps change every minute and
 * an hourly total is as fresh as any challenge needs.
 */
const FREQUENCIES: ReadonlyArray<readonly [SampleTypeIdentifier, UpdateFrequency]> = [
  [SLEEP, UpdateFrequency.immediate],
  [WORKOUTS, UpdateFrequency.immediate],
  [STEPS, UpdateFrequency.hourly],
];

/** Days back from today that a background sync re-reads and posts. */
export const BACKGROUND_DAYS = 2;

/** How long to let a burst of observer callbacks settle before syncing once. */
const DEFAULT_SETTLE_MS = 2000;

export interface BackgroundDeliveryOptions {
  /** Called after each background sync the server accepted. */
  onSynced?: (outcome: SyncOutcome) => void;
  /** Called for a refused frequency, an observer error, or a failed sync. */
  onError?: (error: unknown) => void;
  /** Coalescing window for a burst of deliveries. */
  settleMs?: number;
  /** The sync to run on a delivery. Defaults to syncNow; injected by tests. */
  sync?: (deviceToken: string, days: number) => Promise<SyncOutcome>;
}

export interface BackgroundDeliveryHandle {
  /** Stop listening in this process. Apple's registration itself persists. */
  stop(): void;
}

/**
 * Register for background delivery and listen for it in this process.
 *
 * Call once after a successful pairing, and again on every launch while
 * paired: the subscription lives in the JS process, and a cold start in the
 * background needs it re-established to receive the event that woke it.
 * Every step here is idempotent on the native side.
 */
export async function startBackgroundDelivery(
  deviceToken: string,
  options: BackgroundDeliveryOptions = {},
): Promise<BackgroundDeliveryHandle> {
  const sync = options.sync ?? syncNow;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const report = (error: unknown): void => options.onError?.(error);

  // Persist the types so the core pod registers observers at the next cold
  // launch, before JS exists. It also enables delivery at this one frequency;
  // the per-type frequencies below override it where they differ.
  try {
    await configureBackgroundTypes([...BACKGROUND_TYPES], UpdateFrequency.immediate);
  } catch (err) {
    report(err);
  }

  // A refused frequency is reported, not fatal: the observer still fires
  // while the app is in the foreground, and the next launch tries again.
  for (const [type, frequency] of FREQUENCIES) {
    try {
      await enableBackgroundDelivery(type, frequency);
    } catch (err) {
      report(err);
    }
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let pending = false;

  const stop = (): void => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    for (const sub of subscriptions) sub.remove();
  };

  const flush = async (): Promise<void> => {
    if (stopped) return;
    if (inFlight) {
      // A delivery during a sync is not dropped: it runs once this one lands,
      // because the samples it announces may not have been in the read.
      pending = true;
      return;
    }
    inFlight = true;
    try {
      const outcome = await sync(deviceToken, BACKGROUND_DAYS);
      options.onSynced?.(outcome);
    } catch (err) {
      report(err);
      if (err instanceof NotPairedError) {
        // Revoked: this wallet paired another phone. Nothing this process
        // posts can land again, so stop listening until the user pairs.
        stop();
        return;
      }
    } finally {
      inFlight = false;
    }
    if (pending && !stopped) {
      pending = false;
      schedule();
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, settleMs);
  };

  const subscriptions = BACKGROUND_TYPES.map((type) =>
    subscribeToChanges(type, ({ errorMessage }) => {
      if (errorMessage !== undefined && errorMessage !== "") {
        report(new Error(`${type}: ${errorMessage}`));
        return;
      }
      schedule();
    }),
  );

  return { stop };
}

export interface BackgroundListener {
  /**
   * Listen for this wallet. A no-op while already listening for the same
   * token; for a different token the old subscriptions are removed first.
   * Calls are serialised, so two overlapping calls can never leave two
   * handles alive.
   */
  listen(deviceToken: string): Promise<void>;
  /** Remove whatever is subscribed, including a listen still starting. */
  stop(): Promise<void>;
}

/**
 * The one background listener a process may hold.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT JUST A GUARD IN THE SCREEN. The native
 * side keeps ONE callback per type for a background-routed observer, and
 * removing any JS subscription for that type removes THE callback. Two
 * handles started for the same wallet therefore do not double the syncs:
 * stopping either one silences the other, and delivery dies with nothing on
 * screen. The app asks to listen from more than one place (pairing, the
 * permission step, the launch effect), sometimes within the same tick while
 * the first call is still awaiting the native side, so the only safe shape
 * is a serialised, idempotent listener: at most one start in flight, the old
 * handle stopped before the new one subscribes, and the same token twice is
 * one subscription.
 */
export function createBackgroundListener(
  options: BackgroundDeliveryOptions = {},
): BackgroundListener {
  let active: { token: string; handle: BackgroundDeliveryHandle } | null = null;
  let chain: Promise<void> = Promise.resolve();

  const enqueue = (step: () => Promise<void>): Promise<void> => {
    const next = chain.then(step, step);
    chain = next.catch(() => undefined);
    return next;
  };

  const dropActive = (): void => {
    active?.handle.stop();
    active = null;
  };

  // A handle stops itself when the server says the phone is no longer paired.
  // Forget it here too, so the next listen for the same wallet (the person
  // paired this phone again) subscribes instead of assuming it is still live.
  const handleOptions: BackgroundDeliveryOptions = {
    ...options,
    onError: (err) => {
      if (err instanceof NotPairedError) active = null;
      options.onError?.(err);
    },
  };

  return {
    listen: (deviceToken) =>
      enqueue(async () => {
        if (active !== null && active.token === deviceToken) return;
        dropActive();
        const handle = await startBackgroundDelivery(deviceToken, handleOptions);
        active = { token: deviceToken, handle };
      }),
    stop: () =>
      enqueue(async () => {
        dropActive();
      }),
  };
}
