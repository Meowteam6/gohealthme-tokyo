"use client";

// World ID for Agents (ETHGlobal Tokyo 2026): the boss moment. SPOTTER has
// decided to pay and, before any USDC moves, asks the achiever, the human,
// for a fresh World ID confirmation. This card is that ask.
//
// Lane contract (docs/LANES.md): { goalId, poolId, address, onResult }. Mounted
// by the claim screens when the run reports "awaiting-approval" (and the
// three refusal states); never edited by the UX lane.
//
// WHAT IT DOES. On mount it READS GET /api/agent/approval/status first and
// adopts a finished answer as-is (a reload never undoes a "not now"); only a
// pending or missing request is picked up through
// POST /api/agent/approval/request, which answers 409 "settled" once the run
// settled. "Ask SPOTTER again" is the only thing that opens a fresh attempt.
// It runs the fresh verification, completes it
// through POST /api/agent/approval/complete, polls GET /api/agent/approval/
// status, shows the countdown to expiry, and calls onResult ONCE per request
// with the outcome. Declined and expired are real screens with "ask again";
// cancelled (the pool settled first) is a real screen with no retry, because
// none would work.
//
// WHAT THE CONFIRMATION MEANS. That this human wants this payout. It does not
// re-check the goal; the wearable read and SPOTTER's verdict already did. In
// event mode the proof is mocked and the card says so; in world mode the
// widget talks to World App and the server re-verifies the result.
//
// Every server call carries the wallet proof (lib/client-auth.ts), so a
// stranger holding a goalId or a requestId can neither open nor answer the
// ask. The proof only shows the wallet is yours; no transaction is sent.
//
// NEVER A WALLET ON MOUNT. The mount read (loadApproval) is cachedOnly, its
// 401 retry included. With a held proof (a Dynamic session token, or a
// signature already collected this session) the ask opens as before. Without
// one the card shows the explained Verify wallet step, and the tap is what
// opens the wallet; a session proof landing elsewhere (the sheet after a
// connect) opens the ask with no tap at all. The World ID confirm stays.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useQueryClient } from "@tanstack/react-query";
import {
  authBlockReason,
  cachedOnlyRequester,
  fetchWithWalletAuth,
  type ClientAuth,
  type WalletAuthRequester,
} from "@/lib/client-auth";
import { useWalletAuth } from "@/lib/useWalletAuth";
import { useEmbeddedWallet } from "@/lib/wallet";
import { proofLineFor, runVerifyWallet, verifyOutcomeLine } from "@/lib/session-proof";
import {
  formatCountdown,
  mockApprovalProof,
  mountActionFor,
  outcomeCopy,
  SETTLED_CODE,
  parseOpenRequest,
  parseStatus,
  secondsLeft,
  type ApprovalOutcome,
  type OpenApprovalRequest,
} from "@/lib/world/approval-client";
import {
  shouldFallBackToLegacy,
  type WorldRequestStage,
} from "@/lib/world/credentials";
import { idkitErrorView } from "@/lib/world/idkit-errors";
import { Button, Fine } from "@/components/ui";

export type { ApprovalOutcome };

export interface HumanApprovalCardProps {
  goalId: string;
  poolId: string;
  address: string;
  onResult: (outcome: ApprovalOutcome) => void;
}

const WorldApprovalWidget = dynamic(
  () => import("@/components/world/WorldApprovalWidget"),
  { ssr: false },
);

/** app/api/agent/approval/request answers 409 with this code for a wallet
 *  paid on the verdict (approval.ts payoutConfirmFor). */
const ON_VERDICT_CODE = "on-verdict";

const STATUS_POLL_MS = 2_000;
const COUNTDOWN_TICK_MS = 500;

