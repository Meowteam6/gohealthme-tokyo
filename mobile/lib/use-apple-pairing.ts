// Apple Watch pairing and sync, lifted out of the screen so it runs from the
// app root. The WebView shell in front needs it (the page hands over a code
// and listens for each step) and so does the standalone pairing screen that
// stands in when the site cannot load. Background delivery has to live here
// too: it is a subscription in this JS process, and a root that is a WebView
// would otherwise lose the "last night's sleep lands without opening the
// app" behaviour.
//
// The pipeline itself (redeem, keep the token, Health sheet once, listen,
// first month) is a plain function with every dependency injected, so vitest
// covers each branch without React Native. The hook wires it to the Keychain,
// HealthKit, the background listener and React state.
//
// What leaves this module about a pairing: the wallet address and the counts
// the server stored. The device token is held in the Keychain and passed to
// the sync; it never goes into a status event, a log line or the screen.

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { NotPairedError, RedeemFailedError, redeemCode, type Pairing } from "./api";
import { createBackgroundListener, type BackgroundListener } from "./background";
import { healthDataAvailable, requestPermissions } from "./healthkit";
import { clearPairing, loadConnected, loadPairing, saveConnected, savePairing } from "./pairing-store";
import type { PairFailureReason, PairStatus } from "./shell/bridge";
import { HealthUnreadableError, syncNow as readAndPost, type SyncOutcome } from "./sync";

export type { PairFailureReason, PairStatus } from "./shell/bridge";

/** How far back the first sync after pairing reads. */
export const SYNC_DAYS = 30;

export const REVOKED =
  "This iPhone is no longer paired. Get a new code on the GoHealthMe website and pair again.";
// The code was accepted but the Keychain refused the token, so the code is
// spent and the phone holds nothing. Pairing again revokes the lost token.
export const SAVE_FAILED =
  "This iPhone could not save the pairing. Get a new code on the GoHealthMe website and try again.";
export const NETWORK_FAILED = "Could not reach GoHealthMe. Check your connection and try again.";

export type Busy = "pairing" | "connecting" | "syncing" | null;

/**
 * The newest sync that landed, and whether the person asked for it. A
 * background wake also reports here; its outcome drives the headline, but
 * the Settings line is only shown for a sync the person was waiting on.
 */
export interface LastSync {
  outcome: SyncOutcome;
  manual: boolean;
}

/** How a failed step is retried, and why it failed, for the page's copy. */
export interface Failure {
  message: string;
  retry: "pair" | "connect" | "sync";
  reason: PairFailureReason;
}

export function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type Phase = "redeem" | "connect" | "sync";

/** Which line and which retry an error gets, by what threw it and when. */
export function failureFrom(err: unknown, phase: Phase): Failure {
  const retry: Failure["retry"] = phase === "redeem" ? "pair" : phase === "connect" ? "connect" : "sync";
  if (err instanceof NotPairedError) return { message: REVOKED, retry: "pair", reason: "revoked" };
  if (err instanceof HealthUnreadableError) return { message: err.message, retry, reason: "health-unreadable" };
  if (err instanceof RedeemFailedError) {
    return { message: err.message, retry: "pair", reason: err.status >= 500 ? "server" : "invalid-code" };
  }
  if (phase === "connect") return { message: describe(err), retry, reason: "health-unreadable" };
  // fetch reports an unreachable server as a TypeError.
  if (err instanceof TypeError) return { message: NETWORK_FAILED, retry, reason: "network" };
  return { message: describe(err), retry, reason: "server" };
}

export interface SyncDeps {
  sync: (deviceToken: string, days: number) => Promise<SyncOutcome>;
  emit: (status: PairStatus) => void;
}

export interface SyncRun {
  last: SyncOutcome | null;
  failure: Failure | null;
}

/** One sync, reported to the page as syncing then synced or failed. */
export async function runSync(deviceToken: string, days: number, deps: SyncDeps): Promise<SyncRun> {
  deps.emit({ status: "syncing" });
  try {
    const outcome = await deps.sync(deviceToken, days);
    deps.emit({
      status: "synced",
      stored: outcome.result.stored,
      covered: outcome.result.covered,
      daysWithData: outcome.daysWithData,
      unread: [...outcome.unread],
    });
    return { last: outcome, failure: null };
  } catch (err) {
    const failure = failureFrom(err, "sync");
    deps.emit({ status: "failed", reason: failure.reason, message: failure.message });
    return { last: null, failure };
  }
}

