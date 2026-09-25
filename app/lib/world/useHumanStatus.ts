"use client";

// Lane contract (docs/LANES.md): read-only view of whether a wallet has proven
// it is one human, backed by GET /api/world/status?address=.
//
// Same shape of hook as lib/useAccess.ts: results are tagged with the address
// they were fetched for, so a wallet switch never shows the previous wallet's
// answer while the new fetch is in flight, and the effect only ever calls
// setState from async callbacks. The status route is unauthenticated, so this
// never opens a wallet prompt and the character card can read it on render.
//
// `status` is "unknown" until the first answer lands (or when there is no
// address, or the fetch failed): the card must not show a stake button on
// "unknown", and must not show "verify" either, since either could be wrong.
// A failed read is retried twice before `error` is set (lib/world/retry.ts),
// and `error` never reads as World off: every staking surface holds the stake
// on it with a manual retry (the "check-failed" lock in lib/game/lobby.ts).
// `mode` tells the card whether a verification here is real ("live"), mocked
// for the event ("mock"), or not offered on this deployment ("off").

import { useCallback, useEffect, useState } from "react";
import { fetchHumanStatus, type WorldMode } from "@/lib/world/api";
import { withRetry } from "@/lib/world/retry";

export type HumanStatus = "unknown" | "verified" | "unverified";

export interface HumanStatusView {
  status: HumanStatus;
  loading: boolean;
  refresh: () => void;
  /** Deployment mode; "unknown" until the first answer lands. */
  mode: WorldMode | "unknown";
  /** ISO-8601 of the verification, when verified and known. */
  verifiedAt: string | null;
  /** True when the last fetch for this address failed. */
  error: boolean;
}

interface Tagged {
  address: string;
  status: HumanStatus;
  mode: WorldMode;
  verifiedAt: string | null;
}

export function useHumanStatus(address: string | null): HumanStatusView {
  const [result, setResult] = useState<Tagged | null>(null);
  const [errorFor, setErrorFor] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => {
    setResult(null);
    setErrorFor(null);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (address === null || address === "") return;
    let cancelled = false;
    // A transient failure is retried before it becomes an error: the error
    // state holds the stake at the join, so it should mean "still failing".
    withRetry(() => fetchHumanStatus(address), { shouldStop: () => cancelled })
      .then((data) => {
        if (cancelled) return;
        setResult({
          address,
          status: data.human === "verified" ? "verified" : "unverified",
          mode: data.mode,
          verifiedAt: data.verifiedAt ?? null,
        });
        setErrorFor(null);
      })
      .catch(() => {
        if (!cancelled) setErrorFor(address);
      });
    return () => {
      cancelled = true;
    };
  }, [address, nonce]);

  const fresh = result !== null && result.address === address;
  const errored = errorFor !== null && errorFor === address;

  if (address === null || address === "") {
    return {
      status: "unknown",
      loading: false,
      refresh,
      mode: "unknown",
      verifiedAt: null,
      error: false,
    };
  }
  if (fresh) {
    return {
      status: result.status,
      loading: false,
      refresh,
      mode: result.mode,
      verifiedAt: result.verifiedAt,
      error: false,
    };
  }
  return {
    status: "unknown",
    loading: !errored,
    refresh,
    mode: "unknown",
    verifiedAt: null,
    error: errored,
  };
}
