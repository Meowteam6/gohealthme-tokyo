"use client";

// Wearable verification for wearable-goal pools: connect a provider through
// Junction Link, then hand the claim to SPOTTER with one tap. The run POSTs
// /api/agent/run/[goalId] with evidenceKind "wearable" and no attesterId -
// SPOTTER pulls the health summary server-side, so nothing raw ever passes
// through the browser or the chain. Mirrors the document flow's polling and
// receipt so both evidence paths end in the same terminal states.
//
// Three things it now does that the document flow always did:
//   1. Restore on mount - a returning user's ledger comes back from
//      GET /api/agent/run/[goalId] and renders as the state it encodes. This
//      is the DEFAULT tab for wearable pools, so without it a user with a
//      claim in flight opened the page to an empty box. The read is owner-only
//      (goal ids are public; the ledger's prose is not), so it carries the
//      wallet proof the tab already holds (readClaimOnLoad, cachedOnly: a page
//      load never opens a wallet), and a claim that cannot be shown is
//      reported as withheld rather than as absent, with a tap to verify.
//   2. Say when the payout lands - the recorded state carries the settle
//      moment and a countdown, and schedules the single automatic re-poll that
//      makes the payout appear without anyone touching anything.
//   3. Refuse to loop on a dead provider - when Junction is refusing us, the
//      connect flow can only ever 502, so the CTA is replaced by the reason
//      and a one-tap move to the document proof path.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import { displayGoalSpec, fetchGoalId, fetchPool } from "@/lib/contract";
import { useEmbeddedWallet } from "@/lib/wallet";
import {
  PhoneLinkRequiredError,
  PopupBlockedError,
  currentReturnPath,
  startWearableLink,
} from "@/lib/wearable-connect";
import PhonePairPanel, { type PhoneSteps } from "@/components/PhonePairPanel";
import WhoopReturnNote from "@/components/WhoopReturnNote";
import { classifyWearableGoal } from "@/lib/wearable-goal";
import { missConfirmByMs, missDeadlineMs } from "@/lib/miss-grace";
import { missRulePool } from "@/lib/miss-rule";
import { missedScreenOf, verdictCopy } from "@/lib/game/verdict";
import {
  deferredPeriodEndMs,
  failureModeOf,
  runStatusFromLedger,
  settleRepollDelayMs,
  toUsd2,
  type LedgerEntry,
  type RunStatus,
} from "@/lib/agent-receipt";
import {
  fetchProviderState,
  providerAuthReason,
  providerConnected,
  providerAwaitingFirstSync,
  providerDownReason,
  providerMetricUnavailable,
  providerQueryKey,
} from "@/lib/wearable-provider";
import {
  cachedOnlyRequester,
  fetchWithWalletAuth,
  type WalletAuthRequester,
} from "@/lib/client-auth";
import { useWalletAuth } from "@/lib/useWalletAuth";
import { runVerifyWallet } from "@/lib/session-proof";
import { proofLandedWhileWaiting } from "@/components/world/HumanApprovalCard";

import {
  claimMoved,
  claimScreenOf,
  claimVisibilityOf,
  emptyClaimScreen,
  nextClaimScreen,
  receiptToKeep,
  type ClaimMark,
  type ClaimReadBody,
  type ClaimScreen,
  type ClaimVisibility,
} from "@/lib/claim-restore";
import AgentReceipt from "@/components/AgentReceipt";
import Countdown from "@/components/Countdown";
import PayoutMoment from "@/components/PayoutMoment";
import { Button, ErrorNote, Skeleton, TAP_TARGET, buttonClasses } from "@/components/ui";
import SignInGate from "@/components/SignInGate";

// Same cadence as the document flow, but wearable runs wait on provider data
// pulls, so the cap allows five minutes before a stuck run surfaces.
const POLL_INTERVAL_MS = 800;
const MAX_POLLS = 375;

/** Run statuses that end the polling loop. "recorded" also stops it: the pool
 *  period has not ended, and SPOTTER settles the moment it does.
 *
 *  World ID for Agents: a declined, expired or cancelled confirmation ends the
 *  loop too (nothing more happens without a new ask). "awaiting-approval" does
 *  NOT: the loop's next poll after the player says yes is what records the
 *  result (docs/WORLD.md, step 4), so it keeps polling while the ask is open. */
const TERMINAL: RunStatus[] = [
  "paid",
  "no-pay",
  "missed",
  "cap-exceeded",
  "blocked",
  "recorded",
  "error",
  "approval-declined",
  "approval-expired",
  "approval-cancelled",
];

interface RunResponse {
  status?: RunStatus;
  /** Present only for a caller who proved control of this claim's wallet. */
  ledger?: LedgerEntry[];
  /** Whether a claim exists at all, regardless of who is asking. */
  hasLedger?: boolean;
  error?: string;
}

