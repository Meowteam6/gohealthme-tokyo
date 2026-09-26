"use client";

// The admin's access queue at /admin. Lists every request newest-first and lets
// an admin approve or deny each one. Every call is signed with the admin's
// wallet; the server re-checks that the signer is in ADMIN_ADDRESSES, so this
// component showing is never what grants access — the server does. A non-admin
// wallet gets an honest "not an admin" panel, not a blank screen.

import { useCallback, useEffect, useState } from "react";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useWalletAuth } from "@/lib/useWalletAuth";
import {
  fetchWithWalletAuth,
  authBlockReason,
  type WalletAuthRequester,
} from "@/lib/client-auth";
import { Badge, ErrorNote, TAP_TARGET } from "@/components/ui";

type Decision = "approve" | "deny";

interface AccessRecord {
  address: string;
  status: "pending" | "approved" | "denied";
  name: string;
  email: string;
  reason: string;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

type Load =
  | { state: "loading" }
  | { state: "need-signin" }
  | { state: "forbidden" }
  | { state: "error"; message: string }
  | { state: "ok"; requests: AccessRecord[] };

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function whenText(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString();
}

function statusTone(status: AccessRecord["status"]): "accent" | "muted" | "warning" {
  if (status === "approved") return "accent";
  if (status === "denied") return "warning";
  return "muted";
}

// Pure loader: fetches the queue and RETURNS the next view state. It sets no
// React state itself, so callers can invoke it from an effect and apply the
// result inside a .then callback (the pattern react-hooks/set-state-in-effect
// wants) without a synchronous setState anywhere in the effect body.
async function loadQueue(requestAuth: WalletAuthRequester): Promise<Load> {
  const { response, auth } = await fetchWithWalletAuth(
    "/api/admin/access",
    { method: "GET" },
    requestAuth,
  );
  if (auth.kind !== "ok") return { state: "need-signin" };
  if (response.status === 403) return { state: "forbidden" };
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    return {
      state: "error",
      message: detail?.error ?? `Request failed (${response.status}).`,
    };
  }
  const data = (await response.json()) as { requests: AccessRecord[] };
  return { state: "ok", requests: data.requests };
}

export default function AdminAccess() {
  const { authenticated, ready, login } = useEmbeddedWallet();
  const requestAuth = useWalletAuth();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [deciding, setDeciding] = useState<string | null>(null);

  // Event-handler refresh (Refresh button, retry): setState here is allowed, and
  // the result is applied inside the .then callback.
  const refresh = useCallback(() => {
    setLoad({ state: "loading" });
    loadQueue(requestAuth).then(setLoad, () =>
      setLoad({ state: "error", message: "Could not load the queue." }),
    );
  }, [requestAuth]);

  useEffect(() => {
    // The "not signed in" case is derived at render; here we only fetch and
    // apply the result in a callback, so no setState runs synchronously in the
    // effect body.
    if (!ready || !authenticated) return;
    let cancelled = false;
    loadQueue(requestAuth).then(
      (next) => {
        if (!cancelled) setLoad(next);
      },
      () => {
        if (!cancelled) {
          setLoad({ state: "error", message: "Could not load the queue." });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, requestAuth]);

  async function decide(address: string, decision: Decision) {
    setDeciding(address);
    try {
      const { response, auth } = await fetchWithWalletAuth(
        "/api/admin/access",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address, decision }),
        },
        requestAuth,
      );
      if (auth.kind !== "ok" || !response.ok) return;
      // Reflect the change locally without a full reload flash.
      setLoad((prev) =>
        prev.state === "ok"
          ? {
              state: "ok",
              requests: prev.requests.map((r) =>
                r.address.toLowerCase() === address.toLowerCase()
                  ? { ...r, status: decision === "approve" ? "approved" : "denied" }
                  : r,
              ),
            }
          : prev,
      );
    } finally {
      setDeciding(null);
    }
  }

  if (!ready) {
    return <p className="py-10 text-center text-sm text-muted">Loading…</p>;
  }

  if (!authenticated || load.state === "need-signin") {
    const reason = authBlockReason({ kind: "no-wallet" });
    return (
      <div className="mx-auto max-w-md py-10 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Admin access</h1>
        <p className="mx-auto mt-3 max-w-sm text-muted">
          {reason ?? "Sign in with your admin wallet to review requests."}
        </p>
        <button
          type="button"
          onClick={login}
          className={`mt-5 rounded-xl border border-accent/40 bg-accent/10 font-semibold text-accent-deep hover:bg-accent/15 ${TAP_TARGET}`}
        >
          Sign in
        </button>
      </div>
    );
  }

  if (load.state === "forbidden") {
    return (
      <div className="mx-auto max-w-md py-10 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Not an admin.</h1>
        <p className="mx-auto mt-3 max-w-sm text-muted">
          This wallet can&apos;t review access requests. Switch to the admin
          wallet listed in ADMIN_ADDRESSES.
        </p>
      </div>
    );
  }

  if (load.state === "error") {
    return (
      <div className="mx-auto max-w-md py-10">
        <ErrorNote title="Could not load the queue." detail={load.message} onRetry={() => void refresh()} />
      </div>
    );
  }

  if (load.state === "loading") {
    return <p className="py-10 text-center text-sm text-muted">Loading the queue…</p>;
  }

  const { requests } = load;
  const pending = requests.filter((r) => r.status === "pending");

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Access requests</h1>
          <p className="mt-1 text-sm text-muted">
            {pending.length} pending · {requests.length} total
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className={`rounded-xl border border-edge bg-surface font-medium text-foreground hover:bg-surface-raised ${TAP_TARGET}`}
        >
          Refresh
        </button>
      </div>

      {requests.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-edge bg-surface/50 px-6 py-12 text-center text-muted">
          No requests yet. When someone asks to join, they show up here.
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {requests.map((r) => (
            <li
              key={r.address}
              className="rounded-2xl border border-edge bg-surface p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="font-semibold">
                    {r.name.trim() !== "" ? r.name : "Someone"}
                  </span>
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                </div>
                <span className="font-mono text-xs text-muted">{shortAddr(r.address)}</span>
              </div>
              {r.email.trim() !== "" ? (
                <p className="mt-2 break-all text-sm text-muted">{r.email}</p>
              ) : null}
              {r.reason.trim() !== "" ? (
                <p className="mt-2 text-sm text-foreground/80">{r.reason}</p>
              ) : null}
              <p className="mt-2 text-xs text-muted">Asked {whenText(r.requestedAt)}</p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={deciding === r.address || r.status === "approved"}
                  onClick={() => void decide(r.address, "approve")}
                  className={`rounded-lg border border-accent/40 bg-accent/10 font-semibold text-accent-deep hover:bg-accent/15 disabled:opacity-50 ${TAP_TARGET}`}
                >
                  {r.status === "approved" ? "Approved" : "Approve"}
                </button>
                <button
                  type="button"
                  disabled={deciding === r.address || r.status === "denied"}
                  onClick={() => void decide(r.address, "deny")}
                  className={`rounded-lg border border-edge bg-surface font-semibold text-foreground hover:bg-surface-raised disabled:opacity-50 ${TAP_TARGET}`}
                >
                  {r.status === "denied" ? "Denied" : "Deny"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