export type ApprovalCardState =
  | { kind: "asking" }
  /** No wallet proof is held this session, so the ask cannot open yet. The
   *  card explains the one free signature and waits for a tap; never a wallet
   *  on mount. `note` is how the last tap ended (a no, a wallet error), or
   *  null when nobody has tapped. */
  | { kind: "verify"; note: string | null }
  | { kind: "pending"; request: OpenApprovalRequest; error: string | null }
  | { kind: "verifying"; request: OpenApprovalRequest }
  | { kind: "done"; outcome: ApprovalOutcome; requestId: string | null }
  /** The request route answered 409 "settled": the run settled before any
   *  answer, so there is nothing to confirm and nothing to retry. */
  | { kind: "settled" }
  /** The ask could not be opened or answered: no signature, a misconfigured
   *  deployment, or a network fault. Retryable unless the server said the
   *  step is not enabled here at all. `retryLoad` re-reads the status first
   *  instead of opening a request, for a failure of the mount-time read. */
  | {
      kind: "blocked";
      message: string;
      retry: boolean;
      needsSignature: boolean;
      retryLoad?: boolean;
      /** The request route answered 409 "on-verdict": an admin or approved
       *  list player, paid on the verdict with no World ID confirm. Nothing
       *  is broken, so the card never says payouts wait on a fix. */
      onVerdict?: true;
    };

type CardState = ApprovalCardState;

type WorldRequest = OpenApprovalRequest & {
  world: NonNullable<OpenApprovalRequest["world"]>;
};

function isWorldRequest(request: OpenApprovalRequest): request is WorldRequest {
  return request.provider === "world" && request.world !== undefined;
}

/** Where an auth attempt that produced no proof leaves the card. Nothing
 *  connected is a blocked card; everything else (no proof held yet, a no, a
 *  wallet error) is the explained Verify wallet step, never a cold retry. */
function authBlock(auth: ClientAuth): CardState {
  if (auth.kind === "no-wallet") {
    return {
      kind: "blocked",
      message:
        authBlockReason(auth) ??
        "Sign in with the wallet that made this claim to answer SPOTTER.",
      retry: true,
      needsSignature: false,
    };
  }
  return { kind: "verify", note: auth.kind === "unsigned" ? null : verifyOutcomeLine(auth) };
}

async function readError(
  response: Response,
): Promise<{ message: string; code: string | null }> {
  try {
    const body = (await response.json()) as { error?: unknown; code?: unknown };
    const code = typeof body.code === "string" ? body.code : null;
    if (typeof body.error === "string" && body.error !== "") {
      return { message: body.error, code };
    }
    return { message: "SPOTTER's confirmation step did not answer cleanly. Try again in a moment.", code };
  } catch {
    return { message: "SPOTTER's confirmation step did not answer cleanly. Try again in a moment.", code: null };
  }
}

const STATUS_URL = (goalId: string) =>
  `/api/agent/approval/status?goalId=${encodeURIComponent(goalId)}`;

/**
 * Open, or pick up, the request. Idempotent server-side: SPOTTER's own ask
 * (from the run loop) comes back here with what the browser needs. Returns the
 * next card state and touches nothing else.
 *
 * The proof is settled before anything is sent: with none to attach, the
 * request route could only answer 401, so the card goes straight to its
 * Verify wallet step. A cachedOnly requester therefore never prompts here and
 * never sends an unsigned request; a prompting one asks (explained by the
 * sheet) only because a tap called for it.
 */
export async function openApprovalRequest(
  goalId: string,
  requestAuth: WalletAuthRequester,
  fetchImpl: typeof fetch = fetch,
): Promise<ApprovalCardState> {
  const held = await requestAuth();
  if (held.kind !== "ok") return authBlock(held);
  const sent = await fetchWithWalletAuth(
    "/api/agent/approval/request",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goalId }),
    },
    requestAuth,
    fetchImpl,
  );
  if (sent.auth.kind !== "ok") return authBlock(sent.auth);
  const { response } = sent;
  if (!response.ok) {
    const { message, code } = await readError(response);
    // The run settled first: a terminal fact, not an error to retry.
    if (response.status === 409 && code === SETTLED_CODE) return { kind: "settled" };
    // Paid on the verdict (request route, ON_VERDICT_MESSAGE): no ask exists
    // and none is needed; the run records the result without one.
    if (response.status === 409 && code === ON_VERDICT_CODE) {
      return { kind: "blocked", message, retry: false, needsSignature: false, onVerdict: true };
    }
    return {
      kind: "blocked",
      message,
      // 409 "not enabled" and 503 "not configured" are deployment facts;
      // retrying changes nothing. Everything else is worth another try.
      retry: response.status !== 409 && response.status !== 503,
      needsSignature: response.status === 401,
    };
  }
  const request = parseOpenRequest(await response.json().catch(() => null));
  if (request === null) {
    return {
      kind: "blocked",
      message:
        "SPOTTER's approval service answered in a shape this app cannot read.",
      retry: true,
      needsSignature: false,
    };
  }
  if (request.status !== "pending") {
    return { kind: "done", outcome: request.status, requestId: request.requestId };
  }
  return { kind: "pending", request, error: null };
}

