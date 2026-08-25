"use client";

// The closed-beta gate. Wraps the page content in the root layout.
//
// Public surfaces (the landing page, legal pages, public profiles, and invite
// links) always render — a LinkedIn visitor sees the pitch, and an invited
// friend can read a dare before signing in. Everything else requires an
// approved wallet: an unauthenticated visitor is asked to sign in, a signed-in
// but unapproved wallet gets the request-access flow, and an approved wallet (or
// an admin) passes straight through.
//
// This is a UX gate. It decides what the browser SHOWS; the server decides what
// actually happens (isAllowed on gated routes). The two are intentionally
// separate so a determined caller cannot talk their way past enforcement by
// editing client state.

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useAccess } from "@/lib/useAccess";
import { ErrorNote, TAP_TARGET } from "@/components/ui";
import RequestAccess from "@/components/RequestAccess";

// Exact public paths and public path prefixes. Keep in sync with the route map;
// anything not listed here is gated.
const PUBLIC_EXACT = new Set(["/", "/privacy", "/terms"]);
const PUBLIC_PREFIXES = ["/u/", "/c/"];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function GateShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-6 py-10 text-center">
      {children}
    </div>
  );
}

function OtterCard({
  pose,
  alt,
}: {
  pose: string;
  alt: string;
}) {
  return (
    <div className="relative w-full max-w-xs">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-6 -z-10 rounded-full bg-accent/20 blur-3xl"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/spotter/${pose}`}
        alt={alt}
        className="mx-auto aspect-square w-56 rounded-3xl border border-edge bg-surface object-cover shadow-sm"
      />
    </div>
  );
}

export default function AccessGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const gated = !isPublicPath(pathname);
  const { ready, authenticated, login } = useEmbeddedWallet();
  const access = useAccess(gated);

  // Public pages never gate.
  if (!gated) return <>{children}</>;

  // Approved or admin: the app, unchanged. Checked before the loading gate so a
  // cached-fast resolve does not flash a spinner.
  if (access.isAdmin || access.status === "approved") return <>{children}</>;

  if (!ready || access.loading) {
    return (
      <GateShell>
        <OtterCard pose="spotter-peek.png" alt="" />
        <p className="text-sm text-muted">Checking your spot on the list…</p>
      </GateShell>
    );
  }

  if (!authenticated) {
    return (
      <GateShell>
        <OtterCard
          pose="spotter-greet.png"
          alt="SPOTTER the otter waving hello"
        />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            GoHealthMe is invite-only right now.
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-muted">
            We are running a closed family-and-friends beta. Sign in and ask for
            a spot — no crypto experience needed, a wallet is created for you
            automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={login}
          className={`rounded-xl border border-accent/40 bg-accent/10 font-semibold text-accent-strong hover:bg-accent/15 ${TAP_TARGET}`}
        >
          Sign in to request access
        </button>
      </GateShell>
    );
  }

  if (access.error) {
    return (
      <GateShell>
        <div className="w-full text-left">
          <ErrorNote
            title="Could not check your access."
            detail="Something went wrong reaching the server. Your spot is safe — try again."
            onRetry={access.refetch}
          />
        </div>
      </GateShell>
    );
  }

  // Authenticated but not approved: none / pending / denied.
  return <RequestAccess status={access.status} onSubmitted={access.refetch} />;
}
