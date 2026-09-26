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
import { Badge, Button, Card, ErrorNote, Skeleton } from "@/components/ui";
import { EmptyCard, PAGE_COLUMN, PAGE_TITLE } from "@/components/night/kit";

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

const STATUS_LABEL: Record<AccessRecord["status"], string> = {
  pending: "Pending",
  approved: "Approved",
  denied: "Denied",
};

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
    return (
      <div className={PAGE_COLUMN} aria-busy="true">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="mt-6 h-32" />
      </div>
    );
  }

  if (!authenticated || load.state === "need-signin") {
    const reason = authBlockReason({ kind: "no-wallet" });
    return (
      <div className={PAGE_COLUMN}>
        <h1 className={PAGE_TITLE}>Admin access</h1>
        <Card className="mt-6">
          <p className="m-0 text-muted">
            {reason ?? "Sign in with your admin wallet to review requests."}
          </p>
          <Button onClick={login} className="mt-4">
            Sign in
          </Button>
        </Card>
      </div>
    );
  }

  if (load.state === "forbidden") {
    return (
      <div className={PAGE_COLUMN}>
        <h1 className={PAGE_TITLE}>Not an admin.</h1>
        <Card className="mt-6">
          <p className="m-0 text-muted">
            This wallet can&apos;t review access requests. Switch to the admin
            wallet listed in ADMIN_ADDRESSES.
          </p>
        </Card>
      </div>
    );
  }

  if (load.state === "error") {
    return (
      <div className={PAGE_COLUMN}>
        <ErrorNote title="Could not load the queue." detail={load.message} onRetry={() => void refresh()} />
      </div>
    );
  }

  if (load.state === "loading") {
    return (
      <div className={PAGE_COLUMN} aria-busy="true">
        <p className="sr-only">Loading the queue</p>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="mt-6 h-32" />
        <Skeleton className="mt-3 h-32" />
      </div>
    );
  }

  const { requests } = load;
  const pending = requests.filter((r) => r.status === "pending");

  return (
    <div className={PAGE_COLUMN}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className={PAGE_TITLE}>Access requests</h1>
          <p className="num m-0 mt-1.5 text-muted">
            {pending.length} pending · {requests.length} total
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>

      {requests.length === 0 ? (
        <div className="mt-6">
          <EmptyCard title="No requests yet" detail="When someone asks to join, they show up here." />
        </div>
      ) : (
        <ul className="m-0 mt-6 flex list-none flex-col gap-3 p-0">
          {requests.map((r) => (
            <li key={r.address}>
              <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="font-semibold">
                    {r.name.trim() !== "" ? r.name : "Someone"}
                  </span>
                  <Badge tone={statusTone(r.status)}>{STATUS_LABEL[r.status]}</Badge>
                </div>
                <span className="font-mono text-xs text-haze">{shortAddr(r.address)}</span>
              </div>
              {r.email.trim() !== "" ? (
                <p className="m-0 mt-2 break-all text-sm text-muted">{r.email}</p>
              ) : null}
              {r.reason.trim() !== "" ? (
                <p className="m-0 mt-2 text-[0.9375rem] text-foreground">{r.reason}</p>
              ) : null}
              <p className="num m-0 mt-2 text-[0.8125rem] text-haze">Asked {whenText(r.requestedAt)}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={deciding === r.address || r.status === "approved"}
                  onClick={() => void decide(r.address, "approve")}
                >
                  {r.status === "approved" ? "Approved" : "Approve"}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={deciding === r.address || r.status === "denied"}
                  onClick={() => void decide(r.address, "deny")}
                >
                  {r.status === "denied" ? "Denied" : "Deny"}
                </Button>
              </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