export interface PipelineDeps extends SyncDeps {
  redeem: (code: string) => Promise<Pairing>;
  save: (pairing: Pairing) => Promise<void>;
  /** Whether the Apple Health sheet has already been shown on this phone. */
  connected: boolean;
  requestPermissions: () => Promise<unknown>;
  saveConnected: () => Promise<void>;
  listen: (pairing: Pairing) => Promise<void>;
  /**
   * Called once the code is accepted for a run, before the redeem. A code
   * that runs nothing (already tried) never gets here, so a line that says
   * why its first try failed stays where it is.
   */
  onStart?: () => void;
  /** Called as soon as the token is in the Keychain, before the Health sheet. */
  onPaired?: (pairing: Pairing) => void;
  /** Called once the Health sheet has been shown and dismissed on this phone. */
  onConnected?: () => void;
  onBusy?: (busy: Busy) => void;
  /** Codes already handed to the server. Shared across calls by the caller. */
  attempted: Set<string>;
}

export interface PipelineResult {
  /** false when the code had already been tried and nothing ran. */
  ran: boolean;
  pairing: Pairing | null;
  connected: boolean;
  last: SyncOutcome | null;
  failure: Failure | null;
}

/**
 * Whether the code behind a result is gone for good: it reached the server
 * and was answered. A redeem the network dropped leaves the code usable (the
 * pipeline forgets it again for that reason); a code that ran nothing was
 * decided by its first run, not this one.
 */
export function codeSpent(result: PipelineResult | null): boolean {
  return result !== null && result.ran && result.failure?.reason !== "network";
}

/**
 * Redeem a code and bring the phone to "paired and read". Each step is
 * reported through `emit`; the result is what the screen should now show.
 *
 * A code works once on the server, and the page may hand the same code over
 * twice (an effect that ran twice, a retried post). The second time runs
 * nothing rather than turning a good pairing into a 400. A redeem the
 * network dropped is the one exception: the code is forgotten again so the
 * same code can be retried.
 */
export async function runPairPipeline(code: string, deps: PipelineDeps): Promise<PipelineResult> {
  if (deps.attempted.has(code)) {
    return { ran: false, pairing: null, connected: deps.connected, last: null, failure: null };
  }
  deps.attempted.add(code);
  deps.onStart?.();

  const fail = (failure: Failure, pairing: Pairing | null, connected: boolean): PipelineResult => {
    deps.emit({ status: "failed", reason: failure.reason, message: failure.message });
    deps.onBusy?.(null);
    return { ran: true, pairing, connected, last: null, failure };
  };

  deps.onBusy?.("pairing");
  deps.emit({ status: "redeeming" });
  let pairing: Pairing;
  try {
    pairing = await deps.redeem(code);
  } catch (err) {
    const failure = failureFrom(err, "redeem");
    if (failure.reason === "network") deps.attempted.delete(code);
    return fail(failure, null, deps.connected);
  }
  deps.emit({ status: "redeemed" });

  try {
    await deps.save(pairing);
  } catch {
    return fail({ message: SAVE_FAILED, retry: "pair", reason: "save-failed" }, null, deps.connected);
  }
  deps.onPaired?.(pairing);

  // The sheet is asked for exactly once per phone; iOS shows nothing on a
  // second request, so asking again would be a tap that does nothing.
  let connected = deps.connected;
  if (!connected) {
    deps.onBusy?.("connecting");
    deps.emit({ status: "health-sheet" });
    try {
      await deps.requestPermissions();
    } catch (err) {
      return fail(failureFrom(err, "connect"), pairing, false);
    }
    await deps.saveConnected().catch(() => undefined);
    connected = true;
    deps.onConnected?.();
  }

  // The listener reports its own problems; a refused registration must not
  // stop the first read.
  try {
    await deps.listen(pairing);
  } catch {
    // Reported through the listener's onError.
  }

  deps.onBusy?.("syncing");
  const run = await runSync(pairing.deviceToken, SYNC_DAYS, deps);
  deps.onBusy?.(null);
  if (run.failure !== null) {
    return {
      ran: true,
      pairing: run.failure.reason === "revoked" ? null : pairing,
      connected,
      last: null,
      failure: run.failure,
    };
  }
  return { ran: true, pairing, connected, last: run.last, failure: null };
}

