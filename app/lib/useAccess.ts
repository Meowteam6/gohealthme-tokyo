"use client";

// Reads the connected wallet's closed-beta status from /api/access/status.
//
// The status endpoint is an unauthenticated read (naming an address discloses
// nothing sensitive), so this never opens a wallet-signature prompt — the gate
// can call it on every navigation. A failed fetch surfaces as `error` rather
// than defaulting to "none": silently showing the request form to an already
// approved user on a network blip would be a lie about their state.
//
// The effect only ever calls setState from async fetch callbacks; every
// synchronous case (disabled, SDK not ready, no wallet) is DERIVED at render.
// Results and errors are tagged with the address they belong to, so a wallet
// switch never shows the previous wallet's status while the new fetch is in
// flight.
//
// `source` is kept (2026-10-02): it is the only client read that still knows a
// wallet is World-bound while KILL_WORLD_ID pauses World. The World lane then
// reads off and an approved status alone looks like the list, so the
// character card stamped a World-verified player "On the list".

import { useCallback, useEffect, useState } from "react";
import { useEmbeddedWallet } from "@/lib/wallet";

export type AccessStatus = "none" | "pending" | "approved" | "denied";

/** Why the gate answered the way it did (lib/server/access.ts): an admin
 *  wallet, a World ID binding (kept while World is paused), the closed-beta
 *  list record, or nothing. */
export type AccessSource = "admin" | "world" | "request" | "none";

export interface AccessState {
  loading: boolean;
  error: boolean;
  status: AccessStatus;
  isAdmin: boolean;
  /** "none" until this address's answer lands. The hook always sets it;
   *  optional so view fixtures built before 2026-10-02 still type (a reader
   *  treats absent as "none"), like Character.humanProof. */
  source?: AccessSource;
  authenticated: boolean;
  address: string | null;
  refetch: () => void;
}

export interface AccessStatusRead {
  status: AccessStatus;
  isAdmin: boolean;
  source: AccessSource;
}

interface Tagged extends AccessStatusRead {
  address: string;
}

const STATUSES: readonly AccessStatus[] = ["none", "pending", "approved", "denied"];
const SOURCES: readonly AccessSource[] = ["admin", "world", "request", "none"];

/**
 * `GET /api/access/status` -> what the gate keeps, or null when the answer has
 * no usable status (the gate then shows its retry, never a guess). A missing
 * or unknown `source` is never read as a World binding: an admin stays admin,
 * any other record reads as the list, and no record reads as none.
 */
export function parseAccessStatus(payload: unknown): AccessStatusRead | null {
  if (typeof payload !== "object" || payload === null) return null;
  const body = payload as Record<string, unknown>;
  const status = STATUSES.find((s) => s === body.status);
  if (status === undefined) return null;
  const isAdmin = body.isAdmin === true;
  const known = SOURCES.find((s) => s === body.source);
  const source: AccessSource =
    known ?? (isAdmin ? "admin" : status === "none" ? "none" : "request");
  return { status, isAdmin, source };
}

export function useAccess(enabled = true): AccessState {
  const { address, authenticated, ready } = useEmbeddedWallet();
  const [result, setResult] = useState<Tagged | null>(null);
  const [errorFor, setErrorFor] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => {
    // Clear any tagged result so the gate shows a loading state, not stale data,
    // while the fresh status loads. Called from event handlers, never an effect.
    setResult(null);
    setErrorFor(null);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !ready || address === null) return;
    let cancelled = false;
    fetch(`/api/access/status?address=${address}`)
      .then((r) =>
        r.ok ? (r.json() as Promise<unknown>) : Promise.reject(new Error(String(r.status))),
      )
      .then((data) => {
        if (cancelled) return;
        const read = parseAccessStatus(data);
        if (read === null) throw new Error("access status answered something unusable");
        setResult({ address, ...read });
        setErrorFor(null);
      })
      .catch(() => {
        if (!cancelled) setErrorFor(address);
      });
    return () => {
      cancelled = true;
    };
  }, [address, ready, enabled, nonce]);

  // Derive the returned state at render — no synchronous setState in the effect.
  const fresh = result !== null && result.address === address;
  const errored = errorFor !== null && errorFor === address;

  let loading = false;
  let error = false;
  let status: AccessStatus = "none";
  let isAdmin = false;
  let source: AccessSource = "none";

  if (!enabled) {
    // nothing to load
  } else if (!ready) {
    loading = true;
  } else if (address === null) {
    // no wallet: not loading, status none
  } else if (errored) {
    error = true;
  } else if (fresh) {
    status = result.status;
    isAdmin = result.isAdmin;
    source = result.source;
  } else {
    loading = true; // fetch in flight for this address
  }

  return { loading, error, status, isAdmin, source, authenticated, address, refetch };
}
