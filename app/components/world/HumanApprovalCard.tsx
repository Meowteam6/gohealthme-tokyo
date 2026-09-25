"use client";

// World ID for Agents (ETHGlobal Tokyo 2026): the boss moment. SPOTTER has
// decided to pay and, before any USDC moves, asks the achiever, the human,
// for a fresh World ID confirmation. This card is that ask.
//
// Lane contract (docs/LANES.md): { goalId, poolId, address, onResult }. Mounted
// by the claim screens when the run reports "awaiting-approval" (and the
// three refusal states); never edited by the UX lane.
//
// WHAT IT DOES. Opens (or picks up) the request through
// POST /api/agent/approval/request, runs the fresh verification, completes it
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
  outcomeCopy,
  parseOpenRequest,
  parseStatus,
  secondsLeft,
  type ApprovalOutcome,
  type OpenApprovalRequest,
} from "@/lib/world/approval-client";

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
  /** The ask could not be opened or answered: no signature, a misconfigured
   *  deployment, or a network fault. Retryable unless the server said the
   *  step is not enabled here at all. */
  | { kind: "blocked"; message: string; retry: boolean; needsSignature: boolean };

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

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error !== "") return body.error;
  } catch {
    // fall through
  }
  return `SPOTTER's approval service answered ${response.status}.`;
}

export default function HumanApprovalCard(props: HumanApprovalCardProps) {
  const { goalId, address, onResult } = props;
  const requestAuth = useWalletAuth();
  const [state, setState] = useState<CardState>({ kind: "asking" });
  const [now, setNow] = useState(() => Date.now());
  const [widgetOpen, setWidgetOpen] = useState(false);
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
      return {
        kind: "blocked",
        message: await readError(response),
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

  // First ask on mount. The initial state is already "asking", so nothing is
  // set synchronously here; the result lands when the request answers.
  useEffect(() => {
    let alive = true;
    void openRequest().then((next) => {
      if (alive && mounted.current) setState(next);
    });
    return () => {
      alive = false;
    };
  }, [openRequest]);

  // Report each terminal outcome exactly once per request id.
  useEffect(() => {
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
      const message = await readError(response);
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
      proof: mockApprovalProof(request.action),
    });
    if (!mounted.current || result.ok) return;
    if (result.fatal) {
      // The state may have moved on server-side; re-ask to learn where it is.
      void ask();
      return;
    }
    setState({ kind: "pending", request, error: result.message });
  }, [state, complete, ask]);

  const decline = useCallback(async () => {
    if (state.kind !== "pending") return;
    const { request } = state;
    setState({ kind: "verifying", request });
    const result = await complete(request, { decline: true });
    if (!mounted.current || result.ok) return;
    if (result.fatal) {
      void ask();
      return;
    }
    setState({ kind: "pending", request, error: result.message });
  }, [state, complete, ask]);

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

  const retrySignature = useCallback(async () => {
    await requestAuth({ refresh: true });
    void ask();
  }, [requestAuth, ask]);

  // ------------------------------------------------------------- rendering

  if (state.kind === "asking") {
    return (
      <div
        data-lane="world-agents"
        className="rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm"
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
        className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"
        role="alert"
      >
        <SpotterLabel />
        <p className="mt-1 text-foreground/80">
          i decided to pay, but i cannot ask you to confirm right now.
        </p>
        <p className="mt-2 text-muted">{state.message}</p>
        {state.retry ? (
          <button
            type="button"
            onClick={() => void (state.needsSignature ? retrySignature() : ask())}
            className="mt-3 w-full rounded-xl border border-accent/50 bg-surface-raised px-5 py-3 text-sm font-semibold text-accent hover:bg-accent-deep"
          >
            {state.needsSignature ? "Sign and try again" : "Try again"}
          </button>
        ) : (
          <p className="mt-2 text-xs text-muted">
            Nothing is recorded or paid until this is fixed on the deployment.
          </p>
        )}
      </div>
    );
  }

  if (state.kind === "done") {
    const copy = outcomeCopy(state.outcome);
    const tone =
      state.outcome === "approved"
        ? "border-accent/40 bg-accent/10"
        : "border-warning/40 bg-warning/10";
    return (
      <div
        data-lane="world-agents"
        data-outcome={state.outcome}
        className={`rounded-xl border p-4 text-sm ${tone}`}
        role="status"
      >
        <SpotterLabel />
        <p className="mt-1 font-semibold">{copy.headline}</p>
        <p className="mt-1 text-foreground/80">{copy.detail}</p>
        {copy.askAgain ? (
          <button
            type="button"
            onClick={() => void ask()}
            className="mt-3 w-full rounded-xl border border-accent/50 bg-surface-raised px-5 py-3 text-sm font-semibold text-accent hover:bg-accent-deep"
          >
            Ask SPOTTER again
          </button>
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
      className="rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm"
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
            <button
              type="button"
              disabled={verifying}
              onClick={() => setWidgetOpen(true)}
              className="w-full rounded-xl bg-accent-strong px-5 py-3.5 text-base font-semibold text-background hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {verifying ? "checking your proof..." : "Confirm with World ID"}
            </button>
            <WorldApprovalWidget
              open={widgetOpen}
              onOpenChange={setWidgetOpen}
              request={world}
              address={address}
              onVerify={verifyWorld}
              onSuccess={() => setWidgetOpen(false)}
              onError={(message) =>
                setState({ kind: "pending", request, error: message })
              }
            />
          </>
        ) : (
          <button
            type="button"
            disabled={verifying}
            onClick={() => void approveMock()}
            className="w-full rounded-xl bg-accent-strong px-5 py-3.5 text-base font-semibold text-background hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {verifying ? "checking your proof..." : "Confirm (mocked World ID)"}
          </button>
        )}
        <button
          type="button"
          disabled={verifying}
          onClick={() => void decline()}
          className="w-full rounded-xl border border-edge bg-surface-raised px-5 py-3 text-sm font-semibold text-foreground/80 hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
        >
          Not now, do not pay
        </button>
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
    <span className="text-xs font-semibold uppercase tracking-widest text-muted">
      SPOTTER asks
    </span>
  );
}