/**
 * The mount read: where the confirmation stands, before anything else. A
 * finished answer is adopted, never re-asked (mountActionFor); only a pending
 * request or a missing one is picked up with the idempotent POST.
 *
 * Quiet by construction: whatever requester it is handed, the pick-up reads
 * cached credentials only, its 401 retry included, so mounting the card can
 * never open a wallet. No proof held means the Verify wallet step.
 */
export async function loadApproval(
  goalId: string,
  requestAuth: WalletAuthRequester,
  fetchImpl: typeof fetch = fetch,
): Promise<ApprovalCardState> {
  let status: ReturnType<typeof parseStatus>;
  try {
    const response = await fetchImpl(STATUS_URL(goalId), { cache: "no-store" });
    if (!response.ok) {
      const { message } = await readError(response);
      return {
        kind: "blocked",
        message,
        retry: response.status !== 503,
        needsSignature: false,
        retryLoad: true,
      };
    }
    status = parseStatus(await response.json().catch(() => null));
  } catch {
    status = null;
  }
  if (status === null) {
    return {
      kind: "blocked",
      message: "I could not check where your confirmation stands just now. Nothing moved.",
      retry: true,
      needsSignature: false,
      retryLoad: true,
    };
  }
  if (mountActionFor(status.status) === "adopt" && status.status !== "none" && status.status !== "pending") {
    return { kind: "done", outcome: status.status, requestId: status.requestId ?? null };
  }
  return openApprovalRequest(goalId, cachedOnlyRequester(requestAuth), fetchImpl);
}

/**
 * Whether a session proof just landed for a surface that is waiting on one.
 * `seen` is what the last call returned: null when the surface was not
 * waiting, else whether the wallet was proven then. Fires only on a
 * not-proven to proven change during one wait, so a wallet that was already
 * proven when the wait began (the server refused that proof) never loops.
 * Shared with the claim surfaces (WearableCheck, EvidenceUpload).
 */
export function proofLandedWhileWaiting(
  seen: boolean | null,
  waiting: boolean,
  proven: boolean,
): { seen: boolean | null; proceed: boolean } {
  if (!waiting) return { seen: null, proceed: false };
  return { seen: proven, proceed: seen === false && proven };
}