type CheckStatus =
  | { kind: "idle" }
  | { kind: "starting" }
  | {
      kind: "agent";
      runStatus: RunStatus;
      ledger: LedgerEntry[];
      /** Set when the server withheld the receipt rows for this request. */
      lockedReason: string | null;
    }
  /** A claim exists but cannot be shown without a signature from its wallet. */
  | { kind: "locked"; reason: string }
  // ledger carries whatever SPOTTER recorded before the failure - money that
  // moved must stay on screen even when the run dies.
  | { kind: "error"; message: string; ledger?: LedgerEntry[] };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The claim read a page load makes: the restore on mount, on a wallet change,
 * and after a proof lands. Shared by the wearable and document claim
 * surfaces (EvidenceUpload).
 *
 * Quiet by construction: whatever requester it is handed, it reads cached
 * credentials only (a Dynamic session token, or a signature already collected
 * this session), and fetchWithWalletAuth's 401 retry stays cachedOnly too, so
 * opening a claim never opens a wallet. The request is still sent unsigned:
 * the redacted answer is what says a claim exists. `lockedByProof` is true
 * when the claim is withheld only because this tab holds no proof yet, which
 * one Verify tap fixes; a claim withheld from a proven wallet (another
 * wallet's claim, a refused proof) is not.
 *
 * `resume`: the claim is private only for want of a proof AND its public
 * projection says the run is still in flight, so the panel drives it on with
 * quiet polls. The run route never needs a proof to progress, only to show
 * its rows, so an unproven wallet must not stall SPOTTER until a tap (a hit
 * paid on the verdict records only when a poll drives it).
 */
export async function readClaimOnLoad(
  goalId: string,
  poolId: bigint,
  requestAuth: WalletAuthRequester,
  fetchImpl: typeof fetch = fetch,
): Promise<{ visibility: ClaimVisibility; lockedByProof: boolean; resume: boolean }> {
  const url = `/api/agent/run/${goalId}?poolId=${poolId.toString()}`;
  let sent = await fetchWithWalletAuth(
    url,
    undefined,
    cachedOnlyRequester(requestAuth),
    fetchImpl,
  );
  if (sent.response.status === 401 && sent.auth.kind !== "ok") {
    // The proof it held was refused and none is left to try quietly. Ask
    // unsigned: that answer is what tells a withheld claim from no claim, so
    // the panel never shows an empty box over a claim that already ran.
    sent = { response: await fetchImpl(url), auth: sent.auth };
  }
  if (!sent.response.ok) {
    throw new Error(`ledger read responded ${sent.response.status}`);
  }
  const body = (await sent.response.json().catch(() => ({}))) as ClaimReadBody & {
    claim?: unknown;
  };
  const visibility = claimVisibilityOf(body, sent.auth);
  const lockedByProof = visibility.kind === "locked" && sent.auth.kind !== "ok";
  return {
    visibility,
    lockedByProof,
    resume: lockedByProof && privateClaimInFlight(body.claim),
  };
}

/**
 * Whether a withheld claim's public projection (feed-view.ts, machine states
 * only) is a run a poll can move on: the "verifying" state of
 * runStatusFromLedger (mid-run, decided to pay, approved, or recorded and not
 * settled). Anything finished, refused, waiting on the human, stopped on an
 * error or handed to the sweep is left alone, and so is anything this cannot
 * read: a poll on a finished no-pay could re-check it, which only the
 * player's tap may do.
 */
function privateClaimInFlight(claim: unknown): boolean {
  if (typeof claim !== "object" || claim === null) return false;
  const c = claim as {
    decision?: unknown;
    recordTxs?: unknown;
    settle?: unknown;
    approval?: unknown;
    problem?: unknown;
    missed?: unknown;
  };
  if (c.missed === true) return false;
  if (c.problem !== undefined && c.problem !== null) return false;
  // Settled, deferred to the sweep, or closed: nothing for a poll to do.
  if (c.settle !== undefined && c.settle !== null) return false;
  // Recorded and not settled yet: the next poll settles or defers it.
  if (c.recordTxs !== undefined && c.recordTxs !== null) return true;
  if (typeof c.approval === "object" && c.approval !== null) {
    const status = (c.approval as { status?: unknown }).status;
    // A yes is recorded by the next poll. An open ask waits on the human,
    // whose confirm needs the Verify tap anyway (and the sweep holds it
    // queued), so polling it would only turn this card into a timeout.
    if (status === "approved") return true;
    if (
      status === "requested" ||
      status === "declined" ||
      status === "expired" ||
      status === "cancelled"
    ) {
      return false;
    }
  }
  return c.decision === null || c.decision === "pay";
}

/**
 * The wearable connection read on a claim panel, cachedOnly by construction
 * (its 401 retry included). It used to drop cachedOnly on that retry, so a
 * refused session token turned a page load into a wallet prompt. With no proof
 * held it answers auth-required and the panel offers the explained tap.
 */
export function readProviderOnLoad(
  address: `0x${string}`,
  requestAuth: WalletAuthRequester,
  window?: Parameters<typeof fetchProviderState>[2],
  metric?: string,
): ReturnType<typeof fetchProviderState> {
  return fetchProviderState(address, cachedOnlyRequester(requestAuth), window, metric);
}

/** Human-readable local time for the settlement moment. */
/** How the last Verify tap ended when it did not prove the wallet. */
function UnlockNote({ note }: { note: string | null }) {
  if (note === null) return null;
  return (
    <p className="m-0 text-sm leading-[1.45] text-muted" role="status">
      {note}
    </p>
  );
}

function formatLocalTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function WearableCheckInner({
  poolId,
  goalSpec,
  onSwitchToDocument,
  verdictShown = false,
}: {
  poolId: bigint;
  goalSpec: string;
  onSwitchToDocument?: () => void;
  verdictShown?: boolean;
}) {
  const { ready, authenticated, address, sessionProven } = useEmbeddedWallet();
  const requestAuth = useWalletAuth();
  // Every read this panel makes on its own (restore, resumed polls, the
  // deferred settle re-poll, the connection read) goes through this: a held
  // proof is used, a missing one is never asked for.
  const quietAuth = useMemo(() => cachedOnlyRequester(requestAuth), [requestAuth]);
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<CheckStatus>({ kind: "idle" });
  // A Verify tap in flight, and how the last one ended when it did not prove
  // the wallet (a no, a wallet error). Null otherwise.
  const [unlocking, setUnlocking] = useState(false);
  const [unlockNote, setUnlockNote] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  // Set only when the browser blocked the connect popup: the real Junction
  // Link URL, rendered as a link the user taps directly (a true gesture is
  // never blocked). Null the rest of the time.
  const [connectFallbackUrl, setConnectFallbackUrl] = useState<string | null>(
    null,
  );
  // An Apple wallet pairs from the iPhone app, not a page: the link route
  // answers with a one-time code, rendered as the same pairing card the
  // character step shows. Guidance, not an error. Null the rest of the time.
  const [phoneSteps, setPhoneSteps] = useState<PhoneSteps | null>(null);
  // Which wallet address the ledger restore last completed for. Until it
  // matches the connected address the UI shows a loading state rather than an
  // idle box (a lie for anyone whose claim already ran) or the previous
  // wallet's claim state (worse: a wrong money screen).
  const [restoredFor, setRestoredFor] = useState<string | null>(null);

  // Claim identity shared across the run, the mount restore, and the deferred
  // settle re-poll. Refs, not state: they identify the in-flight attempt for
  // background work and never drive a render by themselves.
  const goalIdRef = useRef<string | null>(null);
  const repollDoneRef = useRef(false);
  // What the receipt currently shows. A poll loop starts from this rather than
  // from nothing, so a failure on its FIRST request (a resumed claim, or the
  // deferred-settle re-poll firing before the chain is ready) still renders
  // the rows the user already has.
  const screenRef = useRef<ClaimScreen>(emptyClaimScreen());
  // Poll-loop generation counter. Each new loop bumps it; a running loop stops
  // silently the moment it is superseded (fresh run, wallet switch, unmount)
  // so a stale loop can never overwrite a newer claim's screen. It also serves
  // as the re-entry guard a queued second tap would otherwise defeat.
  const runSeqRef = useRef(0);

  const readableGoal = displayGoalSpec(goalSpec);

  // The connection-status read resolves on its own and never opens a wallet
  // (readProviderOnLoad): a blocking prompt here once pinned the UI on
  // "Checking for a connected wearable" when it was dismissed. With no proof
  // held the route answers 401 and the explained "Sign and check" tap shows
  // instead of a spinner; the 401 retry stays cachedOnly too.


  // Stop any in-flight poll loop on unmount.
  useEffect(() => {
    const seqRef = runSeqRef;
    return () => {
      seqRef.current++;
    };
  }, []);

  /**
   * Drive SPOTTER's run loop. Every poll resumes it where it stopped and, for
   * the wallet that owns the claim, returns the full ledger (one cached
   * signature covers the session, so this never prompts per tick); the receipt
   * renders it verbatim. No attester id:
   * SPOTTER fetches the wearable summary itself, server-side, and derives the
   * claim's ref from the pool period on the chain.
   *
   * `prompt`: the player tapped to start this check, so its first request may
   * ask for the proof (explained in the page before the wallet opens). Every
   * other request, and every loop nobody tapped for (a resumed claim, the
   * settle re-poll), reads cachedOnly: the run never needs a signature to
   * progress, only to show its rows, so a lapsed proof hides rows rather than
   * opening a wallet mid-loop.
   */
  const pollRun = useCallback(
    async (goalId: string, prompt: boolean) => {
      if (address === null) return;
      const seq = ++runSeqRef.current;
      let last: RunStatus = "verifying";
      // Seeded from the screen, never from nothing: a failure on the first
      // request of a resumed run (or of the deferred settle re-poll) must not
      // blank a receipt that already lists money SPOTTER spent.
      let screen = screenRef.current;
      let seen: ClaimMark | null = null;
      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        let body: RunResponse;
        try {
          const sent = await fetchWithWalletAuth(
            `/api/agent/run/${goalId}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                poolId: poolId.toString(),
                address,
                goalSpec,
                evidenceKind: "wearable",
              }),
            },
            prompt && attempt === 0 ? requestAuth : quietAuth,
          );
          body = (await sent.response.json().catch(() => ({}))) as RunResponse;
          if (!sent.response.ok) {
            throw new Error(
              body.error ??
                "SPOTTER could not start the check. Nothing was charged. Try again in a moment.",
            );
          }
          screen = nextClaimScreen(screen, body, sent.auth);
          screenRef.current = screen;
        } catch (err) {
          if (runSeqRef.current !== seq) return;
          setStatus({
            kind: "error",
            message:
              err instanceof Error
                ? err.message
                : "SPOTTER could not start the check. Nothing was charged. Try again in a moment.",
            ledger: receiptToKeep(screen),
          });
          return;
        }

        if (runSeqRef.current !== seq) return;

        if (body.status === undefined) {
          setStatus({
            kind: "error",
            message: "SPOTTER returned an unexpected response.",
            ledger: receiptToKeep(screen),
          });
          return;
        }

        last = body.status;
        setStatus({
          kind: "agent",
          runStatus: last,
          ledger: screen.ledger,
          lockedReason: screen.lockedReason,
        });
        // The verdict card reads the ledger on its own query, which stops at
        // a no-pay. Without this nudge a check run again from here printed a
        // verified read and a World ID ask in the receipt while the card kept
        // saying it could not get a clean read, with no confirm button.
        const mark = { status: last, length: screen.ledger.length };
        if (claimMoved(seen, mark)) {
          void queryClient.invalidateQueries({ queryKey: ["claim-ledger"] });
        }
        seen = mark;

        if (TERMINAL.includes(last)) {
          if (last === "recorded") {
            await queryClient.invalidateQueries({ queryKey: ["pool"] });
            await queryClient.invalidateQueries({ queryKey: ["participant"] });
          }
          if (last === "paid") {
            // Refresh the participant only. Refetching the pool here flips it
            // to settled and unmounts this component mid-payout-moment; the
            // pool page's polling interval reconciles the phase shortly after.
            await queryClient.invalidateQueries({ queryKey: ["participant"] });
          }
          return;
        }
        await sleep(POLL_INTERVAL_MS);
      }

      if (runSeqRef.current !== seq) return;
      // Exhausted polls without a terminal status. Keep whatever the ledger
      // already shows - spends that happened must not vanish from the screen.
      setStatus({
        kind: "error",
        message:
          "Verification is taking longer than expected. Nothing is lost. Your claim is saved, and this page picks it up where it left off.",
        ledger: receiptToKeep(screen),
      });
    },
    [address, poolId, goalSpec, queryClient, requestAuth, quietAuth],
  );

  // Restore on mount and on wallet change: once the wallet resolves, derive
  // the goal id the same way a run does and fetch any existing ledger, so a
  // returning user sees their receipt and its terminal state instead of the
  // connect box. Keyed to the address so switching wallets restores the new
  // wallet's claim rather than keeping the previous one on screen.
  useEffect(() => {
    if (!ready || address === null || restoredFor === address) return;
    // Supersede any poll loop still running for a previous wallet before this
    // wallet's state loads; pollRun below starts a fresh generation.
    runSeqRef.current++;
    let cancelled = false;
    void (async () => {
      try {
        const goalId = await fetchGoalId(poolId, address);
        const read = await readClaimOnLoad(goalId, poolId, requestAuth);
        const { visibility } = read;
        if (cancelled) return;
        goalIdRef.current = goalId;
        repollDoneRef.current = false;
        setRestoredFor(address);
        if (visibility.kind === "locked") {
          // A claim exists and is being withheld. The connect box here would
          // read as "nothing has happened", which is the opposite of true.
          screenRef.current = emptyClaimScreen();
          setStatus({ kind: "locked", reason: visibility.reason });
          // Still mid-run and private only for want of a proof: SPOTTER keeps
          // working with quiet polls (rows hidden, "Sign and show the rows"
          // offered), so nothing waits on a tap the system can do without.
          if (read.resume) void pollRun(goalId, false);
          return;
        }
        if (visibility.kind === "none") {
          screenRef.current = emptyClaimScreen();
          setStatus({ kind: "idle" });
          return;
        }
        const ledger = visibility.ledger;
        // The poll loop and every error screen read from here, so the rows
        // survive a failure on the resumed run's very first request.
        screenRef.current = claimScreenOf(ledger);
        const runStatus = runStatusFromLedger(ledger) ?? "verifying";
        setStatus({ kind: "agent", runStatus, ledger, lockedReason: null });
        // A run waiting on the player's World ID OK resumes too: the poll after
        // the approval lands is what records the result.
        if (runStatus === "verifying" || runStatus === "awaiting-approval") {
          void pollRun(goalId, false);
        }
      } catch (err) {
        // Restore is a read-only convenience; a failed read must not block a
        // fresh run. Logged so it is never silent.
        console.error("[claim] could not restore the existing ledger:", err);
        if (!cancelled) {
          setRestoredFor(address);
          setStatus({ kind: "idle" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, address, poolId, restoredFor, pollRun, requestAuth]);

  /** The explained tap on a withheld claim: the one wallet proof
   *  (lib/session-proof.ts; the reason on screen is the explanation, so the
   *  wallet opens with no second question), then the restore re-runs under
   *  it. A no stays on the withheld screen with the plain reason, never a
   *  loop. Every other wallet-gated card on the page re-reads too. */
  const unlockClaim = () => {
    void (async () => {
      setUnlocking(true);
      setUnlockNote(null);
      try {
        const note = await runVerifyWallet({
          address,
          requestAuth,
          invalidate: (root) => queryClient.invalidateQueries({ queryKey: [root] }),
        });
        if (note !== null) {
          setUnlockNote(note);
          return;
        }
        setRestoredFor(null);
      } finally {
        setUnlocking(false);
      }
    })();
  };

  // A session proof that lands while this claim waits on one (the explained
  // sheet after a connect, a Verify tap on another card) re-reads it with no
  // tap here. Transition-only, so a proof the server refused cannot loop.
  const waitingOnProof =
    !unlocking &&
    (status.kind === "locked" ||
      (status.kind === "agent" && status.lockedReason !== null));
  const proofSeen = useRef<boolean | null>(null);
  useEffect(() => {
    const step = proofLandedWhileWaiting(proofSeen.current, waitingOnProof, sessionProven);
    proofSeen.current = step.seen;
    // A one-shot re-read on an external change: the session proof landing.
    if (step.proceed) setRestoredFor(null);
  }, [waitingOnProof, sessionProven]);

  // Deferred settlement: the settle entry may carry its own periodEndIso;
  // otherwise read periodEnd from the pool itself. The query key matches
  // PoolDetail's, so this is usually served from cache.
  const poolQuery = useQuery({
    queryKey: ["pool", poolId.toString()],
    queryFn: () => fetchPool(poolId),
    // Also kept enabled on "paid" so PayoutMoment can read the pool's bounty
    // model (self-staked pools describe the payout as stake-back + forfeits).
    // Shares PoolDetail's cache key, so this is usually served without a fetch.
    enabled:
      status.kind === "agent" &&
      (status.runStatus === "recorded" ||
        status.runStatus === "paid" ||
        status.runStatus === "no-pay" ||
        status.runStatus === "missed"),
  });

  // The metric THIS pool is scored on, so the readiness read is about the goal
  // in front of the person rather than about sleep.
  //
  // Without it this panel asked the sleep-streak feed, and a wallet with no
  // sleep data - a phone with no watch, a step-only tracker - came back
  // "awaiting first sync" forever. The awaiting branch sits above the run
  // button, so the claim could never be started, on a pool whose entry fee had
  // already been paid and whose steps had already synced. The verdict path
  // would have verified them; they simply could not reach it.
  const goalMetric = classifyWearableGoal(goalSpec).metric;

  // The pool's own period, which the metric-scoped read is bounded by. Not
  // available until the pool loads, so the read waits rather than asking about
  // sleep in the meantime and caching a wrong answer.
  const poolWindow =
    poolQuery.data !== undefined
      ? {
          periodStart: poolQuery.data.periodStart,
          periodEnd: poolQuery.data.periodEnd,
        }
      : undefined;

  const providerQuery = useQuery({
    // Keyed by metric as well: a sleep answer must not stand in for a steps
    // question just because it is cached under the same address.
    queryKey: providerQueryKey(address, poolId, goalMetric ?? undefined),
    queryFn: () => {
      if (address === null) throw new Error("No wallet connected.");
      return readProviderOnLoad(
        address,
        requestAuth,
        poolWindow,
        goalMetric ?? undefined,
      );
    },
    enabled: address !== null && poolWindow !== undefined,
    retry: false,
  });
  const periodEndMs =
    status.kind === "agent" && status.runStatus === "recorded"
      ? deferredPeriodEndMs(
          status.ledger,
          poolQuery.data !== undefined ? Number(poolQuery.data.periodEnd) : null,
        )
      : null;

  // Schedule exactly one automatic re-poll shortly after the period ends, so
  // the payout appears without any human action. The run route settles in-line
  // on that poll; repollDoneRef keeps this to a single shot even if the chain
  // is not quite ready when it fires. Gated on the restore being current for
  // the connected address: during a wallet switch the cleanup disarms the
  // previous wallet's timer and nothing re-arms until the new wallet loads.
  useEffect(() => {
    if (!ready || address === null || restoredFor !== address) return;
    if (status.kind !== "agent" || status.runStatus !== "recorded") return;
    if (repollDoneRef.current || periodEndMs === null) return;
    const goalId = goalIdRef.current;
    if (goalId === null) return;
    const timer = setTimeout(() => {
      repollDoneRef.current = true;
      void pollRun(goalId, false);
    }, settleRepollDelayMs(periodEndMs, Date.now()));
    return () => clearTimeout(timer);
  }, [ready, address, restoredFor, status, periodEndMs, pollRun]);

  const run = async () => {
    if (address === null) return;
    // The claim's ledger is keyed by the on-chain goal id. The restore already
    // read it from the contract; only fall back to a fresh read if it did not.
    setStatus({ kind: "starting" });
    let goalId = goalIdRef.current;
    if (goalId === null) {
      try {
        goalId = await fetchGoalId(poolId, address);
        goalIdRef.current = goalId;
      } catch {
        // The raw read error names contract plumbing; the player needs to
        // know it was a read and that nothing was spent.
        setStatus({
          kind: "error",
          message:
            "I could not read your entry from Base Sepolia just now. Nothing was charged. Try again in a moment.",
        });
        return;
      }
    }
    repollDoneRef.current = false;
    await pollRun(goalId, true);
  };

  // Loading gate, derived rather than stored: while the wallet SDK is still
  // booting, or a connected wallet's ledger has not been restored yet, any
  // other render would either flash the connect box over an existing claim or
  // show a previous wallet's money screen. Signed-out visitors have no ledger
  // to restore and fall through to the sign-in prompt.
  if (!ready || (address !== null && restoredFor !== address)) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-16" />
      </div>
    );
  }

  if (status.kind === "starting") {
    return (
      <div className="space-y-3" aria-busy="true">
        <h3 className="text-[1.0625rem] font-semibold text-balance">Handing it to SPOTTER</h3>
        <p className="text-sm text-muted">
          SPOTTER is reading your synced wearable summary on its server and
          checking it against the goal. Your raw health data stays server-side
          and never goes on-chain. Only the pass or fail verdict does.
        </p>
      </div>
    );
  }

  // A run that failed with rows already on screen. The receipt stays and the
  // connect box does not appear above it: this claim already bought its
  // verification, and inviting another run would spend the cap again. The
  // retry re-reads the claim rather than starting a new one.
  if (
    status.kind === "error" &&
    status.ledger !== undefined &&
    status.ledger.length > 0
  ) {
    return (
      <div className="space-y-4">
        <AgentReceipt ledger={status.ledger} evidenceKind="wearable" />
        <ErrorNote
          title="Lost contact with SPOTTER"
          detail={`${status.message} The receipt above is what already happened and nothing in it is lost.`}
          onRetry={() => setRestoredFor(null)}
        />
      </div>
    );
  }

  // A claim exists for this wallet and the server would not hand it over. The
  // connect box here would read as "nothing has happened" over a claim SPOTTER
  // already spent money on.
  if (status.kind === "locked") {
    return (
      <div className="space-y-3">
        <h3 className="text-[1.0625rem] font-semibold text-balance">This claim is private</h3>
        <div className="rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border)]">
          <p className="text-sm text-muted">{status.reason}</p>
        </div>
        {!authenticated || address === null ? (
          <SignInGate note="Sign in to see this claim.">
            {(openSignIn) => (
              <Button
                type="button"
                disabled={!ready}
                onClick={openSignIn}
                className="w-full"
              >
                Sign in to see this claim
              </Button>
            )}
          </SignInGate>
        ) : (
          <>
            <Button
              type="button"
              onClick={unlockClaim}
              disabled={unlocking}
              aria-busy={unlocking}
              className="w-full"
            >
              {unlocking ? "Waiting for your wallet" : "Sign and show my claim"}
            </Button>
            <UnlockNote note={unlockNote} />
          </>
        )}
      </div>
    );
  }

  if (status.kind === "agent") {
    const failureMode =
      status.runStatus === "no-pay" ? failureModeOf(status.ledger) : null;
    // On a run that can record a miss, SPOTTER's last look is periodEnd +
    // MISS_GRACE_HOURS; later syncs no longer count (lib/miss-grace.ts).
    const lastCheckMs =
      poolQuery.data !== undefined && missRulePool(poolQuery.data).ok
        ? missDeadlineMs(poolQuery.data.periodEnd)
        : null;
    // The latest a hit can be confirmed on such a run: it settles by then.
    const confirmByMs =
      poolQuery.data !== undefined && missRulePool(poolQuery.data).ok
        ? missConfirmByMs(poolQuery.data.periodEnd)
        : null;
    const missed = status.runStatus === "missed" ? missedScreenOf(status.ledger) : null;
    const missedCopy = missed !== null ? verdictCopy(missed) : null;
    // The contract records a late pass until the pool settles, so a miss is final only then.
    const poolClosed =
      poolQuery.data?.settled === true || poolQuery.data?.cancelled === true;
    const paid = status.ledger.find(
      (e) => e.kind === "settle" && e.status === "settled",
    );

    return (
      <div className="space-y-4">
        {!verdictShown &&
        status.runStatus === "paid" &&
        paid !== undefined &&
        paid.kind === "settle" &&
        paid.paidUsd !== undefined ? (
          <PayoutMoment
            paidUsd={toUsd2(paid.paidUsd)}
            txHash={paid.txHash ?? null}
            selfStaked={poolQuery.data?.bountyModel === 2}
          />
        ) : null}

        <AgentReceipt ledger={status.ledger} evidenceKind="wearable" />

        {/* The run keeps going without a signature; only the rows are held
         *  back. Saying so beats a receipt that silently stops printing. */}
        {status.lockedReason !== null ? (
          <div className="rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border)]">
            <p className="text-base font-semibold">
              The receipt is hidden, not stopped
            </p>
            <p className="mt-1 text-sm text-muted">
              {status.lockedReason} SPOTTER keeps working either way.
            </p>
            <Button
              type="button"
              onClick={unlockClaim}
              disabled={unlocking}
              aria-busy={unlocking}
              variant="ghost"
              className="mt-3 w-full"
            >
              {unlocking ? "Waiting for your wallet" : "Sign and show the rows"}
            </Button>
            <UnlockNote note={unlockNote} />
          </div>
        ) : null}

        {status.runStatus === "verifying" ? (
          <p className="text-sm text-muted" aria-live="polite">
            SPOTTER is working. The check updates on its own.
          </p>
        ) : null}

        {!verdictShown && status.runStatus === "recorded" ? (
          <div className="rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border)]">
            <p className="text-base font-semibold">
              Verified and recorded on-chain.
            </p>
            {periodEndMs !== null ? (
              <p className="mt-1 text-sm text-muted">
                SPOTTER settles the payout at {formatLocalTime(periodEndMs)} (
                <Countdown
                  periodStart={0n}
                  periodEnd={BigInt(Math.floor(periodEndMs / 1000))}
                />
                ). Leave this page open and the payout appears here on its own.
                Nothing more for you to do.
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted">
                SPOTTER settles the payout after the challenge ends, no
                human involved. Come back after it closes and the payout
                appears here.
              </p>
            )}
          </div>
        ) : null}

        {failureMode === "evidence" ? (
          <div className="space-y-3">
            {/* The verdict card above already says this; here it would be
                the same sentence twice. The buttons stay: they live here. */}
            {!verdictShown ? (
              <div className="rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border-strong)]">
                <p className="text-base font-semibold text-foreground">
                  SPOTTER could not get a clean read
                </p>
                <p className="mt-1 text-sm text-muted">
                  The data is the problem, not you, and a check costs you nothing.
                  Make sure your wearable is connected and has synced the period,
                  then check again.
                </p>
              </div>
            ) : null}
            <Button
              type="button"
              onClick={() => setStatus({ kind: "idle" })}
              variant="ghost"
              className="w-full"
            >
              Check again
            </Button>
            {onSwitchToDocument !== undefined ? (
              <Button
                type="button"
                onClick={onSwitchToDocument}
                variant="secondary"
                className="w-full"
              >
                Upload proof instead
              </Button>
            ) : null}
          </div>
        ) : null}

        {!verdictShown && missedCopy !== null ? (
          <div className="rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border)]">
            <p className="text-base font-semibold">{missedCopy.headline}.</p>
            <p className="mt-1 text-sm text-muted">{missedCopy.body}</p>
          </div>
        ) : null}

        {failureMode === "goal-missed" && !poolClosed ? (
          <div className="space-y-3">
            {!verdictShown ? (
              <div className="rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border)]">
                <p className="text-base font-semibold">Not there yet.</p>
                <p className="mt-1 text-sm text-muted">
                  The wearable data was read fine and the goal is not met so far.
                  {lastCheckMs !== null
                    ? ` Days inside the challenge still count if your wearable syncs them by ${formatLocalTime(lastCheckMs)}. After that, SPOTTER records a miss on its own when your wearable covered the whole challenge and shows it; if it did not sync the whole challenge, nothing is recorded and your stake comes back. A hit only counts once you open the challenge and confirm it${confirmByMs !== null ? `, by ${formatLocalTime(confirmByMs)} at the latest` : " before it settles"}.`
                    : " Days inside the challenge still count if they sync before the challenge settles, so check again after your next sync."}
                </p>
              </div>
            ) : null}
            <Button
              type="button"
              onClick={() => setStatus({ kind: "idle" })}
              variant="ghost"
              className="w-full"
            >
              Check again
            </Button>
          </div>
        ) : null}
        {failureMode === "goal-missed" && poolClosed ? (
          <div className="rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border)]">
            <p className="text-base font-semibold">Not paid.</p>
            <p className="mt-1 text-sm text-muted">
              The wearable data was read fine. It does not show the goal being
              met. No miss was recorded on chain, so your stake comes back to
              you.
            </p>
          </div>
        ) : null}

        {!verdictShown && status.runStatus === "cap-exceeded" ? (
          <div className="rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border-strong)]">
            <p className="text-base font-semibold text-foreground">
              SPOTTER hit its spending cap and stopped
            </p>
            <p className="mt-1 text-sm text-muted">
              Every claim has a hard per-claim budget. This one reached
              it before a verdict landed, so no more money moves.
            </p>
          </div>
        ) : null}

        {status.runStatus === "blocked" ? (
          <div className="space-y-3">
            <div className="rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border-strong)]">
              <p className="text-base font-semibold text-foreground">
                Join the challenge first
              </p>
              <p className="mt-1 text-sm text-muted">
                This wallet is not a player in this challenge on-chain, so
                nothing can be recorded for it. Join the challenge, then check
                again.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => setStatus({ kind: "idle" })}
              variant="ghost"
              className="w-full"
            >
              Try again
            </Button>
          </div>
        ) : null}

        {status.runStatus === "error" ? (
          verdictShown ? (
            <Button
              type="button"
              onClick={() => setStatus({ kind: "idle" })}
              variant="ghost"
              className="w-full"
            >
              Have SPOTTER try again
            </Button>
          ) : (
            <ErrorNote
              title="The check hit a problem"
              detail="The receipt above shows where it stopped. Nothing was paid that the receipt does not show."
              onRetry={() => setStatus({ kind: "idle" })}
            />
          )
        ) : null}
      </div>
    );
  }

  const providerState = providerQuery.data;
  const providerDown = providerDownReason(providerState);
  const providerAuth = providerAuthReason(providerState);
  const connected = providerConnected(providerState);

  /** The explained tap when the wearable read came back 401: the device may
   *  well be connected, we just cannot look yet. The proof re-reads every
   *  wallet-gated query, this panel's connection read included. */
  const unlockProvider = () => {
    void (async () => {
      setUnlocking(true);
      setUnlockNote(null);
      try {
        const note = await runVerifyWallet({
          address,
          requestAuth,
          invalidate: (root) => queryClient.invalidateQueries({ queryKey: [root] }),
        });
        setUnlockNote(note);
        if (note === null) await providerQuery.refetch();
      } finally {
        setUnlocking(false);
      }
    })();
  };

  return (
    <div className="space-y-3">
      <WhoopReturnNote whoopConnected={connected} />
      <h3 className="text-[1.0625rem] font-semibold text-balance">Verify from your wearable</h3>
      <p className="text-sm text-muted">
        {readableGoal === ""
          ? "SPOTTER reads your synced wearable summary and pays if the data shows the goal."
          : `SPOTTER reads your synced wearable summary and pays if the data shows "${readableGoal}".`}
      </p>

      {/* Privacy line, scoped honestly to the wearable path. The document path
       *  runs inside the confidential enclave (lib/server/judge.ts); the
       *  wearable path does NOT - SPOTTER reads the Junction summary on its
       *  own server (lib/server/junction.ts + lib/server/agent/wearable.ts)
       *  and derives the verdict there. Raw samples never leave that server
       *  boundary and nothing but the pass/fail verdict and its confidence is
       *  written on-chain, but claiming a sealed enclave here would be a lie:
       *  the wearable summary transits the server. Say what is true. */}
      <p className="rounded-control bg-fill-quiet p-3 shadow-[inset_0_0_0_1px_var(--border)] text-xs text-muted">
        Where your wearable data goes: SPOTTER reads your synced summary on its
        server to check the goal. That is the wearable path, not the sealed
        enclave the document path uses. Your raw health data stays
        server-side, is never written on-chain, and is never shared. Only the
        verdict (pass or fail, with its confidence) is recorded on-chain.
      </p>

      {!authenticated || address === null ? (
        <SignInGate note="Sign in to have SPOTTER check.">
          {(openSignIn) => (
            <Button
              type="button"
              disabled={!ready}
              onClick={openSignIn}
              className="w-full"
            >
              Sign in to have SPOTTER check
            </Button>
          )}
        </SignInGate>
      ) : providerQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <p className="text-xs text-muted">Checking for a connected wearable</p>
        </div>
      ) : providerDown !== null ? (
        // Dead end removed: while the provider refuses us, connecting a device
        // cannot help and the connect call itself 502s. Say what is wrong and
        // hand over the proof path that still works.
        <div className="space-y-3">
          <div className="rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border-strong)]">
            <p className="text-base font-semibold text-foreground">
              Wearable verification is down right now
            </p>
            <p className="mt-1 text-sm text-muted">{providerDown}</p>
            <p className="mt-2 text-sm text-muted">
              This is on us, not on your device. Connecting one would not change
              it, so SPOTTER is not going to send you round that loop.
            </p>
          </div>
          {onSwitchToDocument !== undefined ? (
            <Button
              type="button"
              onClick={onSwitchToDocument}
              className="w-full"
            >
              Prove it with a document instead
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={() => {
              void providerQuery.refetch();
            }}
            variant="secondary"
            className="w-full"
          >
            Check the provider again
          </Button>
        </div>
      ) : providerAuth !== null ? (
        // Not an outage and not a missing device: the read is this wallet's
        // own health data and it has not been unlocked. Saying "no wearable
        // connected" here would send someone to re-link a device that is
        // already linked.
        <div className="space-y-3">
          <p className="rounded-control bg-fill-quiet p-3 shadow-[inset_0_0_0_1px_var(--border)] text-sm text-muted">
            {providerAuth}
          </p>
          <Button
            type="button"
            onClick={unlockProvider}
            disabled={unlocking}
            aria-busy={unlocking}
            className="w-full"
          >
            {unlocking ? "Waiting for your wallet" : "Sign and check my wearable"}
          </Button>
          <UnlockNote note={unlockNote} />
        </div>
      ) : providerMetricUnavailable(providerState) ? (
        // Syncing, and this device does not produce the number this goal is
        // scored on. Offering the run button would spend SPOTTER's money on a
        // read that cannot answer, and telling them to wait would be advice
        // that never comes true.
        <div className="space-y-3">
          <div className="rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border-strong)]">
            <p className="text-base font-semibold text-foreground">
              Your device does not measure this goal
            </p>
            <p className="mt-1 text-sm text-muted">
              It is syncing fine, it just does not report the number this challenge
              is scored on. That is the hardware, not a delay, so SPOTTER is
              not going to try a check that cannot come back with anything.
            </p>
            <p className="mt-2 text-sm text-muted">
              Connect a device that tracks it from your dashboard.
            </p>
          </div>
          {onSwitchToDocument !== undefined ? (
            <Button
              type="button"
              onClick={onSwitchToDocument}
              className="w-full"
            >
              Prove it with a document instead
            </Button>
          ) : null}
        </div>
      ) : providerAwaitingFirstSync(providerState) ? (
        // Linked and working, nothing delivered yet. Running the check here
        // would buy a read and return "0 days", which reads as a failure the
        // user did not earn. Every new user passes through this state.
        <div className="space-y-3">
          <div className="rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border)]">
            <p className="text-base font-semibold text-moonlight">
              Waiting on your first sync
            </p>
            <p className="mt-1 text-sm text-muted">
              Your device is connected and has not sent anything for this goal
              yet. The first sync usually lands within a few minutes. SPOTTER
              will not check this until the data is here, so nothing is charged
              while you wait.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => void providerQuery.refetch()}
            variant="secondary"
            className="w-full"
          >
            Check again
          </Button>
          {onSwitchToDocument !== undefined ? (
            <Button
              type="button"
              onClick={onSwitchToDocument}
              className="w-full"
            >
              Prove it with a document instead
            </Button>
          ) : null}
        </div>
      ) : !connected ? (
        <div className="space-y-3">
          <p className="rounded-control bg-fill-quiet p-3 shadow-[inset_0_0_0_1px_var(--border)] text-sm text-foreground">
            No wearable connected yet. Without one, SPOTTER has nothing to
            verify and will not pay. You can pick which device from the
            dashboard.
          </p>
          <Button
            type="button"
            onClick={() => {
              setConnectError(null);
              setConnectFallbackUrl(null);
              setPhoneSteps(null);
              // A same-tab OAuth (WHOOP) comes back to this pool, not the
              // dashboard, so the player lands where they were about to claim.
              void startWearableLink(
                address,
                requestAuth,
                undefined,
                currentReturnPath(),
              ).catch((err: unknown) => {
                if (err instanceof PopupBlockedError) {
                  // Not a failure - the URL is good, the browser just refused
                  // the auto-open. Offer a link the user taps directly.
                  setConnectFallbackUrl(err.linkUrl);
                  return;
                }
                if (err instanceof PhoneLinkRequiredError) {
                  // The wallet's provider is Apple: nothing opens here, the
                  // phone finishes it. The card below carries the code.
                  setPhoneSteps({
                    instructions: err.instructions,
                    pairing: err.pairing,
                    installUrl: err.installUrl,
                  });
                  return;
                }
                setConnectError(
                  "The pairing page would not open. Nothing was linked and nothing was charged. Try again in a moment.",
                );
              });
            }}
            className="w-full"
          >
            Connect a wearable
          </Button>
          {connectFallbackUrl !== null ? (
            <a
              href={connectFallbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setConnectFallbackUrl(null)}
              className={`${buttonClasses({ variant: "secondary" })} flex w-full text-center`}
            >
              Your browser blocked the popup. Tap here to connect
            </a>
          ) : null}
          {phoneSteps !== null ? (
            <PhonePairPanel steps={phoneSteps} address={address} />
          ) : null}
          <Button
            type="button"
            onClick={() => {
              void providerQuery.refetch();
            }}
            variant="secondary"
            className="w-full"
          >
            I connected it, check again
          </Button>
          {onSwitchToDocument !== undefined ? (
            <button
              type="button"
              onClick={onSwitchToDocument}
              className={`w-full rounded-xl text-muted hover:text-foreground ${TAP_TARGET}`}
            >
              Or upload a document instead
            </button>
          ) : null}
        </div>
      ) : (
        <Button
          type="button"
          disabled={!ready}
          onClick={() => {
            void run();
          }}
          className="w-full"
        >
          Have SPOTTER check my wearable
        </Button>
      )}

      {connectError !== null ? (
        <ErrorNote
          title="Could not start the connect flow"
          detail={connectError}
          onRetry={() => setConnectError(null)}
        />
      ) : null}

      {status.kind === "error" ? (
        <div className="space-y-3">
          {status.ledger !== undefined && status.ledger.length > 0 ? (
            <AgentReceipt ledger={status.ledger} evidenceKind="wearable" />
          ) : null}
          <ErrorNote
            title="Could not start the check"
            detail={status.message}
            onRetry={() => setStatus({ kind: "idle" })}
          />
        </div>
      ) : null}
    </div>
  );
}

export default function WearableCheck({
  poolId,
  goalSpec,
  onSwitchToDocument,
  verdictShown,
}: {
  poolId: bigint;
  goalSpec: string;
  /** Switches the pool page to the document proof path. Absent when the pool
   *  has no document tab to switch to. */
  onSwitchToDocument?: () => void;
  /** The Verdict screen above says what this run's state means, so this
   *  panel keeps the receipt, the polling and the buttons, and drops the
   *  status paragraphs that would say it twice. */
  verdictShown?: boolean;
}) {
  if (!DYNAMIC_CONFIGURED) {
    return (
      <p className="rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border)] text-sm text-muted">
        Sign-in is not switched on for this build, so SPOTTER has no wallet to
        check a wearable for.
      </p>
    );
  }
  return (
    <WearableCheckInner
      poolId={poolId}
      goalSpec={goalSpec}
      onSwitchToDocument={onSwitchToDocument}
      verdictShown={verdictShown}
    />
  );
}
