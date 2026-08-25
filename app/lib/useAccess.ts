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

import { useCallback, useEffect, useState } from "react";
import { useEmbeddedWallet } from "@/lib/wallet";

export type AccessStatus = "none" | "pending" | "approved" | "denied";

export interface AccessState {
  loading: boolean;
  error: boolean;
  status: AccessStatus;
  isAdmin: boolean;
  authenticated: boolean;
  address: string | null;
  refetch: () => void;
}

interface StatusResponse {
  status: AccessStatus;
  isAdmin: boolean;
}

interface Tagged {
  address: string;
  status: AccessStatus;
  isAdmin: boolean;
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
        r.ok
          ? (r.json() as Promise<StatusResponse>)
          : Promise.reject(new Error(String(r.status))),
      )
      .then((data) => {
        if (cancelled) return;
        setResult({ address, status: data.status, isAdmin: Boolean(data.isAdmin) });
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
  } else {
    loading = true; // fetch in flight for this address
  }

  return { loading, error, status, isAdmin, authenticated, address, refetch };
}