export default function HumanApprovalCard(props: HumanApprovalCardProps) {
  // props.address is not used as the proof signal any more: the server hands
  // back `signal` (`<goalId>:<attempt>`), which binds the proof to the payout.
  const { goalId, onResult } = props;
  const requestAuth = useWalletAuth();
  const quietAuth = useMemo(() => cachedOnlyRequester(requestAuth), [requestAuth]);
  const { address, sessionProven, sessionProofPossible } = useEmbeddedWallet();
  const queryClient = useQueryClient();
  const [state, setState] = useState<CardState>({ kind: "asking" });
  const [provingWallet, setProvingWallet] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [widgetOpen, setWidgetOpen] = useState(false);
  // "v4" asks for any World ID 4.0 credential; "legacy" is the 3.0 request,
  // opened only when World App says 4.0 is not available on this account
  // (lib/world/credentials.ts, the same policy prove-human uses).
  const [stage, setStage] = useState<WorldRequestStage>("v4");
  /** onResult fires once per request id, so "ask again" can report anew. */
  const reportedFor = useRef<string | null | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const finish = useCallback(
    (outcome: ApprovalOutcome, requestId: string | null) => {
      if (!mounted.current) return;
      setState({ kind: "done", outcome, requestId });
    },
    [],
  );

  // Open, or pick up, the request (openApprovalRequest). Taps pass the
  // prompting requester, explained by the sheet before any wallet opens.
  const openRequest = useCallback(
    (): Promise<CardState> => openApprovalRequest(goalId, requestAuth),
    [goalId, requestAuth],
  );

  // The same open, cachedOnly: what a proof landing elsewhere, or a Verify
  // tap that already collected the proof, continues with.
  const openQuietly = useCallback(
    (): Promise<CardState> => openApprovalRequest(goalId, quietAuth),
    [goalId, quietAuth],
  );

  /** Button-driven re-ask: shows the asking state, then whatever comes back. */
  const ask = useCallback(() => {
    setState({ kind: "asking" });
    void openRequest().then((next) => {
      if (mounted.current) setState(next);
    });
  }, [openRequest]);

  // Mount: READ where the confirmation stands before anything else
  // (loadApproval). Quiet by construction: a mount never opens a wallet.
  const load = useCallback(
    (): Promise<CardState> => loadApproval(goalId, requestAuth),
    [goalId, requestAuth],
  );

  const reload = useCallback(() => {
    setState({ kind: "asking" });
    void load().then((next) => {
      if (mounted.current) setState(next);
    });
  }, [load]);

  // The initial state is already "asking", so nothing is set synchronously
  // here; the result lands when the read answers.
  useEffect(() => {
    let alive = true;
    void load().then((next) => {
      if (alive && mounted.current) setState(next);
    });
    return () => {
      alive = false;
    };
  }, [load]);

  // Report each terminal outcome exactly once per request id.
  useEffect(() => {
    if (state.kind === "settled") {
      if (reportedFor.current === SETTLED_CODE) return;
      reportedFor.current = SETTLED_CODE;
      onResult("cancelled");
      return;
    }
    if (state.kind !== "done") return;
    if (reportedFor.current === state.requestId) return;
    reportedFor.current = state.requestId;
    onResult(state.outcome);
  }, [state, onResult]);

  // Countdown tick while a request is open.
  useEffect(() => {
    if (state.kind !== "pending" && state.kind !== "verifying") return;
    const id = window.setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
    return () => window.clearInterval(id);
  }, [state.kind]);

  // Poll the machine state while pending: the server is the clock for expiry
  // and the only place the answer is validated, so the card never decides an
  // outcome on its own.
  useEffect(() => {
    if (state.kind !== "pending") return;
    const { requestId } = state.request;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(STATUS_URL(goalId), { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const status = parseStatus(await response.json().catch(() => null));
        if (status === null || cancelled) return;
        if (status.status === "none" || status.status === "pending") return;
        if (status.requestId !== undefined && status.requestId !== requestId) return;
        finish(status.status, status.requestId ?? requestId);
      } catch {
        // A missed poll is not an outcome; the next tick tries again.
      }
    };
    const id = window.setInterval(() => void poll(), STATUS_POLL_MS);
    // An expiry the countdown already reached deserves an immediate check.
    if (secondsLeft(state.request.expiresAt, Date.now()) === 0) void poll();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [state, goalId, finish]);

  const complete = useCallback(
    async (
      request: OpenApprovalRequest,
      body: { proof: unknown } | { decline: true },
    ): Promise<{ ok: true } | { ok: false; message: string; fatal: boolean }> => {
      const sent = await fetchWithWalletAuth(
        "/api/agent/approval/complete",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ requestId: request.requestId, ...body }),
        },
        requestAuth,
      );
      if (sent.auth.kind !== "ok") {
        return {
          ok: false,
          message:
            authBlockReason(sent.auth) ??
            "Sign with the wallet that made this claim to answer SPOTTER.",
          fatal: true,
        };
      }
      const { response } = sent;
      if (response.ok) {
        const data = (await response.json().catch(() => null)) as {
          status?: unknown;
        } | null;
        const status = data?.status;
        if (
          status === "approved" ||
          status === "declined" ||
          status === "expired" ||
          status === "cancelled"
        ) {
          finish(status, request.requestId);
          return { ok: true };
        }
        return {
          ok: false,
          message: "SPOTTER's approval service answered in a shape this app cannot read.",
          fatal: false,
        };
      }
      const { message } = await readError(response);
      // 401 with status pending is "proof refused, try again"; a 409 means the
      // request was superseded or the state moved on; 403/404 are dead ends.
      if (response.status === 401) {
        return { ok: false, message, fatal: false };
      }
      return { ok: false, message, fatal: true };
    },
    [requestAuth, finish],
  );

  const approveMock = useCallback(async () => {
    if (state.kind !== "pending") return;
    const { request } = state;
    setState({ kind: "verifying", request });
    const result = await complete(request, {
      proof: mockApprovalProof(request.action, request.signal),
    });
    if (!mounted.current || result.ok) return;
    if (result.fatal) {
      // The state may have moved on server-side; READ where it is. Never a
      // fresh POST here: that would open a new attempt nobody asked for.
      reload();
      return;
    }
    setState({ kind: "pending", request, error: result.message });
  }, [state, complete, reload]);

  const decline = useCallback(async () => {
    if (state.kind !== "pending") return;
    const { request } = state;
    setState({ kind: "verifying", request });
    const result = await complete(request, { decline: true });
    if (!mounted.current || result.ok) return;
    if (result.fatal) {
      reload();
      return;
    }
    setState({ kind: "pending", request, error: result.message });
  }, [state, complete, reload]);

  // World mode: the widget calls this with the untouched IDKitResult; a throw
  // is what keeps the widget on its error screen, retryable.
  const verifyWorld = useCallback(
    async (proof: unknown) => {
      if (state.kind !== "pending") throw new Error("no request is open");
      const result = await complete(state.request, { proof });
      if (!result.ok) throw new Error(result.message);
    },
    [state, complete],
  );

  // World App answered the widget with an error code. A 4.0-unavailable
  // account falls over to the legacy request with a fresh rp_context (the
  // pending request is re-read, which re-signs it); anything else is shown.
  const onWorldError = useCallback(
    (code: string) => {
      if (state.kind !== "pending") return;
      const { request } = state;
      if (
        shouldFallBackToLegacy(code, stage, request.world?.allowLegacyProofs === true)
      ) {
        setWidgetOpen(false);
        setStage("legacy");
        void openRequest().then((next) => {
          if (!mounted.current) return;
          setState(next);
          if (next.kind === "pending") setWidgetOpen(true);
        });
        return;
      }
      const view = idkitErrorView(code);
      setState({
        kind: "pending",
        request,
        error: view.cancelled ? view.title : `${view.title} ${view.detail}`,
      });
    },
    [state, stage, openRequest],
  );

  // The server refused a proof the tab held: a fresh one, on a tap whose
  // reason is on screen, so the wallet opens with no second question.
  const retrySignature = useCallback(async () => {
    await requestAuth({ refresh: true, confirmed: true });
    reload();
  }, [requestAuth, reload]);

  /** The Verify wallet tap: the one explained proof (lib/session-proof.ts),
   *  then the ask opens with the proof now held. A no stays on this step with
   *  the plain reason and a way back, never a loop. */
  const verifyWallet = useCallback(async () => {
    setProvingWallet(true);
    try {
      const note = await runVerifyWallet({
        address,
        requestAuth,
        invalidate: (root) => queryClient.invalidateQueries({ queryKey: [root] }),
      });
      if (!mounted.current) return;
      if (note !== null) {
        setState({ kind: "verify", note });
        return;
      }
      setState({ kind: "asking" });
      const next = await openQuietly();
      if (mounted.current) setState(next);
    } finally {
      if (mounted.current) setProvingWallet(false);
    }
  }, [address, requestAuth, queryClient, openQuietly]);

  // A session proof that lands while the card waits on one (the explained
  // sheet after a connect, a Verify tap on another card) opens the ask with
  // no tap here. Transition-only, so a proof the server refused cannot loop.
  const proofSeen = useRef<boolean | null>(null);
  useEffect(() => {
    const step = proofLandedWhileWaiting(
      proofSeen.current,
      state.kind === "verify" && !provingWallet,
      sessionProven,
    );
    proofSeen.current = step.seen;
    if (!step.proceed) return;
    // The step stays on screen for the moment the open takes; nothing is set
    // synchronously here.
    void openQuietly().then((next) => {
      if (mounted.current) setState(next);
    });
  }, [state.kind, provingWallet, sessionProven, openQuietly]);

  // ------------------------------------------------------------- rendering
  // The card sits inside the Verdict, under its headline, so it carries no
  // frame of its own: the actions, the countdown and one line of small print.

  if (state.kind === "asking") {
    return (
      <div data-lane="world-agents" aria-busy="true" className={QUIET_WELL}>
        <p className="m-0 flex items-center gap-3 text-[0.9375rem] text-muted">
          <span
            aria-hidden="true"
            className="animate-night-spin size-[18px] flex-none rounded-full border-2 border-moonlight/25 border-t-moonlight"
          />
          Opening the World ID request. Nothing moves before you answer.
        </p>
      </div>
    );
  }

  if (state.kind === "verify") {
    return (
      <div data-lane="world-agents" data-step="verify-wallet" className={QUIET_WELL}>
        <ApprovalWalletStep
          proofLine={proofLineFor(sessionProofPossible)}
          note={state.note}
          busy={provingWallet}
          disabled={address === null}
          onVerify={() => void verifyWallet()}
        />
      </div>
    );
  }

  if (state.kind === "blocked" && state.onVerdict === true) {
    return (
      <div data-lane="world-agents" data-outcome="on-verdict" role="status" className={QUIET_WELL}>
        <p className="m-0 text-[0.9375rem] font-semibold text-foreground">
          SPOTTER decided to pay, with no World ID step for you.
        </p>
        <p className="m-0 mt-1 text-sm text-muted">{state.message}</p>
      </div>
    );
  }

  if (state.kind === "blocked") {
    return (
      <div data-lane="world-agents" role="alert" className={QUIET_WELL}>
        <p className="m-0 text-[0.9375rem] font-semibold text-foreground">
          SPOTTER decided to pay, and cannot ask you to confirm right now.
        </p>
        <p className="m-0 mt-1 text-sm text-muted">{state.message}</p>
        {state.retry ? (
          <Button
            type="button"
            onClick={() =>
              void (state.needsSignature
                ? retrySignature()
                : state.retryLoad === true
                  ? reload()
                  : ask())
            }
            variant="secondary"
            block
            className="mt-3"
          >
            {state.needsSignature ? "Sign and try again" : "Try again"}
          </Button>
        ) : (
          <Fine className="mt-2">Nothing is recorded or paid until this is fixed on the deployment.</Fine>
        )}
      </div>
    );
  }

  if (state.kind === "settled") {
    return (
      <div data-lane="world-agents" data-outcome="settled" role="status" className={QUIET_WELL}>
        <p className="m-0 text-[0.9375rem] font-semibold">The challenge settled first, so there is nothing to confirm.</p>
        <p className="m-0 mt-1 text-sm text-muted">
          Settle is one-shot, so this payout can no longer happen and there is
          nothing to ask again. The settle credited your stake back; claim it
          on this page.
        </p>
      </div>
    );
  }

  if (state.kind === "done") {
    return (
      <div data-lane="world-agents" data-outcome={state.outcome}>
        <ApprovalOutcomeView outcome={state.outcome} onAskAgain={() => void ask()} />
      </div>
    );
  }

  // pending or verifying
  const { request } = state;
  const verifying = state.kind === "verifying";
  const world = isWorldRequest(request) ? request : null;

  return (
    <div data-lane="world-agents" data-request-id={request.requestId}>
      <ApprovalAsk
        secondsLeft={secondsLeft(request.expiresAt, now)}
        mocked={request.mocked}
        error={state.kind === "pending" ? state.error : null}
        verifying={verifying}
        confirmLabel={world !== null ? "Confirm with World ID" : "Confirm (mocked World ID)"}
        onConfirm={world !== null ? () => setWidgetOpen(true) : () => void approveMock()}
        onDecline={() => void decline()}
      />
      {world !== null ? (
        <WorldApprovalWidget
          open={widgetOpen}
          onOpenChange={setWidgetOpen}
          request={world}
          stage={stage}
          onVerify={verifyWorld}
          onSuccess={() => setWidgetOpen(false)}
          onError={onWorldError}
        />
      ) : null}
    </div>
  );
}

