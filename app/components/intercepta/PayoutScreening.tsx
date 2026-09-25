"use client";

// One line inside The Verdict: the payout screening result from a live
// Intercepta call made before SPOTTER signed anything (lib/server/screening).
//
// Lane contract (docs/LANES.md): props are { status, reason? } and stay so.
// "unconfigured" reads as a plain fact about this deployment, never as an
// error. "blocked" is a decision and says what the wallet cannot do;
// "unavailable" is a wait, not a failure.
//
// Client-safe: nothing here imports server code. The status comes in as a
// prop, or from GET /api/screen/status via useScreeningStatus below.

import { useCallback, useEffect, useState } from "react";

export type ScreeningStatus =
  | "pending"
  | "clear"
  | "blocked"
  | "unavailable"
  | "unconfigured";

export interface PayoutScreeningProps {
  status: ScreeningStatus;
  reason?: string;
}

/** Mirror of lib/server/screening/gate.ts SCREEN_HELD_PREFIX. Kept local so
 *  the receipt can recognise a screening hold without importing server code;
 *  gate.test.ts pins the two strings equal. */
export const SCREEN_HELD_PREFIX = "payout held by screening:";

const COPY: Record<ScreeningStatus, string> = {
  pending: "Payout screening: checking this wallet against mainnet risk data (Intercepta).",
  clear: "Payout screening: clear. Intercepta found no sanctions or scam traits on this wallet.",
  blocked: "Payout screening: blocked. This wallet cannot receive a payout.",
  unavailable:
    "Payout screening: Intercepta did not answer. The payout is held until it does.",
  unconfigured: "Payout screening not enabled on this deployment.",
};

const TONE: Record<ScreeningStatus, string> = {
  pending: "text-muted",
  clear: "text-accent",
  blocked: "text-danger",
  unavailable: "text-warning",
  unconfigured: "text-muted",
};

export default function PayoutScreening({ status, reason }: PayoutScreeningProps) {
  const detail = status === "blocked" || status === "unavailable" ? reason : undefined;
  return (
    <p
      data-lane="intercepta"
      data-screening={status}
      className={`min-w-0 break-words text-sm ${TONE[status]}`}
    >
      {COPY[status]}
      {detail ? <span className="ml-1 text-xs text-muted">{detail}</span> : null}
    </p>
  );
}

export interface ScreeningStatusResponse {
  status: ScreeningStatus;
  reason?: string;
  checkedAt?: string;
}

/**
 * Read the claim's screening status from the server. Polls while pending
 * (the verdict lands once SPOTTER reaches the record or settle step); stops
 * on any settled answer. Never calls Intercepta from the browser: the key
 * stays server-side and the endpoint only reads the ledger.
 */
export function useScreeningStatus(
  goalId: string | null,
  pollMs = 5_000,
): ScreeningStatusResponse & { refresh: () => void } {
  const [state, setState] = useState<ScreeningStatusResponse>({ status: "pending" });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (goalId === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const res = await fetch(
          `/api/screen/status?goalId=${encodeURIComponent(goalId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as ScreeningStatusResponse;
        if (cancelled) return;
        setState(body);
        if (body.status === "pending" && pollMs > 0) {
          timer = setTimeout(load, pollMs);
        }
      } catch {
        // The endpoint reads a ledger; a transient failure is just "not yet".
        if (cancelled) return;
        if (pollMs > 0) timer = setTimeout(load, pollMs);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [goalId, pollMs, tick]);

  return { ...state, refresh };
}

/** Convenience for screens that only have the goal id. */
export function PayoutScreeningForGoal({ goalId }: { goalId: string | null }) {
  const { status, reason } = useScreeningStatus(goalId);
  return <PayoutScreening status={status} reason={reason} />;
}