export interface ApplePairing {
  /** undefined while the Keychain is being read, null when unpaired. */
  pairing: Pairing | null | undefined;
  /** Whether the Apple Health sheet has been shown on this phone. */
  connected: boolean;
  /** Whether HealthKit exists on this device; null until checked. */
  available: boolean | null;
  busy: Busy;
  last: LastSync | null;
  failure: Failure | null;
  /**
   * Redeem a code from the page, a deep link or the standalone screen. Resolves
   * with what ran, or null when the code was empty, already tried, or another
   * step was in flight.
   */
  pairWithCode: (code: string) => Promise<PipelineResult | null>;
  /** Retry the failed step in place. */
  retry: () => void;
  /** Read Apple Health again now, asking for the sheet first if it never showed. */
  syncNow: () => Promise<void>;
  /** Subscribe to every pairing and sync step. Returns the unsubscribe. */
  onStatus: (listener: (status: PairStatus) => void) => () => void;
}

export function useApplePairing(): ApplePairing {
  const [pairing, setPairing] = useState<Pairing | null | undefined>(undefined);
  const [connected, setConnected] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [last, setLast] = useState<LastSync | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  // Mirrors of the state the callbacks read, so the callbacks stay stable
  // and the shell's effects do not re-subscribe on every render.
  const pairingRef = useRef<Pairing | null | undefined>(undefined);
  const connectedRef = useRef(false);
  const failureRef = useRef<Failure | null>(null);
  pairingRef.current = pairing;
  connectedRef.current = connected;
  failureRef.current = failure;

  // One pairing or sync at a time. A foreground sync that arrives while a
  // step is running is skipped (the running step reads the same days); a
  // code that arrives then waits its turn, because the page posts it once.
  const inFlight = useRef(false);
  const lock = useRef<Promise<void>>(Promise.resolve());
  const withLock = useCallback(<T,>(step: () => Promise<T>): Promise<T> => {
    const run = lock.current.then(step, step);
    lock.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);
  // The Keychain read at launch; a deep link that arrives first waits for it,
  // so pairing knows whether the Health sheet was already shown.
  const ready = useRef<Promise<void>>(Promise.resolve());
  const attempted = useRef(new Set<string>());
  const listeners = useRef(new Set<(status: PairStatus) => void>());
  // The one background listener this process holds. Pairing, the permission
  // step and the launch effect all ask it to listen, often for the same
  // wallet within the same tick; it serialises them, because two live
  // subscriptions for one type silence each other on the native side.
  const listener = useRef<BackgroundListener | null>(null);

  const emit = useCallback((status: PairStatus): void => {
    for (const l of listeners.current) l(status);
  }, []);

  const onStatus = useCallback((l: (status: PairStatus) => void): (() => void) => {
    listeners.current.add(l);
    return () => {
      listeners.current.delete(l);
    };
  }, []);

  useEffect(() => {
    try {
      setAvailable(healthDataAvailable());
    } catch {
      setAvailable(false);
    }
    ready.current = Promise.all([
      loadConnected()
        .then((c) => {
          connectedRef.current = c;
          setConnected(c);
        })
        .catch(() => setConnected(false)),
      loadPairing()
        .then(setPairing)
        .catch(() => setPairing(null)),
    ]).then(() => undefined);
  }, []);

  const revoked = useCallback(async (): Promise<void> => {
    void listener.current?.stop();
    await clearPairing().catch(() => undefined);
    setPairing(null);
    setLast(null);
    setFailure({ message: REVOKED, retry: "pair", reason: "revoked" });
  }, []);

  const listen = useCallback(
    async (current: Pairing): Promise<void> => {
      if (listener.current === null) {
        listener.current = createBackgroundListener({
          onSynced: (outcome) => {
            setLast({ outcome, manual: false });
            emit({
              status: "synced",
              stored: outcome.result.stored,
              covered: outcome.result.covered,
              daysWithData: outcome.daysWithData,
              unread: [...outcome.unread],
            });
          },
          onError: (err) => {
            if (err instanceof NotPairedError) {
              void revoked();
              emit({ status: "failed", reason: "revoked", message: REVOKED });
            } else {
              console.warn("[background]", describe(err));
            }
          },
        });
      }
      await listener.current.listen(current.deviceToken);
    },
    [emit, revoked],
  );

  const sync = useCallback(
    async (current: Pairing): Promise<void> => {
      if (inFlight.current) return;
      await withLock(async () => {
        inFlight.current = true;
        setBusy("syncing");
        setFailure(null);
        try {
          const run = await runSync(current.deviceToken, SYNC_DAYS, { sync: readAndPost, emit });
          if (run.failure?.reason === "revoked") {
            await revoked();
          } else if (run.failure !== null) {
            setFailure(run.failure);
          } else if (run.last !== null) {
            setLast({ outcome: run.last, manual: true });
          }
        } finally {
          inFlight.current = false;
          setBusy(null);
        }
      });
    },
    [emit, revoked, withLock],
  );

  // Allow Apple Health, then listen for it and read the first month.
  const connect = useCallback(
    async (current: Pairing): Promise<void> => {
      if (inFlight.current) return;
      const shown = await withLock(async (): Promise<boolean> => {
        inFlight.current = true;
        setBusy("connecting");
        setFailure(null);
        emit({ status: "health-sheet" });
        try {
          await requestPermissions();
          await saveConnected().catch(() => undefined);
          connectedRef.current = true;
          setConnected(true);
          return true;
        } catch (err) {
          const f = failureFrom(err, "connect");
          setFailure(f);
          emit({ status: "failed", reason: f.reason, message: f.message });
          setBusy(null);
          return false;
        } finally {
          inFlight.current = false;
        }
      });
      if (!shown) return;
      await listen(current);
      await sync(current);
    },
    [emit, listen, sync, withLock],
  );

  const pairWithCode = useCallback(
    async (raw: string): Promise<PipelineResult | null> => {
      const code = raw.trim();
      if (code === "") return null;
      return withLock(async () => {
        inFlight.current = true;
        try {
          await ready.current;
          const result = await runPairPipeline(code, {
            redeem: redeemCode,
            save: savePairing,
            connected: connectedRef.current,
            requestPermissions,
            saveConnected,
            listen,
            sync: readAndPost,
            emit,
            attempted: attempted.current,
            onBusy: setBusy,
            // The old failure line clears only for a code that actually runs;
            // a spent code typed again keeps the line that says why.
            onStart: () => setFailure(null),
            onPaired: (p) => {
              setPairing(p);
              setLast(null);
            },
            onConnected: () => {
              connectedRef.current = true;
              setConnected(true);
            },
          });
          if (!result.ran) return null;
          if (result.failure?.reason === "revoked") {
            await revoked();
            return result;
          }
          setFailure(result.failure);
          if (result.last !== null) setLast({ outcome: result.last, manual: true });
          return result;
        } finally {
          inFlight.current = false;
          setBusy(null);
        }
      });
    },
    [emit, listen, revoked, withLock],
  );

  const syncNow = useCallback(async (): Promise<void> => {
    const current = pairingRef.current;
    if (current === null || current === undefined) return;
    if (connectedRef.current) await sync(current);
    else await connect(current);
  }, [connect, sync]);

  const retry = useCallback((): void => {
    const current = pairingRef.current;
    const f = failureRef.current;
    if (current === null || current === undefined || f === null) return;
    if (f.retry === "connect") void connect(current);
    else if (f.retry === "sync") void sync(current);
  }, [connect, sync]);

  // Once paired and allowed: listen for background delivery, sync on launch
  // and every time the app comes to the front. A launch in the background
  // (HealthKit woke us) skips the launch sync; the delivery itself syncs.
  useEffect(() => {
    if (pairing === null || pairing === undefined || !connected) return;
    void listen(pairing);
    if (AppState.currentState === "active") void sync(pairing);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync(pairing);
    });
    return () => {
      sub.remove();
      void listener.current?.stop();
    };
  }, [pairing, connected, listen, sync]);

  return { pairing, connected, available, busy, last, failure, pairWithCode, retry, syncNow, onStatus };
}