/** A finished ask: what it means, and "Ask again" where asking can still
 *  work. Props only, so the state gallery can draw it. */
export function ApprovalOutcomeView({
  outcome,
  onAskAgain,
}: {
  outcome: ApprovalOutcome;
  onAskAgain: () => void;
}) {
  const copy = outcomeCopy(outcome);
  return (
    <div role="status">
      <p className="m-0 text-sm leading-[1.45] text-haze">{sentence(copy.detail)}</p>
      {copy.askAgain ? (
        <Button type="button" onClick={onAskAgain} block className="mt-3">
          Ask again
        </Button>
      ) : null}
    </div>
  );
}

const QUIET_WELL =
  "rounded-control bg-fill-quiet p-4 shadow-[inset_0_0_0_1px_var(--border)]";

/**
 * The Verify wallet step, drawn from props only so the state gallery can draw
 * it: why the wallet is asked, what the one signature costs (nothing), the
 * tap, and how the last tap ended. Mirrors components/VerifyWalletAction.tsx,
 * which cannot hand the ask back to this card when the proof lands.
 */
export function ApprovalWalletStep({
  proofLine,
  note,
  busy,
  disabled = false,
  onVerify,
}: {
  proofLine: string;
  note: string | null;
  busy: boolean;
  disabled?: boolean;
  onVerify: () => void;
}) {
  return (
    <div className="grid justify-items-start gap-3">
      <div>
        <p className="m-0 text-[0.9375rem] font-semibold text-foreground">
          SPOTTER decided to pay. Your wallet opens the confirmation.
        </p>
        <p className="m-0 mt-1 text-[0.9375rem] leading-[1.45] text-muted">
          Only the wallet that made this claim can answer SPOTTER, and World
          ID asks you to confirm right after. {proofLine}
        </p>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={busy || disabled}
        aria-busy={busy}
        onClick={onVerify}
      >
        {busy ? "Waiting for your wallet" : "Verify wallet"}
      </Button>
      {note !== null ? (
        <p className="m-0 text-sm leading-[1.45] text-haze" role="status">
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** outcomeCopy is written lower case in SPOTTER's old voice; the card reads in
 *  sentence case. */
function sentence(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

/**
 * The open ask, drawn from props only (docs/DESIGN.md, "Verdict card", confirm
 * with World ID): the confirm action, the way out, the live countdown and what
 * the confirmation shares. HumanApprovalCard feeds it the live request; the
 * state gallery feeds it fixtures.
 */
export function ApprovalAsk({
  secondsLeft: left,
  mocked,
  error,
  verifying,
  confirmLabel,
  onConfirm,
  onDecline,
}: {
  secondsLeft: number;
  /** Event mode: the proof is mocked, and the card says so. */
  mocked: boolean;
  error: string | null;
  verifying: boolean;
  confirmLabel: string;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  return (
    <div>
      {mocked ? (
        <p
          data-mocked="true"
          className="m-0 mb-3 inline-flex h-[26px] items-center rounded-tag bg-fill-quiet px-2.5 text-[0.8125rem] font-semibold text-muted shadow-[inset_0_0_0_1px_var(--border)]"
        >
          Event mode: mocked World ID, not production
        </p>
      ) : null}
      {error !== null ? (
        <p role="alert" className="m-0 mb-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="grid gap-2">
        <Button type="button" disabled={verifying} onClick={onConfirm} block>
          {verifying ? "Checking your proof" : confirmLabel}
        </Button>
        <Button type="button" disabled={verifying} onClick={onDecline} variant="tertiary" className="justify-self-center">
          Not now, do not pay
        </Button>
      </div>
      <p className="num m-0 mt-1 text-[0.8125rem] leading-[1.45] text-haze">
        <span className={left <= 15 ? "font-semibold text-foreground" : "font-semibold text-muted"}>
          {formatCountdown(left)} left on this request.
        </span>{" "}
        World App asks you to confirm. It shares nothing about your health and
        sends no transaction, and it does not re-check the goal: your wearable
        already did.
      </p>
    </div>
  );
}
