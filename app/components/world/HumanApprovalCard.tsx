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
// Every server call carries the wallet signature (lib/client-auth.ts), so a
// stranger holding a goalId or a requestId can neither open nor answer the
// ask. The signature only proves the wallet is yours; no transaction is sent.

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  authBlockReason,
  fetchWithWalletAuth,
  type ClientAuth,
} from "@/lib/client-auth";
import { useWalletAuth } from "@/lib/useWalletAuth";
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
import { Button } from "@/components/ui";

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

const STATUS_POLL_MS = 2_000;
const COUNTDOWN_TICK_MS = 500;

type CardState =
  | { kind: "asking" }
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
    };

type WorldRequest = OpenApprovalRequest & {
  world: NonNullable<OpenApprovalRequest["world"]>;
};

function isWorldRequest(request: OpenApprovalRequest): request is WorldRequest {
  return request.provider === "world" && request.world !== undefined;
}

function authBlock(auth: ClientAuth): CardState {
  return {
    kind: "blocked",
    message:
      authBlockReason(auth) ??
      "Sign with the wallet that made this claim to answer SPOTTER.",
    retry: true,
    needsSignature: auth.kind !== "no-wallet",
  };
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

export default function HumanApprovalCard(props: HumanApprovalCardProps) {
  // props.address is not used as the proof signal any more: the server hands
  // back `signal` (`<goalId>:<attempt>`), which binds the proof to the payout.
  const { goalId, onResult } = props;
  const requestAuth = useWalletAuth();
  const [state, setState] = useState<CardState>({ kind: "asking" });
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

  // Open, or pick up, the request. Idempotent server-side: SPOTTER's own ask
  // (from the run loop) comes back here with what the browser needs. Pure in
  // the React sense: it returns the next card state and touches nothing.
  const openRequest = useCallback(async (): Promise<CardState> => {
    const sent = await fetchWithWalletAuth(
      "/api/agent/approval/request",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goalId }),
      },
      requestAuth,
    );
    if (sent.auth.kind !== "ok") return authBlock(sent.auth);
    const { response } = sent;
    if (!response.ok) {
      const { message, code } = await readError(response);
      // The run settled first: a terminal fact, not an error to retry.
      if (response.status === 409 && code === SETTLED_CODE) return { kind: "settled" };
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
  }, [goalId, requestAuth]);

  /** Button-driven re-ask: shows the asking state, then whatever comes back. */
  const ask = useCallback(() => {
    setState({ kind: "asking" });
    void openRequest().then((next) => {
      if (mounted.current) setState(next);
    });
  }, [openRequest]);

  // Mount: READ where the confirmation stands before anything else. A
  // finished answer is adopted, never re-asked (mountActionFor); only a
  // pending request or a missing one is fetched with the idempotent POST.
  const load = useCallback(async (): Promise<CardState> => {
    let status: ReturnType<typeof parseStatus>;
    try {
      const response = await fetch(
        `/api/agent/approval/status?goalId=${encodeURIComponent(goalId)}`,
        { cache: "no-store" },
      );
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
    return openRequest();
  }, [goalId, openRequest]);

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
        const response = await fetch(
          `/api/agent/approval/status?goalId=${encodeURIComponent(goalId)}`,
          { cache: "no-store" },
        );
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

  const retrySignature = useCallback(async () => {
    await requestAuth({ refresh: true });
    reload();
  }, [requestAuth, reload]);

  // ------------------------------------------------------------- rendering

  if (state.kind === "asking") {
    return (
      <div
        data-lane="world-agents"
        className="rounded-2xl border border-edge bg-surface-raised p-4 text-sm"
        aria-busy="true"
      >
        <SpotterLabel />
        <p className="mt-1 text-foreground/80">
          verdict is in. asking you to confirm before anything moves...
        </p>
      </div>
    );
  }

  if (state.kind === "blocked") {
    return (
      <div
        data-lane="world-agents"
        className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm"
        role="alert"
      >
        <SpotterLabel />
        <p className="mt-1 text-foreground/80">
          i decided to pay, but i cannot ask you to confirm right now.
        </p>
        <p className="mt-2 text-muted">{state.message}</p>
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
            variant="ghost"
            className="mt-3 w-full"
          >
            {state.needsSignature ? "Sign and try again" : "Try again"}
          </Button>
        ) : (
          <p className="mt-2 text-xs text-muted">
            Nothing is recorded or paid until this is fixed on the deployment.
          </p>
        )}
      </div>
    );
  }

  if (state.kind === "settled") {
    return (
      <div
        data-lane="world-agents"
        data-outcome="settled"
        className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm"
        role="status"
      >
        <SpotterLabel />
        <p className="mt-1 font-semibold">the run settled first. nothing to confirm.</p>
        <p className="mt-1 text-foreground/80">
          Settle is one-shot, so this payout can no longer happen and there is
          nothing to ask again. The settle credited your stake back; claim it
          on this page.
        </p>
      </div>
    );
  }

  if (state.kind === "done") {
    const copy = outcomeCopy(state.outcome);
    const tone =
      state.outcome === "approved"
        ? "border-edge bg-surface-raised"
        : "border-warning/40 bg-warning/10";
    return (
      <div
        data-lane="world-agents"
        data-outcome={state.outcome}
        className={`rounded-2xl border p-4 text-sm ${tone}`}
        role="status"
      >
        <SpotterLabel />
        <p className="mt-1 font-semibold">{copy.headline}</p>
        <p className="mt-1 text-foreground/80">{copy.detail}</p>
        {copy.askAgain ? (
          <Button
            type="button"
            onClick={() => void ask()}
            variant="ghost"
            className="mt-3 w-full"
          >
            Ask SPOTTER again
          </Button>
        ) : null}
      </div>
    );
  }

  // pending or verifying
  const { request } = state;
  const left = secondsLeft(request.expiresAt, now);
  const verifying = state.kind === "verifying";
  const world = isWorldRequest(request) ? request : null;

  return (
    <div
      data-lane="world-agents"
      data-request-id={request.requestId}
      className="rounded-2xl border border-edge bg-surface-raised p-4 text-sm"
    >
      <div className="flex items-baseline justify-between gap-3">
        <SpotterLabel />
        <span
          className={`font-mono text-xs ${left <= 15 ? "text-warning" : "text-muted"}`}
          aria-live="polite"
        >
          {formatCountdown(left)} left
        </span>
      </div>
      <p className="mt-1 text-foreground/80">
        verdict is in. before i move any USDC i need you, the human, to say
        yes. this confirms you want the payout; it does not re-check the goal,
        your wearable already did that.
      </p>
      {request.mocked ? (
        <p
          data-mocked="true"
          className="mt-2 inline-block rounded-md border border-edge bg-surface-raised px-2 py-0.5 text-xs text-muted"
        >
          event mode, mocked proofs (not production)
        </p>
      ) : null}
      {state.kind === "pending" && state.error !== null ? (
        <p role="alert" className="mt-2 text-warning">
          {state.error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        {world !== null ? (
          <>
            <Button
              type="button"
              disabled={verifying}
              onClick={() => setWidgetOpen(true)}
              className="w-full"
            >
              {verifying ? "checking your proof..." : "Confirm with World App"}
            </Button>
            <WorldApprovalWidget
              open={widgetOpen}
              onOpenChange={setWidgetOpen}
              request={world}
              stage={stage}
              onVerify={verifyWorld}
              onSuccess={() => setWidgetOpen(false)}
              onError={onWorldError}
            />
          </>
        ) : (
          <Button
            type="button"
            disabled={verifying}
            onClick={() => void approveMock()}
            className="w-full"
          >
            {verifying ? "checking your proof..." : "Confirm (mocked World ID)"}
          </Button>
        )}
        <Button
          type="button"
          disabled={verifying}
          onClick={() => void decline()}
          variant="secondary"
          className="w-full"
        >
          Not now, do not pay
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">
        Signing proves the wallet is yours; no transaction is sent. Nothing is
        recorded or paid until you confirm.
      </p>
    </div>
  );
}

function SpotterLabel() {
  return (
    <span className="text-sm font-bold text-foreground">SPOTTER asks</span>
  );
}
